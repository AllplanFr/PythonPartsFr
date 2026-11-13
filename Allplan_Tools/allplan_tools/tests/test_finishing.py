import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / "runtime.json").read_text())
sys.path.insert(0, str(ROOT / "python"))
from application.core.context import LaunchContext
from application.core import launching
from application.core.origin_project import remember_origin
from application.core.configuration import SettingsStore
from application.core.test_process import console_options
from application.core.test_process import spawn_logged


class FinishingTests(unittest.TestCase):
    def test_hidden_real_child_has_no_console_and_output(self):
        result = subprocess.run(
            [sys.executable, "-c", "import ctypes; print(ctypes.windll.kernel32.GetConsoleWindow())"],
            capture_output=True, text=True, **console_options(),
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "0")

    def test_diagnostic_console_is_explicit(self):
        with patch.dict(os.environ, {"ALLPLAN_TOOLS_DIAGNOSTIC_CONSOLE": "1"}):
            self.assertEqual(console_options()["creationflags"], subprocess.CREATE_NEW_CONSOLE)

    def test_hidden_error_output_keeps_traceback(self):
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"LOCALAPPDATA": directory}):
            process = spawn_logged([sys.executable, "-c", "print('output',flush=True); raise ValueError('controlled failure')"])
            self.assertNotEqual(process.wait(timeout=10), 0)
            logs = list((Path(directory) / "AllplanWebLauncher/logs").glob("process-*.log"))
            self.assertEqual(len(logs), 1)
            text = logs[0].read_text()
            self.assertIn("output", text)
            self.assertIn("Traceback", text)
            self.assertIn("controlled failure", text)

    def test_inventory_preserves_metadata_history_and_favorites(self):
        with TemporaryDirectory() as temporary, patch.dict(os.environ, {"LOCALAPPDATA": temporary}):
            project = Path(temporary) / "Example.prj"
            project.mkdir()
            context = LaunchContext(allplan_version="2026", project_path=project, origin="allplan")
            data = Path(temporary) / "AllplanWebLauncher/information_manager/2026/standard/data"
            store = SettingsStore(data / "aim-settings.json")
            store.save("information_manager", {
                "version": 1, "aimProject": {"lastProject": str(project), "recentProjects": [str(project)]},
                "aimProjectManager": {"favorites": []},
            })
            remember_origin(context)
            remember_origin(context)
            document = store.load("information_manager")
            self.assertEqual(len(document["aimProjectManager"]["projects"]), 1)
            self.assertEqual(document["aimProjectManager"]["projects"][0]["projectInstallation"]["status"], "unknown")
            history = document["aimProject"]
            original = document["aimProjectManager"]["projects"][0]
            original["source"] = {"status": "resolved", "version": "2025", "verificationVersion": False, "reason": None}
            store.save("information_manager", {"version": 1, "aimProjectManager": {
                "projects": [original], "favorites": [str(project)],
            }})
            remember_origin(context)
            after = store.load("information_manager")
            self.assertEqual(after["aimProject"], history)
            self.assertEqual(after["aimProjectManager"]["projects"], [original])
            self.assertEqual(after["aimProjectManager"]["favorites"], [str(project)])

    def test_case_normalization_and_missing_project(self):
        with TemporaryDirectory() as temporary, patch.dict(os.environ, {"LOCALAPPDATA": temporary}):
            path = Path(temporary) / "Example.prj"
            path.mkdir()
            remember_origin(LaunchContext(origin="allplan", allplan_version="2026", project_path=path))
            remember_origin(LaunchContext(origin="allplan", allplan_version="2026", project_path=Path(str(path).upper())))
            remember_origin(LaunchContext(origin="allplan", allplan_version="2026"))
            remember_origin(LaunchContext(origin="allplan", allplan_version="2026", project_path=path.parent))
            store = SettingsStore(Path(temporary) / "AllplanWebLauncher/information_manager/2026/standard/data/aim-settings.json")
            self.assertEqual(len(store.load("information_manager")["aimProjectManager"]["projects"]), 1)

    def test_bad_store_logs_without_raising(self):
        with TemporaryDirectory() as temporary, patch.dict(os.environ, {"LOCALAPPDATA": temporary}):
            project = Path(temporary) / "Example.prj"
            project.mkdir()
            with patch("application.plugins.information_manager.project_manager.ProjectManager.entries", side_effect=ValueError("broken")), patch("application.core.origin_project.LOGGER") as log:
                remember_origin(LaunchContext(origin="allplan", allplan_version="2026", project_path=project))
                log.exception.assert_called_once()

    def test_launch_acceptance_only_and_shared_plugins(self):
        for plugin_id in ("smartcatalog", "vob_editor", "information_manager"):
            context = LaunchContext(origin="allplan")
            plugin = Mock(id=plugin_id, path_options={})
            process = Mock(pid=123)
            with patch.object(launching, "resolve_plugin", return_value=plugin), patch.object(launching, "validate_resources"), patch.object(launching, "resolve_context", side_effect=lambda c, **k:c), patch.object(launching, "spawn_logged", return_value=process) as spawn, patch("application.core.origin_project.remember_origin") as remember, patch("application.core.aim_instance.AimInstance") as lease:
                launching.launch_plugin(plugin_id, context)
                remember.assert_called_once()
                spawn.assert_called_once()
            with patch.object(launching, "resolve_plugin", return_value=plugin), patch.object(launching, "validate_resources", side_effect=ValueError("unavailable")), patch("application.core.origin_project.remember_origin") as remember:
                with self.assertRaises(ValueError):
                    launching.launch_plugin(plugin_id, context)
                remember.assert_not_called()
            with patch.object(launching, "resolve_plugin", return_value=plugin), patch.object(launching, "validate_resources"), patch.object(launching, "resolve_context", side_effect=lambda c, **k:c), patch.object(launching, "spawn_logged", side_effect=OSError("spawn refused")), patch("application.core.origin_project.remember_origin") as remember, patch("application.core.aim_instance.AimInstance"):
                with self.assertRaises(OSError):
                    launching.launch_plugin(plugin_id, context)
                remember.assert_not_called()

    def test_home_preflight_and_simultaneous_launch_guards(self):
        sys.path.insert(0, str(ROOT / "runtime"))
        import home_host
        selector = Mock()
        selector.launch.return_value = {"ok": True}
        plugins = {name: Mock() for name in home_host.PLUGIN_IDS}
        for plugin in plugins.values():
            plugin.availability.return_value = None
        with patch.object(home_host, "_services", return_value=(Mock(return_value=selector), plugins)), patch.object(home_host, "_verify_aim") as preflight:
            api = home_host.HomeApi(LaunchContext(origin="allplan", allplan_version="2026"))
            api._lock.acquire()
            try:
                self.assertFalse(api.launch("information_manager", "2026", False, "")["ok"])
            finally:
                api._lock.release()
            preflight.assert_not_called()
            selector.launch.assert_not_called()
            preflight.side_effect = ValueError("identity refused")
            with self.assertLogs(home_host.LOGGER, level="ERROR"):
                reply = api.launch("information_manager", "2026", False, "")
            self.assertFalse(reply["ok"])
            self.assertIn("Journal", reply["error"])
            selector.launch.assert_not_called()
            preflight.side_effect = None
            self.assertTrue(api.launch("information_manager", "2026", False, "")["ok"])
            selector.launch.assert_called_once_with("information_manager", "2026", False, "")
            selector.launch.reset_mock()
            plugins["smartcatalog"].availability.return_value = "Unavailable"
            with self.assertLogs(home_host.LOGGER, level="WARNING"):
                self.assertFalse(api.launch("smartcatalog", "2026", False, "")["ok"])
            selector.launch.assert_not_called()

    def test_work_identity_rejects_modified_file(self):
        from application.core.work_identity import verify_work_copy
        verify_work_copy()
        with patch("application.core.work_identity.hashlib.sha256", return_value=Mock(hexdigest=Mock(return_value="invalid"))):
            with self.assertRaisesRegex(ValueError, "Copie de travail modifiee"):
                verify_work_copy()

    def test_inspection_failure_keeps_output(self):
        result = SimpleNamespace(returncode=1, stdout="invalid output", stderr="Traceback: inspection failure")
        with patch.object(launching.subprocess, "run", return_value=result), self.assertLogs(launching.LOGGER, level="ERROR") as logged:
            with self.assertRaises(ValueError):
                launching.inspect_context(LaunchContext(origin="allplan"))
        self.assertIn(result.stdout, "\n".join(logged.output))
        self.assertIn(result.stderr, "\n".join(logged.output))

    def test_preflight_invalid_absent_or_timeout_refuses(self):
        sys.path.insert(0, str(ROOT / "runtime"))
        import home_host
        results = (
            SimpleNamespace(returncode=1, stdout="controlled failure"),
            SimpleNamespace(returncode=0, stdout=""),
            SimpleNamespace(returncode=0, stdout='{"status":"verified"}'),
        )
        with TemporaryDirectory() as directory, patch.object(home_host, "PROFILE", Path(directory)):
            for result in results:
                with patch.object(home_host.subprocess, "run", return_value=result):
                    with self.assertRaises(RuntimeError):
                        home_host._verify_aim()
            with patch.object(home_host.subprocess, "run", side_effect=subprocess.TimeoutExpired("preflight", 60)):
                with self.assertRaisesRegex(RuntimeError, "60 s"):
                    home_host._verify_aim()
            text = "\n".join(path.read_text() for path in Path(directory).rglob("*.log"))
            self.assertIn("controlled failure", text)
            self.assertIn("TimeoutExpired", text)

    def test_context_api_accepts_full_release(self):
        from application.core.allplan.adapter import context_from_allplan
        paths = {name: lambda: r"C:\Test" for name in ("GetEtcPath", "GetPrgPath", "GetStdPath", "GetUsrPath", "GetTmpPath", "GetCurPrjPath")}
        settings = SimpleNamespace(AllplanVersion=SimpleNamespace(MainReleaseName=lambda:"2026.1"), AllplanPaths=SimpleNamespace(**paths))
        context, _ = context_from_allplan(settings, verification_version=False)
        self.assertEqual(context.allplan_version, "2026")
        self.assertEqual(context.project_path, Path(r"C:\Test"))

    def test_wrappers_and_palette_references(self):
        result = SimpleNamespace(CreateElementResult=lambda items:items)
        with patch.dict(sys.modules, {"CreateElementResult": result}):
            sys.path.insert(0, str(ROOT / "pythonparts"))
            entry = importlib.import_module("AllplanToolsTest.entry")
            for value, expected in [("2026",True),("2026.0",True),("2026.1",True),(2026,True),(2026.0,True),("99",True),("99.0",True),(99,True),("2021",False),("",False),(None,False),("invalid",False)]:
                self.assertIs(entry.check_allplan_version(None,value),expected)
            for stem, target in [("InformationManager","information_manager"),("SmartCatalogEditor","smartcatalog"),("VOBEditor","vob_editor"),("AllplanToolsHome","home")]:
                module = importlib.import_module("AllplanToolsTest."+stem)
                with patch.object(module, "control_event", return_value=False) as call:
                    module.on_control_event("build",1001,"doc")
                    call.assert_called_once_with(target,"build",1001,"doc")
                name = ET.parse(ROOT/"library"/(stem+".pyp")).findtext("./Script/Name")
                self.assertEqual(name, "AllplanToolsTest\\"+stem+".py")
                self.assertTrue((ROOT/"pythonparts"/Path(name)).is_file())
            text = (ROOT/"template"/"Plugin.py").read_text() + (ROOT/"template"/"Plugin.pyp").read_text()
            for forbidden in ("jmauger", "candidate-", "venv", "0b05206"):
                self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
