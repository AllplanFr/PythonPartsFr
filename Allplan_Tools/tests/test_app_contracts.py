import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from application.plugins.smartcatalog.application import SmartCatalogApp
from application.plugins.vob_editor.application import VobEditorApp
from application.core.bridge import UnsupportedVersionError, push
from application.core.configuration import SettingsStore


class AppContractTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        store = SettingsStore(self.root / "shared" / "settings.json")
        self.smart = SmartCatalogApp(self.root / "smartcatalog", settings_store=store)
        self.vob = VobEditorApp(self.root / "vob", roots={}, settings_store=store)
        self.addCleanup(self.smart._close)
        self.addCleanup(self.vob._close)

    def test_apps_import_without_importing_the_other_app(self):
        for module, other in (
            ("smartcatalog", "vob_editor"), ("vob_editor", "smartcatalog"),
        ):
            code = (
                f"import application.plugins.{module}.application; import sys; "
                f"assert 'application.plugins.{other}.application' not in sys.modules"
            )
            result = subprocess.run(
                [sys.executable, "-c", code],
                cwd=str(Path(__file__).resolve().parents[1]),
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_only_three_public_methods_are_exposed(self):
        for app in (self.smart, self.vob):
            methods = {
                name for name in dir(app)
                if not name.startswith("_") and callable(getattr(app, name))
            }
            self.assertEqual(methods, {"get_app_info", "get_initial_data", "call"})

    def test_initial_data_has_view_specific_shape_and_only_real_capabilities(self):
        smart = self.smart.get_initial_data()
        self.assertEqual(
            set(smart), {"context", "catalogs", "current", "settings", "capabilities",
                         "unavailable_capabilities"}
        )
        self.assertEqual(smart["capabilities"], ["settings.load", "settings.save"])
        self.assertIsNone(smart["current"])
        self.assertIsNone(smart["context"]["allplan_version"])
        self.assertEqual(
            set(self.vob.get_initial_data()),
            {"files", "document", "settings", "context", "backups", "recentFiles",
             "capabilities", "unavailable_capabilities"},
        )

    def test_each_app_rejects_the_other_apps_commands_and_settings_id(self):
        for app, command, other_id in (
            (self.smart, "vob.open", "vob_editor"),
            (self.vob, "catalog.open", "smartcatalog"),
        ):
            result = app.call(command, {"path": "not-opened"})
            self.assertEqual(result["error"]["code"], "unknown_command")
            result = app.call("settings.load", {"app_id": other_id})
            self.assertEqual(result["error"]["code"], "invalid")

    def test_allplan_2021_commands_are_rejected_by_both_apps(self):
        store = self.smart._settings_store
        old_smart = SmartCatalogApp(
            self.root / "old-smartcatalog", settings_store=store,
            context={"allplan_version": "2021", "project": None, "paths": {}},
        )
        old_vob = VobEditorApp(
            self.root / "old-vob", roots={}, settings_store=store,
            allplan_version="2021",
        )
        self.addCleanup(old_smart._close)
        self.addCleanup(old_vob._close)

        for app in (old_smart, old_vob):
            result = app.call("settings.load", {"app_id": app.app_id})
            self.assertEqual(result["error"]["code"], "unsupported-version")
        with self.assertRaises(UnsupportedVersionError):
            old_smart.get_initial_data()

    def test_shared_settings_preserve_app_specific_sections(self):
        self.smart.call("settings.save", {"version": 1, "attributeModels": []})
        self.vob.call("settings.save", {"version": 1, "vobEditor": {"split": 58}})
        loaded = self.smart.call("settings.load", {"app_id": "smartcatalog"})
        self.assertEqual(loaded["data"], {
            "version": 1, "attributeModels": [], "vobEditor": {"split": 58},
        })

    def test_smartcatalog_supports_optional_menu_dialog_commands(self):
        window = Mock()
        window.create_file_dialog.return_value = None
        self.smart._attach_window(window)

        exported = self.smart.call(
            "menu.export", {"toolbar": "editor", "content": "{}"}
        )
        imported = self.smart.call("menu.import", {"toolbar": "editor"})

        self.assertEqual(exported, {"ok": True, "data": None})
        self.assertEqual(imported, {"ok": True, "data": None})
        self.assertEqual(window.create_file_dialog.call_count, 2)

    def test_smartcatalog_commands_have_distinct_extension_points(self):
        cases = {
            "catalog.list": {},
            "catalog.open": {"path": "catalog"},
            "catalog.save": {"info": {}, "document": {}, "revision": "r1"},
            "catalog.save_as": {"info": {}, "document": {}},
            "catalog.create": {"name": "catalog", "source": "STD", "defAttr": 83},
            "catalog.add_existing": {},
            "catalog.remove_from_list": {"path": "catalog"},
            "catalog.duplicate": {"path": "catalog", "name": "copy"},
            "catalog.convert": {"path": "catalog"},
            "catalog.update_projects": {"path": "catalog"},
            "backup.list": {"path": "catalog"},
            "backup.restore": {"path": "catalog", "index": 0},
            "file.browse": {"kind": "library", "root": "std"},
            "library.open": {"path": "library", "kind": "ACCA"},
            "library.reload": {"id": "library"},
            "library.sync": {},
            "reference.load": {"lang": "fr"},
            "app.open": {"app_id": "vob_editor"},
        }
        for command, payload in cases.items():
            with self.subTest(command=command):
                self.assertIn(command, self.smart._handlers)
                result = self.smart.call(command, payload)
                self.assertFalse(result["ok"])
                expected_code = "not-implemented"
                self.assertEqual(result["error"]["code"], expected_code)
                self.assertIn(command, result["error"]["message"])
        self.assertEqual(len({
            self.smart._handlers[command].__name__ for command in cases
        }), len(cases))

    def test_open_app_uses_host_callback_without_importing_vob(self):
        callback = Mock()
        app = SmartCatalogApp(
            self.root / "hosted-smart",
            settings_store=self.smart._settings_store,
            open_app=callback,
        )
        self.addCleanup(app._close)
        self.assertIn("app.open", app.get_initial_data()["capabilities"])
        self.assertEqual(
            app.call("app.open", {"app_id": "vob_editor"}),
            {"ok": True, "data": None},
        )
        callback.assert_called_once_with("vob_editor")

    def test_state_is_per_instance_and_initial_data_is_a_copy(self):
        context = {
            "allplan_version": "test",
            "project": {"id": "p1", "name": "test"},
            "paths": {},
        }
        second = SmartCatalogApp(
            self.root / "second-smart", self.smart._settings_store, context
        )
        self.addCleanup(second._close)
        data = second.get_initial_data()
        data["context"]["project"]["name"] = "changed"
        self.assertEqual(second._context["project"]["name"], "test")
        self.assertEqual(context["project"]["name"], "test")
        second._catalogs.append({"name": "second"})
        self.assertEqual(self.smart._catalogs, [])
        self.assertIsNot(second._handlers, self.smart._handlers)
        self.assertIsNot(second._logger, self.smart._logger)

    def test_vob_reference_contract_is_validated_and_partial(self):
        self.assertEqual(
            self.vob.call("reference.load", {})["error"]["code"], "invalid"
        )
        reply = self.vob.call("reference.load", {"lang": "fr"})
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(reply["data"]["referenceContract"], "vob-references/2")
        for category in ("trades", "objects", "methods", "units"):
            self.assertEqual(reply["data"][category], [])
            self.assertEqual(reply["data"]["metadata"][category]["status"], "unavailable")
            self.assertTrue(reply["data"]["metadata"][category]["diagnostics"])
        self.assertIn("reference.load", self.vob.get_app_info()["capabilities"])
        self.assertNotIn("reference.load", self.vob.get_app_info()["unavailable_capabilities"])

    def test_reference_capabilities_and_errors_are_explicit_for_both_plugins(self):
        for app in (self.smart,):
            with self.subTest(app=app.app_id):
                initial = app.get_initial_data()
                info = app.get_app_info()
                self.assertNotIn("reference.load", info["capabilities"])
                self.assertEqual(info["unavailable_capabilities"],
                                 initial["unavailable_capabilities"])
                status = info["unavailable_capabilities"]["reference.load"]
                self.assertEqual(status["code"], "not-implemented")
                self.assertIn("pas encore implémenté", status["message"])
                self.assertIn("settings.save", info["capabilities"])
                warning = Mock()
                with patch.dict(app._logger.__dict__, {"warning": warning}):
                    for _ in range(3):
                        result = app.call("reference.load", {"lang": "fr"})
                        self.assertEqual(result, {"ok": False, "error": status})
                    warning.assert_called_once()

    def test_unimplemented_reference_does_not_mask_other_error_categories(self):
        for exception, code in (
            (FileNotFoundError("missing"), "not_found"),
            (ValueError("invalid configuration"), "invalid"),
            (OSError("read error"), "io"),
        ):
            with self.subTest(code=code), patch.dict(
                self.vob._handlers, {"reference.load": Mock(side_effect=exception)},
            ):
                result = self.vob.call("reference.load", {"lang": "fr"})
                self.assertFalse(result["ok"])
                self.assertEqual(result["error"]["code"], code)

    def test_vob_raw_identifiers_remain_editable_without_references(self):
        source = self.root / "vob_raw.fra"
        source.write_bytes(b"#987#654#321#876#@201@\r\n")
        window = Mock()
        window.create_file_dialog.return_value = (str(source),)
        self.vob._attach_window(window)
        opened = self.vob.call("vob.open", {"path": None})
        self.assertTrue(opened["ok"], opened)
        document = opened["data"]
        self.assertEqual(
            [document["rules"][0][name] for name in ("trade", "object", "unit", "method")],
            ["987", "654", "321", "876"],
        )
        self.vob.call("reference.load", {"lang": "fr"})
        document["rules"][0]["formula"] = "@202@"
        saved = self.vob.call("vob.save", document)
        self.assertTrue(saved["ok"], saved)
        self.assertIn(b"#987#654#321#876#@202@", source.read_bytes())

    def test_vob_retains_current_document_without_sharing_mutable_data(self):
        source = self.root / "vob_fra.fra"
        source.write_bytes(b"unverified fixture")
        self.vob._roots = {"test": self.root}
        document = {
            "file": {"id": "test/vob_fra.fra", "name": source.name, "path": str(source)},
            "rules": [],
        }
        with patch.object(self.vob, "_read_document", return_value=document):
            result = self.vob.call("vob.open", {"path": str(source)})
        result["data"]["rules"].append({"comment": "not host state"})
        current = self.vob._current_document
        assert current is not None
        self.assertEqual(current["rules"], [])
        self.assertEqual(
            self.vob.get_initial_data()["document"]["file"], document["file"]
        )

    def test_push_serializes_without_interpreting_payload(self):
        window = Mock()
        payload = {"formula": "'\\\n@267@", "name": "\u00e9\u2028"}
        push(window, "vob.document", payload)
        javascript = window.evaluate_js.call_args.args[0]
        self.assertIn("\\u2028", javascript)
        args = javascript.removeprefix("window.allplanHost.receive(")[:-1]
        self.assertEqual(json.loads(f"[{args}]"), ["vob.document", payload])
        with self.assertRaises(ValueError):
            self.vob._push_event("catalog.document", {})


if __name__ == "__main__":
    unittest.main()
