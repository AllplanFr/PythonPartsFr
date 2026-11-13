import io
import json
from pathlib import Path
import ssl
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from application.core import plugin_catalog_remote as remote


EMPTY = {"schema": "allplan-tools-release-catalog/1", "plugins": []}


class TransportTests(unittest.TestCase):
    def response(self, body=None, **changes):
        response = Mock()
        response.status = 200
        response.geturl.return_value = remote.CATALOG_URL
        response.headers = {}
        response.read.return_value = json.dumps(EMPTY).encode() if body is None else body
        for key, value in changes.items():
            setattr(response, key, value)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        return response

    def test_fixed_public_url_no_proxy_auth_redirect_or_tls_bypass(self):
        response = self.response()
        opener = Mock()
        opener.open.return_value = response
        with patch.object(remote, "build_opener", return_value=opener) as build:
            self.assertEqual(remote._fetch_document(2.5), EMPTY)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, remote.CATALOG_URL)
        self.assertEqual(opener.open.call_args.kwargs, {"timeout": 2.5})
        self.assertNotIn("Authorization", request.headers)
        self.assertNotIn("Proxy-authorization", request.headers)
        proxy, redirects, https = build.call_args.args
        self.assertEqual(proxy.proxies, {})
        self.assertIsInstance(redirects, remote._NoRedirect)
        self.assertEqual(https._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(https._context.check_hostname)
        response.read.assert_called_once_with(remote.MAX_RESPONSE_BYTES + 1)

    def test_redirect_is_refused_before_following(self):
        with self.assertRaises(OSError):
            remote._NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.test/")

    def test_http_tls_and_network_errors_propagate(self):
        for failure in (HTTPError(remote.CATALOG_URL, 404, "missing", {}, io.BytesIO()),
                        URLError("offline"), ssl.SSLError("TLS"), TimeoutError()):
            with self.subTest(failure=type(failure).__name__), \
                    patch.object(remote, "build_opener") as build:
                build.return_value.open.side_effect = failure
                with self.assertRaises(OSError):
                    remote._fetch_document(3)
            if isinstance(failure, HTTPError):
                failure.close()

    def test_response_limits_and_metadata(self):
        cases = [
            self.response(status=204),
            self.response(headers={"Content-Length": str(remote.MAX_RESPONSE_BYTES + 1)}),
            self.response(headers={"Content-Length": "-1"}),
            self.response(headers={"Content-Length": "abc"}),
            self.response(headers={"Content-Length": "1"}),
            self.response(headers={"Content-Encoding": "gzip"}),
            self.response(body=b"x" * (remote.MAX_RESPONSE_BYTES + 1)),
        ]
        moved = self.response()
        moved.geturl.return_value = "https://example.test/"
        cases.append(moved)
        for response in cases:
            with self.subTest(response=response), patch.object(remote, "build_opener") as build:
                build.return_value.open.return_value = response
                with self.assertRaises((ValueError, OSError)):
                    remote._fetch_document(3)

    def test_strict_json(self):
        for data in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}',
                     b'{"x":1e999}', b"\xff", b"{}", b'{"plugins":[]} trailing'):
            if data == b"{}":
                self.assertEqual(remote.strict_json(data), {})
                continue
            with self.subTest(data=data), self.assertRaises(ValueError):
                remote.strict_json(data)

    def test_worker_encodes_sanitized_errors_and_empty_catalog(self):
        for result, code in ((EMPTY, None), (OSError("private detail"), "network_error"),
                             (ValueError("private detail"), "invalid_catalog")):
            stdout = Mock(buffer=io.BytesIO())
            with patch.object(remote, "_fetch_document") as fetch, patch.object(sys, "stdout", stdout):
                if isinstance(result, Exception):
                    fetch.side_effect = result
                else:
                    fetch.return_value = result
                remote._worker(3)
            reply = json.loads(stdout.buffer.getvalue())
            self.assertEqual(reply["error"], code)
            self.assertNotIn(b"private detail", stdout.buffer.getvalue())
            self.assertEqual(reply["ok"], code is None)


class LoaderTests(unittest.TestCase):
    def setUp(self):
        self.loader = remote.RemoteCatalogLoader(sys.executable)
        patcher = patch.object(remote, "_unconfirmed_worker", None)
        patcher.start()
        self.addCleanup(patcher.stop)
        read_ready = remote._read_ready

        def read(pipe, limit):
            return pipe.read(limit) if isinstance(pipe, io.BytesIO) else read_ready(pipe, limit)

        patcher = patch.object(remote, "_read_ready", side_effect=read)
        patcher.start()
        self.addCleanup(patcher.stop)

    def process(self, **overrides):
        reply = {
            "interpreter": str(Path(sys.executable).resolve()),
            "ok": True, "data": EMPTY, "error": None,
        }
        reply.update(overrides)
        process = Mock(returncode=0, pid=12345, stdin=None, stderr=None)
        process.stdout = io.BytesIO(json.dumps(reply).encode())
        process.poll.return_value = 0
        process.wait.return_value = 0

        def kill():
            process.poll.return_value = -9
            process.returncode = -9

        process.kill.side_effect = kill
        return process

    def test_interpreter_is_explicit_not_embedding_executable(self):
        process = self.process()
        with patch.object(sys, "executable", r"C:\Allplan\Allplan.exe"), \
                patch.object(remote.subprocess, "Popen", return_value=process) as popen:
            self.assertEqual(self.loader(timeout=3), EMPTY)
        command = popen.call_args.args[0]
        self.assertEqual(command[0], str(Path(self.loader._executable)))
        self.assertEqual(command[1:3], ["-I", "-B"])
        self.assertEqual(command[3], str(Path(remote.__file__).resolve()))
        self.assertFalse(popen.call_args.kwargs["shell"])
        self.assertEqual(popen.call_args.kwargs["stdin"], subprocess.DEVNULL)

    def test_invalid_interpreters_and_budgets_never_spawn(self):
        with patch.object(remote.subprocess, "Popen") as popen:
            for value in (None, "", "python.exe", r"C:\absent\python.exe", sys.executable + ".missing"):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    remote.RemoteCatalogLoader(value)
            for value in (False, 0, -1, 4, float("nan"), float("inf"), "3"):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    self.loader(timeout=value)
            popen.assert_not_called()
        with patch.object(Path, "is_file", return_value=True):
            with self.assertRaises(ValueError):
                remote.RemoteCatalogLoader(str(Path(sys.executable).with_name("Allplan.exe")))

    def test_single_deadline_includes_spawn_and_reaps_after_completion(self):
        process = self.process()
        clock = [10.0]

        def spawn(*args, **kwargs):
            clock[0] = 11.25
            return process

        with patch.object(remote.subprocess, "Popen", side_effect=spawn), \
                patch.object(remote.time, "monotonic", side_effect=lambda: clock[0]):
            self.assertEqual(self.loader(timeout=3), EMPTY)
        self.assertEqual(process.wait.call_args_list[0].kwargs["timeout"], 1.75)
        process.kill.assert_not_called()
        self.assertEqual(process.wait.call_count, 2)
        self.assertTrue(process.stdout.closed)
        process.communicate.assert_not_called()

    def test_expired_spawn_and_slow_completion_are_rejected(self):
        for stage in ("spawn", "receive"):
            process = self.process()
            process.poll.return_value = None
            clock = [10.0]

            def spawn(*args, **kwargs):
                if stage == "spawn":
                    clock[0] = 13.1
                return process

            def read(*args):
                clock[0] = 13.1
                return b""

            with patch.object(remote.subprocess, "Popen", side_effect=spawn), \
                    patch.object(remote.time, "monotonic", side_effect=lambda: clock[0]), \
                    patch.object(remote, "_read_ready", side_effect=read):
                with self.assertRaises(TimeoutError):
                    self.loader(timeout=3)
            process.kill.assert_called_once()
            self.assertLessEqual(process.wait.call_args.kwargs["timeout"],
                                 remote.CLEANUP_TIMEOUT_SECONDS)
            self.assertTrue(process.stdout.closed)

    def test_worker_failures_and_identity(self):
        for changes, error in [
            ({"ok": False, "data": None, "error": "network_error"}, OSError),
            ({"ok": False, "data": None, "error": "invalid_catalog"}, ValueError),
            ({"interpreter": "another interpreter"}, OSError),
            ({"ok": True, "error": "network_error"}, OSError),
            ({"ok": False, "data": None, "error": "unknown"}, OSError),
        ]:
            with self.subTest(changes=changes), \
                    patch.object(remote.subprocess, "Popen", return_value=self.process(**changes)):
                with self.assertRaises(error):
                    self.loader(timeout=3)
        for output, code, error in ((b"not-json", 0, ValueError), (b"", 1, OSError),
                                    (b"x" * (remote.MAX_WORKER_BYTES + 1), 0, ValueError)):
            process = self.process()
            process.returncode = code
            process.stdout = io.BytesIO(output)
            with patch.object(remote.subprocess, "Popen", return_value=process):
                with self.assertRaises(error):
                    self.loader(timeout=3)

    def test_excess_output_stops_during_reception(self):
        process = self.process()
        process.poll.return_value = None
        counts = []

        def read(pipe, limit):
            counts.append(limit)
            return b"x" * limit

        with patch.object(remote, "MAX_WORKER_BYTES", 100), \
                patch.object(remote, "_read_ready", side_effect=read), \
                patch.object(remote.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(ValueError, "too large"):
                self.loader(timeout=3)
        self.assertEqual(counts, [101])
        process.kill.assert_called_once()
        self.assertTrue(process.stdout.closed)
        process.communicate.assert_not_called()

    def test_parent_decoding_and_protocol_control_share_the_deadline(self):
        for valid in (True, False):
            process = self.process()
            clock = [10.0]
            decode = self.loader._decode

            def slow_decode(output):
                clock[0] = 13.01
                if not valid:
                    raise ValueError("Invalid protocol")
                return decode(output)

            with patch.object(remote.subprocess, "Popen", return_value=process), \
                    patch.object(remote.time, "monotonic", side_effect=lambda: clock[0]), \
                    patch.object(self.loader, "_decode", side_effect=slow_decode):
                with self.assertRaises(TimeoutError):
                    self.loader(timeout=3)
            self.assertTrue(process.stdout.closed)

    def test_slow_progressive_read_does_not_restart_the_budget(self):
        process = self.process()
        process.poll.return_value = None
        clock = [10.0]
        chunks = []

        def read(pipe, limit):
            clock[0] += 0.8
            chunks.append(b"x")
            return b"x"

        with patch.object(remote.subprocess, "Popen", return_value=process), \
                patch.object(remote.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(remote, "_read_ready", side_effect=read):
            with self.assertRaises(TimeoutError):
                self.loader(timeout=3)
        self.assertEqual(len(chunks), 4)
        process.kill.assert_called_once()
        self.assertTrue(process.stdout.closed)

    def test_cleanup_failure_blocks_workers_until_stop_is_confirmed(self):
        for kill_fails in (False, True):
            process = self.process()
            process.poll.return_value = None
            process.wait.side_effect = subprocess.TimeoutExpired("worker", 0.5)
            if kill_fails:
                process.kill.side_effect = OSError("kill denied")
            else:
                process.kill.side_effect = None
            with patch.object(remote.subprocess, "Popen", return_value=process) as spawn, \
                    patch.object(remote, "_receive", side_effect=TimeoutError("network")), \
                    self.assertLogs(remote.LOGGER, level="ERROR") as logs:
                with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
                    self.loader(timeout=3)
                self.assertIs(remote._unconfirmed_worker, process)
                with self.assertRaisesRegex(RuntimeError, "unconfirmed"):
                    remote.RemoteCatalogLoader(sys.executable)(timeout=3)
                self.assertEqual(spawn.call_count, 1)
            self.assertTrue(any("UNCONFIRMED" in line for line in logs.output))
            if kill_fails:
                self.assertTrue(any("kill failed" in line for line in logs.output))
            self.assertTrue(any("collection failed" in line for line in logs.output))
            self.assertTrue(process.stdout.closed)
            process.communicate.assert_not_called()
            process.poll.return_value = 0
            process.wait.side_effect = None
            with patch.object(remote.subprocess, "Popen", return_value=self.process()):
                self.assertEqual(self.loader(timeout=3), EMPTY)
            self.assertIsNone(remote._unconfirmed_worker)

    def test_wait_failure_then_final_poll_confirms_collection(self):
        for error in (OSError("wait failed"), subprocess.TimeoutExpired("worker", 0.5)):
            with self.subTest(error=type(error).__name__):
                process = self.process()
                process.poll.side_effect = [None, -9]
                process.wait.side_effect = error
                with self.assertLogs(remote.LOGGER, level="ERROR") as logs, \
                        self.assertRaisesRegex(RuntimeError, "cleanup failed"):
                    remote._cleanup(process)
                process.kill.assert_called_once()
                process.wait.assert_called_once()
                self.assertLessEqual(process.wait.call_args.kwargs["timeout"],
                                     remote.CLEANUP_TIMEOUT_SECONDS)
                self.assertEqual(process.poll.call_count, 2)
                self.assertTrue(process.stdout.closed)
                self.assertIsNone(remote._unconfirmed_worker)
                self.assertTrue(any("collection failed" in line for line in logs.output))
                self.assertFalse(any("UNCONFIRMED" in line for line in logs.output))
                with patch.object(remote.subprocess, "Popen", return_value=self.process()) as spawn:
                    self.assertEqual(self.loader(timeout=3), EMPTY)
                spawn.assert_called_once()

    def test_kill_exit_race_and_pipe_errors_are_collected(self):
        process = self.process()
        process.poll.side_effect = [None, 0, 0]
        process.kill.side_effect = ProcessLookupError("already stopped")
        remote._cleanup(process)
        process.wait.assert_called_once()
        self.assertIsNone(remote._unconfirmed_worker)
        self.assertTrue(process.stdout.closed)
        process = self.process()
        process.poll.return_value = None
        with patch.object(remote.subprocess, "Popen", return_value=process), \
                patch.object(remote, "_read_ready", side_effect=OSError("pipe failed")):
            with self.assertRaisesRegex(OSError, "pipe failed"):
                self.loader(timeout=3)
        process.kill.assert_called_once()
        self.assertTrue(process.stdout.closed)

    def test_pipe_closure_failure_does_not_skip_other_resources(self):
        process = self.process()
        process.stdout = Mock()
        process.stdout.close.side_effect = OSError("close failed")
        process.stderr = Mock()
        process.stdin = Mock()
        with self.assertLogs(remote.LOGGER, level="ERROR"), \
                self.assertRaisesRegex(RuntimeError, "cleanup failed"):
            remote._cleanup(process)
        process.stderr.close.assert_called_once()
        process.stdin.close.assert_called_once()
        self.assertIsNone(remote._unconfirmed_worker)

    def test_unconfirmed_worker_state_errors_keep_the_gate_closed(self):
        process = self.process()
        process.poll.side_effect = OSError("state unavailable")
        remote._unconfirmed_worker = process
        with patch.object(remote.subprocess, "Popen") as spawn, \
                self.assertLogs(remote.LOGGER, level="ERROR"), \
                self.assertRaisesRegex(RuntimeError, "unconfirmed"):
            self.loader(timeout=3)
        spawn.assert_not_called()
        self.assertIs(remote._unconfirmed_worker, process)
        process.stdout.close()

    def test_real_worker_entry_and_protocol_with_local_fake_http(self):
        spawn = subprocess.Popen
        processes = []

        def local_worker(command, **kwargs):
            code = (
                "import io,runpy,sys,urllib.request; "
                "body=" + repr(json.dumps(EMPTY).encode()) + "; "
                "response=io.BytesIO(body); response.status=200; response.headers={}; "
                "response.geturl=lambda:" + repr(remote.CATALOG_URL) + "; "
                "opener=type('LocalOpener',(),{'open':lambda self,*a,**k:response})(); "
                "urllib.request.build_opener=lambda *a:opener; "
                "sys.argv=" + repr(command[3:]) + "; "
                "runpy.run_path(sys.argv[0],run_name='__main__')"
            )
            process = spawn([command[0], "-I", "-B", "-c", code], **kwargs)
            processes.append(process)
            return process

        with patch.object(remote.subprocess, "Popen", side_effect=local_worker):
            self.assertEqual(self.loader(timeout=3), EMPTY)
        self.assertEqual(processes[0].wait(timeout=0), 0)
        self.assertTrue(processes[0].stdout.closed)

    def test_real_excessive_stdout_is_stopped_and_collected(self):
        spawn = subprocess.Popen
        processes = []

        def noisy_worker(command, **kwargs):
            process = spawn([
                command[0], "-I", "-B", "-c",
                "import os,time; os.write(1,b'x'*65536); time.sleep(60)",
            ], **kwargs)
            processes.append(process)
            return process

        with patch.object(remote.subprocess, "Popen", side_effect=noisy_worker), \
                patch.object(remote, "MAX_WORKER_BYTES", 4096):
            with self.assertRaisesRegex(ValueError, "too large"):
                self.loader(timeout=3)
        self.assertIsNotNone(processes[0].poll())
        self.assertIsInstance(processes[0].wait(timeout=0), int)
        self.assertTrue(processes[0].stdout.closed)

    def test_real_blocking_worker_is_killed_and_collected_without_network(self):
        spawn = subprocess.Popen
        processes = []

        def blocking_worker(command, **kwargs):
            self.assertEqual(command[0], str(Path(sys.executable).resolve()))
            process = spawn(
                [command[0], "-I", "-B", "-c", "import time; time.sleep(60)"],
                **kwargs,
            )
            processes.append(process)
            return process

        started = time.monotonic()
        with patch.object(remote.subprocess, "Popen", side_effect=blocking_worker):
            with self.assertRaises(TimeoutError):
                self.loader(timeout=3.0)
        self.assertEqual(len(processes), 1)
        self.assertIsNotNone(processes[0].poll())
        self.assertIsInstance(processes[0].wait(timeout=0), int)
        self.assertTrue(processes[0].stdout.closed)
        elapsed = time.monotonic() - started
        self.assertGreaterEqual(elapsed, 2.9)
        self.assertLess(elapsed, 6)


if __name__ == "__main__":
    unittest.main()
