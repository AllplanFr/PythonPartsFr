import ast
import importlib
import importlib.util
import json
import os
from pathlib import Path
from enum import Enum
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread
import time
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
sys.path.insert(0, str(ROOT / "runtime"))
package = ModuleType("AutostartTest")
package.__path__ = [str(ROOT / "pythonparts" / "AllplanToolsTest")]
sys.modules["AutostartTest"] = package
sys.modules.setdefault("CreateElementResult", SimpleNamespace(CreateElementResult=lambda items: items))
entry = importlib.import_module("AutostartTest.entry")
TARGETS = {
    "AllplanToolsHome": "home", "InformationManager": "information_manager",
    "SmartCatalogEditor": "smartcatalog", "VOBEditor": "vob_editor",
}


class BaseScriptObjectStub:
    def __init__(self, data):
        self.is_only_update = data.is_only_update
        self.document = data.document

    def create_library_preview(self):
        return []

    def modify_element_property(self, _name, _value):
        return False


class CancelResult(Enum):
    CANCEL_INPUT = 1


def script_data(update=False):
    return SimpleNamespace(is_only_update=update, document=object())


class AutostartTests(unittest.TestCase):
    def setUp(self):
        entry._PENDING.clear()
        self.framework = patch.dict(sys.modules, {
            "BaseScriptObject": SimpleNamespace(BaseScriptObject=BaseScriptObjectStub),
            "ScriptObjectInteractors.OnCancelFunctionResult":
                SimpleNamespace(OnCancelFunctionResult=CancelResult),
        })
        self.framework.start()
        self.addCleanup(self.framework.stop)

    def test_four_activations_preview_updates_and_manual_retry(self):
        for stem, target in TARGETS.items():
            module = importlib.import_module("AutostartTest." + stem)
            build, doc = object(), object()
            with patch.object(entry, "_launch") as launch:
                self.assertTrue(module.check_allplan_version(build, "2026.1"))
                module.create_element(build, doc)
                self.assertFalse(module.on_control_event(build, 999, doc))
                self.assertFalse(hasattr(module, "initialize_control_properties"))
                # Library selection/preview can import and create an object but never start input.
                launcher = module.create_script_object(build, script_data())
                launcher.create_library_preview()
                launcher.execute()
                launch.assert_not_called()
                self.assertIsNone(launcher.start_input())
                launch.assert_called_once_with(target)
                launcher.start_input()
                launcher.modify_element_property("Launch", 0)
                launcher.execute()
                module.create_element(build, doc)
                self.assertEqual(launch.call_count, 1)
                self.assertFalse(launcher.on_control_event(1001))
                self.assertEqual(launch.call_count, 2)
                module.create_script_object(object(), script_data()).start_input()
                self.assertEqual(launch.call_count, 3)

    def test_actual_framework_activation_and_preview_callback_routes(self):
        framework = Path(r"C:\ProgramData\Nemetschek\Allplan\2026\Etc\PythonPartsFramework\GeneralScripts")
        # Execute the installed dispatch methods with native inputs stubbed; not an Allplan UI test.
        service_tree = ast.parse((framework / "BuildingElementInputServices" / "ScriptObjectService.py").read_text())
        cls = next(node for node in service_tree.body if isinstance(node, ast.ClassDef))
        cls.body = [node for node in cls.body if isinstance(node, ast.FunctionDef)
                    and node.name == "create_script_object"]
        namespace = {
            "InputData": object, "BaseScriptObject": BaseScriptObjectStub,
            "BaseScriptObjectData": lambda *args: script_data(),
            "ControlPropertiesUtil": lambda *args: None,
            "PythonScriptType": SimpleNamespace(SCRIPT_OBJECT="object"),
            "cast": lambda _type, value: value,
        }
        exec(compile(ast.Module(body=[cls], type_ignores=[]), "<installed-script-object-dispatch>", "exec"),
             namespace)
        service = namespace["ScriptObjectService"]
        service.execute_script_object = Mock()
        module = importlib.import_module("AutostartTest.InformationManager")
        data = SimpleNamespace(
            build_ele_script=module, palette_service=None, coord_input=None,
            modification_ele_list=[], is_only_update=False, execution_event=None,
            modification_matrix=None, build_ele_ctrl_props_list=[],
            build_ele_list=[object()], exec_switch_pythonpart=None, org_and_copy_ele_guids={},
        )
        # The real base class exposes this property; include it in the native API stub.
        with patch.object(BaseScriptObjectStub, "script_object_interactor", None, create=True), \
                patch.object(entry, "_launch") as launch:
            self.assertTrue(service.create_script_object(data))
            launch.assert_called_once_with("information_manager")
            service.execute_script_object.assert_called_once_with(data)
            data.script_object.start_input()
            self.assertEqual(launch.call_count, 1)
        preview_tree = ast.parse((framework / "CreateLibraryPreview.py").read_text())
        preview = next(node for node in preview_tree.body if isinstance(node, ast.FunctionDef)
                       and node.name == "__script_object_preview")
        namespace = {
            "Any": object, "BuildingElement": object, "BuildingElementControlProperties": object,
            "CreateElementResult": object, "BaseScriptObject": BaseScriptObjectStub,
            "AllplanEleAdapter": SimpleNamespace(DocumentAdapter=object),
            "AllplanIFW": SimpleNamespace(CoordinateInput=object),
            "AllplanGeo": SimpleNamespace(Matrix3D=lambda: None),
            "AllplanSettings": SimpleNamespace(ExecutionEvent=SimpleNamespace(eCreation=0)),
            "BaseScriptObjectData": lambda *args: script_data(update=True),
            "CoordinateInputMock": lambda doc: doc, "ModificationElementList": list,
            "ControlPropertiesUtil": lambda *args: None, "Callable": object,
            "cast": lambda _type, value: value,
        }
        exec(compile(ast.Module(body=[preview], type_ignores=[]), "<installed-library-preview-dispatch>", "exec"),
             namespace)
        with patch.object(entry, "_launch") as launch:
            namespace["__script_object_preview"]([object()], [], module, object())
            launch.assert_not_called()

    def test_update_only_and_cancel_never_launch_or_stop_plugins(self):
        for stem in TARGETS:
            module = importlib.import_module("AutostartTest." + stem)
            with patch.object(entry, "_launch") as launch, \
                    patch.object(entry.subprocess, "Popen") as spawn:
                launcher = module.create_script_object(object(), script_data(update=True))
                launcher.start_input()
                launcher.execute()
                launcher.start_input()
                self.assertIs(launcher.on_cancel_function(), CancelResult.CANCEL_INPUT)
                launch.assert_not_called()
                spawn.assert_not_called()
                # Closing an active palette cannot terminate its independently launched process.
                active = module.create_script_object(object(), script_data())
                active.start_input()
                launch.assert_called_once()
                launch.reset_mock()
                self.assertIs(active.on_cancel_function(), CancelResult.CANCEL_INPUT)
                launch.assert_not_called()
                spawn.assert_not_called()

    def test_pending_child_blocks_clicks_until_correlated_completion(self):
        with TemporaryDirectory() as directory:
            for target in TARGETS.values():
                process = Mock()
                process.poll.return_value = None
                result = Path(directory) / (target + ".json")
                token = uuid4().hex
                entry._PENDING[target] = (process, result, token, entry.monotonic())
                with patch.object(entry, "_launch") as launch:
                    entry.control_event(target, None, 1001, None)
                    entry.control_event(target, None, 1001, None)
                    launch.assert_not_called()
                    result.write_text(json.dumps({"token": token, "status": "accepted"}))
                    entry.control_event(target, None, 1001, None)
                    launch.assert_called_once_with(target)
                self.assertNotIn(target, entry._PENDING)

    def test_real_hidden_child_acknowledgement_unblocks_before_home_process_exit(self):
        code = r'''
import importlib.util, json, os, sys, time
from pathlib import Path
os.environ["ALLPLAN_TOOLS_ENTRY_TOKEN"] = sys.argv[3]
spec = importlib.util.spec_from_file_location("probe_runner", sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
assert "ALLPLAN_TOOLS_ENTRY_TOKEN" not in os.environ
runner.CONFIG = dict(runner.CONFIG, profile=sys.argv[2])
time.sleep(0.5)
runner.report_startup("accepted")
print("acknowledged, no plugin opened", flush=True)
time.sleep(2)
'''
        with TemporaryDirectory() as directory:
            logs = Path(directory) / "AllplanWebLauncher" / "logs"
            logs.mkdir(parents=True)
            token = uuid4().hex
            result = logs / ("allplan-entry-" + token + ".json")
            with subprocess.Popen(
                    [sys.executable, "-I", "-c", code, str(ROOT / "runtime" / "runner.py"), directory, token],
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE) as child:
                try:
                    entry._PENDING["home"] = (child, result, token, entry.monotonic())
                    with patch.object(entry, "_launch") as launch:
                        entry.control_event("home", None, 1001, None)
                        launch.assert_not_called()
                        deadline = time.monotonic() + 8
                        while not result.exists() and child.poll() is None and time.monotonic() < deadline:
                            time.sleep(0.02)
                        self.assertTrue(result.is_file())
                        self.assertIsNone(child.poll())
                        entry.control_event("home", None, 1001, None)
                        launch.assert_called_once_with("home")
                finally:
                    output, error = child.communicate(timeout=10)
                self.assertEqual(child.returncode, 0, error.decode(errors="replace"))
                self.assertIn(b"no plugin opened", output)

    def test_failed_automatic_attempt_never_repeats_and_manual_retry_works(self):
        with TemporaryDirectory() as directory:
            for target in TARGETS.values():
                result = Path(directory) / (target + ".json")
                token = uuid4().hex
                def refused(_target):
                    entry._PENDING[target] = (Mock(), result, token, entry.monotonic())
                    result.write_text(json.dumps({"token": token, "status": "failed"}))
                with patch.object(entry, "_launch", side_effect=refused) as launch:
                    launcher = entry.create_launcher(target, object(), script_data())
                    launcher.start_input()
                    launcher.start_input()
                    self.assertEqual(launch.call_count, 1)
                    self.assertFalse(launcher.on_control_event(1001))
                    self.assertEqual(launch.call_count, 2)

    def test_reentrant_and_simultaneous_clicks_do_not_spawn_twice(self):
        for target in TARGETS.values():
            started, release = Event(), Event()
            def slow_launch(_target):
                started.set()
                self.assertTrue(release.wait(5))
            with patch.object(entry, "_launch", side_effect=slow_launch) as launch:
                thread = Thread(target=entry.control_event, args=(target, None, 1001, None))
                thread.start()
                try:
                    self.assertTrue(started.wait(5))
                    self.assertFalse(entry.control_event(target, None, 1001, None))
                finally:
                    release.set()
                    thread.join(5)
                self.assertFalse(thread.is_alive())
                launch.assert_called_once_with(target)

    def test_dead_child_releases_guard_and_foreign_ack_does_not(self):
        with TemporaryDirectory() as directory:
            result = Path(directory) / "result.json"
            result.write_text(json.dumps({"token": "wrong", "status": "accepted"}))
            process = Mock()
            process.poll.return_value = None
            entry._PENDING["home"] = (process, result, uuid4().hex, entry.monotonic())
            self.assertTrue(entry._launch_in_progress("home"))
            self.assertIn("non correle", result.with_suffix(".log").read_text())
            process.poll.return_value = 2
            with patch.object(entry.ctypes, "windll") as native:
                self.assertFalse(entry._launch_in_progress("home"))
                self.assertIn(str(result.with_suffix(".log")), native.user32.MessageBoxW.call_args.args[1])

    def test_real_spawn_exception_has_one_message_log_and_manual_retry(self):
        from application.core.allplan import adapter
        from application.core.context import LaunchContext
        with TemporaryDirectory() as directory:
            config = json.loads((ROOT / "runtime.json").read_text())
            config["profile"] = directory
            context = LaunchContext(origin="allplan", allplan_version="2026", country="FRA")
            message = Mock()
            with patch.object(entry, "_config", return_value=(ROOT, config)), \
                    patch.object(adapter, "context_from_allplan", return_value=(context, [])), \
                    patch.dict(sys.modules, {"NemAll_Python_AllplanSettings": SimpleNamespace()}), \
                    patch.object(entry.ctypes, "windll", SimpleNamespace(user32=SimpleNamespace(MessageBoxW=message))), \
                    patch.object(entry.subprocess, "Popen", side_effect=OSError("controlled spawn refused")) as spawn:
                launcher = entry.create_launcher("home", object(), script_data())
                launcher.start_input()
                launcher.start_input()
                self.assertEqual(spawn.call_count, 1)
                self.assertEqual(message.call_count, 1)
                logs = list(Path(directory).rglob("*.log"))
                self.assertIn("controlled spawn refused", logs[0].read_text())
                self.assertIn("Traceback", logs[0].read_text())
                self.assertIn(str(logs[0]), message.call_args.args[1])
                launcher.on_control_event(1001)
                self.assertEqual(spawn.call_count, 2)

    def test_template_uses_identical_activation_and_button_path(self):
        spec = importlib.util.spec_from_file_location("AutostartTest.template", ROOT / "template" / "Plugin.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.PLUGIN_ID = "vob_editor"
        with patch.object(entry, "_launch") as launch:
            launcher = module.create_script_object(object(), script_data())
            launcher.create_library_preview()
            launch.assert_not_called()
            launcher.start_input()
            launcher.start_input()
            self.assertFalse(launcher.on_control_event(1001))
            self.assertEqual(launch.call_args_list, [unittest.mock.call("vob_editor")] * 2)

    def test_context_standard_hidden_and_request_token_are_shared(self):
        from application.core.allplan import adapter
        from application.core.context import LaunchContext
        with TemporaryDirectory() as directory:
            config = json.loads((ROOT / "runtime.json").read_text())
            config["profile"] = directory
            context = LaunchContext(origin="allplan", allplan_version="2026", country="FRA",
                                    project_path=Path(directory) / "Origin.prj")
            environment_before = dict(os.environ)
            with patch.object(entry, "_config", return_value=(ROOT, config)), \
                    patch.object(adapter, "context_from_allplan", return_value=(context, [])) as read, \
                    patch.dict(sys.modules, {"NemAll_Python_AllplanSettings": SimpleNamespace()}), \
                    patch.object(entry.subprocess, "Popen") as spawn:
                spawn.return_value.poll.return_value = None
                for stem, target in TARGETS.items():
                    module = importlib.import_module("AutostartTest." + stem)
                    launcher = module.create_script_object(object(), script_data())
                    launcher.start_input()
                    command = spawn.call_args.args[0]
                    self.assertEqual(command[command.index("--target") + 1], target)
                    self.assertEqual(command[command.index("--country") + 1], "FRA")
                    self.assertEqual(command[command.index("--allplan-version") + 1], "2026")
                    self.assertEqual(command[command.index("--project-path") + 1], str(context.project_path))
                    self.assertNotIn("--verification-version", command)
                    self.assertIs(read.call_args.kwargs["verification_version"], False)
                    options = spawn.call_args.kwargs
                    self.assertEqual(options["creationflags"], subprocess.CREATE_NO_WINDOW)
                    self.assertEqual(options["env"]["LOCALAPPDATA"], directory)
                    self.assertEqual(options["env"]["ALLPLAN_TOOLS_ENTRY_TOKEN"], entry._PENDING[target][2])
                    launcher.on_control_event(1001)
                self.assertEqual(spawn.call_count, 4)
            self.assertEqual(dict(os.environ), environment_before)

    def test_child_result_atomic_and_home_waits_for_shown(self):
        spec = importlib.util.spec_from_file_location("autostart_runner", ROOT / "runtime" / "runner.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        import home_host
        from application.core import logging_setup
        token = uuid4().hex
        with TemporaryDirectory() as directory:
            logs = Path(directory) / "AllplanWebLauncher" / "logs"
            logs.mkdir(parents=True)
            config = dict(runner.CONFIG, profile=directory)
            with patch.object(runner, "CONFIG", config), patch.object(runner, "ENTRY_TOKEN", token):
                runner.report_startup("failed")
                result = logs / ("allplan-entry-" + token + ".json")
                self.assertEqual(json.loads(result.read_text()), {"token": token, "status": "failed"})
                self.assertFalse(list(logs.glob("*.tmp")))
                with patch.dict(os.environ, {"LOCALAPPDATA": directory}), \
                        patch.object(logging_setup, "configure_logging"), \
                        patch.object(home_host, "_services"), \
                        patch.object(home_host, "_verify_aim") as preflight, \
                        patch.object(home_host, "show_home") as home, \
                        patch.object(runner, "report_startup") as report, \
                        patch.object(sys, "argv", ["runner.py", "--target", "home"]):
                    runner.main()
                    preflight.assert_called_once()
                    report.assert_not_called()
                    home.call_args.kwargs["on_started"]()
                    report.assert_called_once_with("accepted")
                for target in ("information_manager", "smartcatalog", "vob_editor"):
                    api = Mock()
                    api.launch.return_value = {"ok": True}
                    with patch.dict(os.environ, {"LOCALAPPDATA": directory}), \
                            patch.object(logging_setup, "configure_logging"), \
                            patch.object(home_host, "_services"), \
                            patch.object(home_host, "HomeApi", return_value=api), \
                            patch.object(runner, "report_startup") as report, \
                            patch.object(sys, "argv", ["runner.py", "--target", target]):
                        runner.main()
                        api.launch.assert_called_once()
                        report.assert_called_once_with("accepted")
                        api.launch.return_value = {"ok": False, "error": "plugin unavailable"}
                        report.reset_mock()
                        with self.assertRaisesRegex(RuntimeError, "plugin unavailable"):
                            runner.main()
                        report.assert_not_called()


if __name__ == "__main__":
    unittest.main()
