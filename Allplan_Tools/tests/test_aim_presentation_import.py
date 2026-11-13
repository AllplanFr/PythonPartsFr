from copy import deepcopy
from contextlib import closing
import json
from pathlib import Path
import re
import sqlite3
import unittest
from unittest.mock import MagicMock, patch

from application.core.context import LaunchContext
from application.plugins.information_manager.presentation import AimPresentationApp
from application.plugins.information_manager.presentation_import import (
    COMMANDS, PresentationImport, PresentationSnapshot, display_model, validation_report,
)
from application.plugins.information_manager.legacy_presentation import validate_documents
from application.plugins.information_manager.project import AimProjectApp, ProjectAttribute, ProjectDiagnostic
from tests import test_aim_legacy_presentation as fixtures


class PresentationImportTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.LegacyPresentationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.line("INFOS_LINEEDIT", 1, defaut="never applied",
                          formatage="Date", option="n\u00b0 yy/MM/dd")
        self.fixture.line("INFOS_RADIO", 2, number="7", nb_radios=2, defaut="6",
                          nom_radio_1="A", nom_radio_2="B", nom_radio_6="A")
        self.fixture.line("INFOS_CHECKBOX", 3, number="8", defaut=None)
        self.snapshot: PresentationSnapshot = {
            **AimProjectApp._empty("accepted", []),
            "_presentationValues": {"7": "0", "999": "not displayed"},
        }
        self.snapshot["project"] = {"name": "Synthetic.prj", "path": r"C:\Synthetic.prj"}
        self.snapshot["definitions"] = {
            "status": "available", "attr": "PRJ", "language": "fr",
            "source": r"C:\Synthetic.prj", "systemFiles": [], "customFiles": [],
            "priority": "first_valid_etc_then_custom_plain_preferred", "groupMask": 65536,
        }
        self.snapshot["prjatt"]["status"] = "read"
        self.select = MagicMock(return_value=self.fixture.source)
        self.destination = self.fixture.root / "new-presentation.json"
        self.save = MagicMock(return_value=self.destination)
        self.service = PresentationImport(lambda: deepcopy(self.snapshot), self.select, self.save)

    def prepare(self):
        return self.service.call("presentation.import.prepare", {})

    def current(self):
        return self.service.call("presentation.get", {})

    def apply(self, reply):
        return self.service.call("presentation.import.apply", {"token": reply["token"]})

    @staticmethod
    def rows(model):
        return [r for c in model["categories"] for g in c["groups"] for r in g["rows"]]

    def test_prepare_apply_and_cancel_are_atomic_and_lossless(self):
        source_before = self.fixture.source.read_bytes()
        snapshot_before = deepcopy(self.snapshot)
        prepared = self.prepare()
        self.assertEqual(prepared["status"], "prepared")
        self.assertEqual(self.current()["status"], "empty")
        rows = self.rows(prepared["candidate"]["model"])
        self.assertEqual([r["value"] for r in rows], ["0", "0", None])
        self.assertEqual([r["valueState"] for r in rows], ["set", "set", "unset"])
        self.assertEqual(rows[1]["resetDefault"], {"state": "defined", "value": "A"})
        self.assertEqual(rows[0]["dateFormat"]["pattern"], "n\u00b0 yy/MM/dd")
        self.assertEqual(rows[2]["resetDefault"], {"state": "absent"})
        self.assertEqual([r["number"] for r in rows], ["7", "7", "8"])
        self.assertNotEqual(rows[0]["id"], rows[1]["id"])
        applied = self.apply(prepared)
        self.assertEqual(applied["status"], "applied")
        current = self.current()
        next_import = self.prepare()
        self.assertEqual(self.service.call("presentation.import.cancel",
                                         {"token": next_import["token"]})["status"], "cancelled")
        self.assertEqual(current, self.current())
        self.assertEqual(self.fixture.source.read_bytes(), source_before)
        self.assertEqual(self.snapshot, snapshot_before)
        self.assertNotIn("not displayed", json.dumps(prepared))
        self.assertEqual(self.apply(next_import)["error"]["code"], "stale_candidate")

    def test_global_installation_diagnostics_are_technical_not_repeated_on_rows(self):
        global_issue: ProjectDiagnostic = {
            "code": "installation_discovery_diagnostic", "severity": "error",
            "message": "Synthetic inventory diagnostic.", "path": None,
            "line": None, "attributeNumber": None, "relatedPath": None,
        }
        selected: ProjectDiagnostic = {
            **global_issue, "code": "installation_selected_latest", "severity": "info",
        }
        attribute_issue: ProjectDiagnostic = {
            **global_issue, "code": "invalid_definition", "attributeNumber": "7",
        }
        self.snapshot["diagnostics"] = [global_issue, selected, attribute_issue]
        model = self.prepare()["candidate"]["model"]
        self.assertEqual(model["diagnostics"][0]["lineIds"], [])
        self.assertEqual(model["diagnostics"][1]["lineIds"], [])
        self.assertEqual(model["diagnostics"][2]["lineIds"],
                         [row["id"] for row in self.rows(model) if row["number"] == "7"])
        for row in self.rows(model):
            self.assertNotIn("installation_discovery_diagnostic", row["diagnostics"])
            self.assertNotIn("installation_selected_latest", row["diagnostics"])

    def test_import_limitations_are_logged_by_code_without_business_data_or_contract_changes(self):
        from collections import Counter
        logger = "application.plugins.information_manager.presentation_import"
        with self.assertLogs(logger, level="WARNING") as captured:
            prepared = self.prepare()
        self.assertEqual(prepared["status"], "prepared")
        report = prepared["candidate"]["report"]
        counts = Counter((i["code"], i["severity"], i["status"]) for i in report["issues"])
        self.assertTrue(counts)
        self.assertEqual(len(captured.records), len(counts))
        for (code, severity, status), count in counts.items():
            self.assertTrue(any(
                record.getMessage() ==
                f"AIM presentation import: code={code} severity={severity} status={status} count={count}"
                for record in captured.records
            ))
        self.assertNotIn(str(self.fixture.source), "\n".join(captured.output))
        self.assertNotIn("never applied", "\n".join(captured.output))
        self.assertNotIn("new exact value", "\n".join(captured.output))

    def test_real_project_service_rebinds_organized_values_without_replacing_configuration(self):
        from tests.test_aim_project_reading import ProjectReadingTests
        project = ProjectReadingTests()
        project.setUp()
        self.addCleanup(project.doCleanups)
        project.content("Version 3\r\n7|Name|previous\r\n")
        outside = project.outside_project()
        (outside / "prjatt.dat").write_bytes(b"Version 3\r\n7|Name|new exact value\r\n")
        newer = project.installation("2026")
        project.discover.return_value = ([project.context, newer], [])
        before = {
            path: path.read_bytes()
            for root in (project.project, outside)
            for path in root.rglob("*") if path.is_file()
        }
        app = AimPresentationApp(
            project.data, LaunchContext(project_path=project.project),
            settings_store=project.store, choose_directory=project.chooser,
            discover_installations=project.discover,
            choose_presentation=lambda: self.fixture.source,
        )
        app.get_initial_data()
        prepared = app.call("presentation.import.prepare", {})
        initial = app.call("presentation.import.apply", {"token": prepared["token"]})["presentation"]
        project.chooser.return_value = str(outside)
        selected = app.call("project.select", {})
        self.assertTrue(selected["ok"])
        self.assertEqual(selected["data"]["installation"]["version"], "2026")
        current = app.call("presentation.get", {})["presentation"]
        self.assertEqual(current["configuration"], initial["configuration"])
        self.assertEqual([row["id"] for row in self.rows(current["model"])],
                         [row["id"] for row in self.rows(initial["model"])])
        self.assertEqual([row["value"] for row in self.rows(current["model"])],
                         ["new exact value", "new exact value", None])
        self.assertNotIn("previous", json.dumps(current))
        self.assertEqual(before, {path: path.read_bytes() for path in before})
        self.assertTrue(all(not issue["lineIds"] for issue in current["model"]["diagnostics"]
                            if issue["code"] == "installation_selected_latest"))
        project.chooser.return_value = None
        self.assertTrue(app.call("project.select", {})["ok"])
        cancelled = app.call("presentation.get", {})["presentation"]
        self.assertEqual(cancelled, current)

    def test_dialog_cancel_and_failure_preserve_current(self):
        self.apply(self.prepare())
        before = self.current()
        for selected in (None, self.fixture.root / "absent.db"):
            self.select.return_value = selected
            result = self.prepare()
            self.assertEqual(result.get("status", result.get("error", {}).get("code")),
                             "cancelled" if selected is None else "file_access")
            self.assertEqual(before, self.current())
        self.select.side_effect = RuntimeError("dialog")
        self.assertEqual(self.prepare()["error"]["code"], "dialog_unavailable")
        self.assertEqual(before, self.current())
        self.select.side_effect = None
        self.select.return_value = self.fixture.source
        with patch("application.plugins.information_manager.legacy_presentation.sqlite3.connect",
                   side_effect=PermissionError("synthetic access denied")):
            self.assertEqual(self.prepare()["error"]["code"], "file_access")
        self.assertEqual(before, self.current())

    def test_non_aim_and_non_sqlite_are_rejected(self):
        self.apply(self.prepare())
        before = self.current()
        path = self.fixture.root / "other.db"
        with closing(sqlite3.connect(path)) as db:
            db.execute("CREATE TABLE unrelated (id INTEGER)")
        self.select.return_value = path
        self.assertEqual(self.prepare()["error"]["code"], "incompatible_database")
        path.write_bytes(b"not sqlite")
        self.assertEqual(self.prepare()["error"]["code"], "incompatible_database")
        self.assertEqual(before, self.current())

    def test_locked_database_is_explicit_and_never_replaces(self):
        self.apply(self.prepare())
        before = self.current()
        with closing(sqlite3.connect(self.fixture.source, isolation_level=None)) as db:
            db.execute("BEGIN EXCLUSIVE")
            try:
                self.assertEqual(self.prepare()["error"]["code"], "source_locked")
            finally:
                db.rollback()
        self.assertEqual(before, self.current())

    def test_only_allowed_tables_and_read_statements(self):
        real_connect = sqlite3.connect
        statements = []

        def connect(*args, **kwargs):
            self.assertIn("?mode=ro", args[0])
            db = real_connect(*args, **kwargs)
            db.set_trace_callback(statements.append)
            return db
        with patch("application.plugins.information_manager.legacy_presentation.sqlite3.connect",
                   side_effect=connect):
            self.assertTrue(self.prepare()["ok"])
        self.assertFalse(any("PRJ_INFOS" in sql for sql in statements))
        self.assertFalse(any(sql.upper().startswith(("INSERT", "UPDATE", "DELETE", "CREATE",
                                                     "ALTER", "DROP")) for sql in statements))
        self.assertTrue(any("ORDER BY rowid" in sql for sql in statements))

    def test_new_prepare_invalidates_old_token_and_project_change_refuses_apply(self):
        first = self.prepare()
        second = self.prepare()
        self.assertEqual(self.apply(first)["error"]["code"], "stale_candidate")
        self.snapshot["_presentationValues"] = {"7": "changed"}
        self.assertEqual(self.apply(second)["error"]["code"], "project_changed")
        self.assertEqual(self.current()["status"], "empty")

    def test_invalid_payloads_and_no_path_from_browser(self):
        for command, payload in (
            ("presentation.import.prepare", {"path": "arbitrary.db"}),
            ("presentation.import.apply", {"token": 4}),
            ("presentation.import.cancel", {"token": "", "other": 1}),
            ("presentation.get", []),
        ):
            self.assertEqual(self.service.call(command, payload)["error"]["code"],
                             "invalid_payload")
        self.select.assert_not_called()

    def test_bad_relations_refuse_apply_and_return_conversion_report(self):
        self.fixture.line("INFOS_LINEEDIT", 50, group="missing", formatage="Aucune modification")
        result = self.prepare()
        self.assertFalse(result["ok"])
        self.assertGreater(result["report"]["summary"]["errors"], 0)
        self.assertEqual(self.current()["status"], "empty")

    def test_unavailable_values_do_not_become_unset_or_defaults(self):
        self.snapshot["_presentationValues"] = None
        self.snapshot["prjatt"]["status"] = "error"
        rows = self.rows(self.prepare()["candidate"]["model"])
        self.assertTrue(all(r["valueState"] == "unavailable" and r["value"] is None for r in rows))

    def test_exact_empty_pipe_and_zero_values_and_current_project_refresh(self):
        reply = self.prepare()
        self.apply(reply)
        for value in ("", "A|B|", "0"):
            self.snapshot["_presentationValues"] = {"7": value}
            rows = self.rows(self.current()["presentation"]["model"])
            self.assertEqual([r["value"] for r in rows[:2]], [value, value])
            self.assertTrue(all(r["valueState"] == "set" for r in rows[:2]))
        attribute: ProjectAttribute = {
            "number": "7", "label": "Synthetic", "definition": {"name": "Synthetic definition"},
            "valueState": "set", "value": "0",
        }
        self.snapshot["data"]["attributes"] = [attribute]
        model = self.current()["presentation"]["model"]
        self.assertEqual(model["counts"]["matchedDefinitions"], 2)
        self.assertEqual(model["counts"]["missingDefinitions"], 1)
        self.assertEqual(self.rows(model)[0]["definition"]["name"], "Synthetic definition")

    def test_exports_are_new_format_only_exclusive_and_not_project_values(self):
        reply = self.prepare()
        configuration = reply["candidate"]["configuration"]
        result = self.service.call("presentation.export", {"configuration": configuration})
        self.assertEqual(result["status"], "exported")
        self.assertEqual(json.loads(self.destination.read_text("utf-8")), configuration)
        self.assertNotIn("valueState", self.destination.read_text("utf-8"))
        self.assertEqual(self.service.call("presentation.export", {
            "configuration": configuration,
        })["error"]["code"], "output_exists")
        self.select.return_value = self.destination
        restored = self.prepare()
        self.assertEqual(restored["candidate"]["configuration"], configuration)
        self.assertIsNone(restored["candidate"]["report"])
        self.assertEqual(self.apply(restored)["status"], "applied")

    def test_export_cancel_failure_and_protected_destinations_keep_current_and_pending(self):
        reply = self.prepare()
        configuration = reply["candidate"]["configuration"]
        self.save.return_value = None
        self.assertEqual(self.service.call("presentation.export", {
            "configuration": configuration,
        })["status"], "cancelled")
        for path, code in (
            (self.fixture.root / "old.db", "unsupported_format"),
            (self.fixture.root / "a.prj" / "new.json", "protected_destination"),
            (self.fixture.root / "missing" / "out.json", "export_failed"),
        ):
            self.save.return_value = path
            self.assertEqual(self.service.call("presentation.export", {
                "configuration": configuration,
            })["error"]["code"], code)
        self.snapshot["installation"] = {"paths": {"STD": str(self.fixture.root / "STD")}}
        self.save.return_value = self.fixture.root / "STD" / "out.json"
        self.assertEqual(self.service.call("presentation.export", {
            "configuration": configuration,
        })["error"]["code"], "protected_destination")
        self.snapshot["installation"] = None
        self.assertEqual(self.apply(reply)["status"], "applied")

    def test_export_rejects_business_data_and_does_not_open_dialog(self):
        original = self.prepare()["candidate"]["configuration"]
        for field, value in (("values", {"7": "no"}), ("version", True)):
            configuration = deepcopy(original)
            configuration[field] = value
            self.assertFalse(self.service.call("presentation.export",
                                             {"configuration": configuration})["ok"])
        for field, value in (("id", ""), ("position", True)):
            configuration = deepcopy(original)
            configuration["categories"][0][field] = value
            self.assertFalse(self.service.call("presentation.export",
                                             {"configuration": configuration})["ok"])
        self.save.assert_not_called()

    def test_detached_results_cannot_mutate_backend_candidate(self):
        reply = self.prepare()
        reply["candidate"]["configuration"]["categories"].clear()
        self.assertEqual(len(self.apply(reply)["presentation"]["configuration"]["categories"]), 2)

    def test_native_app_identity_contract_2_and_file_dialog_label(self):
        app = AimPresentationApp(self.fixture.root, LaunchContext())
        identity = app.get_app_info()
        self.assertEqual(identity["project_contract"], 2)
        self.assertEqual(identity["capabilities"], ["project.select"])
        self.assertEqual(identity["presentation_contract"], 1)
        self.assertEqual(identity["presentation_capabilities"], list(COMMANDS))
        self.assertTrue(identity["read_only"])
        self.assertTrue(app._requires_protected_host)
        window = MagicMock()
        window.create_file_dialog.return_value = (str(self.fixture.source),)
        app._attach_window(window)
        self.assertEqual(app.call("presentation.import.prepare", {})["status"], "prepared")
        self.assertEqual(window.create_file_dialog.call_args.kwargs["file_types"][0],
                         "Pr\u00e9sentations AIM (*.json;*.db)")
        from webview.util import parse_file_type
        self.assertEqual(parse_file_type(window.create_file_dialog.call_args.kwargs["file_types"][0]),
                         ("Pr\u00e9sentations AIM", "*.json;*.db"))
        self.assertFalse((self.fixture.root / "aim-settings.json").exists())
        self.assertFalse(app.call("save", {})["ok"])

    def test_documented_json_is_complete_and_matches_implemented_model(self):
        path = Path(__file__).resolve().parents[1] / "docs" / "integration" / "AIM_LOVABLE_PRESENTATION_IMPORT.md"
        examples = [json.loads(chunk) for chunk in re.findall(
            r"```json\s*\n(.*?)\n```", path.read_text("utf-8"), re.S,
        )]
        prepared = next(e for e in examples if e.get("status") == "prepared")
        candidate = prepared["candidate"]
        validation_report(candidate["configuration"])
        self.assertEqual(display_model(candidate["configuration"], None, {
            **AimProjectApp._empty("required", []),
        }), candidate["model"])
        report = next(e for e in examples if e.get("schema") == "aim-presentation-conversion-report")
        validate_documents(candidate["configuration"], report)
        applied = next(e for e in examples if e.get("status") == "applied")
        self.assertEqual(applied["presentation"], candidate)

    def test_unresolved_defaults_survive_new_json_export_and_reimport(self):
        with closing(sqlite3.connect(self.fixture.source)) as db:
            db.execute("UPDATE INFOS_RADIO SET defaut='9'")
            db.commit()
        reply = self.prepare()
        configuration = reply["candidate"]["configuration"]
        self.assertEqual(self.rows(reply["candidate"]["model"])[1]["resetDefault"]["state"],
                         "unresolved")
        self.assertEqual(self.service.call("presentation.export", {
            "configuration": configuration,
        })["status"], "exported")
        self.select.return_value = self.destination
        self.assertEqual(self.prepare()["candidate"]["configuration"], configuration)


if __name__ == "__main__":
    unittest.main()
