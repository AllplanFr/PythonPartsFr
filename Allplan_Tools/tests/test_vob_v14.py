import contextlib
import io
import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

from application.plugins.vob_editor.application import VobEditorApp
from application.plugins.vob_editor.messages import MESSAGES, tr
from application.core.configuration import SettingsStore
from application.plugins.vob_editor.format import read_vob_data, serialize_vob
from application.core.windows_ui import clipboard_request_allowed, configure_clipboard, create_file_dialog
from test_vob_editor import FakeWindow


class VobV14Tests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.store = SettingsStore(self.root / "settings.json")
        self.app = VobEditorApp(
            self.root / "data", roots={"std": self.root}, settings_store=self.store,
        )
        self.addCleanup(self.app._close)
        self.paths = [self.root / f"vob_{index}.fra" for index in range(3)]
        for index, path in enumerate(self.paths):
            path.write_bytes(f"//ORIGINAL={index}\r\n#1#2#3#4#A\r\n".encode())

    def call(self, command, payload):
        with contextlib.redirect_stdout(io.StringIO()):
            return self.app.call(command, payload)

    def preview(self, index):
        result = self.call("vob.preview", {"path": str(self.paths[index])})
        self.assertTrue(result["ok"], result)
        return result["data"]

    def test_saving_unopened_files_keeps_active_document_and_separate_backups(self):
        opened = self.call("vob.open", {"path": str(self.paths[0])})
        self.assertTrue(opened["ok"], opened)
        active = deepcopy(self.app._current_document)
        for index in (1, 2):
            document = self.preview(index)
            original = self.paths[index].read_bytes()
            document["header"] = [f"CHANGED={index}"]
            document["rules"][0]["formula"] = str(index)
            document["rules"][0]["enabled"] = False
            saved = self.call("vob.save", document)
            self.assertTrue(saved["ok"], saved)
            self.assertEqual(saved["data"]["file"]["path"], str(self.paths[index]))
            preview = self.preview(index)
            self.assertEqual(preview["header"], [f"CHANGED={index}"])
            self.assertEqual(preview["rules"][0]["formula"], str(index))
            self.assertFalse(preview["rules"][0]["enabled"])
            backups = list((self.root / "backup").glob(self.paths[index].name + ".*.bak"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), original)
        self.assertEqual(self.app._current_document, active)
        self.assertEqual(
            self.store.load("vob_editor")["vobEditorSession"]["lastFile"], str(self.paths[0]),
        )

    def test_preview_always_reads_disk_not_layout_cache(self):
        self.call("vob.open", {"path": str(self.paths[0])})
        self.paths[0].write_bytes(b"//EXTERNAL CHANGE\r\n//#1#2#3#4#B\r\n")
        result = self.preview(0)
        self.assertEqual(result["header"], ["EXTERNAL CHANGE"])
        self.assertEqual(result["rules"][0]["formula"], "B")
        self.assertFalse(result["rules"][0]["enabled"])

    def test_save_as_camel_case_alias_preserves_header_and_enabled(self):
        document = self.preview(0)
        document["header"] = ["TITLE=Saved copy"]
        document["rules"][0]["enabled"] = False
        target = self.root / "vob_copy.fra"
        self.app._attach_window(FakeWindow(dialog_result=(str(target),)))
        result = self.call("vob.saveAs", document)
        self.assertTrue(result["ok"], result)
        rules, layout = read_vob_data(target.read_bytes())
        self.assertEqual(layout.header, ["TITLE=Saved copy"])
        self.assertFalse(rules[0]["enabled"])
        self.assertTrue(self.paths[0].read_bytes().startswith(b"//ORIGINAL=0"))

    def test_parallel_requests_are_serialized_without_mixing_files(self):
        documents = [self.preview(index) for index in (1, 2)]
        for index, document in enumerate(documents):
            document["header"] = [f"PARALLEL={index}"]
            document["rules"][0]["formula"] = str(index)
        with contextlib.redirect_stdout(io.StringIO()), ThreadPoolExecutor(2) as executor:
            results = list(executor.map(lambda doc: self.app.call("vob.save", doc), documents))
        self.assertTrue(all(result["ok"] for result in results), results)
        for index, path in enumerate(self.paths[1:]):
            rules, layout = read_vob_data(path.read_bytes())
            self.assertEqual(layout.header, [f"PARALLEL={index}"])
            self.assertEqual(rules[0]["formula"], str(index))

    def test_header_height_is_sanitized_and_sections_are_merged(self):
        for height in (63, 2001, True, "168", 168.5, None):
            self.store._path.write_text(json.dumps({
                "version": 1, "vobEditor": {"order": ["trade"], "headerHeight": height},
            }), encoding="utf-8")
            loaded = self.call("settings.load", {"app_id": "vob_editor"})
            self.assertTrue(loaded["ok"], loaded)
            self.assertNotIn("headerHeight", loaded["data"]["vobEditor"])
        for height in (64, 168, 2000):
            saved = self.call("settings.save", {
                "version": 1, "vobEditor": {"headerHeight": height},
            })
            self.assertTrue(saved["ok"], saved)
            editor = self.call("settings.load", {"app_id": "vob_editor"})["data"]["vobEditor"]
            self.assertEqual(editor, {"order": ["trade"], "headerHeight": height})
        self.call("settings.save", {"version": 1, "vobEditor": {"headerHeight": -1}})
        self.assertEqual(self.store.load("vob_editor")["vobEditor"]["headerHeight"], 2000)

    def test_language_sources_at_startup_and_changes(self):
        sources = (
            {"general": {"lang": "en"}},
            {"vobEditor": {"lang": "en"}},
            {"app": {"lang": "en"}},
            {"vobEditor": {"app": {"lang": "en"}}},
            {"lang": "en"},
        )
        for source in sources:
            with self.subTest(source=source):
                self.store._path.write_text(json.dumps({"version": 1, **source}), encoding="utf-8")
                self.app._language_initialized = False
                missing = self.call("unknown.command", {})
                self.assertEqual(missing["error"]["message"], tr(
                    "unknown_command", "en", command="unknown.command",
                ))
                self.assertEqual(self.app.get_initial_data()["settings"]["lang"], "en")
        for language in ("fr", "en", "de", "it", "es", "xx"):
            saved = self.call("settings.save", {
                "version": 1, "vobEditor": {"lang": language},
            })
            self.assertTrue(saved["ok"], saved)
            self.assertEqual(self.app.get_initial_data()["settings"]["lang"], language)
            document = self.preview(0)
            with patch("application.plugins.vob_editor.application.write_vob", side_effect=PermissionError("ACCESS_DENIED")):
                failed = self.call("vob.save", document)
            self.assertEqual(failed["error"]["code"], "write_error")
            self.assertEqual(failed["error"]["message"], tr("write_error", language))

    def test_all_messages_have_french_and_english_with_matching_parameters(self):
        from string import Formatter
        for code, translations in MESSAGES.items():
            self.assertTrue({"fr", "en"} <= translations.keys(), code)
            fields = {
                field for _, field, _, _ in Formatter().parse(translations["en"]) if field
            }
            for language in ("fr", "en", "de", "it", "es"):
                self.assertIn(language, translations, code)
                self.assertEqual(
                    fields,
                    {field for _, field, _, _ in Formatter().parse(translations[language]) if field},
                    (code, language),
                )

    def test_unexpected_error_has_translated_message_and_technical_detail(self):
        self.call("settings.save", {"version": 1, "app": {"lang": "en"}})
        with patch.dict(self.app._handlers, {
            "vob.preview": Mock(side_effect=RuntimeError("technical detail")),
        }):
            failed = self.call("vob.preview", {"path": str(self.paths[0])})
        self.assertEqual(failed["error"]["code"], "internal-error")
        self.assertIn("An internal error", failed["error"]["message"])
        self.assertIn("RuntimeError: technical detail", failed["error"]["message"])

    def test_header_text_and_missing_final_newline_are_preserved(self):
        original = b"//HEADER\r\n#1#2#3#4#A"
        rules, layout = read_vob_data(original)
        self.assertEqual(serialize_vob(rules, layout, layout.header)[0], original)
        header = ["  indented text  ", "TITLE=Text"]
        encoded, _ = serialize_vob(rules, layout, header)
        self.assertTrue(encoded.startswith(b"//  indented text  \r\n//TITLE=Text\r\n"))
        self.assertEqual(header, ["  indented text  ", "TITLE=Text"])

    def test_clipboard_permission_is_restricted_to_trusted_https_origin(self):
        url = self.app.canonical_url
        self.assertTrue(clipboard_request_allowed(url, url, "ClipboardRead"))
        for uri, permission in (
            ("https://evil.example/", "ClipboardRead"),
            (url.replace("https:", "http:"), "ClipboardRead"),
            (url.replace(".app/", ".app:444/"), "ClipboardRead"),
            (url, "Camera"),
        ):
            self.assertFalse(clipboard_request_allowed(uri, url, permission))

    @unittest.skipUnless(os.name == "nt", "Windows native dialogs")
    def test_native_file_dialog_uses_translated_title_and_propagates_errors(self):
        from webview import FileDialog

        dialog = Mock()
        dialog.ShowDialog.return_value = "OK"
        dialog.FileNames = [str(self.paths[0])]
        forms = SimpleNamespace(
            OpenFileDialog=Mock(return_value=dialog),
            DialogResult=SimpleNamespace(OK="OK"),
        )
        modules = {"System": SimpleNamespace(Action=lambda callback: callback),
                   "System.Windows.Forms": forms}
        window = SimpleNamespace(
            native=SimpleNamespace(Invoke=lambda callback: callback()), localization={},
        )
        with patch("application.core.windows_ui.import_module", side_effect=modules.__getitem__):
            result = create_file_dialog(
                window, FileDialog.OPEN, title="Ouvrir un fichier",
                file_types=("Fichiers VOB (*.*)",), allow_multiple=True,
            )
            self.assertEqual(result, (str(self.paths[0]),))
            self.assertEqual(dialog.Title, "Ouvrir un fichier")
            self.assertTrue(dialog.Multiselect)
            dialog.Dispose.assert_called_once()
            dialog.ShowDialog.side_effect = RuntimeError("native dialog error")
            with self.assertRaisesRegex(RuntimeError, "native dialog error"):
                create_file_dialog(window, FileDialog.OPEN, title="Open file",
                                   file_types=("VOB files (*.*)",))

    @unittest.skipUnless(os.name == "nt", "Windows WebView2")
    def test_clipboard_hook_attaches_on_ui_thread_once(self):
        class Event:
            def __init__(self):
                self.handlers = []

            def __iadd__(self, handler):
                self.handlers.append(handler)
                return self

        class Control:
            def __init__(self):
                self.on_ui_thread = False
                self.core = SimpleNamespace(PermissionRequested=Event())

            @property
            def CoreWebView2(self):
                if not self.on_ui_thread:
                    raise RuntimeError("UI thread required")
                return self.core

        control = Control()

        def invoke(callback):
            control.on_ui_thread = True
            try:
                callback()
            finally:
                control.on_ui_thread = False

        window = SimpleNamespace(native=SimpleNamespace(webview=control, Invoke=invoke))
        modules = {
            "System": SimpleNamespace(Action=lambda callback: callback),
            "Microsoft.Web.WebView2.Core": SimpleNamespace(
                CoreWebView2PermissionState=SimpleNamespace(Allow="Allow"),
            ),
        }
        with patch("application.core.windows_ui.import_module", side_effect=modules.__getitem__):
            configure_clipboard(window, self.app.canonical_url, self.app._logger)
            configure_clipboard(window, self.app.canonical_url, self.app._logger)
        self.assertEqual(len(control.core.PermissionRequested.handlers), 1)
        handler = control.core.PermissionRequested.handlers[0]
        allowed = SimpleNamespace(Uri=self.app.canonical_url, PermissionKind="ClipboardRead", State="Default")
        handler(None, allowed)
        self.assertEqual(allowed.State, "Allow")
        denied = SimpleNamespace(Uri="https://evil.example/", PermissionKind="ClipboardRead", State="Default")
        handler(None, denied)
        self.assertEqual(denied.State, "Default")
