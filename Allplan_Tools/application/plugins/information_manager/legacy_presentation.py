"""Offline conversion of legacy AIM presentation only; never reads project values."""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from uuid import uuid4

from .presentation_structure import category_children, groups as all_groups, is_group, rows as all_rows


CONTENT = {
    "INFOS_CHECKBOX": ("defaut",),
    "INFOS_COMBOBOX": ("defaut", "liste_attr", "editable"),
    "INFOS_FORMATAGE": ("formatage",),
    "INFOS_LINEEDIT": ("defaut", "formatage", "option", "editable"),
    "INFOS_RADIO": ("defaut", "nb_radios", *(
        f"nom_radio_{i}" for i in range(1, 7)
    )),
}
TABLES = {
    "INFOS_ONGLETS": ("titre", "icone"),
    "INFOS_TITRE": ("nom_objet", "titre", "couleur_fond", "afficher_enfant"),
    "INFOS_ITEMS_ONGLETS": ("nom_onglet", "nom_item", "type_item"),
    "INFOS_ITEMS_TITRES": ("nom_titres", "nom_item", "type_item"),
    "INFOS_SEPARATEUR": ("nom_objet",),
    **{table: ("nom_objet", "num_attr", "nom_attr", "titre_attr", *extra)
       for table, extra in CONTENT.items()},
}
FORMATS = {
    "Aucune modification": "STR",
    "Majuscule": "STR",
    "Minuscule": "STR",
    "1ère lettre en majuscule": "STR",
    "Toutes 1ères lettres en majuscule": "STR",
    "Nombre décimal": "FLOAT",
    "Nombre entier": "INT",
    "Non éditable": "STR",
    "Date": "DATE",
    "E-mail": "EMAIL",
    "Téléphone": "PHONE",
    "Géoloc Postal - Ville": "STR",
    "SIRET": "STR",
    "Lien": "URL",
    "Lien Web": "URL",
}


class IncompatiblePresentation(ValueError):
    """The selected SQLite schema is not the supported legacy AIM schema."""


def _read(source: Path) -> tuple[dict, str]:
    # Explicit columns exclude colour-of-text and all PRJ/DOCS/contact data.
    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        for table, columns in TABLES.items():
            definition = db.execute(
                "SELECT type FROM sqlite_schema WHERE name=?", (table,),
            ).fetchone()
            actual = {row["name"] for row in db.execute(f'PRAGMA table_info("{table}")')}
            if definition is None or definition[0] != "table" or not set(columns) <= actual:
                raise IncompatiblePresentation(
                    f"Ancienne presentation AIM incompatible : table/colonnes {table}."
                )
        encoding = db.execute("PRAGMA encoding").fetchone()[0]
        tables = {
            table: [dict(row) for row in db.execute(
                f'SELECT rowid AS source_rowid, {", ".join(columns)} '
                f'FROM "{table}" ORDER BY rowid'
            )]
            for table, columns in TABLES.items()
        }
        db.rollback()
    return tables, encoding


def _reference(table: str, row: dict) -> dict:
    return {"table": table, "rowid": row["source_rowid"]}


def build_configuration(source: Path, *, configuration_id: str | None = None,
                        mixed=False) -> tuple[dict, dict]:
    """Return both documents from one read transaction, without writing any files."""
    tables, encoding = _read(Path(source))
    identity = configuration_id or str(uuid4())
    if not isinstance(identity, str) or not identity.strip():
        raise ValueError("configurationId doit etre une chaine non vide.")
    configuration: dict = {
        "schema": "aim-presentation-configuration", "version": 2 if mixed else 1,
        "configurationId": identity, "categories": [],
        "resetPolicy": {
            "applyOn": "explicit_reset_only", "checkboxWithoutDefault": "unchecked",
        },
    }
    report: dict = {
        "schema": "aim-presentation-conversion-report", "version": 1,
        "configurationId": identity,
        "source": {
            "fileName": Path(source).name, "encoding": encoding,
            "fileSha256": None,
            "provenanceLimit": "Empreinte fichier non calculee ; lecture SQLite seule.",
            "configurationSnapshotSha256": hashlib.sha256(json.dumps(
                tables, ensure_ascii=True, sort_keys=True, separators=(",", ":"),
            ).encode("utf-8")).hexdigest(),
            "snapshotScope": "Colonnes de configuration selectionnees uniquement.",
        },
        "ordering": {
            "categories": "INFOS_ONGLETS ORDER BY rowid",
            "groups": "INFOS_ITEMS_ONGLETS ORDER BY rowid",
            "rows": "INFOS_ITEMS_TITRES ORDER BY rowid", "positionBase": 1,
        },
        "mappings": [],
        "discarded": {
            "formattingExpressions": [], "separators": [],
            "textColors": "Volontairement abandonnees ; valeurs non lues ni recopiees.",
        },
        "issues": [], "summary": {},
    }
    used = set()

    def issue(code, message, *, target=None, source_ref=None, unresolved=False,
              severity="warning", proposal=None):
        item = {
            "id": f"issue-{len(report['issues']) + 1}", "code": code,
            "severity": severity, "targetId": target, "source": source_ref,
            "status": "unresolved" if unresolved else "known_limitation",
            "message": message,
        }
        if proposal is not None:
            item["proposal"] = proposal
        report["issues"].append(item)
        return item["id"]

    def match(table, key, value, ref) -> dict | None:
        candidates = [row for row in tables[table] if row[key] == value]
        if len(candidates) != 1:
            issue(
                "missing_reference" if not candidates else "ambiguous_reference",
                f"{table}.{key} : reference absente ou non unique.",
                source_ref=ref, severity="error",
            )
            return None
        return candidates[0]

    def mapping(target, table, row, attachment=None):
        used.add((table, row["source_rowid"]))
        item = {
            "targetId": target, "source": _reference(table, row),
            "raw": {k: v for k, v in row.items() if k != "source_rowid"},
        }
        if attachment is not None:
            item["attachment"] = attachment
        report["mappings"].append(item)
        return item

    def line(table, raw, rel, group_id, attachment_table="INFOS_ITEMS_TITRES") -> dict | None:
        ref = _reference(attachment_table, rel)
        target = f"{group_id}-line-{rel['source_rowid']}"
        number = raw["num_attr"]
        if not isinstance(number, str) or not number.isascii() or not number.isdigit():
            issue("invalid_attribute_number", "Numero d'attribut invalide.",
                  source_ref=ref, severity="error")
            return None
        row: dict = {
            "id": target, "position": 0, "num": int(number),
            "title": raw["titre_attr"], "widget": "entry", "type": "STR",
            "resetDefault": {"state": "absent"},
        }
        if mixed:
            row["kind"] = "row"
        trace = mapping(target, table, raw, ref)
        default = raw.get("defaut")
        if table != "INFOS_FORMATAGE" and default is not None:
            row["resetDefault"] = {"state": "defined", "value": default}
        if table == "INFOS_CHECKBOX":
            row["widget"] = "checkbox"
            del row["type"]
            if default is not None and (type(default) is not int or default not in (0, 1)):
                raise ValueError("Defaut checkbox : entier 0/1 ou NULL requis.")
        elif table == "INFOS_COMBOBOX":
            if raw["editable"] not in (0, 1) or not isinstance(raw["liste_attr"], str):
                raise ValueError("Liste combobox ou editable invalide.")
            row["widget"] = "combo" if raw["editable"] else "list"
            row["options"] = raw["liste_attr"].split("\n")
        elif table == "INFOS_FORMATAGE":
            report["discarded"]["formattingExpressions"].append({
                "targetId": target, "expression": raw["formatage"],
            })
        elif table == "INFOS_LINEEDIT":
            fmt = raw["formatage"]
            row["type"] = FORMATS.get(fmt, "STR")
            if fmt == "Date":
                if not isinstance(raw["option"], str):
                    raise ValueError("Option de date textuelle requise.")
                row["dateFormat"] = {
                    "pattern": raw["option"], "syntax": "legacy_aim",
                    "support": "unsupported",
                }
                issue("date_format_not_supported",
                      "Format historique conserve sans traduction ni generation de date.",
                      target=target, source_ref=ref)
            elif fmt not in ("Aucune modification", "Nombre décimal", "Nombre entier",
                             "E-mail", "Téléphone", "Lien", "Lien Web"):
                issue("line_format_behavior_not_supported",
                      "Comportement historique conserve dans le rapport, sans emulation.",
                      target=target, source_ref=ref, unresolved=True)
            if raw["editable"] != 1:
                issue("line_editability_not_supported",
                      "Editabilite historique sans equivalent de parametre actuel.",
                      target=target, source_ref=ref, unresolved=True)
        elif table == "INFOS_RADIO":
            row["widget"] = "list"
            slots = [raw[f"nom_radio_{i}"] for i in range(1, 7)]
            count = raw["nb_radios"]
            if type(count) is not int or not 0 <= count <= 6:
                raise ValueError("nb_radios doit etre un entier entre 0 et 6.")
            slot = (int(default) if isinstance(default, str)
                    and default.isascii() and default.isdigit() else 0)
            label = slots[slot - 1] if 1 <= slot <= 6 else None
            options, choices = [], []
            for index, text in enumerate(slots, 1):
                if text is not None and not isinstance(text, str):
                    raise ValueError("Libelle radio textuel ou NULL requis.")
                destination = None
                if text not in (None, ""):
                    if text in options:
                        issue("radio_duplicate_choice", "Choix regroupe avec sa premiere occurrence.",
                              target=target, source_ref=ref)
                    else:
                        options.append(text)
                    destination = options.index(text)
                    if index > count:
                        issue("radio_choices_beyond_declared_count",
                              f"Case {index} renseignee au-dela de nb_radios={count}.",
                              target=target, source_ref=ref)
                choices.append({"sourceSlot": index, "targetOptionIndex": destination})
            row["options"] = options
            trace["choiceMapping"] = choices
            if default is not None:
                resolution = {
                    "rule": "one_based_source_slot", "sourceSlot": slot or None,
                    "label": label,
                    "targetOptionIndex": options.index(label) if label in options else None,
                }
                if label not in (None, ""):
                    row["resetDefault"] = {"state": "defined", "value": label}
                    trace["defaultResolution"] = resolution
                else:
                    key = issue(
                        "radio_default_unresolvable",
                        "Defaut radio invalide, hors des six cases ou visant une case vide.",
                        target=target, source_ref=ref, unresolved=True, proposal=resolution,
                    )
                    row["resetDefault"] = {"state": "unresolved", "issueId": key}
            else:
                issue("radio_default_absent", "Aucun defaut source radio defini.",
                      target=target, source_ref=ref, severity="info")
        return row

    category_counts = Counter(row["titre"] for row in tables["INFOS_ONGLETS"])
    for raw_category in tables["INFOS_ONGLETS"]:
        ref = _reference("INFOS_ONGLETS", raw_category)
        if category_counts[raw_category["titre"]] != 1:
            issue("ambiguous_reference", "Titre de categorie non unique.",
                  source_ref=ref, severity="error")
            continue
        cat: dict = {
            "id": f"category-{raw_category['source_rowid']}",
            "position": len(configuration["categories"]) + 1,
            "name": raw_category["titre"], "icon": raw_category["icone"], "groups": [],
        }
        if mixed:
            cat["children"] = cat.pop("groups")
        children = category_children(configuration, cat)
        configuration["categories"].append(cat)
        mapping(cat["id"], "INFOS_ONGLETS", raw_category)
        for attachment in tables["INFOS_ITEMS_ONGLETS"]:
            if attachment["nom_onglet"] != raw_category["titre"]:
                continue
            used.add(("INFOS_ITEMS_ONGLETS", attachment["source_rowid"]))
            ref = _reference("INFOS_ITEMS_ONGLETS", attachment)
            if mixed and attachment["type_item"] in CONTENT:
                table = attachment["type_item"]
                raw = match(table, "nom_objet", attachment["nom_item"], ref)
                if raw is not None:
                    converted = line(table, raw, attachment, cat["id"], "INFOS_ITEMS_ONGLETS")
                    if converted is not None:
                        converted["position"] = len(children) + 1
                        children.append(converted)
                continue
            if attachment["type_item"] != "INFOS_TITRE":
                issue("unsupported_reference_type", "Type de groupe non pris en charge.",
                      source_ref=ref, severity="error")
                continue
            raw_group = match("INFOS_TITRE", "nom_objet", attachment["nom_item"], ref)
            if raw_group is None:
                continue
            if raw_group["afficher_enfant"] not in (0, 1):
                raise ValueError("afficher_enfant doit valoir 0 ou 1.")
            group: dict = {
                "id": f"group-{attachment['source_rowid']}",
                "position": len(children) + 1, "title": raw_group["titre"],
                "backgroundColor": raw_group["couleur_fond"],
                "expanded": bool(raw_group["afficher_enfant"]), "rows": [],
            }
            if mixed:
                group["kind"] = "group"
            children.append(group)
            mapping(group["id"], "INFOS_TITRE", raw_group, ref)
            for rel in tables["INFOS_ITEMS_TITRES"]:
                if rel["nom_titres"] != raw_group["nom_objet"]:
                    continue
                used.add(("INFOS_ITEMS_TITRES", rel["source_rowid"]))
                ref = _reference("INFOS_ITEMS_TITRES", rel)
                table = rel["type_item"]
                if table not in CONTENT and table != "INFOS_SEPARATEUR":
                    issue("unsupported_reference_type", "Type de ligne non pris en charge.",
                          source_ref=ref, severity="error")
                    continue
                raw = match(table, "nom_objet", rel["nom_item"], ref)
                if raw is None:
                    continue
                if table == "INFOS_SEPARATEUR":
                    used.add((table, raw["source_rowid"]))
                    report["discarded"]["separators"].append({
                        "parentId": group["id"], "source": _reference(table, raw),
                        "objectId": raw["nom_objet"], "attachment": ref,
                    })
                    continue
                converted = line(table, raw, rel, group["id"])
                if converted is not None:
                    converted["position"] = len(group["rows"]) + 1
                    group["rows"].append(converted)
    for table, entries in tables.items():
        for raw in entries:
            if (table, raw["source_rowid"]) not in used:
                issue("unmapped_source_record", "Enregistrement source non converti.",
                      source_ref=_reference(table, raw), severity="error")
                report.setdefault("unmapped", []).append({
                    "source": _reference(table, raw),
                    "raw": {k: v for k, v in raw.items() if k != "source_rowid"},
                })
    numbers = Counter(row["num"] for row in all_rows(configuration))
    for number, count in numbers.items():
        if count > 1:
            issue("duplicate_attribute_occurrence",
                  f"Attribut {number} : {count} lignes distinctes conservees.", severity="info")
    issues = report["issues"]
    errors = sum(item["severity"] == "error" for item in issues)
    pending = sum(item["status"] == "unresolved" for item in issues)
    report["summary"] = {
        "status": "incomplete" if errors else "requires_decisions" if pending else (
            "converted_with_limitations" if issues else "converted"
        ),
        "categories": len(configuration["categories"]),
        "groups": len(all_groups(configuration)),
        "rows": sum(numbers.values()),
        "ignoredSeparators": len(report["discarded"]["separators"]),
        "unresolvedIssues": pending, "errors": errors,
    }
    validate_documents(configuration, report)
    return configuration, report


def validate_documents(configuration: dict, report: dict) -> None:
    """Validate identities, control parameters, references and output counts."""
    if (configuration["schema"] != "aim-presentation-configuration"
            or report["schema"] != "aim-presentation-conversion-report"
            or configuration["version"] not in (1, 2) or report["version"] != 1
            or configuration["configurationId"] != report["configurationId"]):
        raise ValueError("Identite des documents incoherente.")
    if configuration.get("resetPolicy") != {
        "applyOn": "explicit_reset_only", "checkboxWithoutDefault": "unchecked",
    }:
        raise ValueError("Politique de reinitialisation invalide.")
    ids, lines, groups = set(), [], []

    def register(items):
        for position, item in enumerate(items, 1):
            if item["position"] != position or item["id"] in ids:
                raise ValueError("Position ou identifiant non unique.")
            ids.add(item["id"])

    register(configuration["categories"])
    for cat in configuration["categories"]:
        if not isinstance(cat["name"], str) or not isinstance(cat["icon"], str):
            raise ValueError("Titre ou reference d'icone invalide.")
        children = category_children(configuration, cat)
        register(children)
        for child in children:
            if not is_group(configuration, child):
                lines.append(child)
                continue
            group = child
            groups.append(group)
            if not isinstance(group["title"], str) or type(group["expanded"]) is not bool:
                raise ValueError("Groupe invalide.")
            color = group["backgroundColor"]
            if (not isinstance(color, str) or len(color) != 7 or color[0] != "#"
                    or any(ch not in "0123456789abcdefABCDEF" for ch in color[1:])):
                raise ValueError("Couleur de fond invalide.")
            register(group["rows"])
            lines.extend(group["rows"])
    issue_ids = [issue["id"] for issue in report["issues"]]
    if len(set(issue_ids)) != len(issue_ids):
        raise ValueError("Identifiants de diagnostics non uniques.")
    for row in lines:
        if type(row["num"]) is not int or row["num"] < 0 or not isinstance(row["title"], str):
            raise ValueError("Numero ou titre invalide.")
        widget = row["widget"]
        allowed = {"entry": {"STR", "FLOAT", "INT", "DATE", "TIME", "EMAIL", "PHONE", "URL"},
                   "combo": {"STR", "FLOAT", "INT"}, "list": {"STR"}, "checkbox": set()}
        if widget not in allowed or (
            widget != "checkbox" and row.get("type") not in allowed[widget]
        ) or (widget == "checkbox" and "type" in row):
            raise ValueError("Parametres de ligne invalides.")
        if widget in ("combo", "list") and (
            not isinstance(row.get("options"), list)
            or any(not isinstance(text, str) for text in row["options"])
        ):
            raise ValueError("Choix invalides.")
        if "dateFormat" in row and (
            row.get("type") != "DATE" or not isinstance(row["dateFormat"]["pattern"], str)
            or row["dateFormat"]["syntax"] != "legacy_aim"
            or row["dateFormat"]["support"] != "unsupported"
        ):
            raise ValueError("Format de date invalide.")
        default = row["resetDefault"]
        if default["state"] == "defined":
            value = default["value"]
            if (widget == "checkbox" and (type(value) is not int or value not in (0, 1))
                    or widget != "checkbox" and not isinstance(value, str)):
                raise ValueError("Defaut invalide.")
        elif default["state"] == "unresolved":
            if default["issueId"] not in issue_ids:
                raise ValueError("Diagnostic de defaut introuvable.")
        elif default != {"state": "absent"}:
            raise ValueError("Etat de defaut invalide.")
    mapped_ids = [item["targetId"] for item in report["mappings"]]
    if len(mapped_ids) != len(ids) or set(mapped_ids) != ids:
        raise ValueError("Correspondances source/cible incompletes.")
    for item in report["issues"] + report["discarded"]["formattingExpressions"]:
        if item.get("targetId") is not None and item["targetId"] not in ids:
            raise ValueError("Reference cible introuvable.")
    for item in report["discarded"]["separators"]:
        if item["parentId"] not in {group["id"] for group in groups}:
            raise ValueError("Parent de separateur introuvable.")
    expected = {
        "categories": len(configuration["categories"]), "groups": len(groups),
        "rows": len(lines), "ignoredSeparators": len(report["discarded"]["separators"]),
    }
    if any(report["summary"][key] != value for key, value in expected.items()):
        raise ValueError("Comptages incoherents.")
    errors = sum(issue["severity"] == "error" for issue in report["issues"])
    pending = sum(issue["status"] == "unresolved" for issue in report["issues"])
    status = "incomplete" if errors else "requires_decisions" if pending else (
        "converted_with_limitations" if report["issues"] else "converted"
    )
    if (report["summary"]["errors"] != errors
            or report["summary"]["unresolvedIssues"] != pending
            or report["summary"]["status"] != status):
        raise ValueError("Qualification du resultat incoherente.")


def convert(source: Path, configuration_path: Path, report_path: Path) -> tuple[dict, dict]:
    """Create and re-read both outputs exclusively; rollback our files on failure."""
    source, configuration_path, report_path = map(
        lambda path: Path(path).resolve(), (source, configuration_path, report_path),
    )
    if len({source, configuration_path, report_path}) != 3:
        raise ValueError("Source et sorties doivent etre distinctes.")
    if configuration_path.parent != report_path.parent or configuration_path.parent == source.parent:
        raise ValueError("Les sorties doivent partager un repertoire de travail distinct de la source.")
    for path in (configuration_path, report_path):
        if path.exists():
            raise FileExistsError(f"Sortie existante refusee : {path}")
    configuration, report = build_configuration(source)
    configuration_path.parent.mkdir(parents=True, exist_ok=True)
    created = []
    try:
        for path, document in ((configuration_path, configuration), (report_path, report)):
            with path.open("x", encoding="utf-8", newline="\n") as stream:
                created.append(path)
                json.dump(document, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
        loaded = tuple(json.loads(path.read_text(encoding="utf-8"))
                       for path in (configuration_path, report_path))
        validate_documents(*loaded)
        if loaded != (configuration, report):
            raise ValueError("Relecture des sorties differente.")
    except BaseException:
        for path in created:
            path.unlink()
        raise
    return configuration, report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--configuration", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        _, report = convert(args.source, args.configuration, args.report)
    except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as exc:
        print(f"Conversion impossible : {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report["summary"], ensure_ascii=False))
    return 2 if report["summary"]["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
