import contextlib
import io
import os
import unittest
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from application.plugins.vob_editor.application import VobEditorApp
from application.core.configuration import SettingsStore
from application.core.allplan.paths import AllplanPaths
from application.plugins.vob_editor.allplan import VobEditorAllplanDatas
from application.plugins.vob_editor.close_coordinator import VobCloseCoordinator


class FakeWindow:
    def __init__(self, dialog_result=None):
        self.dialog_result = dialog_result
        self.events = []
        self.dialog_calls = []

    def create_file_dialog(self, *_args, **_kwargs):
        from webview.util import parse_file_type

        for file_type in _kwargs.get("file_types", ()):
            parse_file_type(file_type)
        self.dialog_calls.append((_args, _kwargs))
        return self.dialog_result

    def evaluate_js(self, javascript):
        self.events.append(javascript)


class VobEditorTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name) / "std"
        self.root.mkdir()
        self.data_dir = Path(self.temp_dir.name) / "app-data"
        self.data_dir.mkdir()
        self.settings_path = Path(self.temp_dir.name) / "shared" / "settings.json"
        self.settings = SettingsStore(self.settings_path)
        self.app = VobEditorApp(
            self.data_dir,
            roots={"std": self.root},
            settings_store=self.settings,
        )
        self.addCleanup(self._close_logger)
        self.env_patcher = patch.dict(
            os.environ,
            {"ALLPLAN_SMARTCATALOG_SETTINGS_DIR": str(self.settings_path.parent)},
        )
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def test_initial_data_lists_both_vob_file_families(self):
        expected = (
            "vo2_deu.deu", "vo2_swi.ita", "vob_aus.eng", "vob_can.eng",
            "vob_deu.deu", "vob_deu.fra", "vob_deu.ita", "vob_eng.eng",
            "vob_fra.fra", "vob_ita.eng", "vob_ita.ita", "vob_spa.spa",
            "vob_swi.ita",
        )
        for filename in expected:
            (self.root / filename).write_text("", encoding="utf-8")
        self.settings.save(
            "vob_editor",
            {"version": 1, "general": {"lang": "it", "dark": True}},
        )

        with contextlib.redirect_stdout(io.StringIO()):
            data = self.app.get_initial_data()

        self.assertEqual({item["name"] for item in data["files"]}, set(expected))
        self.assertIsNone(data["document"])
        self.assertEqual(data["settings"], {"lang": "it", "dark": True})
        self.assertTrue(all(Path(item["path"]).is_absolute() for item in data["files"]))

    def test_settings_commands_share_the_shared_store(self):
        data = {
            "version": 1,
            "general": {"lang": "fr", "dark": False},
            "vobEditor": {
                "order": ["comment", "trade", "object", "unit", "method", "formula"],
                "visible": ["trade", "formula"],
                "widths": {"formula": 220},
                "groupBy": "trade",
                "split": 58,
            },
            "toolbars": {
                "layouts": {
                    "vob-editor-actions-v3": {
                        "groups": [{"id": "edit", "buttons": ["copy", "paste"]}],
                    },
                },
            },
        }

        with contextlib.redirect_stdout(io.StringIO()):
            saved = self.app.call("settings.save", data)
            loaded = self.app.call(
                "settings.load", {"app_id": "vob_editor"}
            )

        self.assertEqual(saved, {"ok": True, "data": None})
        self.assertEqual(loaded, {"ok": True, "data": data})
        restarted = self._restart_app()
        self.assertEqual(
            restarted.call("settings.load", {"app_id": "vob_editor"})["data"]["toolbars"],
            data["toolbars"],
        )

    def test_settings_save_preserves_order_and_sections_omitted_from_payload(self):
        existing = {
            "version": 1,
            "general": {"lang": "fr", "dark": False},
            "toolbars": {"main": ["save"]},
            "vobEditor": {"split": 58},
        }
        self.settings.save("vob_editor", existing)
        order = ["comment", "trade", "trade", "unknown", "formula"]

        result = self._call("settings.save", {
            "version": 1,
            "vobEditor": {"order": order},
        })

        self.assertEqual(result, {"ok": True, "data": None})
        loaded = self._call("settings.load", {"app_id": "vob_editor"})
        self.assertEqual(loaded["data"]["vobEditor"]["order"], order)
        self.assertEqual(loaded["data"]["general"], existing["general"])
        self.assertEqual(loaded["data"]["toolbars"], existing["toolbars"])

    def test_settings_save_rejects_non_string_column_order_entries(self):
        result = self._call("settings.save", {
            "version": 1,
            "vobEditor": {"order": ["trade", 2]},
        })

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid")

    def test_open_dialog_cancellation_returns_success_with_none(self):
        window = FakeWindow()
        self.app._attach_window(window)

        with contextlib.redirect_stdout(io.StringIO()):
            result = self.app.call("vob.open", {"path": None})

        self.assertEqual(result, {"ok": True, "data": None})
        from webview import FileDialog

        self.assertEqual(window.dialog_calls[0][0], (FileDialog.OPEN,))
        self.assertEqual(
            window.dialog_calls[0][1]["file_types"],
            ("Fichiers VOB (*.*)",),
        )

    def test_preview_reads_without_changing_the_current_document_or_layout_cache(self):
        _source, _document = self._open_sample()
        source = self.root / "vob_second.fra"
        source.write_bytes(self.SAMPLE)
        self.app._current_document["rules"][0]["formula"] = "MODIFICATION EN COURS"
        current = deepcopy(self.app._current_document)
        layouts = deepcopy(self.app._layouts)

        result = self._call("vob.preview", {"path": str(source)})

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["data"]["file"]["path"], str(source))
        self.assertEqual(result["data"]["rules"][1]["trade"], "-1")
        self.assertEqual(self.app._current_document, current)
        self.assertEqual(self.app._layouts, layouts)

        missing = self._call("vob.preview", {"path": str(self.root / "vob_missing.fra")})
        self.assertFalse(missing["ok"])
        self.assertEqual(missing["error"]["code"], "not_found")

        invalid = self.root / "vob_invalid.fra"
        invalid.write_bytes(b"not a VOB")
        rejected = self._call("vob.preview", {"path": str(invalid)})
        self.assertFalse(rejected["ok"])
        self.assertEqual(rejected["error"]["code"], "invalid")
        self.assertEqual(self.app._current_document, current)

    def test_preview_returns_all_rules_and_empty_files_without_truncation(self):
        source = self.root / "vob_many.fra"
        source.write_text(
            "".join(
                f"#012#0062#02#02#@201@ // Règle {index}\r\n"
                for index in range(17)
            ),
            encoding="utf-8",
        )
        empty = self.root / "vob_empty.fra"
        empty.write_bytes(b"")
        current = {"file": None, "rules": []}
        self.app._current_document = deepcopy(current)

        preview = self._call("vob.preview", {"path": str(source)})
        empty_preview = self._call("vob.preview", {"path": str(empty)})

        self.assertTrue(preview["ok"], preview)
        self.assertEqual(len(preview["data"]["rules"]), 17)
        self.assertEqual(
            set(preview["data"]["rules"][0]),
            {"trade", "object", "unit", "method", "formula", "comment", "enabled"},
        )
        self.assertEqual(preview["data"]["rules"][0], {
            "trade": "012",
            "object": "0062",
            "unit": "02",
            "method": "02",
            "formula": "@201@",
            "comment": "Règle 0",
            "enabled": True,
        })
        self.assertEqual(empty_preview, {
            "ok": True,
            "data": {
                "file": self.app._describe_file(empty.resolve()),
                "header": [],
                "rules": [],
            },
        })
        self.assertEqual(self.app._current_document, current)

        window = FakeWindow()
        self.app._attach_window(window)
        opened = self._call("vob.open", {"path": str(source)})
        self.assertTrue(opened["ok"], opened)
        self.assertEqual(len(opened["data"]["rules"]), 17)
        self.assertEqual(window.dialog_calls, [])

    def test_file_reveal_uses_the_selected_file_path(self):
        source = self.root / "vob_selected.fra"
        source.write_bytes(self.SAMPLE)
        with patch("application.plugins.vob_editor.application.os.name", "nt"), patch(
            "application.plugins.vob_editor.application.subprocess.Popen"
        ) as popen:
            result = self._call("vob.file.reveal", {"path": str(source)})

        self.assertEqual(result, {"ok": True, "data": None})
        popen.assert_called_once_with(["explorer.exe", f'/select,"{source}"'])

    def test_path_traversal_is_rejected(self):
        outside = Path(self.temp_dir.name) / "vob_fra.fra"
        outside.write_text("", encoding="utf-8")

        with contextlib.redirect_stdout(io.StringIO()):
            result = self.app.call("vob.open", {"path": str(self.root / ".." / outside.name)})

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid")

    def _restart_app(self, **kwargs):
        app = VobEditorApp(
            self.data_dir, roots={"std": self.root},
            settings_store=self.settings, **kwargs,
        )
        self.addCleanup(app._close)
        return app

    def test_external_file_and_open_directory_survive_restart(self):
        source = Path(self.temp_dir.name) / "outside" / "vob_external.fra"
        source.parent.mkdir()
        source.write_bytes(self.SAMPLE)
        self.app._attach_window(FakeWindow(dialog_result=(str(source),)))
        self.assertTrue(self._call("vob.open", {"path": None})["ok"])
        restarted = self._restart_app()
        with contextlib.redirect_stdout(io.StringIO()):
            data = restarted.get_initial_data()
        self.assertEqual(data["document"]["file"]["path"], str(source))
        self.assertIn(str(source), [f["path"] for f in data["files"]])
        window = FakeWindow()
        restarted._attach_window(window)
        restarted._open_dialog()
        self.assertEqual(window.dialog_calls[0][1]["directory"], str(source.parent))

    def test_initial_data_restores_header_and_disabled_rules(self):
        source = self.root / "vob_fra.fra"
        source.write_bytes(
            b"//COMPANY=NEMETSCHEK\r\n"
            b"//PRODUCT=ALLPLAN\r\n"
            b"//#012#1#1#02#@201@\r\n"
        )
        opened = self._call("vob.open", {"path": str(source)})
        self.assertTrue(opened["ok"], opened)

        restarted = self._restart_app()
        with contextlib.redirect_stdout(io.StringIO()):
            data = restarted.get_initial_data()

        self.assertEqual(data["document"]["header"], [
            "COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN",
        ])
        self.assertFalse(data["document"]["rules"][0]["enabled"])

    def test_save_as_restores_target_and_remembers_save_directory(self):
        source, document = self._open_sample()
        target = Path(self.temp_dir.name) / "exports" / "vob_copy.fra"
        target.parent.mkdir()
        self.app._attach_window(FakeWindow(dialog_result=(str(target),)))
        self.assertTrue(self._call("vob.save_as", document)["ok"])
        self.assertTrue(self._call("settings.save", {
            "version": 1, "vobEditor": {"split": 60},
        })["ok"])
        restarted = self._restart_app()
        with contextlib.redirect_stdout(io.StringIO()):
            data = restarted.get_initial_data()
        self.assertEqual(data["document"]["file"]["path"], str(target))
        window = FakeWindow()
        restarted._attach_window(window)
        restarted._save_dialog(source.name, source.parent)
        self.assertEqual(window.dialog_calls[0][1]["directory"], str(target.parent))
        self.assertEqual(self.settings.load("vob_editor")["vobEditor"], {"split": 60})

    def test_missing_last_file_does_not_block_startup_or_repeat_error(self):
        source, _document = self._open_sample()
        source.unlink()
        restarted = self._restart_app()
        window = FakeWindow()
        restarted._attach_window(window)
        with contextlib.redirect_stdout(io.StringIO()):
            data = restarted.get_initial_data()
            restarted.get_initial_data()
        self.assertIsNone(data["document"])
        self.assertEqual(len(window.events), 1)
        self.assertIn("Impossible de rouvrir", window.events[0])

    def test_cancelled_dialog_does_not_replace_last_file(self):
        source, _document = self._open_sample()
        self.app._attach_window(FakeWindow())
        self.assertEqual(self._call("vob.open", {"path": None}), {"ok": True, "data": None})
        self.assertEqual(
            self.settings.load("vob_editor")["vobEditorSession"]["lastFile"], str(source),
        )

    def test_files_list_is_scoped_to_real_version_and_source(self):
        source = self.root / "vob_fra.fra"
        source.write_bytes(self.SAMPLE)
        result = self._call("vob.files.list", {
            "version": "",
            "source": str(self.root),
        })
        self.assertTrue(result["ok"], result)
        self.assertEqual([item["path"] for item in result["data"]["files"]], [str(source)])
        self.assertEqual(result["data"]["context"]["versions"], [])

        rejected = self._call("vob.files.list", {
            "version": "2027",
            "source": str(self.root),
        })
        self.assertFalse(rejected["ok"])
        self.assertEqual(rejected["error"]["code"], "invalid")

    def test_add_existing_files_validates_batch_and_persists_personal_resources(self):
        external = Path(self.temp_dir.name) / "external"
        external.mkdir()
        accepted = external / "vob_custom.fra"
        accepted_second = external / "vob_custom_second.fra"
        invalid = external / "vob_invalid.fra"
        accepted.write_bytes(self.SAMPLE)
        accepted_second.write_bytes(self.SAMPLE)
        invalid.write_bytes(b"not a VOB")
        before = accepted.read_bytes()
        window = FakeWindow()
        self.app._attach_window(window)

        failed = self._call("vob.files.add", {
            "paths": [str(accepted), str(invalid), str(accepted_second)],
            "multiple": False,
        })
        self.assertTrue(failed["ok"], failed)
        self.assertEqual(
            {item["path"] for item in failed["data"]["files"]},
            {str(accepted), str(accepted_second)},
        )
        self.assertTrue(any("ignorés" in event for event in window.events))
        self.assertIn(str(accepted), [item["path"] for item in self.app._list_files()])

        added = self._call("vob.files.add", {"paths": [str(accepted)]})
        self.assertTrue(added["ok"], added)
        self.assertEqual(added["data"]["files"][0]["name"], accepted.name)
        self.assertEqual(accepted.read_bytes(), before)
        self.assertEqual(
            {item["path"] for item in self.settings.load("vob_editor")["vobResources"]["addedFiles"]},
            {str(accepted), str(accepted_second)},
        )

        restarted = self._restart_app()
        data = restarted.get_initial_data()
        self.assertIn(str(accepted), [item["path"] for item in data["files"]])
        opened = restarted.call("vob.open", {"path": str(accepted)})
        self.assertTrue(opened["ok"], opened)
        self.assertEqual(opened["data"]["rules"], self._open_sample()[1]["rules"])

    def test_files_add_dialog_uses_the_multiple_flag(self):
        source = self.root / "vob_fra.fra"
        source.write_bytes(self.SAMPLE)
        window = FakeWindow(dialog_result=(str(source),))
        self.app._attach_window(window)

        result = self._call("vob.files.add", {"paths": None, "multiple": True})

        self.assertTrue(result["ok"], result)
        self.assertTrue(window.dialog_calls[0][1]["allow_multiple"])

    def test_files_add_dialog_cancellation_returns_null_data(self):
        self.app._attach_window(FakeWindow())

        result = self._call(
            "vob.files.add", {"paths": None, "multiple": True}
        )

        self.assertEqual(result, {"ok": True, "data": None})

    def test_resource_favorites_round_trip_and_removed_file_stays_on_disk(self):
        external = Path(self.temp_dir.name) / "external"
        external.mkdir()
        added = external / "vob_custom.fra"
        added.write_bytes(self.SAMPLE)
        favorites = ["c:/programdata/allplan/2027/std/vob_fra.fra"]
        self.settings.save("vob_editor", {
            "version": 1,
            "vobResources": {"addedFiles": [], "favorites": favorites},
        })

        added_result = self._call("vob.files.add", {"paths": [str(added)]})
        loaded = self._call("settings.load", {"app_id": "vob_editor"})

        self.assertTrue(added_result["ok"], added_result)
        self.assertEqual(loaded["data"]["vobResources"]["favorites"], favorites)
        self.assertEqual(
            loaded["data"]["vobResources"]["addedFiles"][0]["path"], str(added)
        )
        self.assertTrue(self._call("vob.open", {"path": str(added)})["ok"])
        removed = self._call("settings.save", {
            "version": 1,
            "vobResources": {"addedFiles": [], "favorites": favorites},
        })
        self.assertTrue(removed["ok"], removed)
        self.assertTrue(added.is_file())
        self.assertNotIn(str(added), [item["path"] for item in self.app._list_files()])
        restarted = self._restart_app()
        self.assertNotIn(
            str(added),
            [item["path"] for item in restarted.get_initial_data()["files"]],
        )

    def test_personal_settings_do_not_authorize_invalid_file_content(self):
        external = Path(self.temp_dir.name) / "external"
        external.mkdir()
        invalid = external / "vob_invalid.fra"
        invalid.write_bytes(b"not a VOB")
        self.settings.save("vob_editor", {
            "version": 1,
            "vobResources": {"addedFiles": [{
                "id": "custom:untrusted",
                "name": invalid.name,
                "path": str(invalid),
                "source": str(external),
            }]},
        })

        restarted = self._restart_app()
        restarted.get_initial_data()
        result = restarted.call("vob.open", {"path": str(invalid)})

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid")
        self.assertIn(str(invalid), [item["path"] for item in restarted._list_files()])

    def test_backup_inventory_manual_snapshot_and_restore_are_file_scoped(self):
        source, document = self._open_sample()
        original_rules = deepcopy(document["rules"])
        other = self.root / "vob_deu.fra"
        other.write_bytes(self.SAMPLE)
        document["rules"][0]["formula"] = "MANUAL"
        manual = self._call("vob.backups.create", {
            "file": document["file"],
            "rules": document["rules"],
        })
        self.assertTrue(manual["ok"], manual)
        self.assertEqual(source.read_bytes(), self.SAMPLE)

        changed = deepcopy(document)
        changed["rules"][0]["formula"] = "CURRENT"
        self.assertTrue(self._call("vob.save", changed)["ok"])
        inventory = self._call("vob.backups.list", {"file": document["file"]})
        self.assertTrue(inventory["ok"], inventory)
        self.assertEqual(inventory["data"]["filePath"], str(source))
        self.assertEqual(len(inventory["data"]["files"]), 2)
        self.assertTrue(all(
            item["name"].startswith(source.name + ".")
            and item["createdAt"].endswith("Z")
            for item in inventory["data"]["files"]
        ))

        restored = self._call("vob.backups.restore", {
            "file": document["file"],
            "backup": manual["data"],
        })
        self.assertTrue(restored["ok"], restored)
        self.assertEqual(restored["data"]["rules"][0]["formula"], "MANUAL")
        self.assertEqual(self._call("vob.open", {"path": str(other)})["data"]["rules"], original_rules)

    def test_backup_restore_rejects_another_file_or_corrupt_backup(self):
        source, document = self._open_sample()
        other = self.root / "vob_deu.fra"
        other.write_bytes(self.SAMPLE)
        created = self._call("vob.backups.create", {
            "file": document["file"],
            "rules": document["rules"],
        })["data"]
        wrong_file = self._call("vob.backups.restore", {
            "file": {
                "id": "std/vob_deu.fra", "name": other.name, "path": str(other),
            },
            "backup": created,
        })
        self.assertFalse(wrong_file["ok"])
        self.assertEqual(other.read_bytes(), self.SAMPLE)

        Path(created["path"]).write_bytes(b"corrupt")
        corrupt = self._call("vob.backups.restore", {
            "file": document["file"],
            "backup": created,
        })
        self.assertFalse(corrupt["ok"])
        self.assertEqual(source.read_bytes(), self.SAMPLE)

    def test_vob_open_reads_rules_like_qt_loader(self):
        source = self.root / "vob_fra.fra"
        source.write_bytes(
            "\r\n".join([
                "; entete ignoree",
                "",
                "#1#100#2#4#LAENGE ; métré // note",
                "#-1#-1#-1#-1#A*B // commentaire",
                "#1#2#3#4",
                "#1#2#3#4#X#Y",
                "  # 12 # 0034 # 1 # 2 # <-B->  ",
            ]).encode("cp1252")
        )

        with contextlib.redirect_stdout(io.StringIO()):
            result = self.app.call("vob.open", {"path": str(source)})

        self.assertTrue(result["ok"], result)
        document = result["data"]
        self.assertEqual(document["file"]["id"], "std/vob_fra.fra")
        self.assertEqual(document["header"], [])
        self.assertEqual(document["rules"], [
            {"trade": "1", "object": "100", "unit": "2", "method": "4",
             "formula": "LAENGE", "comment": "métré  note", "enabled": True},
            {"trade": "-1", "object": "-1", "unit": "-1", "method": "-1",
             "formula": "A*B", "comment": "commentaire", "enabled": True},
            {"trade": "12", "object": "0034", "unit": "1", "method": "2",
             "formula": "<-B->", "comment": "", "enabled": True},
        ])

    def test_disabled_rules_and_initial_header_round_trip_with_middle_comments(self):
        source = self.root / "vob_disabled.fra"
        original = (
            "//COMPANY=NEMETSCHEK\r\n"
            "// PRODUCT=ALLPLAN\r\n"
            "\r\n"
            "  // #012#1#1#02#@201@ // désactivée\r\n"
            "#2#3#4#5#ACTIVE\r\n"
            "// commentaire conservé au milieu\r\n"
        ).encode("utf-8")
        source.write_bytes(original)

        opened = self._call("vob.open", {"path": str(source)})

        self.assertTrue(opened["ok"], opened)
        self.assertEqual(opened["data"]["header"], [
            "COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN",
        ])
        self.assertEqual(opened["data"]["rules"][0], {
            "trade": "012", "object": "1", "unit": "1", "method": "02",
            "formula": "@201@", "comment": "désactivée", "enabled": False,
        })
        self.assertTrue(opened["data"]["rules"][1]["enabled"])
        saved = self._call("vob.save", opened["data"])
        self.assertTrue(saved["ok"], saved)
        self.assertEqual(source.read_bytes(), original)

    def test_header_changes_and_disabled_rule_write_prefix_once(self):
        source = self.root / "vob_header.fra"
        source.write_bytes(
            b"//OLD HEADER\r\n"
            b"#1#2#3#4#FORMULA\r\n"
            b"// commentaire milieu\r\n"
        )
        opened = self._call("vob.open", {"path": str(source)})
        self.assertTrue(opened["ok"], opened)
        document = opened["data"]
        document["header"] = ["// COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN"]
        document["rules"][0]["enabled"] = False

        saved = self._call("vob.save", document)

        self.assertTrue(saved["ok"], saved)
        self.assertEqual(
            source.read_bytes(),
            b"//COMPANY=NEMETSCHEK\r\n"
            b"//PRODUCT=ALLPLAN\r\n"
            b"//#1#2#3#4#FORMULA\r\n"
            b"// commentaire milieu\r\n",
        )
        reread = self._call("vob.open", {"path": str(source)})
        self.assertEqual(reread["data"]["header"], [
            "COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN",
        ])
        self.assertFalse(reread["data"]["rules"][0]["enabled"])

    def test_header_only_vob_can_be_opened_previewed_and_saved(self):
        source = self.root / "vob_header_only.fra"
        original = b"//COMPANY=NEMETSCHEK\r\n//PRODUCT=ALLPLAN\r\n"
        source.write_bytes(original)

        opened = self._call("vob.open", {"path": str(source)})
        preview = self._call("vob.preview", {"path": str(source)})

        self.assertTrue(opened["ok"], opened)
        self.assertTrue(preview["ok"], preview)
        self.assertEqual(opened["data"]["header"], [
            "COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN",
        ])
        self.assertEqual(opened["data"]["rules"], [])
        self.assertEqual(preview["data"]["header"], opened["data"]["header"])
        saved = self._call("vob.save", opened["data"])
        self.assertTrue(saved["ok"], saved)
        self.assertEqual(source.read_bytes(), original)

    def test_default_header_is_english_and_uses_file_country(self):
        default = self._call("vob.header.default", {"file": None})
        self.assertTrue(default["ok"], default)
        header = default["data"]["header"]
        self.assertEqual(header[0:5], [
            "COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN",
            "MODULE=Lists, quantity takeoff",
            "TITLE=VOB-compliant quantity takeoff", "COUNTRY=FRA",
        ])
        self.assertEqual(header[5:], [
            "LANGUAGE=independent",
            "description:",
            "1st entry  -> trade identifier",
            "2nd entry  -> component (-1 == default)",
            "3rd entry  -> billing type (0 = m3 / 1 = m2 / 2 = m / -1 = default)",
            "4th entry  -> calculation method (-1=default, 1=Volume, 2=Base, 3=Floor, 4=Ceiling, 5=Sides, 6=Median surface)",
            "5th entry  -> billing criterion",
            "================================================================",
        ])
        by_file = self._call("vob.header.default", {
            "file": {"id": "x", "name": "vob_deu.fra", "path": str(self.root / "vob_deu.fra")},
        })
        self.assertEqual(by_file["data"]["header"][4], "COUNTRY=DEU")

    def test_save_rejects_invalid_enabled_and_header_fields(self):
        _source, document = self._open_sample()
        document["rules"][0]["enabled"] = "false"
        invalid_rule = self._call("vob.save", document)
        self.assertFalse(invalid_rule["ok"])
        self.assertEqual(invalid_rule["error"]["code"], "invalid")

        document["rules"][0]["enabled"] = True
        document["header"] = "COMPANY=NEMETSCHEK"
        invalid_header = self._call("vob.save", document)
        self.assertFalse(invalid_header["ok"])
        self.assertEqual(invalid_header["error"]["code"], "invalid")

    SAMPLE = (
        "; entete\r\n"
        "#1#100#2#4#LAENGE // métré\r\n"
        "#-1#-1#-1#-1#<-A->\r\n"
        "; pied\r\n"
    ).encode("cp1252")

    def _open_sample(self):
        source = self.root / "vob_fra.fra"
        source.write_bytes(self.SAMPLE)
        with contextlib.redirect_stdout(io.StringIO()):
            result = self.app.call("vob.open", {"path": str(source)})
        self.assertTrue(result["ok"], result)
        return source, result["data"]

    def _call(self, command, payload):
        with contextlib.redirect_stdout(io.StringIO()):
            return self.app.call(command, payload)

    def test_unchanged_save_is_byte_identical_and_creates_backup(self):
        source, document = self._open_sample()

        result = self._call("vob.save", document)

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["data"]["file"], document["file"])
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        self.assertEqual((self.root / "vob_fra.fra.bak").read_bytes(), self.SAMPLE)
        self.assertNotIn("vob_fra.fra.bak", [f["name"] for f in self.app._list_files()])

    def test_v15_interface_ids_do_not_change_native_file(self):
        source, document = self._open_sample()
        for index, rule in enumerate(document["rules"]):
            rule["id"] = f"interface-rule-{index}"
        self.assertTrue(self._call("vob.save", document)["ok"])
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        for invalid in (None, 123, True):
            document["rules"][0]["id"] = invalid
            failed = self._call("vob.save", document)
            self.assertFalse(failed["ok"])
            self.assertEqual(failed["error"]["code"], "invalid")
            self.assertEqual(source.read_bytes(), self.SAMPLE)

    def test_v15_copy_between_files_and_duplicate_disabled_rule(self):
        source, original = self._open_sample()
        target = self.root / "vob_copy.fra"
        target.write_bytes("//TARGET HEADER métré\r\n#9#8#7#6#B\r\n; footer\r\n".encode("cp1252"))
        document = self._call("vob.open", {"path": str(target)})["data"]
        copied = {**original["rules"][0], "id": "copied-rule", "enabled": False}
        duplicate = {**copied, "id": "duplicated-rule"}
        document["rules"][0].pop("enabled")
        document["rules"][1:1] = [copied, duplicate]
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        self.assertFalse((self.root / "backup").exists())
        self.assertTrue(self._call("vob.save", document)["ok"])
        reopened = self._call("vob.open", {"path": str(target)})["data"]
        expected = [
            {**{key: value for key, value in rule.items() if key != "id"},
             "enabled": rule.get("enabled", True)}
            for rule in document["rules"]
        ]
        self.assertEqual(reopened["rules"], expected)
        self.assertEqual(reopened["header"], ["TARGET HEADER métré"])
        raw = target.read_bytes()
        self.assertEqual(raw.count("//#1#100#2#4#LAENGE // métré\r\n".encode("cp1252")), 2)
        self.assertTrue(raw.endswith(b"; footer\r\n"))
        self.assertNotIn(b"copied-rule", raw)
        self.assertNotIn(b"duplicated-rule", raw)
        self.assertEqual(source.read_bytes(), self.SAMPLE)

    def test_v15_save_uses_final_rule_list_after_local_undo_redo(self):
        source, document = self._open_sample()
        before = deepcopy(document["rules"])
        document["rules"].pop(0)
        document["rules"] = deepcopy(before)
        document["rules"].pop(0)
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        self.assertFalse((self.root / "backup").exists())
        self.assertTrue(self._call("vob.save", document)["ok"])
        reopened = self._call("vob.open", {"path": str(source)})["data"]
        self.assertEqual(reopened["rules"], before[1:])
        self.assertNotIn(b"LAENGE", source.read_bytes())

    def test_save_keeps_layout_and_appends_new_rules_after_last_rule(self):
        source, document = self._open_sample()
        document["rules"][0]["formula"] = "BREITE"
        document["rules"].append({
            "trade": "2", "object": "3", "unit": "4", "method": "5",
            "formula": "X", "comment": "nouveau", "enabled": True,
        })

        result = self._call("vob.save", document)

        self.assertTrue(result["ok"], result)
        self.assertEqual(source.read_bytes(), (
            "; entete\r\n"
            "#1#100#2#4#BREITE // métré\r\n"
            "#-1#-1#-1#-1#<-A->\r\n"
            "#2#3#4#5#X // nouveau\r\n"
            "; pied\r\n"
        ).encode("cp1252"))
        reopened = self._call("vob.open", {"path": str(source)})
        self.assertEqual(reopened["data"]["rules"], document["rules"])

    def test_save_rejects_rules_that_cannot_round_trip(self):
        source, document = self._open_sample()
        document["rules"][0]["formula"] = "A#B"

        result = self._call("vob.save", document)

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid")
        self.assertEqual(source.read_bytes(), self.SAMPLE)

    def test_save_on_read_only_file_returns_io_error(self):
        source, document = self._open_sample()
        os.chmod(source, 0o444)
        self.addCleanup(os.chmod, source, 0o666)

        result = self._call("vob.save", document)

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "write_error")
        self.assertIn("refuse", result["error"]["message"].lower())

    def test_save_as_writes_new_file_and_pushes_file_list(self):
        source, document = self._open_sample()
        target = self.root / "vob_fra_copy.fra"
        window = FakeWindow(dialog_result=(str(target),))
        self.app._attach_window(window)

        result = self._call("vob.save_as", document)

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["data"]["file"]["id"], "std/vob_fra_copy.fra")
        self.assertEqual(target.read_bytes(), self.SAMPLE)
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        self.assertTrue(any("vob.files" in event for event in window.events))
        self.assertTrue(any("vob.recent_files" in event for event in window.events))
        expected = [str(target.resolve()), str(source.resolve())]
        self.assertEqual(self.app._recent_files(), expected)
        self.assertEqual(self._restart_app().get_initial_data()["recentFiles"], expected)

    def _protected_save_session(self):
        source, document = self._open_sample()
        self.app._allplan_datas = VobEditorAllplanDatas(AllplanPaths(
            "2026", "FRA", paths={"ETC": self.root, "STD": self.data_dir},
        ))
        self.app._language = "fr"
        self.app._language_initialized = True
        scheduled = []
        coordinator = VobCloseCoordinator(
            identified=lambda: True, emit=Mock(), defer=lambda callback: None,
            schedule_close=scheduled.append, destroy=Mock(), logger=Mock(),
        )
        self.app._handlers.update({
            "vob.close.request": coordinator.request,
            "vob.close.cancel": coordinator.cancel,
            "vob.close.authorize": coordinator.authorize,
        })
        return source, document, coordinator, scheduled

    def test_etc_refusal_is_explicit_before_backup_or_write(self):
        source, document, _coordinator, _scheduled = self._protected_save_session()
        before = source.read_bytes()
        current = deepcopy(self.app._current_document)
        with patch.object(self.app, "_create_backup") as backup, patch(
            "application.plugins.vob_editor.application.write_vob",
        ) as writer:
            reply = self._call("vob.save", document)
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["error"]["code"], "write_confirmation_required")
        self.assertIn("ETC", reply["error"]["message"])
        self.assertEqual(reply["error"]["confirmation"]["path"], str(source))
        backup.assert_not_called()
        writer.assert_not_called()
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(self.app._current_document, current)

    def _confirm_etc(self, reply, *, accept=True):
        return self._call("vob.write.confirm", {
            "confirmationId": reply["error"]["confirmation"]["confirmationId"],
            "accept": accept,
        })

    def test_etc_confirmation_accept_refuse_and_single_use(self):
        source, document, _coordinator, _scheduled = self._protected_save_session()
        document["rules"][0]["comment"] = "Confirmed edit"
        request = self._call("vob.save", document)
        self.assertEqual(self._confirm_etc(request, accept=False), {"ok": True, "data": None})
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        self.assertFalse(self._confirm_etc(request)["ok"])
        request = self._call("vob.save", document)
        self.assertTrue(self._confirm_etc(request)["ok"])
        self.assertNotEqual(source.read_bytes(), self.SAMPLE)
        self.assertTrue((source.parent / "backup").is_dir())
        self.assertEqual(source.with_name(source.name + ".bak").read_bytes(), self.SAMPLE)
        self.assertFalse(self._confirm_etc(request)["ok"])
        self.assertEqual(self._call("vob.save", document)["error"]["code"],
                         "write_confirmation_required")

    def test_etc_confirmation_cannot_change_target_or_operation(self):
        source, document, _coordinator, _scheduled = self._protected_save_session()
        request = self._call("vob.save", document)
        payload = {
            "confirmationId": request["error"]["confirmation"]["confirmationId"],
            "accept": True, "path": str(self.root / "vob_other.fra"),
        }
        self.assertFalse(self._call("vob.write.confirm", payload)["ok"])
        # A new save invalidates the first operation's token, even on the same target.
        newer = self._call("vob.save", document)
        self.assertFalse(self._confirm_etc(request)["ok"])
        self.assertFalse(self._confirm_etc(newer)["ok"])
        self.assertEqual(source.read_bytes(), self.SAMPLE)

    def test_etc_backup_and_replace_errors_never_overwrite_source(self):
        source, document, _coordinator, _scheduled = self._protected_save_session()
        document["rules"][0]["comment"] = "Unsaved"
        request = self._call("vob.save", document)
        with patch.object(self.app, "_create_backup", side_effect=PermissionError("backup denied")), \
                patch("application.plugins.vob_editor.application.write_vob") as writer:
            result = self._confirm_etc(request)
        writer.assert_not_called()
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "write_error")
        self.assertIn("backup denied", result["error"]["message"])
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        request = self._call("vob.save", document)
        import application.plugins.vob_editor.format as vob_format
        replace = os.replace

        def fail_target_replacement(src, dst):
            if Path(dst) == source:
                raise PermissionError("target replacement denied")
            return replace(src, dst)

        with patch.object(vob_format.os, "replace", side_effect=fail_target_replacement):
            result = self._confirm_etc(request)
        self.assertFalse(result["ok"])
        self.assertIn("target replacement denied", result["error"]["message"])
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        self.assertFalse(self._confirm_etc(request)["ok"])

    def test_save_as_etc_requires_confirmation_and_preserves_history_on_refusal(self):
        source, document, _coordinator, scheduled = self._protected_save_session()
        target = self.root / "vob_etc_copy.fra"
        self.app._attach_window(FakeWindow(dialog_result=(str(target),)))
        request = self._call("vob.save_as", document)
        self.assertEqual(request["error"]["confirmation"]["operation"], "vob.save_as")
        self.assertFalse(target.exists())
        self.assertEqual(self._confirm_etc(request, accept=False)["data"], None)
        self.assertNotIn(str(target), self.app._recent_files())
        request = self._call("vob.save_as", document)
        close_id = self._call("vob.close.request", {})["data"]["requestId"]
        result = self._confirm_etc(request)
        self.assertTrue(result["ok"], result)
        self.assertEqual(target.read_bytes(), self.SAMPLE)
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        self.assertEqual(self.app._recent_files()[0], str(target))
        self.assertEqual(scheduled, [])
        self.assertEqual(self._call("vob.close.authorize", {
            "requestId": close_id,
        })["data"]["status"], "authorized")
        self.assertEqual(len(scheduled), 1)

    def test_etc_confirmation_rejects_changed_file(self):
        source, document, _coordinator, _scheduled = self._protected_save_session()
        request = self._call("vob.save", document)
        source.write_bytes(b"Changed by another process (temporary test file)")
        before = source.read_bytes()
        result = self._confirm_etc(request)
        self.assertFalse(result["ok"])
        self.assertEqual(source.read_bytes(), before)

    def test_etc_confirmation_saves_only_the_confirmed_snapshot(self):
        source, document, _coordinator, _scheduled = self._protected_save_session()
        document["rules"][0]["comment"] = "Confirmed snapshot"
        request = self._call("vob.save", document)
        document["rules"][0]["comment"] = "Newer unsaved edit"
        result = self._confirm_etc(request)
        self.assertTrue(result["ok"], result)
        saved = self.app._read_document(source)
        self.assertEqual(saved["rules"][0]["comment"], "Confirmed snapshot")
        self.assertEqual(document["rules"][0]["comment"], "Newer unsaved edit")

    def test_etc_adjacent_backup_failure_stops_before_replacement(self):
        source, document, _coordinator, _scheduled = self._protected_save_session()
        document["rules"][0]["comment"] = "Unsaved"
        request = self._call("vob.save", document)
        with patch("application.plugins.vob_editor.format.shutil.copy2",
                   side_effect=PermissionError("adjacent backup denied")), \
                patch("application.plugins.vob_editor.format.tempfile.mkstemp") as temporary:
            result = self._confirm_etc(request)
        self.assertFalse(result["ok"])
        temporary.assert_not_called()
        self.assertEqual(source.read_bytes(), self.SAMPLE)

    def test_failed_or_cancelled_save_then_cancel_blocks_late_authorization(self):
        source, document, coordinator, scheduled = self._protected_save_session()
        self.app._attach_window(FakeWindow())
        edited = deepcopy(document)
        edited["rules"][0]["comment"] = "Unsaved change"
        for operation, payload in (("vob.save", edited), ("vob.save_as", edited)):
            request_id = self._call("vob.close.request", {})["data"]["requestId"]
            result = self._call(operation, payload)
            self.assertTrue(not result["ok"] or result["data"] is None)
            # Simulate the frontend guard: never authorize on false/null.
            self.assertEqual(self._call("vob.close.cancel", {
                "requestId": request_id,
            })["data"]["status"], "cancelled")
            self.assertEqual(self._call("vob.close.authorize", {
                "requestId": request_id,
            })["data"]["status"], "ignored")
            self.assertFalse(coordinator.native_closing())
            self.assertEqual(scheduled, [])
        self.assertEqual(edited["rules"][0]["comment"], "Unsaved change")
        self.assertEqual(source.read_bytes(), self.SAMPLE)

    def test_save_as_checks_destination_and_only_current_close_can_be_authorized(self):
        source, document, _coordinator, scheduled = self._protected_save_session()
        old = self._call("vob.close.request", {})["data"]["requestId"]
        self._call("vob.close.cancel", {"requestId": old})
        current = self._call("vob.close.request", {})["data"]["requestId"]
        protected_target = self.root / "vob_protected_copy.fra"
        window = FakeWindow(dialog_result=(str(protected_target),))
        self.app._attach_window(window)
        with patch.object(self.app, "_create_backup") as backup:
            self.assertFalse(self._call("vob.save_as", document)["ok"])
        backup.assert_not_called()
        self.assertFalse(protected_target.exists())
        target = self.data_dir / "vob_copy.fra"
        window.dialog_result = (str(target),)
        with patch("application.plugins.vob_editor.application.write_vob",
                   side_effect=OSError("simulated write failure")):
            failed = self._call("vob.save_as", document)
        self.assertFalse(failed["ok"])
        self.assertEqual(self.app._current_document["file"]["path"], str(source))
        self.assertNotIn(str(target), self.app._recent_files())
        self.assertEqual(scheduled, [])
        saved = self._call("vob.save_as", document)
        self.assertTrue(saved["ok"], saved)
        self.assertEqual(target.read_bytes(), self.SAMPLE)
        self.assertEqual(source.read_bytes(), self.SAMPLE)
        self.assertEqual(self.app._recent_files()[0], str(target))
        self.assertTrue(any("vob.recent_files" in event for event in window.events))
        self.assertEqual(self._call("vob.close.authorize", {
            "requestId": old,
        })["data"]["status"], "ignored")
        self.assertEqual(scheduled, [])
        self.assertEqual(self._call("vob.close.authorize", {
            "requestId": current,
        })["data"]["status"], "authorized")
        self.assertEqual(len(scheduled), 1)

    def test_failed_or_cancelled_operations_leave_recent_history_unchanged(self):
        source, document = self._open_sample()
        before = self.settings_path.read_bytes()
        window = FakeWindow()
        self.app._attach_window(window)
        self.assertEqual(self._call("vob.open", {"path": None}), {"ok": True, "data": None})
        self.assertEqual(self._call("vob.save_as", document), {"ok": True, "data": None})
        with patch.object(self.app, "_read_document", side_effect=OSError("read failed")):
            self.assertFalse(self._call("vob.open", {"path": str(source)})["ok"])
        target = self.root / "vob_failed.fra"
        window.dialog_result = (str(target),)
        with patch.object(self.app, "_write_document", side_effect=OSError("write failed")):
            self.assertFalse(self._call("vob.save_as", document)["ok"])
        self.assertEqual(self.settings_path.read_bytes(), before)
        self.assertFalse(any("vob.recent_files" in event for event in window.events))

    def test_save_with_null_file_behaves_like_save_as(self):
        _source, document = self._open_sample()
        target = self.root / "vob_new.fra"
        self.app._attach_window(FakeWindow(dialog_result=(str(target),)))
        document["file"] = None

        result = self._call("vob.save", document)

        self.assertTrue(result["ok"], result)
        self.assertEqual(target.read_bytes(), self.SAMPLE)

    def test_save_as_cancellation_does_not_create_a_file(self):
        source = self.root / "vob_fra.fra"
        source.write_text("example", encoding="utf-8")
        self.app._attach_window(FakeWindow())
        document = {
            "file": {
                "id": "std/vob_fra.fra",
                "name": source.name,
                "path": str(source),
            },
            "rules": [],
        }

        with contextlib.redirect_stdout(io.StringIO()):
            result = self.app.call("vob.save_as", document)

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual(list(self.root.iterdir()), [source])

    def test_menu_export_and_import_use_native_dialogs_and_preserve_text(self):
        target = Path(self.temp_dir.name) / "menu-editor.menu"
        content = '{"kind":"smartcatalog-menu","toolbar":"editor"}\n'
        self.app._attach_window(FakeWindow(dialog_result=(str(target),)))

        exported = self._call(
            "menu.export", {"toolbar": "editor", "content": content}
        )

        self.assertEqual(exported, {"ok": True, "data": {"path": str(target)}})
        self.assertEqual(target.read_text(encoding="utf-8"), content)

        self.app._attach_window(FakeWindow(dialog_result=(str(target),)))
        imported = self._call("menu.import", {"toolbar": "editor"})
        self.assertEqual(imported, {"ok": True, "data": {"content": content}})

    def _close_logger(self):
        for handler in self.app._logger.handlers[:]:
            handler.close()
            self.app._logger.removeHandler(handler)


if __name__ == "__main__":
    unittest.main()
