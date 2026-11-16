import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch
from xml.etree import ElementTree

from application.core.allplan.adapter import context_from_allplan, launch_from_allplan
from application.core.allplan.paths import AllplanPaths, resolve_paths
from application.core.allplan.paths import Registry
from application.core.context import (
    LaunchContext, context_from_arguments, context_to_arguments, installation_key,
    normalize_version,
)
from application.launcher.main import create_parser, main
from application.launcher.selector import SelectorApi, discover_installations, show_selector
from application.core.catalog import PLUGINS, resolve_plugin
from application.core.launching import (
    ROOT, inspect_context, launch_plugin, launcher_command,
    resolve_context,
)


class MemoryRegistry:
    def __init__(self, settings=None, installed=True):
        self.errors = []
        self.calls = []
        self.settings = {} if settings is None else settings
        self.installed = installed

    def values(self, hive, key, view):
        self.calls.append((hive, key, view))
        if key.endswith(r"\InstallRoot"):
            return {"installed": "yes"} if self.installed else {}
        return self.settings if key.endswith(r"\Settings") else {}


class RegistryContextTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.paths = dict.fromkeys(("ETC", "PRG", "STD", "PRJ", "USR", "TMP"),
                                  Path(temporary.name))

    def resolve(self, registry, **kwargs):
        return resolve_paths("2026", overrides=self.paths, registry=registry, **kwargs)

    def test_exact_standard_and_verification_keys_without_registry(self):
        self.assertEqual(installation_key("2026"), r"SOFTWARE\NEMETSCHEK\Allplan\2026.0")
        self.assertEqual(installation_key("2026", True),
                         r"SOFTWARE\NEMETSCHEK\2026_Verification\2026.0")

    def test_requested_installation_only_and_country_normalization(self):
        for verification in (False, True):
            registry = MemoryRegistry({"country": "Fra", "language": "DEU"})
            state = self.resolve(registry, verification_version=verification)
            self.assertEqual(state.country, "FRA")
            self.assertEqual(state.verification_version, verification)
            self.assertTrue(all(key.startswith(installation_key("2026", verification) + "\\")
                                and view == 64 for _, key, view in registry.calls))

    def test_explicit_country_has_priority_and_skips_settings(self):
        registry = MemoryRegistry({"country": "DEU"})
        state = self.resolve(registry, country="Fra")
        self.assertEqual(state.country, "FRA")
        self.assertFalse(any(key.endswith(r"\Settings") for _, key, _ in registry.calls))

    def test_language_is_resolved_separately_from_country_in_exact_64_bit_hkcu(self):
        registry = MemoryRegistry({"country": "Fra", "language": "DEU"})
        state = self.resolve(registry, resolve_language=True, verification_version=True)
        self.assertEqual(state.country, "FRA")
        self.assertEqual(state.language, "deu")
        self.assertIn(("HKCU", installation_key("2026", True) + r"\Settings", 64),
                      registry.calls)
        self.assertEqual(AllplanPaths.from_dict(state.to_dict()), state)

    def test_missing_empty_and_wrong_type_country_remain_unresolved(self):
        for settings in ({}, {"country": ""}, {"country": 33}, {"country": []},
                         {"language": "FRA", "installedlanguagelcid": "1036"}):
            with self.subTest(settings=settings):
                state = self.resolve(MemoryRegistry(settings))
                self.assertEqual(state.country, "")
                self.assertTrue(any("pays non resolu" in value for value in state.diagnostics))

    def test_missing_installation_never_selects_another_one(self):
        registry = MemoryRegistry(installed=False)
        state = self.resolve(registry, verification_version=True)
        self.assertTrue(any("installation demandee absente" in d for d in state.diagnostics))
        self.assertTrue(all("2026_Verification" in key for _, key, _ in registry.calls))

    def test_registry_uses_read_only_64_bit_view(self):
        registry = Registry()
        winreg = Mock()
        winreg.KEY_READ = 1
        winreg.KEY_WOW64_64KEY = 256
        winreg.REG_SZ, winreg.REG_EXPAND_SZ = 1, 2
        winreg.OpenKey.return_value.__enter__ = Mock(return_value="key")
        winreg.OpenKey.return_value.__exit__ = Mock(return_value=False)
        winreg.QueryInfoKey.return_value = (0, 1, 0)
        winreg.EnumValue.return_value = ("Country", "Fra", 1)
        registry.reg = winreg
        self.assertEqual(registry.values("HKLM", installation_key("2026") + r"\Settings", 64),
                         {"country": "Fra"})
        self.assertEqual(winreg.OpenKey.call_args.args[3], 257)
        self.assertIs(winreg.OpenKey.call_args.args[0], winreg.HKEY_LOCAL_MACHINE)
        with self.assertRaises(ValueError):
            registry.values("HKLM", "anything", 32)

    def test_registry_errors_are_diagnosed_and_do_not_change_installation(self):
        for error in (FileNotFoundError(), PermissionError("Access denied")):
            registry = Registry()
            registry.reg = Mock()
            registry.reg.KEY_READ, registry.reg.KEY_WOW64_64KEY = 1, 256
            registry.reg.OpenKey.side_effect = error
            state = self.resolve(registry, verification_version=True)
            self.assertEqual(state.country, "")
            self.assertTrue(registry.errors)
            self.assertTrue(all("2026_Verification" in call.args[1]
                                for call in registry.reg.OpenKey.call_args_list))

    def test_registry_country_with_unexpected_type_is_reported(self):
        registry = Registry()
        winreg = Mock()
        winreg.KEY_READ, winreg.KEY_WOW64_64KEY = 1, 256
        winreg.REG_SZ, winreg.REG_EXPAND_SZ = 1, 2
        winreg.OpenKey.return_value.__enter__ = Mock(return_value="key")
        winreg.OpenKey.return_value.__exit__ = Mock(return_value=False)
        winreg.QueryInfoKey.return_value = (0, 1, 0)
        winreg.EnumValue.return_value = ("Country", 42, 4)
        registry.reg = winreg
        self.assertEqual(registry.values("HKLM", installation_key("2026") + r"\Settings", 64), {})
        self.assertTrue(any("Country" in value and "type inattendu" in value
                            for value in registry.errors))

    def test_registry_ignores_unrelated_numeric_values_in_shared_keys(self):
        from contextlib import nullcontext

        cases = {
            "Settings": [("Country", "Fra", 1), ("UseOnboarding", 1, 4),
                         ("InstalledLanguageLcid", 1036, 4), ("MouseMoveTime", 10, 4)],
            "Setup": [("NetPath", "C:\\Allplan", 1), ("StartMenuShortcuts", 1, 4),
                      ("ExtensionAllplan", 1, 4)],
        }
        for section, entries in cases.items():
            with self.subTest(section=section):
                registry = Registry()
                winreg = Mock()
                winreg.KEY_READ, winreg.KEY_WOW64_64KEY = 1, 256
                winreg.REG_SZ, winreg.REG_EXPAND_SZ = 1, 2
                winreg.OpenKey.return_value = nullcontext("key")
                winreg.QueryInfoKey.return_value = (0, len(entries), 0)
                winreg.EnumValue.side_effect = entries
                registry.reg = winreg
                values = registry.values("HKLM", installation_key("2026") + "\\" + section, 64)
                self.assertTrue(values)
                self.assertEqual(registry.errors, [])

    def test_optional_customized_paths_absence_is_not_an_error(self):
        for hive in ("HKLM", "HKCU"):
            for verification in (False, True):
                with self.subTest(hive=hive, verification=verification):
                    registry = Registry()
                    registry.reg = Mock()
                    registry.reg.KEY_READ, registry.reg.KEY_WOW64_64KEY = 1, 256
                    registry.reg.OpenKey.side_effect = FileNotFoundError()
                    key = installation_key("2026", verification) + r"\InstallRoot\CustomizedPaths"
                    self.assertEqual(registry.values(hive, key, 64), {})
                    self.assertEqual(registry.errors, [])
                    registry.reg.OpenKey.side_effect = PermissionError("Access denied")
                    self.assertEqual(registry.values(hive, key, 64), {})
                    self.assertTrue(registry.errors)

    def test_relevant_path_values_with_invalid_types_are_still_reported(self):
        from contextlib import nullcontext

        for section, name in (("InstallRoot", "ProgramPath"), ("Setup", "NetPath"),
                              ("InstallTrace", "Netmanager"),
                              (r"InstallRoot\CustomizedPaths", "STD")):
            with self.subTest(section=section):
                registry = Registry()
                winreg = Mock()
                winreg.KEY_READ, winreg.KEY_WOW64_64KEY = 1, 256
                winreg.REG_SZ, winreg.REG_EXPAND_SZ = 1, 2
                winreg.OpenKey.return_value = nullcontext("key")
                winreg.QueryInfoKey.return_value = (0, 1, 0)
                winreg.EnumValue.return_value = (name, 42, 4)
                registry.reg = winreg
                registry.values("HKLM", installation_key("2026") + "\\" + section, 64)
                self.assertTrue(any(name in error for error in registry.errors))

    def test_discovery_keeps_standard_and_verification_in_64_bit_view(self):
        from contextlib import nullcontext

        registry = Registry()
        winreg = Mock()
        winreg.KEY_READ, winreg.KEY_WOW64_64KEY = 1, 256
        winreg.REG_SZ, winreg.REG_EXPAND_SZ = 1, 2
        # Registry names are case-insensitive; preserve that property in discovery.
        parent = r"SOFTWARE\NEMETSCHEK"
        tree = {
            parent: ["ALLPLAN", "2026_VERIFICATION"],
            parent + r"\ALLPLAN": ["2026.0"],
            parent + r"\2026_VERIFICATION": ["2026.0"],
        }
        winreg.OpenKey.side_effect = lambda _hive, key, _reserved, _flags: nullcontext(key)
        winreg.QueryInfoKey.side_effect = lambda key: (len(tree.get(key, [])), 1, 0)
        winreg.EnumKey.side_effect = lambda key, index: tree[key][index]
        winreg.EnumValue.return_value = ("ProgramPath", r"C:\Allplan", 1)
        registry.reg = winreg
        installations = registry.installations()
        self.assertEqual(len(installations), 2)
        self.assertEqual({item["verification_version"] for item in installations}, {False, True})
        self.assertTrue(all(call.args[3] == 257 for call in winreg.OpenKey.call_args_list))

    def test_round_trip_resolved_paths(self):
        original = AllplanPaths("2026", "FRA", True, paths=self.paths)
        self.assertEqual(AllplanPaths.from_dict(original.to_dict()), original)
        self.assertNotIn("installation_id", original.to_dict())

    def test_version_validation_before_registry(self):
        self.assertIsNone(LaunchContext().allplan_version)
        for value in (None, "", "2026.0", "20", "latest", "2021", "10000"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_version(value)
        self.assertEqual(normalize_version(" 2026 "), "2026")


class CliLaunchTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.context = LaunchContext("2026", True, "Fra", {"ETC": self.root}, origin="allplan")

    def test_empty_cli_and_verification_flag(self):
        parser = create_parser()
        empty = parser.parse_args([])
        self.assertIsNone(empty.app_id)
        self.assertEqual(context_from_arguments(empty), LaunchContext())
        self.assertFalse(context_from_arguments(parser.parse_args(["--allplan-version", "2026"]))
                         .verification_version)
        self.assertTrue(context_from_arguments(parser.parse_args([
            "--allplan-version", "2026", "--verification-version"])).verification_version)
        with self.assertRaises(ValueError):
            context_from_arguments(parser.parse_args(["--verification-version"]))

    def test_context_cli_round_trip_with_spaces_accents_and_metacharacters(self):
        path = self.root / "Projet été & [A]"
        context = LaunchContext("2026", True, "Fra", {"ETC": path, "STD": path},
                                catalog_user_path=path, project_path=path, origin="allplan")
        restored = context_from_arguments(create_parser().parse_args(context_to_arguments(context)))
        self.assertEqual(restored, context)
        self.assertNotIn("--installation-id", context_to_arguments(context))

    def test_no_argument_opens_selector_without_context_resolution(self):
        with patch("application.launcher.selector.show_selector") as show, patch("application.launcher.main.resolve_context") as resolve:
            self.assertEqual(main([]), 0)
        show.assert_called_once_with(LaunchContext(), timeout=15)
        resolve.assert_not_called()

    def test_three_direct_plugins(self):
        for plugin_id in PLUGINS:
            with self.subTest(plugin_id=plugin_id), patch(
                "application.launcher.main.resolve_context", return_value=self.context,
            ), patch("application.launcher.main.run_app") as run:
                self.assertEqual(main([plugin_id, "--allplan-version", "2026",
                                       "--verification-version"]), 0)
                self.assertEqual(run.call_args.args[0].id, plugin_id)
                self.assertEqual(run.call_args.args[1], self.context)

    def test_webview_hosts_receive_the_same_typed_context(self):
        from application.launcher.main import run_app
        webview = MagicMock()
        webview.settings = {}
        with patch.dict(sys.modules, {"webview": webview}), patch.dict(
            "os.environ", {"LOCALAPPDATA": str(self.root),
                           "ALLPLAN_SMARTCATALOG_SETTINGS_DIR": str(self.root / "settings")},
        ), patch("application.plugins.vob_editor.discovery.detect_allplan_versions", return_value={}), patch(
            "application.core.windows_ui.configure_clipboard",
        ):
            for plugin in PLUGINS.values():
                if plugin.id == "information_manager":
                    with self.assertRaisesRegex(RuntimeError, "lancement distant bloque"):
                        run_app(plugin, self.context, create_parser().parse_args([]))
                    continue
                if plugin.id == "vob_editor":
                    with patch("application.launcher.vob_online.run") as run_protected:
                        run_app(plugin, self.context, create_parser().parse_args([]))
                    app, workspace, profile = run_protected.call_args.args
                    self.assertEqual(app._launch_context, self.context)
                    self.assertEqual(workspace.parents[1].name, "vob_editor")
                    self.assertEqual(
                        workspace.name,
                        "verification" if self.context.verification_version else "standard",
                    )
                    self.assertEqual(profile.name, "profile")
                    continue
                event = webview.create_window.return_value.events.loaded
                webview.create_window.return_value.get_current_url.return_value = plugin.url
                run_app(plugin, self.context, create_parser().parse_args([]))
                kwargs = webview.create_window.call_args.kwargs
                self.assertEqual(kwargs["url"], plugin.url)
                self.assertNotIn("?", kwargs["url"])
                app = kwargs["js_api"]
                self.assertEqual(app._launch_context, self.context)
                event.__iadd__.call_args.args[0]()
                script = webview.create_window.return_value.evaluate_js.call_args.args[0]
                self.assertLess(
                    script.index("window.__connectAllplanLauncher ="),
                    script.index(f'window.__connectAllplanLauncher("{plugin.id}")'),
                )
                if plugin.id == "smartcatalog":
                    self.assertIsNotNone(app._open_app)
                if hasattr(app, "_close"):
                    app._close()

    def test_manual_apps_do_not_require_allplan_context(self):
        from application.launcher.main import run_app
        webview = MagicMock()
        webview.settings = {}
        with patch.dict(sys.modules, {"webview": webview}), patch.dict(
            "os.environ", {"LOCALAPPDATA": str(self.root),
                           "ALLPLAN_SMARTCATALOG_SETTINGS_DIR": str(self.root / "settings")},
        ):
            for plugin in PLUGINS.values():
                if plugin.id == "information_manager":
                    with self.assertRaisesRegex(RuntimeError, "lancement distant bloque"):
                        run_app(plugin, LaunchContext(), create_parser().parse_args([]))
                    continue
                if plugin.id == "vob_editor":
                    with patch("application.launcher.vob_online.run") as run_protected:
                        run_app(plugin, LaunchContext(), create_parser().parse_args([]))
                    self.assertEqual(run_protected.call_args.args[0]._launch_context, LaunchContext())
                    continue
                run_app(plugin, LaunchContext(), create_parser().parse_args([]))
                app = webview.create_window.call_args.kwargs["js_api"]
                self.assertEqual(app._launch_context, LaunchContext())
                if hasattr(app, "_close"):
                    app._close()

    def test_information_manager_needs_no_allplan_and_does_not_read_registry(self):
        with patch("application.core.launching.inspect_context") as inspect:
            self.assertEqual(resolve_context(LaunchContext()), LaunchContext())
        inspect.assert_not_called()
        resolve_plugin("information_manager").validate(LaunchContext())

    def test_unknown_plugin_old_cli_and_unsupported_platform_fail_before_ui(self):
        with contextlib.redirect_stderr(io.StringIO()):
            for argv in (["unknown"], ["--installation-id", "obsolete"]):
                with self.assertRaises(SystemExit):
                    main(argv)
            with patch("application.launcher.main.sys.platform", "darwin"), self.assertRaises(SystemExit):
                main([])

    def test_missing_required_plugin_context(self):
        for plugin_id in PLUGINS:
            resolve_plugin(plugin_id).validate(LaunchContext())
        with self.assertRaisesRegex(ValueError, "pays"):
            resolve_plugin("vob_editor").validate(LaunchContext("2027", paths={"ETC": self.root}))
        with self.assertRaisesRegex(ValueError, "dossier"):
            resolve_plugin("vob_editor").validate(LaunchContext("2026"))

    def test_plugin_process_receives_context_and_plugin_options_as_list(self):
        initial = self.root / "Règles & choix.fra"
        initial.write_bytes(b"#1#2#3#4#A")
        with patch("application.core.launching.resolve_context", return_value=self.context), patch(
            "application.core.launching.subprocess.Popen",
        ) as popen:
            launch_plugin("vob_editor", self.context, {"initial_path": initial})
        command = popen.call_args.args[0]
        self.assertIsInstance(command, list)
        self.assertFalse(popen.call_args.kwargs["shell"])
        self.assertEqual(popen.call_args.kwargs["cwd"], str(ROOT))
        parsed = create_parser().parse_args(command[len(launcher_command()):])
        self.assertEqual(context_from_arguments(parsed), self.context)
        self.assertEqual(parsed.initial_path, initial)

    def test_each_app_can_launch_another_without_interface_imports(self):
        from application.core.runtime import create_app, PluginServices
        for plugin in PLUGINS.values():
            app = create_app(plugin, self.root / plugin.id, LaunchContext(), {}, PluginServices())
            try:
                app._set_launch_context(self.context)
                with patch("application.core.launching.launch_plugin") as launch:
                    app._launch_plugin("information_manager")
                launch.assert_called_once_with("information_manager", self.context, None)
            finally:
                if hasattr(app, "_close"):
                    app._close()

    def test_missing_resource_launcher_interpreter_and_process_failure(self):
        with self.assertRaises(FileNotFoundError):
            launcher_command(self.root / "missing.exe")
        with self.assertRaises(FileNotFoundError):
            launcher_command(ROOT / "launcher.py", self.root / "missing-python.exe")
        with patch("application.core.catalog.Plugin.availability", return_value="missing"), self.assertRaises(FileNotFoundError):
            launch_plugin("information_manager", LaunchContext())
        with patch("application.core.launching.subprocess.Popen", side_effect=OSError("failed")):
            with self.assertRaises(OSError):
                launch_plugin("information_manager", LaunchContext())

    def test_detection_failure_is_not_a_successful_context(self):
        for stdout, returncode in (("broken", 1), ('{"ok": false, "error": "missing"}', 1)):
            with patch("application.core.launching.subprocess.run", return_value=SimpleNamespace(
                stdout=stdout, returncode=returncode,
            )), self.assertRaises(ValueError):
                inspect_context(self.context)
        with patch("application.core.launching.subprocess.run", side_effect=subprocess.TimeoutExpired("worker", 1)):
            with self.assertRaises(subprocess.TimeoutExpired):
                resolve_context(self.context)

    def test_ambiguous_other_versions_are_not_chosen_arbitrarily(self):
        from application.plugins.vob_editor.discovery import detect_allplan_versions
        payload = {
            "ok": True, "data": {
                "installations": [
                    AllplanPaths("2027", "FRA", False).to_dict(),
                    AllplanPaths("2027", "FRA", True).to_dict(),
                ], "diagnostics": [],
            },
        }
        import json
        with patch("application.plugins.vob_editor.discovery.subprocess.run", return_value=SimpleNamespace(
            returncode=0, stdout=json.dumps(payload),
        )), contextlib.redirect_stderr(io.StringIO()) as diagnostics:
            versions = detect_allplan_versions(create_parser().parse_args([]), AllplanPaths("2026"))
        self.assertEqual(versions, {})
        self.assertIn("plusieurs installations", diagnostics.getvalue())

    def test_selector_preserves_context_and_clears_paths_when_installation_changes(self):
        api = SelectorApi(self.context)
        with patch("application.launcher.selector.launch_plugin") as launch:
            self.assertTrue(api.launch("vob_editor", "2026", True, "Fra")["ok"])
            self.assertEqual(launch.call_args.args[1], self.context)
            api.launch("smartcatalog", "2027", False, "")
            self.assertEqual(launch.call_args.args[1].paths, {})
            self.assertIsNone(launch.call_args.args[1].country)
        with patch("application.launcher.selector.launch_plugin", side_effect=ValueError("missing")):
            self.assertEqual(api.launch("vob_editor", "", False, ""),
                             {"ok": False, "error": "missing"})

    def test_selector_contains_only_real_catalog_entries_and_no_default_installation(self):
        webview = Mock()
        webview.settings = {}
        with patch.dict(sys.modules, {"webview": webview}), patch(
            "application.launcher.selector.discover_installations", return_value=([
                {"version": "2026", "verification_version": False},
                {"version": "2026", "verification_version": True},
            ], []),
        ):
            show_selector(LaunchContext())
        html = webview.create_window.call_args.kwargs["html"]
        self.assertEqual(html.count("data-plugin="), 3)
        self.assertIn("2026:0", html)
        self.assertIn("2026:1", html)
        self.assertNotIn("selected", html)
        self.assertNotIn("attribute_manager", html)
        self.assertIn('id="year" value=""', html)

    def test_inventory_failure_remains_visible(self):
        with patch("application.launcher.selector.subprocess.run", side_effect=OSError("denied")):
            items, diagnostics = discover_installations(1)
        self.assertEqual(items, [])
        self.assertTrue(diagnostics)

    def test_information_manager_url_and_host_only_context(self):
        from application.plugins.information_manager.application import InformationManagerApp
        from application.core.catalog import resolve_url
        plugin = PLUGINS["information_manager"]
        self.assertEqual(plugin.url, "https://allplan-tools.lovable.app/information-manager")
        self.assertIs(resolve_url(plugin.url), plugin)
        with self.assertRaises(ValueError):
            resolve_url("https://flexi-meta.lovable.app/")
        app = InformationManagerApp(self.root)
        app._set_launch_context(self.context)
        self.assertNotIn("allplan", app.get_initial_data())


class AllplanAdapterTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.settings = SimpleNamespace(
            AllplanVersion=SimpleNamespace(MainReleaseName=lambda: "2026"),
            AllplanPaths=SimpleNamespace(**{
                name: lambda: str(self.root / "Projet été")
                for name in ("GetEtcPath", "GetPrgPath", "GetStdPath", "GetUsrPath",
                             "GetTmpPath", "GetCurPrjPath")
            }),
        )

    def test_allplan_context_uses_documented_apis_not_current_project_as_prj_root(self):
        context, diagnostics = context_from_allplan(self.settings, verification_version=True)
        self.assertEqual(diagnostics, [])
        self.assertEqual(context.allplan_version, "2026")
        self.assertTrue(context.verification_version)
        self.assertEqual(context.origin, "allplan")
        self.assertNotIn("PRJ", context.paths)
        self.assertEqual(context.project_path, self.root / "Projet été")

    def test_unknown_installation_type_requires_explicit_choice(self):
        with self.assertRaisesRegex(ValueError, "choisir"):
            context_from_allplan(self.settings, verification_version=None)

    def test_missing_path_warns_missing_version_fails(self):
        self.settings.AllplanPaths.GetEtcPath = lambda: ""
        context, diagnostics = context_from_allplan(self.settings, verification_version=False)
        self.assertNotIn("ETC", context.paths)
        self.assertTrue(diagnostics)
        self.settings.AllplanVersion.MainReleaseName = lambda: ""
        with self.assertRaises(ValueError):
            context_from_allplan(self.settings, verification_version=False)

    def test_missing_registered_launcher_is_reported(self):
        with patch.dict("os.environ", {"LOCALAPPDATA": str(self.root)}):
            with self.assertRaisesRegex(FileNotFoundError, "premiere fois"):
                launch_from_allplan(self.settings, verification_version=False)

    def test_allplan_launch_arguments_do_not_use_allplan_executable(self):
        with patch("application.core.launching.subprocess.Popen") as popen, patch(
            "application.core.launcher_location.registered_command",
            return_value=([sys.executable, "-m", "application"], ROOT),
        ):
            launch_from_allplan(
                self.settings, verification_version=True,
            )
        command = popen.call_args.args[0]
        parsed = create_parser().parse_args(command[3:])
        context, _ = context_from_allplan(self.settings, verification_version=True)
        self.assertEqual(context_from_arguments(parsed), context)
        self.assertIsNone(parsed.app_id)
        self.assertFalse(popen.call_args.kwargs["shell"])

    def test_pythonpart_event_and_pyp_with_mocked_allplan(self):
        directory = ROOT / "application" / "launcher" / "allplan_entry"
        pyp = ElementTree.parse(directory / "AllplanWebLauncher.pyp")
        self.assertEqual(pyp.findtext(".//EventId"), "1001")
        spec = importlib.util.spec_from_file_location(
            "test_pythonpart_launcher", directory / "AllplanWebLauncher.py",
        )
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {
            "NemAll_Python_AllplanSettings": self.settings,
            "CreateElementResult": SimpleNamespace(CreateElementResult=lambda elements: elements),
        }):
            spec.loader.exec_module(module)
        self.assertEqual(module.create_element(None, None), [])
        build = SimpleNamespace(
            InstallationType=SimpleNamespace(value="Standard"),
        )
        launch = Mock(return_value=[])
        with patch.dict(module.__dict__, {"launch_from_allplan": launch}):
            self.assertFalse(module.on_control_event(build, 1001, None))
            self.assertFalse(launch.call_args.kwargs["verification_version"])
        message = Mock()
        native = SimpleNamespace(windll=SimpleNamespace(user32=SimpleNamespace(MessageBoxW=message)))
        with patch.dict(module.__dict__, {
            "launch_from_allplan": Mock(side_effect=FileNotFoundError("absent")),
            "ctypes": native,
        }):
            module.on_control_event(build, 1001, None)
            self.assertIn("absent", message.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
