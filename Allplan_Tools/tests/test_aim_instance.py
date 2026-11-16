import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.aim_instance import AimAlreadyOpen, AimInstance, MESSAGE
from application.core.context import LaunchContext
from application.launcher.selector import SelectorApi


@unittest.skipUnless(sys.platform == "win32", "Windows kernel lease")
class AimInstanceTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.env = patch.dict(os.environ, {"LOCALAPPDATA": temporary.name})
        self.env.start()
        self.addCleanup(self.env.stop)

    def child(self):
        script = (
            "from application.core.aim_instance import AimInstance;"
            "import sys;"
            "lease=AimInstance(inherit=True);"
            "print('ready',flush=True);"
            "sys.stdin.readline();"
            "lease.__exit__()"
        )
        with AimInstance() as lease:
            process = lease.spawn(
                [sys.executable, "-u", "-c", script],
                cwd=str(Path(__file__).resolve().parents[1]),
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True,
            )
        self.addCleanup(self.dispose, process)
        self.assertEqual(process.stdout.readline().strip(), "ready")
        return process

    @staticmethod
    def dispose(process):
        if process.poll() is None:
            process.terminate()
        process.communicate(timeout=10)

    def test_inherited_lease_blocks_second_process_then_normal_close_allows_relaunch(self):
        process = self.child()
        with self.assertRaises(AimAlreadyOpen):
            AimInstance()
        _, error = process.communicate("\n", timeout=10)
        self.assertEqual(process.returncode, 0, error)
        with AimInstance():
            pass
        relaunched = self.child()
        relaunched.communicate("\n", timeout=10)
        self.assertEqual(relaunched.returncode, 0)

    def test_abnormal_exit_releases_kernel_lease_without_manual_cleanup(self):
        process = self.child()
        process.terminate()
        process.communicate(timeout=10)
        self.assertNotEqual(process.returncode, 0)
        with AimInstance():
            pass

    def test_two_managers_and_rapid_clicks_do_not_spawn_any_second_aim_process(self):
        with AimInstance(), patch("application.core.launching.subprocess.Popen") as popen:
            for manager in (SelectorApi(LaunchContext()), SelectorApi(LaunchContext())):
                for _ in range(2):
                    result = manager.launch("information_manager", "", False, "")
                    self.assertFalse(result["ok"])
                    self.assertEqual(result["error"], MESSAGE)
            popen.assert_not_called()

    def test_spawn_failure_releases_reservation_and_other_plugins_do_not_use_it(self):
        with self.assertRaises(OSError):
            with AimInstance() as lease:
                lease.spawn([r"Z:\missing-aim-executable.exe"])
        with AimInstance(), patch(
            "application.core.launching.resolve_context", side_effect=lambda context, **_: context,
        ), patch("application.core.launching.validate_resources"), patch(
            "application.core.launching.subprocess.Popen",
        ) as popen:
            from application.core.launching import launch_plugin
            launch_plugin("vob_editor", LaunchContext())
            popen.assert_called_once()


if __name__ == "__main__":
    unittest.main()
