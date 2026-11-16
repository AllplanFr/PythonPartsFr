"""In-memory presentation migration. Never writes SQLite or Allplan project files."""
from collections import Counter
from copy import deepcopy
import hashlib
import json
import logging
from pathlib import Path
import sqlite3
from typing import NotRequired
from uuid import uuid4

from .legacy_presentation import (
    IncompatiblePresentation, build_configuration, validate_documents,
)
from .project import ProjectDiagnostic, ProjectState
from .presentation_structure import category_children, groups as all_groups, is_group, rows as all_rows


LOGGER = logging.getLogger(__name__)
COMMANDS = (
    "presentation.import.prepare", "presentation.import.apply",
    "presentation.import.cancel", "presentation.get", "presentation.export",
)


class PresentationSnapshot(ProjectState):
    _presentationValues: NotRequired[dict[str, str] | None]
    _workingEditable: NotRequired[bool]


class DisplayDiagnostic(ProjectDiagnostic):
    lineIds: list[str]


def validation_report(configuration):
    """Validate a new-format presentation independently of migration provenance."""
    def fields(item, allowed):
        if type(item) is not dict or set(item) - set(allowed.split()):
            raise ValueError("Champs de presentation inconnus.")

    def identity(item):
        if (not isinstance(item.get("id"), str) or not item["id"]
                or type(item.get("position")) is not int or item["position"] < 1):
            raise ValueError("Identifiant ou position invalide.")

    fields(configuration, "schema version configurationId categories resetPolicy")
    if type(configuration.get("version")) is not int or configuration["version"] not in (1, 2):
        raise ValueError("Version 1 ou 2 obligatoire.")
    mixed = configuration["version"] == 2
    if not isinstance(configuration.get("configurationId"), str) or not configuration["configurationId"]:
        raise ValueError("Identifiant de presentation obligatoire.")
    fields(configuration["resetPolicy"], "applyOn checkboxWithoutDefault")
    categories = configuration["categories"]
    for category in categories:
        fields(category, "id position name icon children" if mixed else "id position name icon groups")
        identity(category)
        if category["id"] in ("all", "unlisted"):
            raise ValueError("Les vues virtuelles ne sont pas des categories.")
        for child in category_children(configuration, category):
            if mixed and child.get("kind") not in ("row", "group"):
                raise ValueError("Enfant de categorie : ligne ou groupe uniquement.")
            if not is_group(configuration, child):
                continue
            group = child
            fields(group, "kind id position title backgroundColor expanded rows" if mixed
                   else "id position title backgroundColor expanded rows")
            identity(group)
    groups = all_groups(configuration)
    rows = all_rows(configuration)
    for row in rows:
        fields(row, "kind id position num title widget type options dateFormat resetDefault" if mixed
               else "id position num title widget type options dateFormat resetDefault")
        identity(row)
        if mixed and row.get("kind") != "row":
            raise ValueError("Groupe imbrique interdit.")
        default = row["resetDefault"]
        allowed = {"absent": {"state"}, "defined": {"state", "value"},
                   "unresolved": {"state", "issueId"}}
        if type(default) is not dict or set(default) != allowed.get(default.get("state")):
            raise ValueError("Defaut de presentation invalide.")
        if default["state"] == "unresolved" and (
            not isinstance(default["issueId"], str) or not default["issueId"]
        ):
            raise ValueError("Diagnostic de defaut obligatoire.")
        if "dateFormat" in row:
            fields(row["dateFormat"], "pattern syntax support")
    ids = [item["id"] for item in [*categories, *groups, *rows]]
    issues = {
        r["resetDefault"]["issueId"]: r["id"] for r in rows
        if r["resetDefault"]["state"] == "unresolved"
    }
    report = {
        "schema": "aim-presentation-conversion-report", "version": 1,
        "configurationId": configuration["configurationId"],
        "mappings": [{"targetId": identity} for identity in ids],
        "issues": [{"id": key, "targetId": target, "severity": "warning",
                    "status": "unresolved"} for key, target in issues.items()],
        "discarded": {"formattingExpressions": [], "separators": []},
        "summary": {
            "categories": len(categories), "groups": len(groups), "rows": len(rows),
            "ignoredSeparators": 0, "errors": 0, "unresolvedIssues": len(issues),
            "status": "requires_decisions" if issues else "converted",
        },
    }
    validate_documents(configuration, report)
    return report


def display_model(configuration: dict, report: dict | None, snapshot: PresentationSnapshot) -> dict:
    """Associate against the Python-owned contract-2 snapshot, never browser edits."""
    attributes = {r["number"]: r for r in snapshot["data"]["attributes"]}
    project_values = snapshot.get("_presentationValues")
    categories = deepcopy(configuration["categories"])
    diagnostics: list[DisplayDiagnostic] = [
        {**deepcopy(d), "lineIds": []} for d in snapshot["diagnostics"]
    ]
    counts = dict(configurationLines=0, matchedDefinitions=0, missingDefinitions=0,
                  set=0, unset=0, unavailable=0)
    for category in categories:
        # Portable reference only: a remote page must not fetch local file paths.
        for child in category_children(configuration, category):
            for row in (child["rows"] if is_group(configuration, child) else [child]):
                number = str(row.pop("num"))
                attribute = attributes.get(number)
                definition = attribute["definition"] if attribute is not None else None
                state = ("set" if number in project_values else "unset") if (
                    project_values is not None
                ) else attribute["valueState"] if attribute is not None else (
                    "unset" if snapshot["selection"] == "accepted"
                    and snapshot["prjatt"]["status"] in ("read", "missing")
                    and snapshot["definitions"]["status"] in (
                        "available", "available_with_diagnostics",
                    ) else "unavailable"
                )
                value = project_values.get(number) if project_values is not None else (
                    attribute["value"] if attribute is not None else None
                )
                row.update(number=number, definition=deepcopy(definition),
                           valueState=state, value=value,
                           diagnostics=[])
                counts["configurationLines"] += 1
                counts["matchedDefinitions" if definition else "missingDefinitions"] += 1
                counts[state] += 1
                if definition is None:
                    row["diagnostics"].append("definition_missing")
                if "dateFormat" in row:
                    row["diagnostics"].append("date_format_not_supported")
                for issue in diagnostics:
                    raw = issue["attributeNumber"]
                    number_match = (str(int(raw)) if raw and raw.isdecimal() else raw) == number
                    if number_match:
                        issue["lineIds"].append(row["id"])
                        if issue["code"] not in row["diagnostics"]:
                            row["diagnostics"].append(issue["code"])
    return {
        "schema": "aim-organized-presentation", "version": configuration["version"],
        "configurationId": configuration["configurationId"],
        "readOnly": not snapshot.get("_workingEditable", False),
        "project": deepcopy(snapshot["project"]),
        "installation": deepcopy(snapshot["installation"]),
        "prjatt": deepcopy(snapshot["prjatt"]),
        "definitions": deepcopy(snapshot["definitions"]),
        "categories": categories, "counts": counts, "diagnostics": diagnostics,
        "conversionDiagnostics": [
            {key: issue[key] for key in ("code", "severity", "targetId", "message")}
            for issue in report["issues"]
        ] if report is not None else [],
    }


def _fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()


class PresentationImport:
    """One pending candidate and one active presentation per native window."""
    def __init__(self, snapshot, choose_file, choose_export, *, mixed=False):
        self._snapshot = snapshot
        self._choose_file = choose_file
        self._choose_export = choose_export
        self._pending: tuple[str, str, dict] | None = None
        self._current: dict | None = None
        self._pending_file = None
        self._working_file = None
        self._working_bytes = None
        self.mixed = mixed

    @staticmethod
    def _error(code, message):
        LOGGER.warning("AIM presentation command refused: %s", code)
        return {"ok": False, "error": {"code": code, "message": message}}

    def call(self, command, payload):
        expected = {
            "presentation.import.prepare": set(), "presentation.get": set(),
            "presentation.import.apply": {"token"},
            "presentation.import.cancel": {"token"},
            "presentation.export": {"configuration"},
        }
        if command not in expected:
            return self._error("unknown_command", "Commande de presentation inconnue.")
        if (type(payload) is not dict or set(payload) != expected[command]
                or "token" in payload and (
                    type(payload["token"]) is not str or not payload["token"]
                )):
            return self._error("invalid_payload", "Payload de presentation invalide.")
        try:
            return self._call(command, payload)
        except IncompatiblePresentation:
            return self._error("incompatible_database", "Ce fichier n'est pas une ancienne presentation AIM compatible.")
        except sqlite3.DatabaseError as exc:
            code = getattr(exc, "sqlite_errorcode", None)
            if code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                return self._error("source_locked", "Base verrouillee ; reessayez apres liberation.")
            if code in (sqlite3.SQLITE_NOTADB, sqlite3.SQLITE_CORRUPT):
                return self._error("incompatible_database", "Fichier SQLite invalide ou endommage.")
            return self._error("source_read_error", "Lecture SQLite impossible.")
        except (OSError, UnicodeError):
            return self._error("file_access", "Fichier inaccessible ou non lisible.")
        except (ValueError, KeyError, TypeError):
            return self._error("invalid_presentation", "Structure de presentation invalide.")
        except RuntimeError:
            return self._error("dialog_unavailable", "Dialogue natif indisponible.")

    def _call(self, command, payload):
        if command == "presentation.import.prepare":
            # A new preparation supersedes any previous candidate, never the active state.
            self._pending = None
            self._pending_file = None
            selected = self._choose_file()
            if selected is None:
                return {"ok": True, "status": "cancelled"}
            source = Path(selected)
            if source.is_symlink() or not source.is_file():
                return self._error("file_access", "Fichier source inaccessible ou lie.")
            if source.suffix.lower() in (".db", ".db3"):
                configuration, report = build_configuration(source, mixed=self.mixed)
                validation_report(configuration)
            elif source.suffix.lower() == ".json":
                source_bytes = source.read_bytes()
                configuration = json.loads(source_bytes.decode("utf-8"))
                validation_report(configuration)
                report = None
                self._pending_file = (source.resolve(), source_bytes)
            else:
                return self._error("unsupported_format", "Selectionnez une presentation .db ou .json.")
            if configuration["version"] == 2 and not self.mixed:
                return self._error("unsupported_presentation_version",
                                   "Cette presentation requiert une interface compatible avec les enfants ordonnes.")
            if report is not None:
                counts = Counter((issue["code"], issue["severity"], issue["status"])
                                 for issue in report["issues"])
                for (code, severity, status), count in sorted(counts.items()):
                    LOGGER.log(
                        logging.ERROR if severity == "error" else logging.WARNING,
                        "AIM presentation import: code=%s severity=%s status=%s count=%d",
                        code, severity, status, count,
                    )
            if report is not None and report["summary"]["errors"]:
                return self._error("conversion_failed", "Relations AIM invalides ; aucun remplacement.",) | {
                    "report": report,
                }
            snapshot = self._snapshot()
            model = display_model(configuration, report, snapshot)
            token = str(uuid4())
            candidate = {"configuration": configuration, "report": report, "model": model}
            self._pending = (token, _fingerprint(snapshot), candidate)
            return {"ok": True, "status": "prepared", "token": token,
                    "candidate": deepcopy(candidate)}
        if command == "presentation.get":
            active = self._current
            if active is None:
                return {"ok": True, "status": "empty", "presentation": None}
            current = deepcopy(active)
            current["model"] = display_model(
                current["configuration"], current["report"], self._snapshot(),
            )
            return {"ok": True, "status": "current", "presentation": current}
        if command == "presentation.export":
            configuration = deepcopy(payload["configuration"])
            validation_report(configuration)
            if configuration["version"] == 2 and not self.mixed:
                return self._error("unsupported_presentation_version",
                                   "Export de presentation mixte indisponible avec cette interface.")
            selected = self._choose_export()
            if selected is None:
                return {"ok": True, "status": "cancelled"}
            destination = Path(selected)
            if destination.suffix.lower() != ".json":
                return self._error("unsupported_format", "Export JSON uniquement ; aucun export .db.")
            resolved = destination.resolve()
            if any(p.suffix.lower() == ".prj" for p in (resolved, *resolved.parents)):
                return self._error("protected_destination", "Export interdit dans un projet Allplan.")
            snapshot = self._snapshot()
            roots = (snapshot.get("installation") or {}).get("paths", {}).values()
            if any(destination.resolve().is_relative_to(Path(root).resolve()) for root in roots):
                return self._error("protected_destination", "Export interdit dans les sources Allplan.")
            if destination.exists():
                return self._error("output_exists", "Sortie existante refusee ; choisissez un nouveau fichier.")
            data = json.dumps(configuration, ensure_ascii=False, indent=2) + "\n"
            try:
                with destination.open("x", encoding="utf-8", newline="\n") as stream:
                    stream.write(data)
            except OSError:
                # Preserve a partial new file for diagnosis; never report success.
                return self._error("export_failed", "Export echoue ; verifier la destination avant de poursuivre.")
            return {"ok": True, "status": "exported", "fileName": destination.name,
                    "configurationId": configuration["configurationId"]}
        if self._pending is None or payload["token"] != self._pending[0]:
            return self._error("stale_candidate", "Import absent, expire ou deja consomme.")
        if command == "presentation.import.cancel":
            self._pending = None
            self._pending_file = None
            return {"ok": True, "status": "cancelled"}
        _, fingerprint, candidate = self._pending
        if _fingerprint(self._snapshot()) != fingerprint:
            self._pending = None
            return self._error("project_changed", "Le contexte projet a change ; preparez de nouveau l'import.")
        self._current = deepcopy(candidate)
        self._working_file, self._working_bytes = self._pending_file or (None, None)
        self._pending_file = None
        self._pending = None
        return {"ok": True, "status": "applied", "presentation": deepcopy(candidate)}
