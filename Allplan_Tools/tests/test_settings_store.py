import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from application.plugins.smartcatalog.application import SmartCatalogApp
from application.core.configuration import FutureSettingsVersionError, SettingsStore


class SettingsStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.path = Path(self.temp_dir.name) / "settings.json"
        self.store = SettingsStore(self.path)
        self.env_patcher = patch.dict(
            os.environ,
            {"ALLPLAN_SMARTCATALOG_SETTINGS_DIR": self.temp_dir.name},
        )
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def test_first_launch_returns_empty_document(self):
        self.assertEqual(self.store.load("smartcatalog"), {})

    def test_saves_merge_sections_and_preserve_unknown_sections(self):
        self.store.save(
            "smartcatalog",
            {"version": 1, "general": {"lang": "fr"}, "futureSection": {"x": 1}},
        )
        self.store.save(
            "vob_editor",
            {"version": 1, "toolbars": {"frozen": False}},
        )

        self.assertEqual(
            self.store.load("smartcatalog"),
            {
                "version": 1,
                "general": {"lang": "fr"},
                "futureSection": {"x": 1},
                "toolbars": {"frozen": False},
            },
        )
        self.assertEqual(
            json.loads(self.path.with_name("settings.bak").read_text()),
            {
                "version": 1,
                "general": {"lang": "fr"},
                "futureSection": {"x": 1},
            },
        )

    def test_corrupt_file_is_preserved_and_load_returns_empty_document(self):
        self.path.write_text("{not-json", encoding="utf-8")
        app = self._app()

        response = app.call("settings.load", {"app_id": "smartcatalog"})

        self.assertEqual(response, {"ok": True, "data": {}})
        preserved = list(self.path.parent.glob("settings.corrupt-*.json"))
        self.assertEqual(len(preserved), 1)
        self.assertEqual(preserved[0].read_text(encoding="utf-8"), "{not-json")
        self.assertFalse(self.path.exists())

    def test_future_version_is_never_overwritten(self):
        original = '{"version": 2, "general": {"lang": "it"}}'
        self.path.write_text(original, encoding="utf-8")

        with self.assertRaises(FutureSettingsVersionError):
            self.store.save("smartcatalog", {"version": 1, "general": {"lang": "fr"}})

        self.assertEqual(self.path.read_text(encoding="utf-8"), original)

    def test_legacy_document_is_migrated_to_version_one(self):
        self.path.write_text('{"general": {"lang": "fr"}}', encoding="utf-8")

        self.assertEqual(
            self.store.load("smartcatalog"),
            {"version": 1, "general": {"lang": "fr"}},
        )

    def test_settings_commands_validate_and_save(self):
        app = self._app()
        data = {
            "version": 1,
            "general": {"lang": "fr", "dark": False},
            "toolbars": {"frozen": False, "layouts": {}},
            "dialogs": {},
        }

        saved = app.call("settings.save", data)
        loaded = app.call("settings.load", {"app_id": "smartcatalog"})

        self.assertEqual(saved, {"ok": True, "data": None})
        self.assertEqual(loaded, {"ok": True, "data": data})
        self.assertEqual(
            app.call("settings.load", {"app_id": "invalid"})["error"]["code"],
            "invalid",
        )

    def _app(self):
        data_dir = Path(self.temp_dir.name) / "app-data"
        data_dir.mkdir(exist_ok=True)
        app = SmartCatalogApp(data_dir)
        self.addCleanup(self._close_logger, app._logger)
        return app

    @staticmethod
    def _close_logger(logger):
        for handler in logger.handlers[:]:
            handler.close()
            logger.removeHandler(handler)


if __name__ == "__main__":
    unittest.main()
