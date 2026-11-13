import hashlib
import json
import os
from pathlib import Path
import re
import shutil
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from application.core.allplan.readers.project_attributes import read_project_attributes
from application.core.configuration import SettingsStore
from application.core.context import LaunchContext
from application.plugins.information_manager.project import AimProjectApp


class ProjectReadingTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.project = self.root / "Prj" / "Test.prj"
        self.project.mkdir(parents=True)
        (self.project / "project.cfg").write_bytes(b"ATTR=PRJ\r\n")
        self.etc = self.root / "Etc"
        self.std = self.root / "Std"
        for directory in (self.etc, self.std, self.project):
            (directory / "Xml").mkdir(parents=True, exist_ok=True)
        self.xml(self.etc, "AttributeDefinitionCollectionAllplan_en.xml",
                 self.definition("7", "Real definition"))
        self.xml(self.project, "AttributeDefinitionCollectionLocal.xml", "")
        self.context = LaunchContext(
            allplan_version="2024",
            paths={"PRJ": self.project.parent, "STD": self.std, "ETC": self.etc},
        )
        self.path = self.project / "prjatt.dat"
        self.data = self.root / "isolated-data"
        self.store = SettingsStore(self.data / "aim-settings.json")
        self.chooser = MagicMock(return_value=None)
        self.discover = MagicMock(return_value=([self.context], []))

    @staticmethod
    def definition(number, label, group="65536", uid=None, extra=""):
        return (
            f"<AttributeDefinition><Ifnr>{number}</Ifnr><Uid>{uid or number}</Uid>"
            f"<Text>{label}</Text><Datatype>C</Datatype><Group>{group}</Group>"
            f"{extra}</AttributeDefinition>"
        )

    @staticmethod
    def xml(directory, name, entries):
        path = directory / "Xml" / name
        path.write_text(f"<Attributes>{entries}</Attributes>", encoding="utf-8")
        return path

    def app(self, project=None):
        return AimProjectApp(
            self.data, LaunchContext(project_path=project),
            settings_store=self.store, choose_directory=self.chooser,
            discover_installations=self.discover,
        )

    def content(self, text):
        self.path.write_bytes(text.encode("cp1252"))

    def history(self):
        return self.store.load("information_manager").get("aimProject", {}).get("lastProject")

    def test_recent_projects_are_unique_newest_first_and_survive_restart(self):
        second = self.outside_project()
        app = self.app(self.project)
        app.get_initial_data()
        self.chooser.return_value = str(second)
        self.assertTrue(app.call("project.select", {})["ok"])
        self.assertEqual(app.call("project.recent", {}), {
            "ok": True, "projects": [
                {"path": str(second), "name": second.name},
                {"path": str(self.project), "name": self.project.name},
            ],
        })
        self.chooser.reset_mock()
        reply = app.call("project.select", {"path": str(self.project)})
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["data"]["project"]["path"], str(self.project))
        self.chooser.assert_not_called()
        restarted = self.app()
        self.assertEqual(restarted.get_initial_data()["project"]["path"], str(self.project))
        self.assertEqual([p["path"] for p in restarted.call("project.recent", {})["projects"]],
                         [str(self.project), str(second)])
        self.assertEqual(self.history(), str(self.project))
        self.assertEqual(self.store.load(app.app_id)["aimProject"]["recentProjects"],
                         [str(self.project), str(second)])

    def test_recent_list_does_not_open_project_and_migrates_last_project_without_writing(self):
        self.store.save("information_manager", {
            "version": 1, "aimProject": {"lastProject": str(self.project)},
        })
        before = (self.data / "aim-settings.json").read_bytes()
        app = self.app()
        self.assertEqual(app.call("project.recent", {})["projects"],
                         [{"path": str(self.project), "name": self.project.name}])
        self.assertIsNone(app._state)
        self.assertIsNone(app._document)
        self.discover.assert_not_called()
        self.chooser.assert_not_called()
        self.assertEqual((self.data / "aim-settings.json").read_bytes(), before)
        self.assertEqual(app.get_app_info()["project_history_contract"], 1)
        self.assertEqual(app.get_app_info()["capabilities"], ["project.select"])

    def test_recent_paths_deduplicate_windows_case_and_preserve_unavailable_entries(self):
        absent = self.root / "Absent.prj"
        self.store.save("information_manager", {
            "version": 1, "aimProject": {
                "lastProject": str(self.project),
                "recentProjects": [str(self.project).upper(), str(absent), str(absent)],
                "otherPreference": "preserved",
            },
        })
        app = self.app(self.project)
        app.get_initial_data()
        self.assertEqual([p["path"] for p in app.call("project.recent", {})["projects"]],
                         [str(self.project), str(absent)])
        self.assertEqual(self.store.load(app.app_id)["aimProject"]["otherPreference"], "preserved")

    def test_recent_open_refuses_paths_not_in_history_before_dialog_or_reader(self):
        app = self.app()
        with patch.object(app, "_load") as load:
            reply = app.call("project.select", {"path": str(self.project)})
        self.assertEqual(reply["error"]["code"], "project_not_recent")
        load.assert_not_called()
        self.chooser.assert_not_called()
        self.assertEqual(app.call("project.recent", {}), {"ok": True, "projects": []})

    def test_recent_missing_project_preserves_current_state_document_and_history(self):
        absent = self.root / "Absent.prj"
        app = self.app(self.project)
        previous = app.get_initial_data()
        document = app._document
        self.store.save(app.app_id, {
            "version": 1, "aimProject": {"recentProjects": [str(self.project), str(absent)]},
        })
        history_before = (self.data / "aim-settings.json").read_bytes()
        reply = app.call("project.select", {"path": str(absent)})
        self.assertFalse(reply["ok"])
        self.assertNotIn("data", reply)
        self.assertEqual(app.get_initial_data(), previous)
        self.assertIs(app._document, document)
        self.assertEqual((self.data / "aim-settings.json").read_bytes(), history_before)
        self.chooser.assert_not_called()

    def test_recent_corrupt_history_reports_error_not_an_empty_success(self):
        app = self.app(self.project)
        previous = app.get_initial_data()
        for invalid in ("not-a-list", [None], ["relative.prj"]):
            with self.subTest(invalid=invalid):
                self.store.save(app.app_id, {
                    "version": 1, "aimProject": {"recentProjects": invalid},
                })
                reply = app.call("project.recent", {})
                self.assertEqual(reply["error"]["code"], "history_unavailable")
                self.assertNotIn("projects", reply)
                self.assertEqual(app.get_initial_data(), previous)

    def test_recent_history_access_failure_is_explicit_and_does_not_change_project(self):
        app = self.app(self.project)
        previous = app.get_initial_data()
        with patch.object(self.store, "load", side_effect=PermissionError("denied")):
            reply = app.call("project.recent", {})
        self.assertEqual(reply["error"]["code"], "history_unavailable")
        self.assertEqual(app.get_initial_data(), previous)

    def test_unexpected_loader_failure_restores_document_and_propagates(self):
        app = self.app(self.project)
        previous = app.get_initial_data()
        document = app._document
        self.chooser.return_value = str(self.project)

        def fail(*_args):
            app._document = None
            raise RuntimeError("Unexpected reader failure")

        with patch.object(app, "_load", side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, "Unexpected reader failure"):
                app.call("project.select", {})
        self.assertEqual(app.get_initial_data(), previous)
        self.assertIs(app._document, document)

    def test_failed_or_cancelled_selection_preserves_confirmed_and_pending_presentation(self):
        from application.plugins.information_manager.presentation import AimPresentationApp
        configuration = json.loads((Path(__file__).parent / "fixtures" /
                                    "aim_frontend_update_example.json").read_text("utf-8"))["configuration"]
        source = self.root / "presentation.json"
        source.write_text(json.dumps(configuration), encoding="utf-8")
        self.content("Version 3\r\n7|Name|original value\r\n")
        app = AimPresentationApp(
            self.data, LaunchContext(project_path=self.project), settings_store=self.store,
            choose_directory=self.chooser, discover_installations=self.discover,
            choose_presentation=lambda: str(source), presentation_update=True,
        )
        previous = app.get_initial_data()
        self.assertTrue(app.call("presentation.update", {"configuration": configuration})["ok"])
        presentation = app.call("presentation.get", {})["presentation"]
        token = app.call("presentation.import.prepare", {})["token"]
        self.content("invalid")
        self.chooser.return_value = str(self.project)
        self.assertFalse(app.call("project.select", {})["ok"])
        self.chooser.return_value = None
        self.assertEqual(app.call("project.select", {})["status"], "cancelled")
        self.assertEqual(app.get_initial_data(), previous)
        self.assertEqual(app.call("presentation.get", {})["presentation"], presentation)
        self.assertTrue(app.call("presentation.import.apply", {"token": token})["ok"])

    def assert_value_states(self, state, expected):
        self.assertEqual(set(state["data"]), {"attributes"})
        self.assertEqual(
            [(row["number"], row["valueState"], row["value"])
             for row in state["data"]["attributes"]],
            expected,
        )

    def test_accents_pipes_zero_empty_and_whitespace_are_preserved(self):
        self.content("Version 3\r\n7|Nom accentu\u00e9|  \u00e9t\u00e9|suite  \r\n8|Zero|0\r\n9|Vide|\r\n")
        result = read_project_attributes(self.project)
        self.assertEqual(result.data.status, "read")
        self.assertEqual(result.data.header, "Version 3")
        self.assertEqual(result.data.values(), {"7": "  \u00e9t\u00e9|suite  ", "8": "0", "9": ""})
        self.assertEqual(result.data.records[0].name, "Nom accentu\u00e9")
        assert result.data.text is not None
        self.assertTrue(result.data.text.endswith("\r\n"))
        self.assertEqual(self.path.read_bytes(), result.data.text.encode("cp1252"))

    def test_unknown_attributes_not_fabricated_into_definitions(self):
        self.content("Version 3\r\n999999|Not a definition|unknown\r\n")
        app = self.app(self.project)
        state = app.get_initial_data()
        self.assert_value_states(state, [("7", "unset", None)])
        self.assertEqual(app._document.values(), {"999999": "unknown"})
        self.assertEqual(app._document.records[0].name, "Not a definition")
        self.assertEqual(state["definitions"]["status"], "available")

    def test_missing_file_is_accepted_and_remembered(self):
        state = self.app(self.project).get_initial_data()
        self.assertEqual(state["selection"], "accepted")
        self.assertEqual(state["prjatt"]["status"], "missing")
        self.assert_value_states(state, [("7", "unset", None)])
        self.assertEqual(self.history(), str(self.project))

    def test_invalid_header_invalid_lines_and_duplicates_have_no_winning_values(self):
        for text, code in (
            ("Version 9\r\n7|Name|value\r\n", "invalid_header"),
            ("Version 3\r\nbad line\r\n", "invalid_line"),
            ("Version 3\r\n7|a|1\r\n7|b|2\r\n", "duplicate_number"),
            ("Version 3\r\n07|a|1\r\n7|b|2\r\n", "duplicate_number"),
            ("Version 3\r\n7|a|1\r\n\r\n8|b|2\r\n", "invalid_line"),
            ("Version 3\r\n7|a|\x00\r\n", "invalid_line"),
        ):
            with self.subTest(code=code, text=text):
                self.content(text)
                result = read_project_attributes(self.project)
                self.assertEqual(result.data.status, "error")
                self.assertIsNone(result.data.values())
                self.assertIn(code, [d.code for d in result.diagnostics])
                self.assertEqual(result.data.text, text)

    def test_decode_error_is_not_replaced(self):
        self.path.write_bytes(b"Version 3\r\n7|a|\x81\r\n")
        result = read_project_attributes(self.project)
        self.assertEqual(result.data.status, "error")
        self.assertIsNone(result.data.values())
        self.assertIn("decode_failed", [d.code for d in result.diagnostics])

    def test_linked_attribute_file_is_refused_before_read(self):
        with patch.object(Path, "is_symlink", return_value=True), patch.object(
            Path, "read_bytes",
        ) as read:
            result = read_project_attributes(self.project)
        read.assert_not_called()
        self.assertEqual(result.data.status, "error")
        self.assertIn("linked_file", [d.code for d in result.diagnostics])

    def test_read_error_is_not_missing_or_empty_and_does_not_update_history(self):
        self.content("Version 3\r\n7|a|value\r\n")
        app = self.app(self.project)
        original = Path.read_bytes

        def read(path):
            if path.name == "prjatt.dat":
                raise PermissionError("denied")
            return original(path)

        with patch.object(Path, "read_bytes", read):
            state = app.get_initial_data()
        self.assertEqual(state["selection"], "error")
        self.assertEqual(state["prjatt"]["status"], "error")
        self.assert_value_states(state, [("7", "unavailable", None)])
        self.assertIsNone(self.history())
        self.chooser.assert_not_called()

    def test_missing_version_does_not_prevent_recognized_project(self):
        state = self.app(self.project).get_initial_data()
        self.chooser.assert_not_called()
        self.assertEqual(state["selection"], "accepted")
        self.assertEqual(state["project"]["path"], str(self.project))
        self.assertEqual(self.history(), str(self.project))

    def test_inaccessible_explicit_does_not_fall_back_to_history(self):
        self.store.save("information_manager", {
            "version": 1, "aimProject": {"lastProject": str(self.project)},
        })
        state = self.app(self.root / "Absent.prj").get_initial_data()
        self.chooser.assert_called_once_with()
        self.assertEqual(state["selection"], "cancelled")
        self.assertIsNone(state["project"])
        self.assertEqual(self.history(), str(self.project))

    def test_inaccessible_history_returns_to_selection(self):
        self.store.save("information_manager", {
            "version": 1, "aimProject": {"lastProject": str(self.root / "Absent.prj")},
        })
        self.chooser.return_value = str(self.project)
        state = self.app().get_initial_data()
        self.chooser.assert_called_once_with()
        self.assertEqual(state["project"]["path"], str(self.project))
        self.assertEqual(self.history(), str(self.project))

    def test_valid_explicit_has_priority_and_valid_history_skips_dialog(self):
        self.store.save("information_manager", {
            "version": 1, "aimProject": {"lastProject": str(self.root / "Absent.prj")},
        })
        self.assertEqual(self.app(self.project).get_initial_data()["selection"], "accepted")
        self.assertEqual(self.app().get_initial_data()["project"]["path"], str(self.project))
        self.chooser.assert_not_called()

    def test_cancel_is_open_without_project_and_initialization_is_idempotent(self):
        app = self.app()
        state = app.get_initial_data()
        self.assertEqual(state, app.get_initial_data())
        self.chooser.assert_called_once_with()
        self.assertEqual(state["selection"], "cancelled")
        self.assertIsNone(state["project"])
        self.assert_value_states(state, [])
        self.assertIsNone(self.history())

    def test_invalid_history_is_diagnosed_before_dialog(self):
        self.store.save("information_manager", {"version": 1, "aimProject": []})
        state = self.app().get_initial_data()
        self.chooser.assert_called_once_with()
        self.assertIn("history_error", [d["code"] for d in state["diagnostics"]])

    def test_invalid_selection_is_not_success_or_another_project(self):
        self.chooser.return_value = str(self.root / "Absent.prj")
        reply = self.app().call("project.select", {})
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["error"]["code"], "project_selection_required")
        self.assertIsNone(reply["data"]["project"])
        self.assertIsNone(self.history())

    def test_native_selection_error_is_diagnosed(self):
        self.chooser.side_effect = OSError("dialog unavailable")
        reply = self.app().call("project.select", {})
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["data"]["selection"], "required")
        self.assertIn("selection_error", [d["code"] for d in reply["data"]["diagnostics"]])

    def test_history_write_failure_does_not_hide_loaded_values(self):
        self.content("Version 3\r\n7|Name|0\r\n")
        with patch.object(self.store, "save", side_effect=PermissionError("denied")):
            state = self.app(self.project).get_initial_data()
        self.assert_value_states(state, [("7", "set", "0")])
        self.assertEqual(state["selection"], "accepted")
        self.assertIn("history_error", [d["code"] for d in state["diagnostics"]])

    def test_returned_snapshots_cannot_mutate_cached_state(self):
        app = self.app(self.project)
        state = app.get_initial_data()
        state["data"]["attributes"][0]["value"] = "injected"
        state["data"]["attributes"][0]["definition"]["label"] = "injected"
        state["capabilities"].append("save")
        self.assert_value_states(app.get_initial_data(), [("7", "unset", None)])
        self.assertEqual(app.get_initial_data()["data"]["attributes"][0]["definition"]["label"],
                         "Real definition")
        self.assertEqual(app.get_app_info()["capabilities"], ["project.select"])

    def test_change_to_missing_attributes_clears_previous_values(self):
        self.content("Version 3\r\n7|a|first\r\n")
        second = self.root / "Prj" / "Second.prj"
        second.mkdir()
        (second / "project.cfg").write_bytes(b"ATTR=STD\r\n")
        self.xml(self.std, "AttributeDefinitionCollectionLocal.xml",
                 self.definition("5001", "STD field"))
        app = self.app(self.project)
        self.assert_value_states(app.get_initial_data(), [("7", "set", "first")])
        self.chooser.return_value = str(second)
        reply = app.call("project.select", {})
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["data"]["prjatt"]["status"], "missing")
        self.assert_value_states(reply["data"], [("7", "unset", None), ("5001", "unset", None)])
        self.assertEqual(self.history(), str(second))
        self.assertEqual(reply["data"]["definitions"]["attr"], "STD")

    def test_cancel_change_preserves_project_document_and_history(self):
        app = self.app(self.project)
        previous = app.get_initial_data()
        document = app._document
        reply = app.call("project.select", {})
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["status"], "cancelled")
        self.assertEqual(reply["data"], previous)
        self.assertEqual(app.get_initial_data(), reply["data"])
        self.assertIs(app._document, document)
        self.assertEqual(self.history(), str(self.project))

    def test_failed_selected_project_returns_error_and_preserves_history(self):
        app = self.app(self.project)
        previous = app.get_initial_data()
        document = app._document
        self.content("invalid")
        self.chooser.return_value = str(self.project)
        reply = app.call("project.select", {})
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["error"]["code"], "project_read_error")
        self.assertNotIn("data", reply)
        self.assertEqual(app.get_initial_data(), previous)
        self.assertIs(app._document, document)
        self.assertEqual(self.history(), str(self.project))

    def test_surface_and_refusals_before_history_dialog_or_read(self):
        app = self.app()
        methods = {name for name in dir(app)
                   if not name.startswith("_") and callable(getattr(app, name))}
        self.assertEqual(methods, {"get_app_info", "get_initial_data", "call"})
        self.assertEqual(app.get_app_info()["capabilities"], ["project.select"])
        with patch.object(self.store, "load") as load, patch(
            "application.plugins.information_manager.project.read_project_attributes"
        ) as read:
            for command in ("save", "settings.save", "project.open", "prjtool", None, []):
                self.assertFalse(app.call(command, {})["ok"])
            for payload in (None, [], "", {"path": None}, {"path": "relative.prj"},
                            {"app_id": app.app_id}):
                self.assertFalse(app.call("project.select", payload)["ok"])
        load.assert_not_called()
        read.assert_not_called()
        self.chooser.assert_not_called()

    def test_shared_definitions_use_number_not_prjatt_name(self):
        self.content("Version 3\r\n7|Wrong name|value\r\n")
        app = self.app(self.project)
        state = app.get_initial_data()
        self.assertEqual(state["data"]["attributes"][0]["label"], "Real definition")
        self.assertEqual(state["data"]["attributes"][0]["definition"]["group_mask"], 65536)
        self.assert_value_states(state, [("7", "set", "value")])

    def test_contract_two_associates_canonical_numbers_and_preserves_all_strings(self):
        self.xml(self.etc, "AttributeDefinitionCollectionAllplan_en.xml", "".join(
            self.definition(str(number), f"Field {number}") for number in (7, 8, 9, 10)
        ))
        self.content("Version 3\r\n09|Wrong label|  \u00e9t\u00e9|suite  \r\n"
                     "0007|Wrong label|0\r\n8|Wrong label|\r\n999|Unknown|private\r\n")
        app = self.app(self.project)
        state = app.get_initial_data()
        self.assert_value_states(state, [
            ("7", "set", "0"), ("8", "set", ""),
            ("9", "set", "  \u00e9t\u00e9|suite  "), ("10", "unset", None),
        ])
        self.assertEqual(json.loads(json.dumps(state)), state)
        for row in state["data"]["attributes"]:
            self.assertEqual(set(row), {"number", "label", "definition", "valueState", "value"})
            self.assertEqual(row["number"], row["definition"]["number"])
            self.assertEqual(row["label"], row["definition"]["label"])
            self.assertEqual(row["label"], f"Field {row['number']}")
            self.assertEqual(set(row["definition"]), {
                "number", "uid", "label", "datatype", "group_mask", "unit", "minimum",
                "maximum", "modify", "visible", "control", "propositions", "formulas",
                "properties", "provenance",
            })
        self.assertEqual(app._document.records[1].number, "0007")
        self.assertEqual(app._document.values()["999"], "private")
        self.assertNotIn("private", json.dumps(state))
        self.assertEqual(app.get_app_info()["project_contract"], 2)
        self.assertEqual(app.get_app_info()["protocol_version"], 1)
        self.assertEqual(state["project_contract"], 2)

    def test_change_from_set_to_invalid_file_preserves_all_values(self):
        self.content("Version 3\r\n7|a|old value\r\n")
        app = self.app(self.project)
        self.assert_value_states(app.get_initial_data(), [("7", "set", "old value")])
        self.chooser.return_value = str(self.project)
        for raw in ("Version 9\r\n", "Version 3\r\n7|a|1\r\n07|b|2\r\n",
                    "Version 3\r\ninvalid\r\n", "Version 3\r\n7|a|\x81\r\n"):
            with self.subTest(raw=raw):
                self.path.write_bytes(raw.encode("cp1252") if "\x81" not in raw else
                                      b"Version 3\r\n7|a|\x81\r\n")
                reply = app.call("project.select", {})
                self.assertFalse(reply["ok"])
                self.assertNotIn("data", reply)
                self.assert_value_states(app.get_initial_data(), [("7", "set", "old value")])
                self.assertEqual(app._document.values(), {"7": "old value"})

    def test_projection_canonicalizes_xml_number_without_mutating_reader_data(self):
        from application.core.allplan.readers.attributes import (
            discover_attributes, read_project_definitions,
        )
        from application.core.allplan.sources import SourceSelection

        for xml_number, record_number in (("0007", "7"), ("7", "0007")):
            with self.subTest(xml_number=xml_number, record_number=record_number):
                xml = self.xml(self.etc, "AttributeDefinitionCollectionAllplan_en.xml",
                               self.definition(xml_number, "Real definition"))
                self.content(f"Version 3\r\n{record_number}|Other name|0\r\n")
                definitions = read_project_definitions(discover_attributes(
                    self.context, SourceSelection("attributes", "project", self.project),
                    "", project_only=True,
                ))
                original_xml = xml.read_bytes()
                original_definition = definitions.data["7"]
                app = self.app(self.project)
                self.chooser.return_value = str(self.project)
                with patch(
                    "application.plugins.information_manager.project.read_project_definitions",
                    return_value=definitions,
                ):
                    initial = app.get_initial_data()
                    selected = app.call("project.select", {})
                self.assertTrue(selected["ok"])
                self.assertEqual(selected["data"], initial)
                self.assertEqual(app.get_initial_data(), initial)
                self.assert_value_states(initial, [("7", "set", "0")])
                row = initial["data"]["attributes"][0]
                self.assertEqual(row["definition"]["number"], row["number"])
                self.assertEqual(initial["project_contract"], 2)
                self.assertEqual(json.loads(json.dumps(initial)), initial)
                self.assertIs(definitions.data["7"], original_definition)
                self.assertEqual(original_definition.number, xml_number)
                self.assertEqual(
                    next(prop.text for prop in original_definition.properties if prop.name == "Ifnr"),
                    xml_number,
                )
                self.assertEqual(app._document.records[0].number, record_number)
                self.assertEqual(xml.read_bytes(), original_xml)

    def test_change_to_unavailable_definitions_preserves_state_and_document(self):
        self.content("Version 3\r\n7|a|0\r\n")
        app = self.app(self.project)
        self.assert_value_states(app.get_initial_data(), [("7", "set", "0")])
        (self.etc / "Xml" / "AttributeDefinitionCollectionAllplan_en.xml").unlink()
        self.chooser.return_value = str(self.project)
        previous = app.get_initial_data()
        reply = app.call("project.select", {})
        self.assertFalse(reply["ok"])
        self.assertNotIn("data", reply)
        self.assertEqual(app.get_initial_data(), previous)
        self.assertEqual(app._document.values(), {"7": "0"})

    def contract_examples(self):
        from dataclasses import replace
        self.content("Version 3\r\n7|Wrong name|0\r\n")
        app = self.app(self.project)
        examples = {"loaded": app.get_initial_data()}
        self.chooser.return_value = str(self.project)
        self.path.unlink()
        examples["missing"] = app.call("project.select", {})["data"]
        self.content("Version 9\r\n")
        examples["read_error"] = self.app().call("project.select", {})["data"]
        self.discover.return_value = ([], [])
        examples["unrecognized"] = self.app().call("project.select", {})["data"]
        self.discover.return_value = ([self.context, replace(self.context, allplan_version="2025")], [])
        self.content("Version 3\r\n7|Wrong name|0\r\n")
        examples["shared_prj"] = app.call("project.select", {})["data"]
        self.discover.return_value = ([self.context], [])
        (self.etc / "Xml" / "AttributeDefinitionCollectionAllplan_en.xml").unlink()
        self.content("Version 3\r\n7|Wrong name|0\r\n")
        examples["definitions_unavailable"] = self.app().call("project.select", {})["data"]
        self.chooser.return_value = None
        examples["cancelled"] = self.app().call("project.select", {})["data"]
        return examples

    def test_documented_snapshots_match_contract_two_service(self):
        document = (Path(__file__).resolve().parents[1] / "docs" / "integration" /
                    "AIM_PROJECT_READING.md").read_text(encoding="utf-8")
        identity_match = re.search(r"```json\s+(.*?)\s+```", document, re.DOTALL)
        if identity_match is None:
            self.fail("Identite JSON absente du contrat documente.")
        identity = json.loads(identity_match.group(1))
        self.assertEqual(identity, self.app().get_app_info())
        blocks = dict(re.findall(r"### Snapshot `(\w+)`\s+```json\s+(.*?)\s+```",
                                 document, re.DOTALL))
        examples = self.contract_examples()
        self.assertEqual(set(blocks), set(examples))
        for name, state in examples.items():
            with self.subTest(name=name):
                normalized = json.loads(json.dumps(state).replace(
                    json.dumps(str(self.root))[1:-1], json.dumps(r"C:\AIM-Fixture")[1:-1],
                ))
                self.assertEqual(json.loads(blocks[name]), normalized)
                self.assertEqual(state["project_contract"], 2)
                self.assertEqual(set(state["data"]), {"attributes"})

    def test_no_project_write_and_settings_confined(self):
        self.content("Version 3\r\n7|a|0\r\n")
        before = {str(p): p.read_bytes() for p in self.project.rglob("*") if p.is_file()}
        self.app(self.project).get_initial_data()
        self.assertEqual(before, {
            str(p): p.read_bytes() for p in self.project.rglob("*") if p.is_file()
        })
        self.assertTrue((self.data / "aim-settings.json").is_file())
        self.assertTrue((self.data / "aim-settings.json.lock").is_file())

    def test_normal_launch_fails_before_api_exposure_or_navigation(self):
        from application.core.catalog import PLUGINS
        from application.launcher.main import create_parser, run_app
        webview = MagicMock()
        with patch.dict("sys.modules", {"webview": webview}), patch.dict(
            os.environ, {"LOCALAPPDATA": str(self.root / "local")},
        ):
            with self.assertRaisesRegex(RuntimeError, "lancement distant bloque"):
                run_app(PLUGINS["information_manager"], LaunchContext(),
                        create_parser().parse_args([]))
        webview.create_window.assert_not_called()
        webview.start.assert_not_called()

    def test_runtime_factory_preserves_context_without_registry_or_remote_access(self):
        from application.core.catalog import PLUGINS
        from application.core.runtime import create_app, PluginServices
        context = LaunchContext(project_path=self.project)
        app = create_app(PLUGINS["information_manager"], self.data, context, {},
                         PluginServices())
        self.assertIsInstance(app, AimProjectApp)
        self.assertEqual(app._launch_context, context)
        self.assertTrue(app._requires_protected_host)
        app._discover_installations = self.discover
        self.assertEqual(app.get_initial_data()["project"]["path"], str(self.project))

    def test_prj_named_directory_is_not_an_installation(self):
        self.discover.return_value = ([], [])
        with patch(
            "application.plugins.information_manager.project.read_project_attributes"
        ) as values, patch(
            "application.plugins.information_manager.project.discover_attributes"
        ) as definitions:
            state = self.app(self.project).get_initial_data()
        values.assert_not_called()
        definitions.assert_not_called()
        self.assertEqual(state["selection"], "error")
        self.assert_value_states(state, [])
        self.assertIn("installation_unavailable", [d["code"] for d in state["diagnostics"]])
        self.assertIsNone(self.history())

    def test_shared_prj_uses_latest_installation_without_dialog(self):
        from dataclasses import replace
        other = replace(self.context, allplan_version="2025")
        self.discover.return_value = ([self.context, other], [])
        state = self.app(self.project).get_initial_data()
        self.assertEqual(state["selection"], "accepted")
        self.assertEqual(len(state["installationCandidates"]), 2)
        self.assertEqual(state["installation"]["version"], "2025")
        self.assertIn("installation_selected_project", [d["code"] for d in state["diagnostics"]])
        self.chooser.assert_not_called()

    def test_explicit_installation_choice_resolves_ambiguity_without_resource_mix(self):
        from dataclasses import replace
        other = replace(self.context, allplan_version="2025")
        self.discover.return_value = ([self.context, other], [])
        app = AimProjectApp(
            self.data, replace(self.context, project_path=self.project),
            settings_store=self.store, discover_installations=self.discover,
        )
        state = app.get_initial_data()
        self.assertEqual(state["selection"], "accepted")
        self.assertEqual(state["installation"]["version"], "2024")
        self.assertEqual(state["installation"]["paths"]["ETC"], str(self.etc))

    def test_launch_version_does_not_block_real_project_installation(self):
        from dataclasses import replace
        app = AimProjectApp(
            self.data, replace(self.context, allplan_version="2025",
                               paths={"PRJ": self.root / "OtherPrj"},
                               project_path=self.project),
            settings_store=self.store, discover_installations=self.discover,
        )
        state = app.get_initial_data()
        self.assertEqual(state["selection"], "accepted")
        self.assertEqual(state["installation"]["version"], "2024")
        self.assertEqual(self.history(), str(self.project))

    def test_incomplete_installation_inventory_is_not_treated_as_unique(self):
        self.discover.side_effect = TimeoutError("timeout")
        state = self.app(self.project).get_initial_data()
        self.assertEqual(state["selection"], "error")
        self.assert_value_states(state, [])
        self.assertIn("installation_discovery_error", [d["code"] for d in state["diagnostics"]])

    def test_invalid_config_has_no_std_fallback(self):
        self.content("Version 3\r\n7|a|value\r\n")
        for raw in (None, b"", b"ATTR=OTHER\r\n", b"ATTR=STD\r\nATTR=PRJ\r\n", b"ATTR=\x81"):
            with self.subTest(raw=raw):
                path = self.project / "project.cfg"
                if raw is None:
                    path.unlink(missing_ok=True)
                else:
                    path.write_bytes(raw)
                with patch(
                    "application.plugins.information_manager.project.read_project_attributes"
                ) as values, patch(
                    "application.plugins.information_manager.project.discover_attributes"
                ) as definitions:
                    state = self.app(self.project).get_initial_data()
                values.assert_not_called()
                definitions.assert_not_called()
                self.assertEqual(state["selection"], "error")
                self.assert_value_states(state, [])
                self.assertIn("project_config_invalid", [d["code"] for d in state["diagnostics"]])
                self.assertIsNone(self.history())

    def test_unreadable_config_does_not_load_values_or_definitions(self):
        original = Path.read_bytes

        def read(path):
            if path.name == "project.cfg":
                raise PermissionError("denied")
            return original(path)

        with patch.object(Path, "read_bytes", read), patch(
            "application.plugins.information_manager.project.read_project_attributes"
        ) as values, patch(
            "application.plugins.information_manager.project.discover_attributes"
        ) as definitions:
            state = self.app(self.project).get_initial_data()
        values.assert_not_called()
        definitions.assert_not_called()
        self.assertIn("project_config_invalid", [d["code"] for d in state["diagnostics"]])
        self.assertEqual(state["prjatt"]["status"], "not_loaded")
        self.assertIsNone(self.history())

    def test_incomplete_matched_context_does_not_borrow_other_versions_paths(self):
        from dataclasses import replace
        incomplete = replace(self.context, paths={"PRJ": self.project.parent})
        other = replace(self.context, allplan_version="2025",
                        paths={**self.context.paths, "PRJ": self.root / "OtherPrj"})
        self.discover.return_value = ([incomplete, other], [])
        state = self.app(self.project).get_initial_data()
        self.assertEqual(state["selection"], "error")
        self.assert_value_states(state, [])
        self.assertIn("installation_context_incomplete",
                      [d["code"] for d in state["diagnostics"]])
        self.assertIsNone(state["installation"])
        self.assertIsNone(self.history())

    def installation(self, version, *, verification=False):
        root = self.root / f"Allplan-{version}-{verification}"
        paths = {key: root / key for key in ("PRJ", "STD", "ETC")}
        for directory in paths.values():
            (directory / "Xml").mkdir(parents=True)
        self.xml(paths["ETC"], "AttributeDefinitionCollectionAllplan_en.xml",
                 self.definition("7", f"Allplan {version}"))
        self.xml(paths["STD"], "AttributeDefinitionCollectionLocal.xml", "")
        return LaunchContext(allplan_version=version, verification_version=verification, paths=paths)

    def outside_project(self):
        outside = self.root / "Anywhere" / "Name-2099.prj"
        shutil.copytree(self.project, outside)
        return outside

    def test_outside_prj_selects_numeric_latest_usable_installation_in_place(self):
        self.content("Version 3\r\n7|Name|  exact|0  \r\n")
        outside = self.outside_project()
        newer = self.installation("2026")
        special = self.installation("99")
        self.discover.return_value = ([special, newer, self.context], ["Inventory detail"])
        before = {p: p.read_bytes() for p in outside.rglob("*") if p.is_file()}
        self.chooser.return_value = str(outside)
        reply = self.app().call("project.select", {})
        self.assertTrue(reply["ok"])
        state = reply["data"]
        self.assertEqual(state["installation"]["version"], "2026")
        self.assertEqual(state["project"]["path"], str(outside))
        self.assert_value_states(state, [("7", "set", "  exact|0  ")])
        self.assertIn("installation_selected_latest", [d["code"] for d in state["diagnostics"]])
        self.assertFalse(any(d["severity"] == "error" for d in state["diagnostics"]))
        self.assertEqual(before, {p: p.read_bytes() for p in outside.rglob("*") if p.is_file()})
        self.chooser.assert_called_once_with()

    def test_associated_installation_has_priority_over_newest_unrelated(self):
        newer = self.installation("2026")
        self.discover.return_value = ([newer, self.context], [])
        state = self.app(self.project).get_initial_data()
        self.assertEqual(state["installation"]["version"], "2024")
        self.assertEqual(state["installation"]["paths"]["ETC"], str(self.etc))
        self.assertIn("installation_selected_project", [d["code"] for d in state["diagnostics"]])

    def test_same_installation_preserves_launch_path_and_language_overrides(self):
        (self.project / "project.cfg").write_bytes(b"ATTR=STD\r\n")
        override = self.root / "OverrideStd"
        (override / "Xml").mkdir(parents=True)
        self.xml(override, "AttributeDefinitionCollectionLocal.xml",
                 self.definition("8", "Explicit STD"))
        self.xml(self.etc, "AttributeDefinitionCollectionAllplan_fr.xml",
                 self.definition("7", "French definition"))
        app = AimProjectApp(
            self.data,
            LaunchContext(allplan_version="2024", allplan_language="fra",
                          project_path=self.project, paths={"STD": override}),
            settings_store=self.store, discover_installations=self.discover,
        )
        state = app.get_initial_data()
        self.assertEqual(state["selection"], "accepted")
        self.assertEqual(state["definitions"]["language"], "fr")
        self.assertEqual(state["definitions"]["source"], str(override))
        self.assertEqual(state["installation"]["paths"]["ETC"], str(self.etc))
        self.assertEqual([row["label"] for row in state["data"]["attributes"]],
                         ["French definition", "Explicit STD"])

    def test_launch_context_alone_cannot_invent_an_installed_version(self):
        from dataclasses import replace
        self.discover.return_value = ([], [])
        app = AimProjectApp(
            self.data, replace(self.context, project_path=self.project),
            settings_store=self.store, discover_installations=self.discover,
        )
        state = app.get_initial_data()
        self.assertEqual(state["selection"], "error")
        self.assertIsNone(state["installation"])
        self.assertIsNone(self.history())

    def test_samefile_alias_association_is_preferred_to_unrelated_newer_version(self):
        outside = self.outside_project()
        newer = self.installation("2026")
        self.discover.return_value = ([newer, self.context], [])

        def samefile(path, other):
            return path == outside.parent and other == self.project.parent

        with patch.object(Path, "samefile", samefile):
            state = self.app(outside).get_initial_data()
        self.assertEqual(state["installation"]["version"], "2024")
        self.assertEqual(state["project"]["path"], str(outside))
        self.assertIn("installation_selected_project", [d["code"] for d in state["diagnostics"]])

    def test_fallback_skips_newer_incomplete_and_corrupt_installations(self):
        from dataclasses import replace
        outside = self.outside_project()
        newer = self.installation("2026")
        (newer.paths["ETC"] / "Xml" / "AttributeDefinitionCollectionAllplan_en.xml").write_text(
            "<broken", encoding="utf-8",
        )
        incomplete = replace(newer, allplan_version="2027", paths={"PRJ": newer.paths["PRJ"]})
        self.discover.return_value = ([incomplete, self.context, newer], [])
        state = self.app(outside).get_initial_data()
        self.assertEqual(state["selection"], "accepted")
        self.assertEqual(state["installation"]["version"], "2024")
        self.assertEqual(state["installation"]["paths"], {
            key: str(value) for key, value in self.context.paths.items()
        })
        self.assertIn("installation_resources_unavailable", [d["code"] for d in state["diagnostics"]])
        self.assertIn("installation_context_incomplete", [d["code"] for d in state["diagnostics"]])

    def test_no_exploitable_installation_is_real_error_and_never_reads_values(self):
        outside = self.outside_project()
        system = self.etc / "Xml" / "AttributeDefinitionCollectionAllplan_en.xml"
        system.unlink()
        self.chooser.return_value = str(outside)
        with patch("application.plugins.information_manager.project.read_project_attributes") as read:
            reply = self.app().call("project.select", {})
        read.assert_not_called()
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["data"]["selection"], "error")
        self.assertIsNone(reply["data"]["installation"])
        self.assertIn("Aucune installation", reply["error"]["message"])

    def test_fallback_std_uses_only_selected_installation_and_no_defaults(self):
        outside = self.outside_project()
        (outside / "project.cfg").write_bytes(b"ATTR=STD\r\n")
        newer = self.installation("2026")
        self.xml(newer.paths["STD"], "AttributeDefinitionCollectionLocal.xml",
                 self.definition("8", "Selected STD", extra="<Value>default not applied</Value>"))
        self.discover.return_value = ([newer, self.context], [])
        state = self.app(outside).get_initial_data()
        self.assertEqual(state["definitions"]["source"], str(newer.paths["STD"]))
        self.assertEqual([row["label"] for row in state["data"]["attributes"]],
                         ["Allplan 2026", "Selected STD"])
        self.assert_value_states(state, [("7", "unset", None), ("8", "unset", None)])

    def test_fallback_read_error_preserves_current_project_without_trying_other_installations(self):
        self.content("Version 3\r\n7|Name|previous\r\n")
        outside = self.outside_project()
        (outside / "prjatt.dat").write_bytes(b"Version 9\r\n7|Name|invalid\r\n")
        newer = self.installation("2026")
        self.discover.return_value = ([newer, self.context], [])
        app = self.app(self.project)
        previous = app.get_initial_data()
        self.chooser.return_value = str(outside)
        with patch("application.plugins.information_manager.project.read_project_attributes",
                   wraps=read_project_attributes) as read:
            reply = app.call("project.select", {})
        read.assert_called_once_with(outside)
        self.assertFalse(reply["ok"])
        self.assertIn("prjatt.dat", reply["error"]["message"])
        self.assertNotIn("data", reply)
        self.assertEqual(app.get_initial_data(), previous)
        self.assert_value_states(previous, [("7", "set", "previous")])

    def test_outside_invalid_config_has_specific_error_not_inventory_reason(self):
        outside = self.outside_project()
        (outside / "project.cfg").write_bytes(b"ATTR=INVALID\r\n")
        self.discover.return_value = ([self.context], ["Unrelated inventory diagnostic"])
        self.chooser.return_value = str(outside)
        with patch("application.plugins.information_manager.project.read_project_attributes") as read:
            reply = self.app().call("project.select", {})
        self.assertFalse(reply["ok"])
        self.assertIn("project.cfg", reply["error"]["message"])
        self.assertNotIn("Unrelated", reply["error"]["message"])
        self.assertEqual(reply["data"]["diagnostics"][0]["severity"], "warning")
        self.assertIsNone(self.history())
        read.assert_not_called()

    def test_fallback_same_year_prefers_standard_unless_launch_context_selects_verification(self):
        from dataclasses import replace
        outside = self.outside_project()
        standard = self.installation("2026")
        verification = self.installation("2026", verification=True)
        self.discover.return_value = ([verification, standard], [])
        self.assertFalse(self.app(outside).get_initial_data()["installation"]["verificationVersion"])
        app = AimProjectApp(
            self.data, replace(verification, project_path=outside),
            settings_store=self.store, discover_installations=self.discover,
        )
        self.assertTrue(app.get_initial_data()["installation"]["verificationVersion"])

    def test_std_mode_does_not_read_project_local_definitions(self):
        (self.project / "project.cfg").write_bytes(b"ATTR=STD\r\n")
        self.xml(self.std, "AttributeDefinitionCollectionLocal.xml",
                 self.definition("5000", "STD"))
        self.xml(self.project, "AttributeDefinitionCollectionLocal.xml",
                 self.definition("6000", "Project"))
        state = self.app(self.project).get_initial_data()
        self.assertEqual([e["number"] for e in state["data"]["attributes"]], ["7", "5000"])
        self.assertEqual(state["definitions"]["source"], str(self.std))

    def test_project_group_is_mask_not_comment_and_metadata_preserved(self):
        self.xml(self.project, "AttributeDefinitionCollectionLocal.xml",
                 self.definition("5000", "Project", "65537", extra=(
                     "<Modify>false</Modify><Visible>true</Visible><Unit>m</Unit>"
                     "<MinValue>0</MinValue><MaxValue>12.5</MaxValue>"
                     "<Enumeration><Item><Key>0</Key><Value>Zero</Value></Item></Enumeration>"
                 )) + self.definition("6000", "Not project", "1",
                                      extra="<!-- ATTR_PRG_BEREICH_PROJEKT 65536 -->"))
        self.content("Version 3\r\n5000|Wrong label|0\r\n")
        state = self.app(self.project).get_initial_data()
        self.assertEqual([e["number"] for e in state["data"]["attributes"]], ["7", "5000"])
        definition = state["data"]["attributes"][1]["definition"]
        self.assertEqual(definition["group_mask"], 65537)
        self.assertFalse(definition["modify"])
        self.assertEqual(definition["maximum"], "12.5")
        self.assertEqual(definition["propositions"][0]["index"], 0)
        self.assert_value_states(state, [("7", "unset", None), ("5000", "set", "0")])

    def test_local_plain_and_localized_are_complete_definitions_not_translation_overlay(self):
        self.xml(self.project, "AttributeDefinitionCollectionLocal.xml",
                 self.definition("5000", "Plain"))
        self.xml(self.project, "AttributeDefinitionCollectionLocal_en.xml",
                 self.definition("5000", "Localized") + self.definition("6000", "Extra"))
        state = self.app(self.project).get_initial_data()
        self.assertEqual([e["label"] for e in state["data"]["attributes"]], ["Real definition", "Plain"])
        self.assertEqual(state["definitions"]["customFiles"], [
            str(self.project / "Xml" / "AttributeDefinitionCollectionLocal.xml"),
        ])

    def test_language_uses_installation_language_not_country_and_only_known_families(self):
        from dataclasses import replace
        self.xml(self.etc, "AttributeDefinitionCollectionAllplan_fr.xml",
                 self.definition("7", "Francais"))
        self.xml(self.etc, "AttributeDefinitionCollectionAllplan2_fr.xml",
                 self.definition("8", "Second"))
        self.xml(self.etc, "AttributeDefinitionCollection_PrjPassiveHouse_fr.xml",
                 self.definition("9", "Passive"))
        self.xml(self.etc, "AttributeDefinition_test.xml", self.definition("10", "Ignored"))
        self.xml(self.etc, "LocalLayoutAttributeDefinition_fr.xml",
                 self.definition("11", "Ignored"))
        self.discover.return_value = ([replace(self.context, country="DEU",
                                              allplan_language="fra")], [])
        state = self.app(self.project).get_initial_data()
        self.assertEqual(state["definitions"]["language"], "fr")
        self.assertEqual([e["number"] for e in state["data"]["attributes"]], ["7", "9", "8"])
        self.assertEqual(state["data"]["attributes"][0]["label"], "Francais")
        self.discover.return_value = ([replace(self.context, country="FRA")], [])
        self.assertEqual(self.app(self.project).get_initial_data()["definitions"]["language"], "en")

    def test_definition_conflicts_keep_existing_first_valid_rule_and_provenance(self):
        self.xml(self.etc, "AttributeDefinitionCollectionAllplan2_en.xml",
                 self.definition("7", "Second", uid="different") +
                 self.definition("8", "Extension"))
        self.xml(self.project, "AttributeDefinitionCollectionLocal.xml",
                 self.definition("7", "Custom", uid="different-again"))
        state = self.app(self.project).get_initial_data()
        self.assertEqual(state["data"]["attributes"][0]["label"], "Real definition")
        self.assertEqual(len([d for d in state["diagnostics"] if d["code"] == "uid_conflict"]), 2)
        self.assertEqual(state["data"]["attributes"][0]["definition"]["provenance"]["source"], "etc")

    def test_missing_and_corrupt_definitions_are_distinct_from_values(self):
        self.content("Version 3\r\n7|a|0\r\n")
        system = self.etc / "Xml" / "AttributeDefinitionCollectionAllplan_en.xml"
        for raw in (None, "<broken"):
            if raw is None:
                system.unlink(missing_ok=True)
            else:
                system.write_text(raw, encoding="utf-8")
            app = self.app(self.project)
            state = app.get_initial_data()
            self.assertEqual(state["definitions"]["status"], "unavailable")
            self.assert_value_states(state, [])
            self.assertEqual(app._document.values(), {"7": "0"})
            self.assertIn("definitions_unavailable", [d["code"] for d in state["diagnostics"]])

    def test_missing_custom_collection_is_reported_without_switch_to_std(self):
        (self.project / "Xml" / "AttributeDefinitionCollectionLocal.xml").unlink()
        self.xml(self.std, "AttributeDefinitionCollectionLocal.xml",
                 self.definition("8888", "Must not be read"))
        state = self.app(self.project).get_initial_data()
        self.assertEqual([e["number"] for e in state["data"]["attributes"]], ["7"])
        self.assertEqual(state["definitions"]["status"], "available_with_diagnostics")
        self.assertEqual(state["definitions"]["customFiles"], [])
        self.assertIn("custom_definition_missing", [d["code"] for d in state["diagnostics"]])

    def test_localized_custom_used_only_when_plain_missing_and_language_matches(self):
        (self.project / "Xml" / "AttributeDefinitionCollectionLocal.xml").unlink()
        self.xml(self.project, "AttributeDefinitionCollectionLocal_en.xml",
                 self.definition("5000", "English"))
        self.xml(self.project, "AttributeDefinitionCollectionLocal_fr.xml",
                 self.definition("6000", "French not selected"))
        state = self.app(self.project).get_initial_data()
        self.assertEqual([e["number"] for e in state["data"]["attributes"]], ["7", "5000"])

    def test_change_to_unrecognized_project_preserves_previous_document(self):
        outside = self.root / "ForeignPrj" / "Unknown.prj"
        outside.mkdir(parents=True)
        self.content("Version 3\r\n7|a|0\r\n")
        app = self.app(self.project)
        previous = app.get_initial_data()
        document = app._document
        self.chooser.return_value = str(outside)
        reply = app.call("project.select", {})
        self.assertFalse(reply["ok"])
        self.assertNotIn("data", reply)
        self.assertEqual(app.get_initial_data(), previous)
        self.assertIs(app._document, document)
        self.assertEqual(self.history(), str(self.project))

    @unittest.skipUnless(os.environ.get("ALLPLAN_AIM_RESOLUTION_FIXTURES"),
                         "Private XML/config copies not supplied")
    def test_inspected_real_sources_on_isolated_copies(self):
        from dataclasses import replace
        root = Path(os.environ["ALLPLAN_AIM_RESOLUTION_FIXTURES"])
        context = LaunchContext(
            allplan_version="2024", allplan_language="fra",
            paths={"PRJ": root / "Prj", "STD": root / "Std", "ETC": root / "Etc"},
        )
        before = {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()}
        app = AimProjectApp(
            self.data, replace(context, project_path=root / "Prj" / "Sample.prj"),
            settings_store=self.store, discover_installations=lambda: ([context], []),
        )
        state = app.get_initial_data()
        self.assertEqual(state["selection"], "accepted")
        self.assertEqual(state["definitions"]["attr"], "PRJ")
        self.assertEqual(state["definitions"]["language"], "fr")
        self.assertEqual(len(state["definitions"]["systemFiles"]), 3)
        self.assertEqual(len(state["data"]["attributes"]), 225)
        self.assertTrue(all(item["definition"]["group_mask"] & 65536
                            for item in state["data"]["attributes"]))
        self.assertEqual(len(app._document.records), 138)
        values = app._document.values()
        for item in state["data"]["attributes"]:
            self.assertEqual(item["valueState"], "set" if item["number"] in values else "unset")
            self.assertEqual(item["value"], values.get(item["number"]))
        self.assertEqual(set(state["data"]), {"attributes"})
        self.assertIn("5000", [item["number"] for item in state["data"]["attributes"]])
        self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob("*") if p.is_file()})

    def test_change_to_other_installation_replaces_sources_and_values(self):
        from dataclasses import replace
        second_prj = self.root / "Other" / "Prj"
        second = second_prj / "Other.prj"
        second.mkdir(parents=True)
        (second / "project.cfg").write_bytes(b"ATTR=STD\r\n")
        other_std = self.root / "Other" / "Std"
        other_etc = self.root / "Other" / "Etc"
        for directory in (other_std, other_etc):
            (directory / "Xml").mkdir(parents=True)
        self.xml(other_std, "AttributeDefinitionCollectionLocal.xml", "")
        self.xml(other_etc, "AttributeDefinitionCollectionAllplan_en.xml",
                 self.definition("77", "Other installation"))
        other = replace(self.context, allplan_version="2025",
                        paths={"PRJ": second_prj, "STD": other_std, "ETC": other_etc})
        self.discover.return_value = ([self.context, other], [])
        self.content("Version 3\r\n7|a|0\r\n")
        app = self.app(self.project)
        self.assertEqual(app.get_initial_data()["installation"]["version"], "2024")
        self.chooser.return_value = str(second)
        state = app.call("project.select", {})["data"]
        self.assertEqual(state["installation"]["version"], "2025")
        self.assert_value_states(state, [("77", "unset", None)])
        self.assertEqual(state["definitions"]["customFiles"],
                         [str(other_std / "Xml" / "AttributeDefinitionCollectionLocal.xml")])

    @unittest.skipUnless(os.environ.get("ALLPLAN_AIM_PRJATT_FIXTURE"),
                         "Private supplied fixture must be an isolated copy")
    def test_supplied_fixture_is_read_only_and_lossless(self):
        fixture = Path(os.environ["ALLPLAN_AIM_PRJATT_FIXTURE"])
        shutil.copyfile(fixture, self.path)
        raw = self.path.read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),
                         "859259422004fd19961c218e85909a1b5c5573710fb1c30c0085b7b4a63bed6c")
        document = read_project_attributes(self.project).data
        self.assertEqual(document.status, "read")
        self.assertEqual(document.header, "Version 3")
        self.assertEqual(len(document.records), 138)
        assert document.text is not None
        self.assertEqual(document.text.encode("cp1252"), raw)
        self.assertEqual(raw.count(b"\r\n"), 139)
        self.assertTrue(any("|" in record.value for record in document.records))
        self.assertTrue(any(ord(c) > 127 for c in document.text))
        self.assertEqual(sum(ord(c) > 127 for c in document.text), 100)
        self.assertEqual(sum("|" in record.value for record in document.records), 1)
        self.assertEqual(len(document.values()), len(document.records))
        self.assertEqual(self.path.read_bytes(), raw)


if __name__ == "__main__":
    unittest.main()
