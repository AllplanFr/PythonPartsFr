import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from application.plugins.information_manager.application import InformationManagerApp
from application.plugins.smartcatalog.application import SmartCatalogApp
from application.plugins.vob_editor.application import VobEditorApp
from application.core.configuration import SettingsStore


class LegacyIdentityAlignmentTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.aim = InformationManagerApp(self.root)

    def test_all_plugins_report_exact_non_conflicting_native_identity(self):
        store = SettingsStore(self.root / "settings.json")
        smart = SmartCatalogApp(self.root / "smart", settings_store=store)
        vob = VobEditorApp(self.root / "vob", roots={}, settings_store=store)
        self.addCleanup(smart._close)
        self.addCleanup(vob._close)
        for app in (self.aim, smart, vob):
            info = app.get_app_info()
            keys = set(info) & {"id", "app_id"}
            self.assertTrue(keys)
            self.assertEqual({info[key] for key in keys}, {app.app_id})

    def test_absent_file_is_not_a_fabricated_catalog(self):
        self.assertEqual(self.aim.get_initial_data(), {
            "app": "information_manager", "data": {},
        })
        self.assertFalse(hasattr(self.aim, "call"))

    def test_incompatible_present_content_is_explicitly_rejected(self):
        for data in ({}, [], {"catalog": None}, {"catalog": [], "values": []},
                     {"catalog": [], "attributes": {}}):
            with self.subTest(data=data):
                (self.root / "initial_data.json").write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaises(ValueError):
                    self.aim.get_initial_data()

    def test_invalid_json_is_not_treated_as_absent(self):
        (self.root / "initial_data.json").write_text("{", encoding="utf-8")
        with self.assertRaises(json.JSONDecodeError):
            self.aim.get_initial_data()

    def test_empty_catalog_and_attributes_are_preserved_without_conversion(self):
        for data in ({"catalog": []}, {
            "catalog": [{"name": "provided"}],
            "attributes": [{"num": "0007", "raw": "uninterpreted"}],
            "values": {"0007": "0000"}, "projectName": "provided",
        }):
            with self.subTest(data=data):
                (self.root / "initial_data.json").write_text(json.dumps(data), encoding="utf-8")
                self.assertEqual(self.aim.get_initial_data(), {
                    "app": "information_manager", "data": data,
                })
