import ast
from dataclasses import replace
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
import zipfile

from application.core.catalog import PLUGINS, discover_plugins, read_manifest, resolve_url
from application.core.configuration import SettingsStore, default_settings_path
from application.core.context import LaunchContext
from application.core.launcher_location import register_launcher, registered_command
from application.core.messages import settings_language
from application.core.resources import PACKAGE_ROOT, resource_path
from application.launcher.selector import SelectorApi, show_selector
from application.launcher.main import entrypoint


class PluginArchitectureTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def manifest(self, plugin_id="example", **overrides):
        package = self.root / plugin_id
        package.mkdir(exist_ok=True)
        data = {
            "id": plugin_id, "name": "Example", "description": "Example plugin",
            "entrypoint": "plugin:create_app", "url": f"https://{plugin_id}.example.com/",
            "script": "resources\\bridge.js",
        }
        data.update(overrides)
        path = package / "plugin.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    def probe(self, root, code, *, isolated=False):
        command = [sys.executable]
        if isolated:
            command += ["-I", "-S"]
        return subprocess.run(
            command + ["-c", f"import sys; sys.path.insert(0, {str(root)!r});\n" + code],
            cwd=self.root, capture_output=True, text=True, encoding="utf-8",
            timeout=30,
        )

    def test_shipped_ids_are_unique_and_all_resources_available(self):
        self.assertEqual(set(PLUGINS), {"smartcatalog", "vob_editor", "information_manager"})
        catalog = discover_plugins()
        self.assertEqual(catalog.unavailable, [])
        for plugin in catalog.plugins.values():
            self.assertIsNone(plugin.availability(), plugin.id)
            self.assertTrue(resource_path(plugin.package_dir, plugin.script).is_file())

    def test_suite_routes_preserve_window_identity_and_exclude_home(self):
        base = "https://allplan-tools.lovable.app"
        self.assertEqual(PLUGINS["smartcatalog"].url, base + "/smartcatalog")
        self.assertEqual(PLUGINS["vob_editor"].url, base + "/vob-editor")
        self.assertEqual(
            PLUGINS["information_manager"].url,
            base + "/information-manager",
        )
        for app_id in ("smartcatalog", "vob_editor", "information_manager"):
            plugin = PLUGINS[app_id]
            self.assertIs(resolve_url(plugin.url), plugin)
            self.assertIs(resolve_url(plugin.url + "?lang=fr#editor"), plugin)
        for route in ("/", "/information-manager/", "/smartcatalog/", "/vob-editor/",
                      "/unknown", "/information-manager/extra"):
            with self.subTest(route=route), self.assertRaises(ValueError):
                resolve_url(base + route)
        for url in (
            "https://allplan-information-manager.lovable.app/",
            "https://allplan-smartcatalog-editor.lovable.app/smartcatalog",
            "https://allplan-smartcatalog-editor.lovable.app/vob-editor",
            "https://allplan-smartcatalog-editor.lovable.app/information-manager",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                resolve_url(url)

    def test_smartcatalog_opens_its_route_directly_without_changing_context(self):
        from application.launcher.main import main
        context = LaunchContext()
        with patch("application.launcher.main.resolve_context", return_value=context), \
                patch("application.launcher.main.run_app") as run:
            self.assertEqual(main(["smartcatalog"]), 0)
        plugin, received_context, _args = run.call_args.args
        self.assertIs(plugin, PLUGINS["smartcatalog"])
        self.assertIs(received_context, context)
        self.assertEqual(plugin.entrypoint, "plugin:create_app")
        self.assertTrue(plugin.url.endswith("/smartcatalog"))

    def test_discovery_never_imports_plugin_code_or_heavy_dependencies(self):
        result = self.probe(PACKAGE_ROOT.parent, """
from application.core.catalog import PLUGINS
assert len(PLUGINS) == 3
assert not any(n.startswith("application.plugins.") for n in sys.modules)
assert not any(n.startswith(("webview", "defusedxml", "clr", "pythonnet")) for n in sys.modules)
assert not any(n.startswith("application.core.allplan.readers") for n in sys.modules)
assert "jsonschema" not in sys.modules
assert "application.core.protocol_control" not in sys.modules
""", isolated=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_data_reader_modules_have_no_plugin_or_ui_imports(self):
        directory = PACKAGE_ROOT / "core" / "allplan"
        paths = [directory / name for name in ("models.py", "sources.py", "text.py")]
        paths.extend((directory / "readers").glob("*.py"))
        for path in paths:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    modules = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    modules = [node.module or ""]
                else:
                    continue
                self.assertFalse(any(module.startswith((
                    "application.plugins", "PyQt", "PySide", "webview",
                )) for module in modules), path.name)

    def test_new_declaration_is_discovered_without_a_central_list(self):
        path = self.manifest()
        (path.parent / "plugin.py").write_text("raise RuntimeError('must not execute')", encoding="utf-8")
        with patch("importlib.import_module", side_effect=AssertionError("unexpected import")):
            catalog = discover_plugins(self.root)
        self.assertEqual(set(catalog.plugins), {"example"})
        self.assertEqual(catalog.unavailable, [])

    def test_invalid_declaration_is_isolated_from_valid_plugin(self):
        self.manifest("valid")
        invalid = self.manifest("invalid")
        invalid.write_text("not JSON", encoding="utf-8")
        catalog = discover_plugins(self.root)
        self.assertEqual(set(catalog.plugins), {"valid"})
        self.assertEqual(len(catalog.unavailable), 1)
        self.assertTrue(catalog.unavailable[0].reason)

    def test_invalid_manifest_fields_and_resource_traversal(self):
        variants = [
            {"id": "wrong"}, {"entrypoint": "..os:system"}, {"url": "http://example.com"},
            {"script": "..\\outside.js"}, {"icon": str(self.root / "icon.png")},
            {"requires_version": "yes"}, {"required_paths": ["COUNTRY"]},
            {"path_options": {"help": "collision"}},
            {"path_options": {"country": "collision"}},
            {"path_options": {"installation_id": "removed"}},
            {"path_options": {"diagnostic": "collision"}},
            {"path_options": {"allplan_language": "collision"}},
            {"path_options": {"protocol_control_test": "collision"}},
            {"settings_rules": {"field": {"min": True, "max": 10}}},
            {"language_paths": [42]}, {"required_resources": ["..\\outside.py"]},
            {"unknown": True},
        ]
        for variant in variants:
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                read_manifest(self.manifest(**variant))

    def test_duplicate_ids_and_urls_are_rejected(self):
        first = self.manifest("first")
        self.manifest("second", url="https://first.example.com/")
        catalog = discover_plugins(self.root)
        self.assertEqual(set(catalog.plugins), {"first"})
        self.assertEqual(len(catalog.unavailable), 1)
        plugin = read_manifest(first)
        with patch("application.core.catalog.read_manifest", return_value=plugin):
            catalog = discover_plugins(self.root)
        self.assertEqual(catalog.plugins, {})
        self.assertIn("duplique", catalog.unavailable[0].reason)

    def test_missing_resources_disable_only_the_affected_plugin(self):
        unavailable = replace(PLUGINS["smartcatalog"], package_dir=self.root)
        self.assertIsNotNone(unavailable.availability())
        self.assertIsNone(PLUGINS["information_manager"].availability())
        with patch("application.core.catalog.resource_path", side_effect=PermissionError("denied")):
            self.assertIn("inaccessibles", unavailable.availability())

    def test_selector_displays_disabled_card_and_keeps_other_plugins_available(self):
        webview = Mock()
        webview.settings = {}
        plugins = {**PLUGINS, "smartcatalog": replace(PLUGINS["smartcatalog"], package_dir=self.root)}
        with patch.dict(sys.modules, {"webview": webview}), patch(
            "application.launcher.selector.PLUGINS", plugins,
        ), patch("application.launcher.selector.discover_installations", return_value=([], [])):
            show_selector(LaunchContext())
        html = webview.create_window.call_args.kwargs["html"]
        self.assertIn('data-plugin="smartcatalog" disabled', html)
        self.assertIn('data-plugin="information_manager">Ouvrir', html)
        self.assertIn(PLUGINS["vob_editor"].description, html)

    def test_failed_plugin_does_not_prevent_the_next_launch(self):
        with patch(
            "application.launcher.selector.launch_plugin",
            side_effect=[ImportError("missing dependency"), Mock()],
        ):
            api = SelectorApi(LaunchContext())
            failed = api.launch("smartcatalog", "", False, "")
            self.assertFalse(failed["ok"])
            self.assertIn("autres applications", failed["error"])
            self.assertTrue(api.launch("information_manager", "", False, "")["ok"])

    def test_resources_work_from_another_cwd_with_accents_and_spaces(self):
        directory = self.root / "Projet été & espaces"
        directory.mkdir()
        (directory / "bridge.js").write_text("available", encoding="utf-8")
        self.assertEqual(resource_path(directory, "bridge.js").read_text(), "available")
        result = self.probe(PACKAGE_ROOT.parent, """
from application.core.catalog import PLUGINS
from application.core.resources import resource_path
assert all(resource_path(p.package_dir, p.script).is_file() for p in PLUGINS.values())
""")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_common_modules_do_not_import_concrete_plugins(self):
        for path in (PACKAGE_ROOT / "core").rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Import):
                    names = [item.name for item in node.names]
                elif isinstance(node, ast.ImportFrom):
                    names = [node.module or ""]
                self.assertFalse(any(name.startswith("application.plugins.") for name in names), path)

    def test_modules_import_in_reverse_order_without_cycles_or_app_startup(self):
        result = self.probe(PACKAGE_ROOT.parent, """
import importlib
from pathlib import Path
root = Path(sys.path[0]) / "application"
names = sorted(
    ("application." + ".".join(p.relative_to(root).with_suffix("").parts))
    for p in root.rglob("*.py")
    if p.name not in ("__main__.py", "__init__.py", "AllplanWebLauncher.py")
)
for name in reversed(names):
    importlib.import_module(name)
assert "webview" not in sys.modules
""")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_allplan_adapter_uses_only_standard_library_and_compatible_syntax(self):
        result = self.probe(PACKAGE_ROOT.parent, """
import ast
from pathlib import Path
import application.core.allplan.adapter
assert not any(n.startswith(("webview", "defusedxml", "clr", "pythonnet")) for n in sys.modules)
root = Path(sys.path[0])
for name, module in tuple(sys.modules.items()):
    if name.startswith("application") and getattr(module, "__file__", None):
        ast.parse(Path(module.__file__).read_text(encoding="utf-8"), feature_version=(3, 8))
""", isolated=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_settings_location_and_existing_data_are_preserved(self):
        with patch.dict(os.environ, {"APPDATA": str(self.root)}):
            with patch.dict(os.environ):
                os.environ.pop("ALLPLAN_SMARTCATALOG_SETTINGS_DIR", None)
                path = default_settings_path()
        self.assertEqual(path, self.root / "Allplan" / "SmartCatalog" / "settings.json")
        path.parent.mkdir(parents=True)
        document = {"version": 1, "general": {"lang": "de"}, "custom": {"keep": "yes"}}
        path.write_text(json.dumps(document), encoding="utf-8")
        before = path.read_bytes()
        store = SettingsStore(path)
        self.assertEqual(store.load("vob_editor"), document)
        self.assertEqual(path.read_bytes(), before)
        store.save("smartcatalog", {"version": 1, "toolbars": {"visible": True}})
        self.assertEqual(store.load("vob_editor")["custom"], document["custom"])

    def test_language_precedence_is_unchanged(self):
        settings = {"vobEditor": {"lang": "fr"}, "app": {"lang": "de"}, "general": {"lang": "en"}}
        self.assertEqual(settings_language(settings), "fr")
        self.assertEqual(settings_language({**settings, "lang": "it"}), "it")

    def test_automatic_launcher_location_round_trip_and_missing_resources(self):
        with patch.dict(os.environ, {"LOCALAPPDATA": str(self.root)}):
            register_launcher()
            command, directory = registered_command()
            self.assertEqual(command, [sys.executable, "-m", "application"])
            self.assertEqual(directory, PACKAGE_ROOT.parent)
            target = self.root / "AllplanWebLauncher" / "launcher.json"
            payload = json.loads(target.read_text(encoding="utf-8"))
            payload["python_executable"] = str(self.root / "missing.exe")
            target.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "raccourci"):
                registered_command()
            self.assertEqual(list(target.parent.glob(".launcher-*.tmp")), [])

    def test_gui_startup_failure_has_an_actionable_notification(self):
        with patch("sys.argv", ["allplan-launcher.exe", "unknown"]), patch(
            "application.core.logging_setup.configure_logging",
        ), patch("application.core.launcher_location.register_launcher"), patch(
            "application.launcher.main.notify_launch_error",
        ) as notify:
            self.assertEqual(entrypoint(), 2)
        self.assertIn("Application inconnue", notify.call_args.args[0])

    @unittest.skipUnless(os.environ.get("ALLPLAN_LAUNCHER_TEST_WHEEL"), "wheel path not supplied")
    def test_built_wheel_contains_resources_and_supports_isolated_discovery(self):
        wheel = Path(os.environ["ALLPLAN_LAUNCHER_TEST_WHEEL"])
        destination = self.root / "Installation été"
        with zipfile.ZipFile(wheel) as archive:
            names = set(archive.namelist())
            for plugin in PLUGINS.values():
                prefix = f"application/plugins/{plugin.id}/"
                self.assertIn(prefix + "plugin.json", names)
                self.assertIn(prefix + "plugin.py", names)
                self.assertIn(prefix + plugin.script.replace("\\", "/"), names)
            for name in (
                "application/core/resources/messages.json",
                "application/core/resources/bridge.js",
                "application/core/allplan/resources/paths.example.json",
                "application/core/allplan/readers/attributes.py",
                "application/core/allplan/readers/asw.py",
                "application/core/allplan/models.py",
                "application/core/allplan/sources.py",
                "application/core/allplan/text.py",
                "application/plugins/vob_editor/resources/messages.json",
                "application/launcher/resources/selector.html",
                "application/launcher/allplan_entry/AllplanWebLauncher.pyp",
                "application/launcher/allplan_entry/AllplanWebLauncher.py",
            ):
                self.assertIn(name, names)
            entry_name = next(n for n in names if n.endswith(".dist-info/entry_points.txt"))
            entries = archive.read(entry_name).decode()
            self.assertIn("[gui_scripts]", entries)
            self.assertIn("allplan-launcher = application.launcher.main:entrypoint", entries)
            self.assertIn("allplan-inspect = application.core.allplan.inspection:main", entries)
            archive.extractall(destination)
        result = self.probe(destination, """
from application.core.catalog import PLUGINS
from application.core.allplan.adapter import context_from_allplan
assert len(PLUGINS) == 3
assert all(p.availability() is None for p in PLUGINS.values())
assert not any(n.startswith("application.plugins.") for n in sys.modules)
""", isolated=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.probe(destination, """
from pathlib import Path
from application.core.allplan.readers import attributes, asw
from application.core.allplan import models, sources, text
assert all(Path(module.__file__).is_relative_to(Path(sys.path[0]))
           for module in (attributes, asw, models, sources, text))
""")
        self.assertEqual(result.returncode, 0, result.stderr)
