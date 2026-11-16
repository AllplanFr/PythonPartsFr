import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from application.core.context import LaunchContext
from application.core.catalog import read_manifest
from application.core.launching import validate_resources


RUNTIME = Path(__file__).resolve().parents[1] / "allplan_tools" / "runtime"


def load_runtime(name, config):
    spec = importlib.util.spec_from_file_location("test_tools_" + name, RUNTIME / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    with patch.object(Path, "read_text", return_value=json.dumps(config)), \
            patch.object(sys, "path", list(sys.path)), patch.dict(os.environ):
        spec.loader.exec_module(module)
    return module


class ToolsRuntimeTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.config = {
            "pythonRoot": str(root / "python"),
            "profile": str(root / "profile"),
            "homeDirectory": str(root / "home"),
            "pinnedCandidate": str(root / "candidate"),
            "pythonExecutable": sys.executable,
            "vobEntrypoint": str(root / "vob_launcher.py"),
        }
        self.host = load_runtime("home_host", self.config)
        self.runner = load_runtime("runner", self.config)
        self.context = LaunchContext(allplan_version="2026", country="FRA", origin="allplan")
        self.selector = Mock()
        self.selector.launch.return_value = {"ok": True}
        self.plugins = {
            plugin_id: SimpleNamespace(
                id=plugin_id, name=plugin_id, description="Test plugin",
                version=None, lifecycle="ready", availability=Mock(return_value=None),
            )
            for plugin_id in ("smartcatalog", "vob_editor", "information_manager")
        }
        services = patch.object(
            self.host, "_services",
            return_value=(Mock(return_value=self.selector), self.plugins),
        )
        services.start()
        self.addCleanup(services.stop)
        self.api = self.host.HomeApi(self.context)
        self.host._services.reset_mock()

    def run_target(self, target):
        logging_setup = SimpleNamespace(configure_logging=Mock(), set_diagnostic=Mock())
        with patch.dict(sys.modules, {
            "home_host": self.host, "application.core.logging_setup": logging_setup,
        }), patch.dict(os.environ, {"LOCALAPPDATA": self.config["profile"]}), \
                patch.object(sys, "path", list(sys.path)), \
                patch.object(sys, "argv", [
                    "runner.py", "--target", target, "--origin", "allplan",
                    "--allplan-version", "2026", "--country", "FRA",
                ]):
            self.runner.main()

    def test_home_opens_without_aim_preflight_and_acknowledges_only_when_shown(self):
        with patch.object(self.host, "_verify_aim", side_effect=ValueError("AIM mismatch")) as aim, \
                patch.object(self.host, "show_home") as show, \
                patch.object(self.runner, "report_startup") as report:
            self.run_target("home")
            aim.assert_not_called()
            self.selector.launch.assert_not_called()
            report.assert_not_called()
            args = show.call_args
            self.assertEqual(args.args, (
                self.context, self.host.HOME_DIRECTORY, self.host.HOME_REVISION,
            ))
            args.kwargs["on_started"]()
            report.assert_called_once_with("accepted")
            self.host._services.assert_called_once()

    def test_home_keeps_work_copy_check(self):
        self.host._services.side_effect = ValueError("work copy mismatch")
        with patch.object(self.host, "show_home") as show, \
                patch.object(self.runner, "report_startup") as report:
            with self.assertRaisesRegex(ValueError, "work copy mismatch"):
                self.run_target("home")
            show.assert_not_called()
            report.assert_not_called()

    def test_close_home_requires_bound_window_and_reports_only_request(self):
        with self.assertLogs(self.host.LOGGER, level="ERROR"):
            reply = self.api.close_home()
        self.assertFalse(reply["ok"])
        self.assertIn("associee", reply["error"])
        window = Mock()
        self.api._home_window = window
        self.assertEqual(self.api.close_home(), {"ok": True, "status": "requested"})
        window.destroy.assert_called_once_with()
        self.selector.launch.assert_not_called()

    def test_close_home_failure_is_explicit(self):
        window = Mock()
        window.destroy.side_effect = RuntimeError("native close refused")
        self.api._home_window = window
        with self.assertLogs(self.host.LOGGER, level="ERROR"):
            reply = self.api.close_home()
        self.assertFalse(reply["ok"])
        self.assertIn("native close refused", reply["error"])
        window.destroy.assert_called_once_with()
        self.selector.launch.assert_not_called()

    def test_home_resource_failure_is_not_acknowledged(self):
        with patch.object(self.host, "show_home", side_effect=ValueError("home integrity mismatch")), \
                patch.object(self.runner, "report_startup") as report:
            with self.assertRaisesRegex(ValueError, "home integrity mismatch"):
                self.run_target("home")
            report.assert_not_called()

    def test_aim_preflight_failure_blocks_only_aim_and_releases_launch_guard(self):
        with patch.object(self.host, "_verify_aim", side_effect=ValueError("descriptor mismatch")) as aim, \
                patch.object(self.api, "_launch_vob") as vob, \
                self.assertLogs(self.host.LOGGER, level="ERROR"):
            reply = self.api.launch("information_manager", "2026", False, "FRA")
        self.assertFalse(reply["ok"])
        self.assertIn("descriptor mismatch", reply["error"])
        aim.assert_called_once_with()
        self.selector.launch.assert_not_called()
        vob.assert_not_called()
        with patch.object(self.host, "_verify_aim", side_effect=AssertionError("unexpected AIM check")), \
                patch.object(self.api, "_launch_vob") as vob:
            self.assertEqual(self.api.launch("smartcatalog", "2026", False, "FRA"), {"ok": True})
            self.assertEqual(self.api.launch("vob_editor", "2026", False, "FRA"), {"ok": True})
            vob.assert_called_once_with()
        self.selector.launch.assert_called_once_with("smartcatalog", "2026", False, "FRA")

    def test_aim_preflight_still_precedes_process_creation(self):
        order = Mock()
        order.attach_mock(self.selector.launch, "launch")
        with patch.object(self.host, "_verify_aim") as aim:
            order.attach_mock(aim, "preflight")
            self.assertEqual(self.api.launch("information_manager", "2026", False, "FRA"), {"ok": True})
        self.assertEqual([call[0] for call in order.mock_calls], ["preflight", "launch"])

    def test_aim_preflight_timeout_does_not_launch(self):
        with patch.object(self.host, "_verify_aim", side_effect=subprocess.TimeoutExpired("aim", 60)), \
                self.assertLogs(self.host.LOGGER, level="ERROR"):
            self.assertFalse(self.api.launch("information_manager", "2026", False, "FRA")["ok"])
        self.selector.launch.assert_not_called()

    def test_success_reply_preserves_contract_and_diagnostic_does_not_claim_ready(self):
        for plugin_id in self.plugins:
            with self.subTest(plugin_id=plugin_id), \
                    patch.object(self.host, "_verify_aim"), \
                    patch.object(self.api, "_launch_vob"), \
                    self.assertLogs(self.host.LOGGER, level="INFO") as logs:
                self.assertEqual(self.api.launch(plugin_id, "2026", False, "FRA"), {"ok": True})
            self.assertIn("process created; window readiness not confirmed", "\n".join(logs.output))

    def test_launch_failure_keeps_error_and_no_acceptance_diagnostic(self):
        self.selector.launch.return_value = {"ok": False, "error": "initialization refused"}
        with patch.object(self.host, "LOGGER") as logger:
            reply = self.api.launch("smartcatalog", "2026", False, "FRA")
        self.assertFalse(reply["ok"])
        self.assertIn("initialization refused", reply["error"])
        logger.info.assert_not_called()

    def test_unavailable_plugin_still_cannot_launch(self):
        self.plugins["smartcatalog"].availability.return_value = "Missing resource"
        with self.assertLogs(self.host.LOGGER, level="WARNING"):
            reply = self.api.launch("smartcatalog", "2026", False, "FRA")
        self.assertFalse(reply["ok"])
        self.assertIn("Missing resource", reply["error"])
        self.selector.launch.assert_not_called()

    def test_context_change_still_cannot_launch(self):
        with self.assertLogs(self.host.LOGGER, level="WARNING"):
            reply = self.api.launch("smartcatalog", "2025", False, "FRA")
        self.assertFalse(reply["ok"])
        self.selector.launch.assert_not_called()

    def test_direct_aim_failure_does_not_report_process_accepted(self):
        with patch.object(self.host, "_verify_aim", side_effect=ValueError("descriptor mismatch")), \
                patch.object(self.runner, "report_startup") as report, \
                self.assertLogs(self.host.LOGGER, level="ERROR"):
            with self.assertRaisesRegex(RuntimeError, "descriptor mismatch"):
                self.run_target("information_manager")
        report.assert_not_called()
        self.selector.launch.assert_not_called()

    def test_direct_smartcatalog_reports_process_acceptance_not_readiness(self):
        with patch.object(self.host, "_verify_aim", side_effect=AssertionError("unexpected AIM check")), \
                patch.object(self.runner, "report_startup") as report, \
                self.assertLogs(level="INFO") as logs:
            self.run_target("smartcatalog")
        self.selector.launch.assert_called_once_with("smartcatalog", "2026", False, "FRA")
        report.assert_called_once_with("accepted")
        self.assertIn("fenetre non confirmee", "\n".join(logs.output))

    def test_inventory_accepts_zero_one_or_more_than_three_local_plugins(self):
        extra = SimpleNamespace(
            id="local_tool", name="Local tool", description="Local test",
            version="1.2.3", lifecycle="ready", availability=Mock(return_value=None),
        )
        for plugins in ({}, {"local_tool": extra}, {**self.plugins, "local_tool": extra}):
            with self.subTest(count=len(plugins)):
                self.api._plugins = plugins
                info = self.api.get_home_info()
                self.assertEqual(info["home_launch_contract"], 1)
                self.assertEqual(info["plugin_inventory_contract"], 1)
                self.assertEqual([item["id"] for item in info["plugins"]], list(plugins))
        item = self.api.get_home_info()["plugins"][-1]
        self.assertEqual(item, {
            "id": "local_tool", "name": "Local tool", "description": "Local test",
            "installedVersion": "1.2.3", "lifecycle": "ready", "launchable": True,
            "available": True, "reason": None, "reasonCode": None,
            "iconUrl": "/plugin-icons/local_tool.png",
        })
        self.assertEqual(self.api.launch("local_tool", "2026", False, "FRA"), {"ok": True})
        self.selector.launch.assert_called_once_with("local_tool", "2026", False, "FRA")

    def test_construction_and_missing_resource_have_different_reasons(self):
        plugin = self.plugins["smartcatalog"]
        plugin.lifecycle = "construction"
        item = self.api.get_home_info()["plugins"][0]
        self.assertFalse(item["launchable"])
        self.assertFalse(item["available"])
        self.assertEqual(item["reasonCode"], "construction")
        with patch.object(self.host, "_verify_aim") as aim, \
                self.assertLogs(self.host.LOGGER, level="WARNING"):
            self.assertFalse(self.api.launch("smartcatalog", "2026", False, "FRA")["ok"])
        aim.assert_not_called()
        self.selector.launch.assert_not_called()
        plugin.lifecycle = "ready"
        plugin.availability.return_value = "Missing script"
        item = self.api.get_home_info()["plugins"][0]
        self.assertEqual(item["reasonCode"], "unavailable")
        self.assertEqual(item["reason"], "Missing script")
        self.assertIsNone(item["installedVersion"])

    def test_unknown_id_or_command_is_never_executed(self):
        for value in ("unknown", r"C:\tool.exe", "smartcatalog --other", "", None, [], {}):
            with self.subTest(value=value), self.assertLogs(self.host.LOGGER, level="WARNING"):
                self.assertFalse(self.api.launch(value, "2026", False, "FRA")["ok"])
                self.assertEqual(self.api.update(value)["error"]["code"],
                                 "unknown_plugin" if type(value) is str else "invalid_arguments")
        self.selector.launch.assert_not_called()

    def test_catalog_disabled_update_never_opens_or_fetches_and_launch_still_works(self):
        with patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")), \
                patch("webbrowser.open", side_effect=AssertionError("browser forbidden")), \
                patch.object(subprocess, "Popen", side_effect=AssertionError("process forbidden")):
            data = self.api.get_catalog()["data"]
            self.assertEqual(data["schema"], "allplan-tools-catalog/2")
            self.assertEqual(data["status"], "not_configured")
            self.assertEqual(data["source"], "none")
            self.assertEqual(len(data["entries"]), 3)
            self.assertTrue(all(not p["canUpdate"] for p in data["entries"]))
            self.assertEqual(self.api.update("smartcatalog"), {"ok": False, "error": {
                "code": "update_not_available", "message": "Aucune proposition active.",
                "reason": "catalog_not_configured",
            }})
            self.assertEqual(self.api.launch("smartcatalog", "2026", False, "FRA"), {"ok": True})

    def test_update_does_not_accept_a_caller_supplied_url(self):
        with self.assertRaises(TypeError):
            self.api.update("smartcatalog", "https://example.com")

    def test_production_catalog_activation_is_explicit_and_launch_is_independent(self):
        target = "application.core.plugin_catalog_remote.RemoteCatalogLoader"
        for enabled in (None, False, True):
            self.host.CONFIG.pop("productionCatalogEnabled", None)
            if enabled is not None:
                self.host.CONFIG["productionCatalogEnabled"] = enabled
            with self.subTest(enabled=enabled), patch(target) as factory:
                factory.return_value.return_value = {
                    "schema": "allplan-tools-release-catalog/1", "plugins": [],
                }
                api = self.host.HomeApi(self.context)
                self.assertTrue(api.launch("smartcatalog", "2026", False, "FRA")["ok"])
                factory.return_value.assert_not_called()
                data = api.get_catalog()["data"]
                if enabled is True:
                    factory.assert_called_once_with(self.config["pythonExecutable"])
                    factory.return_value.assert_called_once_with(timeout=3.0)
                    self.assertEqual((data["status"], data["source"]), ("available", "remote"))
                    self.assertEqual(api._catalog._hosts, frozenset())
                    self.assertIsNone(api._catalog._open)
                else:
                    factory.assert_not_called()
                    self.assertEqual(data["status"], "not_configured")
                self.assertFalse(api.update("smartcatalog")["ok"])

    def test_invalid_catalog_configuration_is_explicit_and_does_not_block_launch(self):
        for invalid in (None, 0, 1, "true", [], {}):
            self.host.CONFIG["productionCatalogEnabled"] = invalid
            with self.subTest(invalid=invalid), \
                    patch("application.core.plugin_catalog_remote.RemoteCatalogLoader") as factory, \
                    self.assertLogs(self.host.LOGGER, level="ERROR"):
                api = self.host.HomeApi(self.context)
                reply = api.get_catalog()
                self.assertEqual(reply["error"]["code"], "catalog_internal_error")
                self.assertIn("productionCatalogEnabled", reply["error"]["message"])
                self.assertTrue(api.launch("smartcatalog", "2026", False, "FRA")["ok"])
                self.assertFalse(api.update("smartcatalog")["ok"])
                factory.assert_not_called()
        self.host.CONFIG["productionCatalogEnabled"] = True
        self.host.CONFIG["pythonExecutable"] = r"C:\missing\python.exe"
        with self.assertLogs(self.host.LOGGER, level="ERROR"):
            api = self.host.HomeApi(self.context)
        self.assertIn("interpreteur", api.get_catalog()["error"]["message"])
        self.assertTrue(api.launch("smartcatalog", "2026", False, "FRA")["ok"])

    def test_catalog_internal_errors_are_explicit_and_never_block_launch(self):
        with patch.object(self.api._catalog, "get_catalog", side_effect=ValueError("simulated")), \
                patch.object(self.api._catalog, "update", side_effect=ValueError("simulated")), \
                self.assertLogs(self.host.LOGGER, level="ERROR"):
            self.assertEqual(self.api.get_catalog()["error"]["code"], "catalog_internal_error")
            self.assertEqual(self.api.update("smartcatalog")["error"]["code"], "catalog_internal_error")
        self.assertTrue(self.api.launch("smartcatalog", "2026", False, "FRA")["ok"])

    def test_unknown_runner_target_is_rejected_without_launch(self):
        with patch.object(self.runner, "report_startup") as report, \
                self.assertLogs(self.host.LOGGER, level="WARNING"):
            with self.assertRaisesRegex(RuntimeError, "Arguments de lancement invalides"):
                self.run_target("not_installed")
        report.assert_not_called()
        self.selector.launch.assert_not_called()

    def test_existing_local_routes_and_dynamic_icons_only(self):
        import bottle
        import io
        from wsgiref.util import setup_testing_defaults

        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "index.html").write_bytes(b"<html>local home</html>")
            (root / "entry.js").write_bytes(b"// local test")
            (root / "home-manifest.json").write_text(json.dumps({
                "files": {"index.html": "test", "entry.js": "test"},
            }), encoding="utf-8")
            icon = root / "icon.png"
            icon.write_bytes(b"test icon")
            extra = SimpleNamespace(
                id="local_tool", name="Local tool", description="Local",
                version=None, lifecycle="ready", availability=Mock(return_value=None),
            )
            self.plugins[extra.id] = extra
            webview = SimpleNamespace(settings={}, create_window=Mock(), start=Mock())
            icon_service = SimpleNamespace(icon_path=Mock(return_value=icon), bind_window_icon=Mock())
            with patch.dict(sys.modules, {
                "webview": webview, "application.core.plugin_icons": icon_service,
            }), patch.object(self.host, "verified_home", return_value=root / "index.html"):
                self.host.show_home(self.context, root, "test")
            app = webview.create_window.call_args.kwargs["url"]
            bound_api = webview.create_window.call_args.kwargs["js_api"]
            self.assertIs(bound_api._home_window, webview.create_window.return_value)
            self.assertIsInstance(app, bottle.Bottle)
            self.assertTrue(webview.start.call_args.kwargs["http_server"])
            self.assertFalse(webview.start.call_args.kwargs["private_mode"])
            self.assertEqual(webview.start.call_args.kwargs["storage_path"], str(
                self.host.PROFILE / "AllplanWebLauncher" / "home-test" / "profile",
            ))

            def request(path):
                environ = {}
                setup_testing_defaults(environ)
                environ.update(PATH_INFO=path, REQUEST_METHOD="GET", **{"wsgi.input": io.BytesIO()})
                status = []
                body = app(environ, lambda code, headers, exc_info=None: status.append(code))
                try:
                    data = b"".join(body)
                finally:
                    if hasattr(body, "close"):
                        body.close()
                return int(status[0].split()[0]), data

            self.assertEqual(request("/"), (200, b"<html>local home</html>"))
            self.assertEqual(request("/entry.js"), (200, b"// local test"))
            with patch.dict(sys.modules, {"application.core.plugin_icons": icon_service}):
                self.assertEqual(request("/plugin-icons/local_tool.png"), (200, b"test icon"))
            for path in ("/vob-editor", "/smartcatalog", "/information-manager",
                         "/plugin-icons/not_installed.png", "/unlisted.js"):
                self.assertEqual(request(path)[0], 404, path)


class PluginMetadataTests(unittest.TestCase):
    def test_source_and_overlay_metadata_defaults_validation_and_construction_guard(self):
        overlay = RUNTIME.parent / "overlay" / "python" / "application" / "core"
        for module_name in ("catalog", "launching"):
            spec = importlib.util.spec_from_file_location(
                "application.core.test_overlay_" + module_name, overlay / (module_name + ".py"),
            )
            module = importlib.util.module_from_spec(spec)
            with patch.dict(sys.modules, {
                spec.name: module,
                "application.core.test_process": SimpleNamespace(
                    console_options=Mock(), spawn_logged=Mock(),
                ),
            }):
                spec.loader.exec_module(module)
            if module_name == "catalog":
                overlay_read = module.read_manifest
            else:
                overlay_validate = module.validate_resources
        with TemporaryDirectory() as temporary:
            root = Path(temporary) / "local_tool"
            root.mkdir()
            path = root / "plugin.json"
            base = {
                "id": "local_tool", "name": "Local tool", "description": "Test",
                "entrypoint": "plugin:create_app", "url": "https://example.com/local",
                "script": "bridge.js",
            }
            for reader in (read_manifest, overlay_read):
                path.write_text(json.dumps(base), encoding="utf-8")
                plugin = reader(path)
                self.assertIsNone(plugin.version)
                self.assertEqual(plugin.lifecycle, "ready")
                for version in (None, "1.2.3", "non-semver-legacy"):
                    path.write_text(json.dumps({**base, "version": version, "lifecycle": "construction"}))
                    plugin = reader(path)
                    self.assertEqual(plugin.version, version)
                    for validator in (validate_resources, overlay_validate):
                        with self.assertRaisesRegex(ValueError, "en construction"):
                            validator(plugin)
                for fields in ({"version": ""}, {"version": 1}, {"version": False},
                               {"lifecycle": None}, {"lifecycle": "broken"}):
                    path.write_text(json.dumps({**base, **fields}), encoding="utf-8")
                    with self.subTest(fields=fields), self.assertRaises(ValueError):
                        reader(path)


if __name__ == "__main__":
    unittest.main()
