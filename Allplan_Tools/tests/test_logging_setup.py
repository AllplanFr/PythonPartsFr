import logging
import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from unittest.mock import Mock
from application.core.context import LaunchContext
from application.core.launching import launch_plugin

from application.core import logging_setup as logs


class LoggingTests(unittest.TestCase):
    def setUp(self):
        self.root = logging.getLogger()
        self.handlers = self.root.handlers[:]
        self.level = self.root.level
        self.mode = logs.diagnostic_enabled()
        self.root.handlers = []
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.restore)
        self.directory = Path(self.temporary.name)

    def restore(self):
        for handler in self.root.handlers[:]:
            handler.close()
        self.root.handlers = self.handlers
        logs.set_diagnostic(self.mode)
        self.root.setLevel(self.level)
        self.temporary.cleanup()

    def test_rotation_bounded_and_no_duplicate_handlers_on_toggle(self):
        with patch.object(logs, "log_directory", return_value=self.directory), \
                patch.object(logs, "_MAX_BYTES", 128), \
                patch.object(logs.sys, "stderr", None):
            logs.configure_logging()
            original = self.root.handlers[:]
            for _ in range(30):
                logs.set_diagnostic(True)
                logs.configure_logging()
                self.root.debug("Synthetic test record with bounded length")
                logs.set_diagnostic(False)
            self.assertEqual(self.root.handlers, original)
        files = list(self.directory.glob("*"))
        self.assertLessEqual(len(files), 4)
        self.assertTrue(any(p.suffix == ".1" for p in files))
        self.assertFalse(logs.diagnostic_enabled())

    def test_write_failure_and_missing_localappdata_are_nonblocking(self):
        with patch.object(logs, "log_directory", side_effect=PermissionError), \
                patch.object(logs, "_report_failure") as report:
            logs.configure_logging()
            report.assert_called_once()
        with patch.object(logs, "log_directory", side_effect=KeyError):
            logs.configure_logging()

    def test_normal_host_events_are_file_only_and_console_is_explicit(self):
        from application.launcher.aim_remote_review import trace, AimLogSummary
        output = io.StringIO()
        with patch.object(logs, "log_directory", return_value=self.directory), \
                patch.object(logs.sys, "stderr", output), patch("sys.stdout", output):
            logs.set_diagnostic(False)
            logs.configure_logging()
            file_handler = next(h for h in self.root.handlers
                                if h.get_name() == "allplan.file")
            summary = AimLogSummary()
            self.root.addHandler(summary)
            try:
                trace("AIM_HOST_START synthetic")
                self.root.warning("Synthetic warning")
                summary.flush()
                self.assertEqual(output.getvalue(), "")
                logs.set_diagnostic(True)
                trace("AIM_HOST_READY synthetic")
                self.assertIn("AIM_HOST_READY", output.getvalue())
                logs.set_diagnostic(False)
                output.truncate(0)
                output.seek(0)
                trace("AIM_HOST_RETURN synthetic")
                self.assertEqual(output.getvalue(), "")
                self.assertIn(file_handler, self.root.handlers)
            finally:
                self.root.removeHandler(summary)
                summary.close()
        text = Path(file_handler.baseFilename).read_text("utf-8")
        for marker in ("AIM_HOST_START", "AIM_HOST_READY", "AIM_HOST_RETURN",
                       "AIM_DIAGNOSTICS"):
            self.assertIn(marker, text)

    def test_emit_failure_reports_once_and_does_not_raise(self):
        with patch.object(logs, "log_directory", return_value=self.directory), \
                patch.object(logs.sys, "stderr", None):
            logs.configure_logging()
        handler = next(h for h in self.root.handlers if isinstance(h, logs._SafeRotatingHandler))
        broken_stream = io.StringIO()
        broken_stream.close()
        with patch.dict(handler.__dict__, {"stream": broken_stream}), \
                patch.object(logs, "_report_failure") as report:
            self.root.warning("one")
            self.root.warning("two")
            report.assert_called_once()

    def test_session_name_is_process_unique_and_open_folder_uses_no_shell(self):
        self.assertIn(str(logs.os.getpid()), logs._SESSION)
        with patch.object(logs, "log_directory", return_value=self.directory), \
                patch.object(logs.subprocess, "Popen") as process:
            logs.open_log_directory()
        self.assertEqual(process.call_args.args[0], ["explorer.exe", str(self.directory)])
        self.assertFalse(process.call_args.kwargs["shell"])

    def test_retention_limits_old_sessions(self):
        for number in range(25):
            (self.directory / f"session-old-{number}.log").touch()
        with patch.object(logs, "log_directory", return_value=self.directory), \
                patch.object(logs.sys, "stderr", None):
            logs.configure_logging()
        self.assertLessEqual(len(list(self.directory.glob("session-*.log"))), 20)

    def test_launch_propagates_current_mode_not_stale_context(self):
        for enabled in (True, False):
            logs.set_diagnostic(enabled)
            with patch("application.core.launching.resolve_context",
                       side_effect=lambda context, **kw: context), \
                    patch("application.core.launching.subprocess.Popen") as process, \
                    patch("application.core.launching.validate_resources"), \
                    patch("application.core.launching.resolve_plugin") as resolve:
                resolve.return_value = Mock(id="information_manager", path_options={})
                launch_plugin("information_manager", LaunchContext(diagnostic=not enabled))
                self.assertEqual("--diagnostic" in process.call_args.args[0], enabled)


if __name__ == "__main__":
    unittest.main()
