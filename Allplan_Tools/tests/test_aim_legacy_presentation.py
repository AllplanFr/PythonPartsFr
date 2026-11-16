import copy
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.plugins.information_manager import legacy_presentation as legacy


class LegacyPresentationTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source" / "aim.db"
        self.source.parent.mkdir()
        with closing(sqlite3.connect(self.source, isolation_level=None)) as db:
            for table, columns in legacy.TABLES.items():
                declarations = [
                    name + (" INTEGER" if name in (
                        "defaut", "editable", "afficher_enfant", "nb_radios",
                    ) and (name != "defaut" or table == "INFOS_CHECKBOX") else " TEXT")
                    for name in columns
                ]
                if table == "INFOS_TITRE":
                    declarations.append("couleur_texte TEXT")
                db.execute(f'CREATE TABLE {table} ({", ".join(declarations)})')
            db.execute("CREATE TABLE PRJ_INFOS (valeur TEXT)")
            db.execute("INSERT INTO PRJ_INFOS VALUES ('DO NOT READ')")
        self.add("INFOS_ONGLETS", 1, titre="Projet", icone="[icones_aim]société.png")
        self.add("INFOS_ONGLETS", 2, titre="Clients", icone="[icones_aim]clients.png")
        self.group("titre_1", "Infos Projet", "Projet", 1)
        self.group("titre_4", "Infos Clients", "Clients", 4)
        self.configuration_path = self.root / "output" / "configuration.json"
        self.report_path = self.root / "output" / "report.json"

    def add(self, table, rowid, **values):
        columns = ["rowid", *values]
        with closing(sqlite3.connect(self.source, isolation_level=None)) as db:
            db.execute(
                f'INSERT INTO {table} ({", ".join(columns)}) '
                f'VALUES ({", ".join("?" for _ in columns)})',
                (rowid, *values.values()),
            )

    def group(self, object_id, title, category, rowid):
        self.add("INFOS_TITRE", rowid, nom_objet=object_id, titre=title,
                 couleur_fond="#55aaff", afficher_enfant=1, couleur_texte="#123456")
        self.add("INFOS_ITEMS_ONGLETS", rowid, nom_onglet=category,
                 nom_item=object_id, type_item="INFOS_TITRE")

    def line(self, table, rowid, *, group="titre_1", number="7", **extra):
        object_id = f"{table.lower()}_{rowid}"
        values = dict(nom_objet=object_id, num_attr=number, nom_attr="Original name",
                      titre_attr="  Titre exact  ", **extra)
        self.add(table, rowid, **values)
        self.add("INFOS_ITEMS_TITRES", rowid, nom_titres=group,
                 nom_item=object_id, type_item=table)
        return object_id

    def build(self):
        return legacy.build_configuration(self.source, configuration_id="test-import")

    @staticmethod
    def rows(configuration):
        return [row for cat in configuration["categories"]
                for group in cat["groups"] for row in group["rows"]]

    def test_correct_categories_date_and_radio_reference_example(self):
        self.line("INFOS_RADIO", 1, number="957", defaut="2", nb_radios=3,
                  **dict(zip((f"nom_radio_{i}" for i in range(1, 7)),
                             ["APS", "PC", "EXE", "", "", ""])))
        self.line("INFOS_LINEEDIT", 21, group="titre_4", number="936", defaut="",
                  formatage="Date", option="n° yy/MM/dd", editable=1)
        configuration, report = legacy.convert(
            self.source, self.configuration_path, self.report_path,
        )
        project, clients = configuration["categories"]
        self.assertEqual((project["name"], clients["name"]), ("Projet", "Clients"))
        self.assertEqual([group["title"] for group in project["groups"]], ["Infos Projet"])
        self.assertEqual([group["title"] for group in clients["groups"]], ["Infos Clients"])
        radio, date = self.rows(configuration)
        self.assertEqual(date["dateFormat"], {
            "pattern": "n° yy/MM/dd", "syntax": "legacy_aim", "support": "unsupported",
        })
        self.assertEqual(date["resetDefault"], {"state": "defined", "value": ""})
        self.assertEqual(radio["resetDefault"], {"state": "defined", "value": "PC"})
        trace = next(x for x in report["mappings"] if x["targetId"] == radio["id"])
        self.assertEqual(trace["defaultResolution"], {
            "rule": "one_based_source_slot", "sourceSlot": 2,
            "label": "PC", "targetOptionIndex": 1,
        })
        self.assertEqual(report["summary"]["status"], "converted_with_limitations")
        self.assertEqual(configuration, json.loads(self.configuration_path.read_text("utf-8")))
        legacy.validate_documents(configuration, report)

    def test_rowid_order_not_name_and_duplicate_numbers(self):
        self.line("INFOS_FORMATAGE", 20, number="7", formatage="[abandoned]")
        self.line("INFOS_FORMATAGE", 3, number="7", formatage="[other]")
        configuration, report = self.build()
        rows = self.rows(configuration)
        self.assertEqual([row["id"] for row in rows], ["group-1-line-3", "group-1-line-20"])
        self.assertEqual([row["position"] for row in rows], [1, 2])
        self.assertEqual([row["num"] for row in rows], [7, 7])
        self.assertEqual(len({row["id"] for row in rows}), 2)
        self.assertEqual(rows[0]["title"], "  Titre exact  ")
        self.assertIn("duplicate_attribute_occurrence", [x["code"] for x in report["issues"]])
        self.assertEqual(len(report["discarded"]["formattingExpressions"]), 2)
        self.assertNotIn("#123456", json.dumps((configuration, report)))
        self.assertNotIn("value", rows[0])

    def test_group_attachment_order_and_expanded(self):
        self.group("aaa", "A first alphabetically", "Projet", 9)
        with closing(sqlite3.connect(self.source, isolation_level=None)) as db:
            db.execute("UPDATE INFOS_TITRE SET afficher_enfant=0 WHERE nom_objet='aaa'")
        configuration, _ = self.build()
        groups = configuration["categories"][0]["groups"]
        self.assertEqual([x["title"] for x in groups], ["Infos Projet", "A first alphabetically"])
        self.assertEqual([x["position"] for x in groups], [1, 2])
        self.assertEqual([x["expanded"] for x in groups], [True, False])

    def test_combo_empty_choices_order_and_text_defaults(self):
        for index, default in enumerate(["", "0", None], 1):
            self.line("INFOS_COMBOBOX", index, defaut=default,
                      liste_attr="\nA\nA\n\n0", editable=index % 2)
        configuration, _ = self.build()
        rows = self.rows(configuration)
        for row in rows:
            self.assertEqual(row["options"], ["", "A", "A", "", "0"])
        self.assertEqual([x["widget"] for x in rows], ["combo", "list", "combo"])
        self.assertEqual([x["resetDefault"] for x in rows], [
            {"state": "defined", "value": ""},
            {"state": "defined", "value": "0"}, {"state": "absent"},
        ])

    def test_radio_six_slots_dedup_and_default_before_filter(self):
        self.line("INFOS_RADIO", 1, defaut="4", nb_radios=2,
                  nom_radio_1=None, nom_radio_2="A", nom_radio_3="",
                  nom_radio_4="A", nom_radio_5="B", nom_radio_6="C")
        configuration, report = self.build()
        self.assertEqual(self.rows(configuration)[0]["options"], ["A", "B", "C"])
        self.assertEqual(self.rows(configuration)[0]["resetDefault"],
                         {"state": "defined", "value": "A"})
        trace = next(x for x in report["mappings"] if "choiceMapping" in x)
        self.assertEqual(trace["raw"]["defaut"], "4")
        self.assertEqual(trace["defaultResolution"], {
            "rule": "one_based_source_slot", "sourceSlot": 4,
            "label": "A", "targetOptionIndex": 0,
        })
        self.assertEqual(report["summary"]["unresolvedIssues"], 0)
        self.assertEqual(len(trace["choiceMapping"]), 6)
        self.assertEqual(sum(x["code"] == "radio_choices_beyond_declared_count"
                             for x in report["issues"]), 3)

    def test_radio_empty_invalid_and_null_defaults(self):
        for index, default in enumerate(["1", "0", "outside", "7", "", None], 1):
            self.line("INFOS_RADIO", index, defaut=default, nb_radios=1,
                      **{f"nom_radio_{i}": "" for i in range(1, 7)})
        configuration, report = self.build()
        rows = self.rows(configuration)
        self.assertEqual([x["resetDefault"]["state"] for x in rows],
                         ["unresolved"] * 5 + ["absent"])
        self.assertEqual(sum(x["code"] == "radio_default_unresolvable"
                             for x in report["issues"]), 5)
        self.assertEqual(report["summary"]["status"], "requires_decisions")

    def test_radio_deduplicated_default_survives_output_roundtrip(self):
        self.line("INFOS_RADIO", 1, defaut="6", nb_radios=6,
                  nom_radio_1="Premier", nom_radio_2="", nom_radio_3=None,
                  nom_radio_4="Choix exact", nom_radio_5="Autre",
                  nom_radio_6="Choix exact")
        legacy.convert(self.source, self.configuration_path, self.report_path)
        configuration = json.loads(self.configuration_path.read_text("utf-8"))
        report = json.loads(self.report_path.read_text("utf-8"))
        row = self.rows(configuration)[0]
        self.assertEqual(row["options"], ["Premier", "Choix exact", "Autre"])
        self.assertEqual(row["resetDefault"], {"state": "defined", "value": "Choix exact"})
        trace = next(x for x in report["mappings"] if x["targetId"] == row["id"])
        self.assertEqual(trace["defaultResolution"]["sourceSlot"], 6)
        self.assertEqual(trace["defaultResolution"]["targetOptionIndex"], 1)
        self.assertEqual(trace["choiceMapping"][3]["targetOptionIndex"], 1)
        self.assertEqual(trace["choiceMapping"][5]["targetOptionIndex"], 1)
        self.assertEqual(report["summary"]["unresolvedIssues"], 0)
        self.assertEqual(report["summary"]["status"], "converted_with_limitations")

    def test_checkbox_defaults_zero_one_null(self):
        for index, default in enumerate([0, 1, None], 1):
            self.line("INFOS_CHECKBOX", index, defaut=default)
        configuration, report = self.build()
        self.assertEqual([x["resetDefault"] for x in self.rows(configuration)], [
            {"state": "defined", "value": 0}, {"state": "defined", "value": 1},
            {"state": "absent"},
        ])
        self.assertEqual(configuration["resetPolicy"], {
            "applyOn": "explicit_reset_only", "checkboxWithoutDefault": "unchecked",
        })
        self.assertEqual(report["summary"]["unresolvedIssues"], 0)
        self.assertNotIn("checkbox_reset_without_default_pending",
                         [x["code"] for x in report["issues"]])

    def test_lineedit_equivalents_preserve_strings(self):
        formats = [("Nombre décimal", "FLOAT", "2.50"), ("Nombre entier", "INT", "0"),
                   ("E-mail", "EMAIL", ""), ("Téléphone", "PHONE", None),
                   ("Lien Web", "URL", ""), ("Aucune modification", "STR", "0.00")]
        for index, (fmt, _, default) in enumerate(formats, 1):
            self.line("INFOS_LINEEDIT", index, formatage=fmt, defaut=default,
                      option="", editable=1)
        configuration, _ = self.build()
        for row, (_, expected, default) in zip(self.rows(configuration), formats):
            self.assertEqual(row["type"], expected)
            self.assertEqual(row["resetDefault"],
                             {"state": "absent"} if default is None
                             else {"state": "defined", "value": default})

    def test_separator_ignored_and_positions_compacted(self):
        self.line("INFOS_FORMATAGE", 1, formatage="[x]")
        self.add("INFOS_SEPARATEUR", 1, nom_objet="separator")
        self.add("INFOS_ITEMS_TITRES", 2, nom_titres="titre_1",
                 nom_item="separator", type_item="INFOS_SEPARATEUR")
        self.line("INFOS_FORMATAGE", 3, formatage="[y]")
        configuration, report = self.build()
        self.assertEqual([x["position"] for x in self.rows(configuration)], [1, 2])
        self.assertEqual(report["summary"]["ignoredSeparators"], 1)
        self.assertEqual(report["discarded"]["separators"][0]["attachment"]["rowid"], 2)

    def test_missing_and_ambiguous_line_references_reported(self):
        self.line("INFOS_FORMATAGE", 1, formatage="[x]")
        self.add("INFOS_FORMATAGE", 2, nom_objet="infos_formatage_1",
                 num_attr="9", nom_attr="other", titre_attr="other", formatage="[y]")
        self.add("INFOS_ITEMS_TITRES", 3, nom_titres="titre_1",
                 nom_item="missing", type_item="INFOS_CHECKBOX")
        configuration, report = self.build()
        self.assertEqual(self.rows(configuration), [])
        self.assertEqual(report["summary"]["status"], "incomplete")
        self.assertTrue({"missing_reference", "ambiguous_reference"} <=
                        {x["code"] for x in report["issues"]})
        self.assertTrue(report["unmapped"])

    def test_missing_and_ambiguous_parents_do_not_invent_relations(self):
        self.add("INFOS_ONGLETS", 3, titre="Projet", icone="[icones_aim]x.png")
        self.add("INFOS_ITEMS_ONGLETS", 7, nom_onglet="Unknown",
                 nom_item="titre_4", type_item="INFOS_TITRE")
        self.add("INFOS_ITEMS_TITRES", 9, nom_titres="Unknown",
                 nom_item="x", type_item="INFOS_CHECKBOX")
        configuration, report = self.build()
        self.assertEqual([x["name"] for x in configuration["categories"]], ["Clients"])
        self.assertEqual(report["summary"]["status"], "incomplete")

    def test_group_target_missing_or_ambiguous(self):
        self.add("INFOS_TITRE", 5, nom_objet="titre_1", titre="Duplicate",
                 couleur_fond="#ffffff", afficher_enfant=1)
        self.add("INFOS_ITEMS_ONGLETS", 8, nom_onglet="Clients",
                 nom_item="missing", type_item="INFOS_TITRE")
        configuration, report = self.build()
        self.assertEqual(configuration["categories"][0]["groups"], [])
        self.assertEqual(len(configuration["categories"][1]["groups"]), 1)
        self.assertTrue({"missing_reference", "ambiguous_reference"} <=
                        {x["code"] for x in report["issues"]})

    def test_readonly_connection_rejects_writes(self):
        with closing(sqlite3.connect(self.source.as_uri() + "?mode=ro", uri=True)) as db:
            with self.assertRaises(sqlite3.OperationalError):
                db.execute("DELETE FROM INFOS_ONGLETS")

    def test_source_and_outputs_must_be_distinct(self):
        with self.assertRaises(ValueError):
            legacy.convert(self.source, self.source, self.report_path)
        with self.assertRaises(ValueError):
            legacy.convert(self.source, self.configuration_path, self.configuration_path)
        with self.assertRaises(ValueError):
            legacy.convert(self.source, self.source.parent / "config.json",
                           self.source.parent / "report.json")

    def test_shared_content_gets_unique_occurrence_ids(self):
        object_id = self.line("INFOS_FORMATAGE", 1, formatage="[x]")
        self.add("INFOS_ITEMS_TITRES", 2, nom_titres="titre_4",
                 nom_item=object_id, type_item="INFOS_FORMATAGE")
        configuration, report = self.build()
        self.assertEqual(len({x["id"] for x in self.rows(configuration)}), 2)
        legacy.validate_documents(configuration, report)

    def test_existing_outputs_refused_and_source_unchanged(self):
        before = hashlib.sha256(self.source.read_bytes()).hexdigest()
        legacy.convert(self.source, self.configuration_path, self.report_path)
        written = self.configuration_path.read_bytes(), self.report_path.read_bytes()
        with self.assertRaises(FileExistsError):
            legacy.convert(self.source, self.configuration_path, self.report_path)
        self.assertEqual(written, (self.configuration_path.read_bytes(), self.report_path.read_bytes()))
        self.assertEqual(before, hashlib.sha256(self.source.read_bytes()).hexdigest())

    def test_existing_report_alone_refused(self):
        self.report_path.parent.mkdir()
        self.report_path.write_text("untouched", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            legacy.convert(self.source, self.configuration_path, self.report_path)
        self.assertFalse(self.configuration_path.exists())
        self.assertEqual(self.report_path.read_text("utf-8"), "untouched")

    def test_output_failure_removes_only_new_files(self):
        original_open = Path.open

        def failing_open(path, *args, **kwargs):
            if path == self.report_path and args and args[0] == "x":
                raise OSError("synthetic write failure")
            return original_open(path, *args, **kwargs)

        with patch.object(Path, "open", failing_open):
            with self.assertRaisesRegex(OSError, "synthetic"):
                legacy.convert(self.source, self.configuration_path, self.report_path)
        self.assertFalse(self.configuration_path.exists())
        self.assertFalse(self.report_path.exists())

    def test_readonly_and_configuration_tables_only(self):
        connect = sqlite3.connect
        denied = []

        def guarded_connect(database_uri, **kwargs):
            self.assertTrue(database_uri.endswith("?mode=ro"))
            self.assertTrue(kwargs["uri"])
            db = connect(database_uri, **kwargs)

            def authorize(action, name, column, database, trigger):
                schema_metadata = name == "sqlite_master" and column in ("name", "type")
                if action == sqlite3.SQLITE_READ and name not in legacy.TABLES and not schema_metadata:
                    denied.append(name)
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK

            db.set_authorizer(authorize)
            return db

        with patch("sqlite3.connect", guarded_connect):
            self.build()
        self.assertEqual(denied, [])

    def test_validation_rejects_broken_ids_positions_and_issue_links(self):
        self.line("INFOS_RADIO", 1, defaut="7", nb_radios=1,
                  **{f"nom_radio_{i}": "A" if i == 1 else "" for i in range(1, 7)})
        configuration, report = self.build()
        for field, value in [("id", "category-1"), ("position", 8)]:
            changed = copy.deepcopy(configuration)
            self.rows(changed)[0][field] = value
            with self.assertRaises(ValueError):
                legacy.validate_documents(changed, report)
        changed = copy.deepcopy(configuration)
        self.rows(changed)[0]["resetDefault"]["issueId"] = "missing"
        with self.assertRaises(ValueError):
            legacy.validate_documents(changed, report)


if __name__ == "__main__":
    unittest.main()
