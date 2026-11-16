"""Exercise the source and overlaid launchers without starting any application."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = """
import importlib.util
import json
import os
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
from application.launcher import main
from application.core.context import LaunchContext
import webview
"""


class VobLaunchIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = TemporaryDirectory()
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.base = Path(cls.temporary.name).resolve()
        cls.candidate = cls.base / "candidate"
        cls.profile = cls.base / "profile"
        spec = importlib.util.spec_from_file_location(
            "vob_test_assembler", ROOT / "allplan_tools" / "assemble_package.py",
        )
        assembly = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(assembly)
        assembly.assemble(
            cls.candidate, Path(sys.executable).resolve(), cls.profile, cls.base / "pin",
        )

    def run_code(self, code, *, source=False):
        env = os.environ.copy()
        env["LOCALAPPDATA"] = str(self.base / self.id().rsplit(".", 1)[-1])
        env.pop("PYTHONPATH", None)
        root = ROOT if source else self.candidate / "python"
        result = subprocess.run(
            [sys.executable, "-I", "-B", "-c", BOOTSTRAP + code, str(root)],
            cwd=str(root), env=env, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_wrapper_compatible_in_both_contexts_without_registration(self):
        code = """
from application.core import launcher_location
from application.core import logging_setup
from inspect import signature
work = None
if 'register_location' not in signature(main.entrypoint).parameters:
    from application.core import work_identity
    work = patch.object(work_identity, 'verify_work_copy', wraps=work_identity.verify_work_copy)
with patch.object(launcher_location, 'register_launcher') as register, \
     patch.object(logging_setup, 'configure_logging'), \
     patch.object(main, 'main', return_value=0) as dispatch:
    if work:
        verified = work.start()
    sys.argv = [str(root / 'vob_launcher.py'), '--allplan-version', '2026', '--country', 'FRA']
    try:
        runpy.run_path(str(root / 'vob_launcher.py'), run_name='__main__')
    except SystemExit as exc:
        assert exc.code == 0
    else:
        raise AssertionError('Wrapper did not return')
    register.assert_not_called()
    dispatch.assert_called_once_with(['vob_editor', '--allplan-version', '2026', '--country', 'FRA'])
    if work:
        verified.assert_called_once_with()
        work.stop()
"""
        for source in (True, False):
            with self.subTest(source=source):
                self.run_code(code, source=source)

    def test_internal_type_error_not_retried(self):
        code = """
from application.core import logging_setup
with patch.object(logging_setup, 'configure_logging'), \
     patch.object(main, 'main', side_effect=TypeError('internal failure')) as dispatch:
    sys.argv = [str(root / 'vob_launcher.py')]
    try:
        runpy.run_path(str(root / 'vob_launcher.py'), run_name='__main__')
    except TypeError as exc:
        assert str(exc) == 'internal failure'
    else:
        raise AssertionError('Internal TypeError masked')
    dispatch.assert_called_once()
"""
        for source in (True, False):
            with self.subTest(source=source):
                self.run_code(code, source=source)

    def test_wrapper_copied_inventoried_and_entrypoint_internal(self):
        wrapper = self.candidate / "python" / "vob_launcher.py"
        self.assertEqual(wrapper.read_bytes(), (ROOT / "vob_launcher.py").read_bytes())
        config = json.loads((self.candidate / "runtime.json").read_text())
        self.assertEqual(config["vobEntrypoint"], str(wrapper))
        self.assertTrue(Path(config["vobEntrypoint"]).is_relative_to(self.candidate / "python"))
        manifest = json.loads((self.candidate / "work-manifest.json").read_text())
        self.assertEqual(manifest["files"]["python/vob_launcher.py"],
                         hashlib.sha256(wrapper.read_bytes()).hexdigest())
        self.assertEqual(
            (self.candidate / "python/application/launcher/main.py").read_bytes(),
            (ROOT / "allplan_tools/overlay/python/application/launcher/main.py").read_bytes(),
        )
        self.run_code("""
from application.core.work_identity import verify_work_copy
verify_work_copy()
assert main.PACKAGE_ROOT == root / 'application'
""")

    def test_overlaid_dispatch_uses_protected_service_and_never_https_fallback(self):
        self.run_code("""
from application.launcher import vob_online
app = Mock()
context = LaunchContext(allplan_version='2026', country='FRA')
args = SimpleNamespace(timeout=15)
plugin = SimpleNamespace(id='vob_editor')
with patch.object(main, 'create_app', return_value=app), \
     patch.object(main, 'plugin_options', return_value={}), \
     patch.object(vob_online, 'run') as protected, \
     patch.object(webview, 'create_window') as generic:
    main._run_app(plugin, context, args)
    work = Path(os.environ['LOCALAPPDATA']) / 'AllplanWebLauncher/vob_editor/2026/standard'
    protected.assert_called_once_with(
        app, work, work / 'profile',
        coordinated_revision='58a9c1f6047015778ccddb6fb40e98e19008b56d',
    )
    generic.assert_not_called()
    protected.reset_mock()
    protected.side_effect = ValueError('protected failure')
    try:
        main._run_app(plugin, context, args)
    except ValueError as exc:
        assert str(exc) == 'protected failure'
    else:
        raise AssertionError('Protected failure masked')
    generic.assert_not_called()
""")

    def test_local_dispatch_in_source_and_overlay_never_falls_back(self):
        code = """
from application.launcher import vob_local_delivery, vob_online
app = Mock()
context = LaunchContext(allplan_version='2026', country='FRA')
args = SimpleNamespace(timeout=15, vob_local_package=root / 'delivery.zip')
plugin = SimpleNamespace(id='vob_editor')
parsed = main.create_parser().parse_args(['vob_editor', '--vob-local-package', str(args.vob_local_package)])
assert parsed.vob_local_package == args.vob_local_package
from application.core.errors import LaunchError
for rejected in (['smartcatalog', '--vob-local-package', 'delivery.zip'],
                 ['vob_editor', '--protocol-control-test', '--vob-local-package', 'delivery.zip']):
    try:
        main.main(rejected)
    except LaunchError:
        pass
    else:
        raise AssertionError('Local option accepted outside VOB business dispatch')
with patch.object(main, 'create_app', return_value=app), \
     patch.object(main, 'plugin_options', return_value={}), \
     patch.object(vob_local_delivery, 'run') as local, \
     patch.object(vob_online, 'run') as remote, \
     patch.object(webview, 'create_window') as generic:
    main._run_app(plugin, context, args)
    work = Path(os.environ['LOCALAPPDATA']) / 'AllplanWebLauncher/vob_editor/2026/standard'
    local.assert_called_once_with(app, work, work / 'profile', archive=args.vob_local_package)
    local.side_effect = ValueError('local package refused')
    try:
        main._run_app(plugin, context, args)
    except ValueError as exc:
        assert str(exc) == 'local package refused'
    else:
        raise AssertionError('Local failure masked')
    remote.assert_not_called()
    generic.assert_not_called()
"""
        for source in (True, False):
            with self.subTest(source=source):
                self.run_code(code, source=source)

    def test_aim_and_smartcatalog_branches_and_icons_preserved(self):
        self.run_code("""
from application.launcher import aim_local_delivery
from application.core import aim_instance, plugin_icons
context = LaunchContext(allplan_version='2026', country='FRA')
with patch.object(aim_instance, 'AimInstance') as lease, patch.object(main, '_run_app') as inner:
    plugin = SimpleNamespace(id='information_manager')
    args = SimpleNamespace(timeout=15)
    main.run_app(plugin, context, args)
    lease.assert_called_once_with(inherit=True)
    inner.assert_called_once_with(plugin, context, args)
app = Mock()
app._requires_protected_host = True
with patch.object(main, 'create_app', return_value=app), \
     patch.object(main, 'plugin_options', return_value={}), \
     patch.object(aim_local_delivery, 'run_installed') as installed, \
     patch.object(webview, 'create_window') as generic:
    main._run_app(plugin, context, args)
    installed.assert_called_once_with(
        app, Path(os.environ['LOCALAPPDATA']) / 'AllplanWebLauncher/information_manager/2026/standard')
    generic.assert_not_called()
app._requires_protected_host = False
plugin = SimpleNamespace(id='smartcatalog', name='SmartCatalog', url='https://example.invalid/smartcatalog')
window = MagicMock()
with patch.object(main, 'create_app', return_value=app), \
     patch.object(main, 'plugin_options', return_value={}), \
     patch.object(webview, 'create_window', return_value=window) as generic, \
     patch.object(webview, 'start') as start, \
     patch.object(plugin_icons, 'bind_window_icon') as icon:
    main._run_app(plugin, context, args)
    assert generic.call_args.kwargs['url'] == plugin.url
    assert generic.call_args.kwargs['js_api'] is app
    icon.assert_called_once_with(window, plugin)
    app._attach_window.assert_called_once_with(window)
    start.assert_called_once()
    assert webview.settings['IGNORE_SSL_ERRORS'] is False
""")

    def test_home_first_launch_leaves_data_initialization_to_child(self):
        self.run_code("""
from application.core import launching, test_process
spec = importlib.util.spec_from_file_location('vob_home_test', root.parent / 'runtime/home_host.py')
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)
home.PROFILE = Path(os.environ['LOCALAPPDATA'])
api = home.HomeApi.__new__(home.HomeApi)
api._context = LaunchContext(allplan_version='2026', country='FRA', verification_version=True,
                            origin='allplan', project_path=root.parent / 'example.prj')
api._year = '2026'
api._verification = True
api._timeout = 15
with patch.object(test_process, 'spawn_logged') as spawn:
    data = home.PROFILE / 'AllplanWebLauncher/vob_editor/2026/verification/data'
    assert not data.exists()
    api._launch_vob()
    assert not data.exists(), 'Home must not initialize child storage'
    command = spawn.call_args.args[0]
    assert command[:3] == [home.CONFIG['pythonExecutable'], '-I', str(root / 'vob_launcher.py')]
    assert command[command.index('--allplan-version') + 1] == '2026'
    assert command[command.index('--country') + 1] == 'FRA'
    assert '--verification-version' in command
    assert command[command.index('--project-path') + 1] == str(api._context.project_path)
    assert spawn.call_args.kwargs['cwd'] == str(root)
    assert spawn.call_args.kwargs['env']['LOCALAPPDATA'] == str(home.PROFILE)
    assert spawn.call_args.kwargs['shell'] is False
    api._context = LaunchContext()
    try:
        api._launch_vob()
    except ValueError:
        pass
    else:
        raise AssertionError('Missing Allplan context accepted')
from application.launcher import vob_local_delivery
with patch.object(main, 'create_app', return_value=Mock()), \
     patch.object(main, 'plugin_options', return_value={}), \
     patch.object(vob_local_delivery, 'run') as local:
    main._run_app(SimpleNamespace(id='vob_editor'),
                  LaunchContext(allplan_version='2026', verification_version=True),
                  SimpleNamespace(timeout=15, vob_local_package=root / 'delivery.zip'))
    assert data.is_dir()
    assert list(data.iterdir()) == []
    local.assert_called_once()
""")

    def test_child_preserves_existing_profile_data(self):
        self.run_code("""
from application.launcher import vob_local_delivery
data = Path(os.environ['LOCALAPPDATA']) / 'AllplanWebLauncher/vob_editor/2026/standard/data'
data.mkdir(parents=True)
existing = data / 'existing.json'
existing.write_bytes(b'preserve exactly')
with patch.object(main, 'create_app', return_value=Mock()) as create, \
     patch.object(main, 'plugin_options', return_value={}), \
     patch.object(vob_local_delivery, 'run') as local:
    main._run_app(SimpleNamespace(id='vob_editor'), LaunchContext(allplan_version='2026'),
                  SimpleNamespace(timeout=15, vob_local_package=root / 'delivery.zip'))
    assert existing.read_bytes() == b'preserve exactly'
    assert list(data.iterdir()) == [existing]
    assert create.call_args.args[1] == data
    local.assert_called_once()
""")

    def test_child_initialization_and_process_access_failures_are_explicit(self):
        self.run_code("""
from application.launcher import vob_local_delivery
from application.core import test_process
data = Path(os.environ['LOCALAPPDATA']) / 'AllplanWebLauncher/vob_editor/2026/standard/data'
data.parent.mkdir(parents=True)
data.write_bytes(b'not a directory')
with patch.object(main, 'create_app') as create, patch.object(vob_local_delivery, 'run') as local:
    try:
        main._run_app(SimpleNamespace(id='vob_editor'), LaunchContext(allplan_version='2026'),
                      SimpleNamespace(timeout=15, vob_local_package=root / 'delivery.zip'))
    except FileExistsError:
        pass
    else:
        raise AssertionError('Initialization failure masked')
    create.assert_not_called()
    local.assert_not_called()
spec = importlib.util.spec_from_file_location('vob_home_test', root.parent / 'runtime/home_host.py')
home = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home)
home.PROFILE = Path(os.environ['LOCALAPPDATA'])
api = home.HomeApi.__new__(home.HomeApi)
api._context = LaunchContext(allplan_version='2026', country='FRA')
api._year, api._verification, api._country, api._timeout = '2026', False, 'FRA', 15
from threading import Lock
api._lock = Lock()
api._plugins = {'vob_editor': Mock()}
with patch.object(api, '_plugin_info', return_value={'launchable': True}), \
     patch.object(test_process, 'spawn_logged', side_effect=PermissionError('process access refused')):
    reply = api.launch('vob_editor', '2026', False, 'FRA')
    assert reply['ok'] is False
    assert 'process access refused' in reply['error']
""")


if __name__ == "__main__":
    unittest.main()
