import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from application.launcher.suite_recipe_pywebview import (
    AimRecipeApi, Boundary, ROOT_NAME, SmartCatalogRecipeApi, VobRecipeApi,
    aim_fixture_displayed, aim_paths,
    startup_observation_complete,
    main,
)


class Event:
    def __iadd__(self, _handler):
        return self


class VobRecipeTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.outside = Path(temporary.name)
        self.root = self.outside / ROOT_NAME
        for folder in ("smartcatalog\\profile", "vob_editor\\profile", "vob_editor\\data",
                       "settings", "logs"):
            (self.root / folder).mkdir(parents=True)
        self.settings = self.root / "settings" / "vob-recipe.json"
        self.document = {"version": 1, "general": {"lang": "fr", "dark": False}}
        self.settings.write_text(json.dumps(self.document), encoding="utf-8")
        self.api: VobRecipeApi = VobRecipeApi(self.root)
        self.addCleanup(self.api._app._close)

    def test_real_identity_initial_data_empty_state_and_capabilities(self):
        from application.core.configuration import SettingsStore
        from application.plugins.vob_editor.application import VobEditorApp

        real = VobEditorApp(
            self.root / "vob_editor" / "data", roots={},
            settings_store=SettingsStore(self.settings), initial_path=None,
            allplan_version=None, allplan_datas=None, allplan_versions={})
        original = real.get_initial_data()
        initial = self.api.get_initial_data()
        self.assertEqual(
            {key: value for key, value in initial.items()
             if key not in ("capabilities", "unavailable_capabilities")},
            {key: value for key, value in original.items()
             if key not in ("capabilities", "unavailable_capabilities")})
        self.assertEqual(initial["files"], [])
        self.assertIsNone(initial["document"])
        self.assertEqual(initial["context"], {"version": "", "source": "", "versions": []})
        self.assertEqual(initial["backups"], {"filePath": None, "files": []})
        self.assertEqual(initial["settings"], {"lang": "fr", "dark": False})
        self.assertNotIn("references", initial)
        info = self.api.get_app_info()
        self.assertEqual(info["app_id"], "vob_editor")
        self.assertIsNone(info["allplan_version"])
        for value in (info, initial):
            self.assertEqual(value["capabilities"], ["settings.load"])
            self.assertEqual(value["unavailable_capabilities"], {})

    def test_exact_settings_load_delegated_and_completed(self):
        with patch("application.core.bridge.BridgeApp.call",
                   wraps=self.api._app.call) as dispatch:
            reply = self.api.call("settings.load", {"app_id": "vob_editor"})
        dispatch.assert_called_once_with("settings.load", {"app_id": "vob_editor"})
        self.assertEqual(reply, {"ok": True, "data": self.document})

    def test_reference_load_is_explicitly_refused_without_dispatch_or_service_or_store(self):
        with (patch("application.core.bridge.BridgeApp.call") as dispatch,
              patch("application.plugins.vob_editor.application.VobEditorApp._handle_reference_load")
              as references,
              patch("application.core.configuration.SettingsStore.load") as load):
            reply = self.api.call("reference.load", {"lang": "fr"})
            self.assertEqual(reply, {"ok": False, "error": {
                "code": "unknown_command",
                "message": "Native VOB references unavailable in isolated recipe."}})
            self.assertNotIn("data", reply)
            dispatch.assert_not_called()
            references.assert_not_called()
            load.assert_not_called()
        self.assertIn("reference.load", (self.root / "logs" / "vob-recipe.log").read_text(
            encoding="utf-8"))

    def test_write_and_other_commands_refused_before_dispatch(self):
        commands = [
            "settings.save", "vob.save", "vob.save_as", "vob.saveAs", "vob.open",
            "vob.preview", "vob.files.list", "vob.files.add", "vob.projects.add",
            "vob.header.default", "vob.backups.list", "vob.backups.create",
            "vob.backups.restore", "vob.file.reveal", "vob.file.open_external",
            "menu.import", "menu.export", "app.open", "prjtool", "save", "quit",
            "unknown", "", " settings.load", "settings.load ", None, [], {},
        ]
        with (patch("application.core.bridge.BridgeApp.call") as dispatch,
              patch("application.core.configuration.SettingsStore.load") as load,
              patch("application.core.configuration.SettingsStore.save") as save):
            for command in commands:
                with self.subTest(command=command):
                    reply = self.api.call(command, {"version": 1})
                    self.assertFalse(reply["ok"])
                    self.assertEqual(reply["error"]["code"], "unknown_command")
            dispatch.assert_not_called()
            load.assert_not_called()
            save.assert_not_called()
        text = (self.root / "logs" / "vob-recipe.log").read_text(encoding="utf-8")
        self.assertEqual(text.count("refused before delegation"), len(commands))
        self.assertIn("settings.save", text)

    def test_invalid_enriched_and_other_identity_payloads_refused(self):
        payloads = [
            None, [], "vob_editor", {}, {"app_id": "smartcatalog"}, {"app_id": "vob-editor"},
            {"app_id": "information_manager"}, {"app_id": None}, {"app_id": 1},
            {"app_id": ["vob_editor"]}, {"app_id": "vob_editor "},
            {"app_id": "vob_editor", "path": "outside"}, {"app_id": "vob_editor", "lang": "fr"},
        ]
        with (patch("application.core.bridge.BridgeApp.call") as dispatch,
              patch("application.core.configuration.SettingsStore.load") as load):
            for payload in payloads:
                with self.subTest(payload=payload):
                    reply = self.api.call("settings.load", payload)
                    self.assertEqual(reply["error"]["code"], "invalid")
                    self.assertFalse(reply["ok"])
            dispatch.assert_not_called()
            load.assert_not_called()

    def test_unsafe_settings_rejected_before_construction_and_not_rewritten(self):
        documents = [
            {**self.document, "vobEditorSession": {"lastFile": "outside"}},
            {**self.document, "vobEditorSession": {"selectedFiles": ["outside"]}},
            {**self.document, "vobResources": {"addedFiles": [], "addedProjects": []}},
            {**self.document, "path": "outside"},
            {"version": 1, "general": {"lang": "en", "dark": False}},
            {"version": 1, "general": {"lang": "fr", "dark": False, "path": "outside"}},
            {"version": True, "general": {"lang": "fr", "dark": False}},
            {"version": 1, "general": {"lang": "fr", "dark": 0}},
            {},
        ]
        with patch("application.plugins.vob_editor.application.VobEditorApp") as plugin:
            for document in documents:
                with self.subTest(document=document):
                    raw = json.dumps(document)
                    self.settings.write_text(raw, encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "VOB recipe requires"):
                        VobRecipeApi(self.root)
                    self.assertEqual(self.settings.read_text(encoding="utf-8"), raw)
            plugin.assert_not_called()

    def test_changed_settings_cannot_restore_session_after_construction(self):
        self.settings.write_text(json.dumps({
            **self.document, "vobEditorSession": {"lastFile": "outside"}}), encoding="utf-8")
        with (patch("application.plugins.vob_editor.application.VobEditorApp._read_document")
              as read_document,
              patch("application.plugins.vob_editor.application.VobEditorApp._restore_resources")
              as resources):
            with self.assertRaisesRegex(ValueError, "VOB recipe requires"):
                self.api.get_initial_data()
            read_document.assert_not_called()
            resources.assert_not_called()
        self.assertFalse(self.api._app._session_restored)

    def test_no_roots_provider_paths_or_environment_discovery(self):
        with (patch.dict(os.environ, {
                "ALLPLAN_STD_DIR": str(self.outside), "ALLPLAN_PRJ_DIR": str(self.outside),
                "ALLPLAN_VOB_TEST_DIR": str(self.outside)}),
              patch("application.core.configuration.default_settings_path",
                    side_effect=AssertionError("Normal settings path used"))):
            other = VobRecipeApi(self.root)
            self.addCleanup(other._app._close)
            other.get_initial_data()
        self.assertEqual(other._app._roots, {})
        self.assertIsNone(other._app._initial_path)
        self.assertIsNone(other._app._allplan_datas)
        self.assertEqual(other._app._allplan_versions, {})
        self.assertEqual(other._app._authorized_files, set())
        self.assertEqual(other._app._personal_files, {})
        self.assertEqual(other._app._references, {})

    def test_effects_stay_isolated_and_no_settings_or_vob_write(self):
        sentinel = self.outside / "usual-settings.json"
        sentinel.write_bytes(b"UNCHANGED")
        before = self.settings.read_bytes()
        self.api.get_initial_data()
        self.api.call("settings.load", {"app_id": "vob_editor"})
        self.api.call("settings.save", {"version": 1})
        self.api.call("reference.load", {"lang": "fr"})
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertEqual(sentinel.read_bytes(), b"UNCHANGED")
        self.assertEqual(self.api._app._settings_store._path, self.settings)
        self.assertFalse(self.api._logger.propagate)
        self.assertIs(self.api._app._logger, self.api._logger)
        for handler in self.api._logger.handlers:
            self.assertEqual(Path(handler.baseFilename).parent, self.root / "logs")
        self.assertEqual({p.name for p in self.settings.parent.iterdir()},
                         {"vob-recipe.json", "vob-recipe.json.lock"})
        self.assertEqual(list((self.root / "vob_editor" / "data").iterdir()), [])
        self.assertEqual({p.name for p in self.outside.iterdir()},
                         {ROOT_NAME, "usual-settings.json"})

    def test_exact_public_surface(self):
        names = {name for name in dir(self.api) if not name.startswith("_")}
        self.assertEqual(names, {"get_app_info", "get_initial_data", "call"})
        self.assertTrue(all(callable(getattr(self.api, name)) for name in names))

    def test_missing_or_corrupt_settings_fail_before_plugin_construction(self):
        with patch("application.plugins.vob_editor.application.VobEditorApp") as plugin:
            self.settings.unlink()
            with self.assertRaises(FileNotFoundError):
                VobRecipeApi(self.root)
            self.settings.write_text("{broken", encoding="utf-8")
            with self.assertRaises(json.JSONDecodeError):
                VobRecipeApi(self.root)
            plugin.assert_not_called()

    def test_hard_linked_settings_fail_before_plugin_construction(self):
        self.settings.unlink()
        outside_settings = self.outside / "client-settings.json"
        outside_settings.write_text(json.dumps(self.document), encoding="utf-8")
        os.link(outside_settings, self.settings)
        with patch("application.plugins.vob_editor.application.VobEditorApp") as plugin:
            with self.assertRaisesRegex(ValueError, "hard-linked"):
                VobRecipeApi(self.root)
            plugin.assert_not_called()
        self.assertEqual(json.loads(outside_settings.read_text(encoding="utf-8")), self.document)


class SmartCatalogRecipeTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.outside = Path(temporary.name)
        self.root = self.outside / ROOT_NAME
        for folder in ("smartcatalog\\profile", "smartcatalog\\data", "settings", "logs"):
            (self.root / folder).mkdir(parents=True)
        self.settings = self.root / "settings" / "smartcatalog-recipe.json"
        self.settings.write_text(
            '{"version":1,"general":{"lang":"fr","dark":false}}', encoding="utf-8")
        self.api: SmartCatalogRecipeApi = SmartCatalogRecipeApi(self.root)
        self.addCleanup(self.api._app._close)

    def test_identity_initial_data_and_capabilities_keep_real_plugin_content(self):
        from application.core.configuration import SettingsStore
        from application.plugins.smartcatalog.application import SmartCatalogApp

        real = SmartCatalogApp(
            self.root / "smartcatalog" / "data", settings_store=SettingsStore(self.settings),
            context={"allplan_version": None, "project": None, "paths": {}}, open_app=None)
        original = real.get_initial_data()
        initial = self.api.get_initial_data()
        self.assertEqual(
            {key: value for key, value in initial.items()
             if key not in ("capabilities", "unavailable_capabilities")},
            {key: value for key, value in original.items()
             if key not in ("capabilities", "unavailable_capabilities")})
        self.assertEqual(initial["catalogs"], [])
        self.assertIsNone(initial["current"])
        self.assertEqual(initial["context"],
                         {"allplan_version": None, "project": None, "paths": {}})
        info = self.api.get_app_info()
        self.assertEqual(info["app_id"], "smartcatalog")
        self.assertIsNone(info["allplan_version"])
        for value in (info, initial):
            self.assertEqual(value["capabilities"], ["settings.load"])
            self.assertEqual(value["unavailable_capabilities"], {})
        self.assertIsNone(self.api._app._open_app)
        info["capabilities"].append("settings.save")
        self.assertEqual(self.api.get_app_info()["capabilities"], ["settings.load"])

    def test_exact_settings_load_delegates_once_to_real_dispatcher(self):
        with patch("application.core.bridge.BridgeApp.call",
                   wraps=self.api._app.call) as dispatch:
            reply = self.api.call("settings.load", {"app_id": "smartcatalog"})
        dispatch.assert_called_once_with("settings.load", {"app_id": "smartcatalog"})
        self.assertEqual(reply, {"ok": True, "data": {
            "version": 1, "general": {"lang": "fr", "dark": False}}})

    def test_other_commands_are_refused_and_logged_before_any_dispatch_or_store_read(self):
        commands = [
            "settings.save", "catalog.list", "catalog.open", "catalog.save",
            "reference.load", "backup.list", "backup.restore", "file.browse",
            "library.open", "library.sync", "menu.import", "menu.export", "app.open",
            "save", "quit", "prjtool", "unknown", "", " settings.load", "settings.load ",
            None, [], {},
        ]
        with (patch("application.core.bridge.BridgeApp.call") as dispatch,
              patch("application.core.configuration.SettingsStore.load") as load):
            for command in commands:
                with self.subTest(command=command):
                    reply = self.api.call(command, {"app_id": "smartcatalog"})
                    self.assertIs(reply["ok"], False)
                    self.assertEqual(reply["error"]["code"], "unknown_command")
            dispatch.assert_not_called()
            load.assert_not_called()
        text = (self.root / "logs" / "smartcatalog-recipe.log").read_text(encoding="utf-8")
        self.assertIn("settings.save", text)
        self.assertEqual(text.count("refused before delegation"), len(commands))

    def test_invalid_payloads_never_reach_dispatcher(self):
        payloads = [
            None, [], "smartcatalog", {}, {"app_id": "vob_editor"},
            {"app_id": "information_manager"}, {"app_id": "smartcatlog"},
            {"app_id": None}, {"app_id": ["smartcatalog"]}, {"app_id": 1},
            {"app_id": "smartcatalog "}, {"app_id": "smartcatalog", "path": "outside"},
            {"app_id": "smartcatalog", "version": 1},
        ]
        with (patch("application.core.bridge.BridgeApp.call") as dispatch,
              patch("application.core.configuration.SettingsStore.load") as load):
            for payload in payloads:
                with self.subTest(payload=payload):
                    reply = self.api.call("settings.load", payload)
                    self.assertIs(reply["ok"], False)
                    self.assertEqual(reply["error"]["code"], "invalid")
            dispatch.assert_not_called()
            load.assert_not_called()

    def test_store_locks_logs_and_corrupt_preservation_stay_inside_recipe(self):
        sentinel = self.outside / "usual-settings.json"
        sentinel.write_bytes(b"DO NOT TOUCH")
        settings_before = self.settings.read_bytes()
        with patch("application.core.configuration.default_settings_path",
                   side_effect=AssertionError("Normal settings path must not be used")):
            self.api.get_initial_data()
            self.assertTrue(self.api.call("settings.load", {"app_id": "smartcatalog"})["ok"])
            self.api.call("settings.save", {"version": 1})
            self.assertEqual(self.settings.read_bytes(), settings_before)
            self.settings.write_text("{broken", encoding="utf-8")
            self.assertTrue(self.api.call("settings.load", {"app_id": "smartcatalog"})["ok"])
        self.assertEqual(sentinel.read_bytes(), b"DO NOT TOUCH")
        self.assertEqual(self.api._app._settings_store._path, self.settings)
        self.assertTrue(self.settings.with_name(self.settings.name + ".lock").is_file())
        preserved = list(self.settings.parent.glob("settings.corrupt-*.json"))
        self.assertEqual(len(preserved), 1)
        self.assertEqual(preserved[0].read_text(encoding="utf-8"), "{broken")
        self.assertIs(self.api._app._logger, self.api._logger)
        self.assertFalse(self.api._logger.propagate)
        for handler in self.api._logger.handlers:
            self.assertEqual(Path(handler.baseFilename).parent, self.root / "logs")
        self.assertEqual({p.name for p in self.outside.iterdir()},
                         {ROOT_NAME, "usual-settings.json"})

    def test_exposable_surface_has_only_three_methods(self):
        methods = {name for name in dir(self.api)
                   if not name.startswith("_") and callable(getattr(self.api, name))}
        self.assertEqual(methods, {"get_app_info", "get_initial_data", "call"})
        self.assertEqual({name for name in dir(self.api) if not name.startswith("_")}, methods)

    def test_settings_default_is_not_selected_during_construction(self):
        with patch("application.core.configuration.default_settings_path",
                   side_effect=AssertionError("Normal settings path must not be used")):
            other = SmartCatalogRecipeApi(self.root)
            self.addCleanup(other._app._close)
            self.assertEqual(other._app._settings_store._path, self.settings)

    def test_hard_linked_settings_are_rejected_before_plugin_construction(self):
        outside_settings = self.outside / "outside-settings.json"
        self.settings.unlink()
        outside_settings.write_text('{"version":1}', encoding="utf-8")
        os.link(outside_settings, self.settings)
        with patch("application.plugins.smartcatalog.application.SmartCatalogApp") as plugin:
            with self.assertRaisesRegex(ValueError, "hard-linked"):
                SmartCatalogRecipeApi(self.root)
            plugin.assert_not_called()
        self.assertEqual(outside_settings.read_text(encoding="utf-8"), '{"version":1}')

    def test_missing_isolated_settings_directory_is_rejected(self):
        self.settings.unlink()
        self.settings.parent.rmdir()
        with patch("application.plugins.smartcatalog.application.SmartCatalogApp") as plugin:
            with self.assertRaisesRegex(ValueError, "directory missing"):
                SmartCatalogRecipeApi(self.root)
            plugin.assert_not_called()


class RecipeTests(unittest.TestCase):
    def test_vob_cli_selects_only_vob_and_preserves_existing_reports(self):
        with TemporaryDirectory() as folder:
            root = Path(folder) / ROOT_NAME
            (root / "smartcatalog" / "profile").mkdir(parents=True)
            report = Path(folder) / "result.json"
            args = ["recipe", "--root", str(root), "--report", str(report),
                    "--vob-remote-once"]
            with (patch("sys.argv", args),
                  patch("application.launcher.suite_recipe_pywebview.run_remote_recipe",
                        return_value={"errors": [], "closed": True}) as run):
                self.assertEqual(main(), 0)
                run.assert_called_once_with(root, "vob_editor")
            raw = report.read_bytes()
            with (patch("sys.argv", args),
                  patch("application.launcher.suite_recipe_pywebview.run_remote_recipe") as run):
                with self.assertRaises(SystemExit):
                    main()
                run.assert_not_called()
            self.assertEqual(report.read_bytes(), raw)

    def test_vob_observation_waits_after_reference_refusal_when_present(self):
        calls = [
            {"method": "get_initial_data", "completed": True, "finishedMonotonic": 2},
            {"method": "call", "command": "settings.load", "completed": True,
             "reply": {"ok": True}, "finishedMonotonic": 3},
            {"method": "call", "command": "reference.load", "completed": True,
             "reply": {"ok": False}, "finishedMonotonic": 10},
        ]
        self.assertTrue(startup_observation_complete(calls, 18, 0))
        self.assertFalse(startup_observation_complete(calls, 24.9, 0, include_references=True))
        self.assertTrue(startup_observation_complete(calls, 25, 0, include_references=True))
        calls[-1]["finishedMonotonic"] = 40
        self.assertTrue(startup_observation_complete(calls, 45, 0, include_references=True))

    def test_smartcatalog_passive_observation_waits_fifteen_seconds_after_reads(self):
        calls = [
            {"method": "get_initial_data", "completed": True, "finishedMonotonic": 5},
            {"method": "call", "command": "settings.load", "completed": True,
             "reply": {"ok": True}, "finishedMonotonic": 6},
        ]
        self.assertFalse(startup_observation_complete(calls, 20.9, 0))
        self.assertTrue(startup_observation_complete(calls, 21, 0))
        self.assertFalse(startup_observation_complete(calls[:1], 30, 0))
        self.assertTrue(startup_observation_complete(calls[:1], 45, 0))
        calls[1]["reply"]["ok"] = False
        self.assertFalse(startup_observation_complete(calls, 30, 0))

    def test_aim_fixture_display_predicate_accepts_field_values_and_requires_both(self):
        for page, expected in (
            ({"text": "007 Donnees disponibles",
              "inputValues": ["", "Synthetic recipe attribute", "SYNTHETIC-ONLY", ""]}, True),
            ({"text": "Synthetic recipe attribute SYNTHETIC-ONLY", "inputValues": []}, True),
            ({"text": "Synthetic recipe attribute", "inputValues": ["SYNTHETIC-ONLY"]}, True),
            ({"text": "", "inputValues": ["Synthetic recipe attribute"]}, False),
            ({"text": "", "inputValues": ["SYNTHETIC-ONLY"]}, False),
            ({"text": "", "inputValues": ["prefix Synthetic recipe attribute", "SYNTHETIC-ONLY"]},
             False),
            ({"text": "", "inputValues": []}, False),
        ):
            with self.subTest(page=page):
                self.assertEqual(aim_fixture_displayed(page), expected)

    def test_remote_aim_selects_only_prepared_populated_paths(self):
        with TemporaryDirectory() as folder:
            root = Path(folder)
            selected = root / "information_manager" / "populated"
            (selected / "profile").mkdir(parents=True)
            (selected / "data").mkdir()
            fixture = selected / "data" / "initial_data.json"
            fixture.write_text(json.dumps({
                "catalog": [{"num": 7}], "attributes": [{"num": 7}],
                "values": {"7": "SYNTHETIC-ONLY"},
            }), encoding="utf-8")
            self.assertEqual(aim_paths(root),
                             (selected / "profile", selected / "data", fixture))
            fixture.write_text('{"catalog":[]}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "populated synthetic AIM"):
                aim_paths(root)

    def test_remote_aim_missing_prepared_paths_fail_before_window(self):
        with TemporaryDirectory() as folder:
            with self.assertRaises(FileNotFoundError):
                aim_paths(Path(folder))

    def test_aim_surface_is_exactly_two_real_plugin_reads(self):
        with TemporaryDirectory() as folder:
            api = AimRecipeApi(Path(folder))
            methods = {name for name in dir(api)
                       if not name.startswith("_") and callable(getattr(api, name))}
            self.assertEqual(methods, {"get_app_info", "get_initial_data"})
            self.assertEqual(api.get_app_info()["id"], "information_manager")
            self.assertEqual(api.get_initial_data(), {"app": "information_manager", "data": {}})
            data = {"catalog": [], "attributes": [], "values": {}}
            Path(folder, "initial_data.json").write_text(json.dumps(data), encoding="utf-8")
            self.assertEqual(api.get_initial_data()["data"], data)
            Path(folder, "initial_data.json").write_text(
                json.dumps({"catalog": "incompatible"}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "catalog array required"):
                api.get_initial_data()

    def test_successful_installation_records_readiness_after_all_handlers(self):
        boundary = self.boundary()
        core = SimpleNamespace(Settings=SimpleNamespace(),
                               AddWebResourceRequestedFilter=Mock(),
                               **{name: Event() for name in (
                                   "WebResourceRequested", "NavigationStarting",
                                   "NewWindowRequested", "DownloadStarting")})
        boundary.install(core)
        self.assertEqual(len(boundary.subscriptions), 4)
        self.assertEqual(self.record, ["filter-installed"])

    def boundary(self):
        self.record, self.stop = [], Mock()
        environment = SimpleNamespace(CreateWebResourceResponse=Mock(return_value="403"))
        return Boundary("http://127.0.0.1:1/recipe",
                        frozenset({"http://127.0.0.1:1/~flock.js"}),
                        environment, SimpleNamespace(All=1, Document=3), SimpleNamespace(All=2),
                        self.record, self.stop)

    def test_exact_refusal_and_variant_stop(self):
        boundary = self.boundary()
        for url, variant in (
                ("http://127.0.0.1:1/~flock.js", False),
                ("http://127.0.0.1:1/~flock.js?v=2", True)):
            args = SimpleNamespace(Request=SimpleNamespace(Uri=url), Response=None)
            boundary.request(None, args)
            self.assertEqual(args.Response, "403")
            self.assertEqual(self.stop.called, variant)
        self.assertEqual(boundary.blocked, frozenset({"http://127.0.0.1:1/~flock.js"}))

    def test_allowed_resource_unchanged(self):
        boundary = self.boundary()
        args = SimpleNamespace(Request=SimpleNamespace(Uri="http://127.0.0.1:1/allowed.js"),
                               Response=None)
        boundary.request(None, args)
        self.assertIsNone(args.Response)

    def test_outside_document_is_refused_at_resource_layer(self):
        boundary = self.boundary()
        args = SimpleNamespace(Request=SimpleNamespace(Uri="http://127.0.0.1:1/outside"),
                               ResourceContext=3, Response=None)
        boundary.request(None, args)
        self.assertEqual(args.Response, "403")
        self.assertTrue(self.record[0].startswith("document-denied:"))

    def test_installation_completion_is_not_recorded_on_failure(self):
        boundary = self.boundary()
        core = SimpleNamespace(Settings=SimpleNamespace(),
                               AddWebResourceRequestedFilter=Mock(),
                               **{name: Event() for name in (
                                   "WebResourceRequested", "NavigationStarting",
                                   "NewWindowRequested", "DownloadStarting")})
        with self.assertRaisesRegex(RuntimeError, "Controlled installation failure"):
            boundary.install(core, fail_install=True)
        self.assertNotIn("filter-installed", self.record)
        self.assertIs(core.Settings.AreHostObjectsAllowed, False)

    def test_native_event_cancellation(self):
        boundary = self.boundary()
        navigation = SimpleNamespace(Uri="http://127.0.0.1:1/outside", Cancel=False)
        boundary.navigation(None, navigation)
        self.assertTrue(navigation.Cancel)
        popup = SimpleNamespace(Uri="http://127.0.0.1:1/popup", Handled=False)
        boundary.popup(None, popup)
        self.assertTrue(popup.Handled)
        download = SimpleNamespace(Cancel=False)
        boundary.download(None, download)
        self.assertTrue(download.Cancel)
