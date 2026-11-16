from copy import deepcopy
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import Mock, patch
import zipfile
import shutil

from application.core.context import LaunchContext, context_to_arguments
from application.core import logging_setup
from application.core.protocol_control import (
    ControlFacade, ControlSession, ControlValidator, ProtocolBoundaryError,
    artifact_directory, bootstrap_script, event_script,
)


ROOT = Path(__file__).resolve().parents[1]


class ProtocolControlTests(unittest.TestCase):
    def setUp(self):
        mode = logging_setup.diagnostic_enabled()
        level = logging.getLogger().level
        self.addCleanup(logging.getLogger().setLevel, level)
        self.addCleanup(logging_setup.set_diagnostic, mode)
        self.events = []
        self.guard = Mock(return_value=True)
        self.session = ControlSession(
            "information_manager", LaunchContext(), authorize=self.guard,
            emit=self.events.append,
        )
        self.counter = 0
        self.version = patch("application.core.protocol_control.version", return_value="0.1.0")
        self.version.start()
        self.addCleanup(self.version.stop)

    def request(self, command, payload=None, **overrides):
        self.counter += 1
        descriptor = self.session.descriptor()
        result = {
            "protocol_version": "2.0", "kind": "request",
            "session_id": descriptor["session_id"],
            "app_id": descriptor["app_id"], "request_id": f"request-{self.counter}",
            "command": command, "context_id": None, "generation": None,
            "payload": {} if payload is None else payload,
        }
        result.update(overrides)
        return result

    def hello(self):
        return self.session.dispatch(self.request("host.handshake", {
            "supported_versions": ["2.0"], "client_version": "test",
            "contract_release": "2.0.0-rc.1",
        }))

    def test_all_six_commands_and_responses_validate(self):
        hello = self.hello()
        self.assertEqual(hello["result"]["session_id"], hello["session_id"])
        commands = hello["result"]["capabilities"]
        self.assertEqual(len(commands), 6)
        self.assertEqual(len({item["command"] for item in commands}), 6)
        self.assertFalse(hello["result"]["limits"]["operation_status_supported"])
        self.assertIsNone(hello["result"]["context"]["allplan_version"])
        for command, payload in (
            ("host.capabilities", {}), ("host.context", {}),
            ("diagnostic.get", {}), ("diagnostic.set", {"enabled": True}),
            ("diagnostic.open_logs", {}),
        ):
            with self.subTest(command=command), patch.object(logging_setup, "open_log_directory") as opened:
                response = self.session.dispatch(self.request(command, payload))
                self.assertTrue(ControlValidator().valid("response", response))
                self.assertEqual(response["status"], "success")
                self.assertEqual(opened.call_count, int(command == "diagnostic.open_logs"))
        self.assertTrue(logging_setup.diagnostic_enabled())
        self.assertEqual(self.events[0]["payload"], {"enabled": True})
        self.assertTrue(ControlValidator().valid("event", self.events[0]))
        script = event_script(self.events[0])
        self.assertIn("__allplanProtocolClient", script)
        self.assertIn("client.receive_message(message)", script)
        with self.assertRaises(ValueError):
            event_script({**self.events[0], "payload": {"enabled": "true"}})

    def test_handshake_required_without_effect_and_retry_after_hello(self):
        request = self.request("diagnostic.set", {"enabled": True})
        with patch.object(logging_setup, "set_diagnostic") as setter:
            response = self.session.dispatch(request)
            self.assertEqual(response["error"]["code"], "configuration_error")
            setter.assert_not_called()
            self.hello()
            self.session.dispatch(request)
            setter.assert_called_once_with(True)

    def test_handshake_identity_deduplication_and_no_shared_mutability(self):
        request = self.request("host.handshake", {
            "supported_versions": ["2.0"], "client_version": "test",
            "contract_release": "2.0.0-rc.1",
        })
        first = self.session.dispatch(request)
        first["result"]["context"]["paths"]["PRJ"] = "altered"
        second = self.session.dispatch(request)
        self.assertEqual(second["result"]["context"]["paths"], {})
        self.assertEqual(second["session_id"], second["result"]["session_id"])
        self.assertEqual(second["app_id"], second["result"]["app_id"])

    def test_no_protocol_intersection_is_structured_error(self):
        response = self.session.dispatch(self.request("host.handshake", {
            "supported_versions": ["1.0"], "client_version": "test",
            "contract_release": "2.0.0-rc.1",
        }))
        self.assertEqual(response["error"]["code"], "unsupported_protocol")

    def test_session_checked_before_request_lookup_and_origin_revoked(self):
        self.hello()
        request = self.request("diagnostic.get")
        self.session.dispatch(request)
        for key, value in (("session_id", "old-session"), ("app_id", "smartcatalog")):
            with self.subTest(key=key), self.assertRaises(ProtocolBoundaryError):
                self.session.dispatch({**request, key: value})
        self.guard.return_value = False
        with self.assertRaises(ProtocolBoundaryError):
            self.session.dispatch(request)
        self.guard.return_value = True
        with self.assertRaises(ProtocolBoundaryError):
            self.session.dispatch(request)

    def test_no_authorizer_and_explicit_invalidation_are_fail_closed(self):
        other = ControlSession("information_manager", LaunchContext())
        with self.assertRaises(ProtocolBoundaryError):
            other.dispatch(self.request("host.handshake"))
        self.session.invalidate()
        with self.assertRaises(ProtocolBoundaryError):
            self.hello()

    def test_new_session_same_request_id_does_not_accept_old_request(self):
        request = self.request("diagnostic.get")
        new = ControlSession("information_manager", LaunchContext(), authorize=lambda: True)
        self.assertNotEqual(new.descriptor()["session_id"], request["session_id"])
        with self.assertRaises(ProtocolBoundaryError):
            new.dispatch(request)

    def test_authorization_is_strict_boolean_not_truthiness(self):
        for authorization in ("false", 1, None):
            with self.subTest(authorization=authorization):
                session = ControlSession(
                    "information_manager", LaunchContext(),
                    authorize=lambda: authorization,
                )
                request = self.request(
                    "diagnostic.get", session_id=session.descriptor()["session_id"],
                )
                with self.assertRaises(ProtocolBoundaryError):
                    session.dispatch(request)

    def test_integrity_failure_is_never_replaced_by_default_schema(self):
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for name in ("schema.json", "fixtures.json", "manifest.json"):
                shutil.copyfile(artifact_directory() / name, directory / name)
            with (directory / "schema.json").open("ab") as stream:
                stream.write(b"\n")
            with patch("application.core.protocol_control.artifact_directory", return_value=directory):
                with self.assertRaisesRegex(RuntimeError, "integrity"):
                    ControlValidator()

    def test_reserved_commands_and_bad_payloads_have_no_effect(self):
        self.hello()
        with patch.object(logging_setup, "open_log_directory") as opened, \
                patch.object(logging_setup, "set_diagnostic") as setter:
            for command in (
                "vob.open", "vob.save", "vob.files.list", "catalog.open",
                "aim.presentation.save", "aim.values.write", "host.refresh", "operation.status",
            ):
                with self.subTest(command=command), self.assertRaises(ProtocolBoundaryError):
                    self.session.dispatch(self.request(command))
            with self.assertRaises(ProtocolBoundaryError):
                self.session.dispatch(self.request("diagnostic.set", {"enabled": "true"}))
            setter.assert_not_called()
            opened.assert_not_called()

    def test_exactly_once_effects_under_concurrent_duplicate_requests(self):
        self.hello()
        request = self.request("diagnostic.open_logs")
        with patch.object(logging_setup, "open_log_directory") as opened:
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses = list(pool.map(self.session.dispatch, [request] * 8))
            opened.assert_called_once()
        self.assertTrue(all(response == responses[0] for response in responses))
        changed = deepcopy(request)
        changed["command"] = "diagnostic.get"
        with self.assertRaises(ProtocolBoundaryError):
            self.session.dispatch(changed)

    def test_diagnostic_event_emitted_once_for_duplicate(self):
        self.hello()
        request = self.request("diagnostic.set", {"enabled": False})
        self.session.dispatch(request)
        self.session.dispatch(request)
        self.assertEqual(len(self.events), 1)
        self.assertFalse(logging_setup.diagnostic_enabled())

    def test_access_failure_is_validated_and_not_retried(self):
        self.hello()
        request = self.request("diagnostic.open_logs")
        with patch.object(logging_setup, "open_log_directory", side_effect=PermissionError) as opened:
            response = self.session.dispatch(request)
            self.assertEqual(response["error"]["code"], "access_denied")
            self.assertEqual(response, self.session.dispatch(request))
            opened.assert_called_once()
        self.assertTrue(ControlValidator().valid("response", response))

    def test_bad_handler_result_invalidates_session(self):
        self.hello()
        with patch.object(logging_setup, "diagnostic_enabled", return_value="true"):
            with self.assertRaises(ProtocolBoundaryError):
                self.session.dispatch(self.request("diagnostic.get"))
        with self.assertRaises(ProtocolBoundaryError):
            self.session.dispatch(self.request("diagnostic.get"))

    def test_unexpected_failure_after_effect_does_not_enable_retry(self):
        self.hello()
        request = self.request("diagnostic.open_logs")
        with patch.object(logging_setup, "open_log_directory", side_effect=RuntimeError("failure")) as opened:
            with self.assertRaises(ProtocolBoundaryError):
                self.session.dispatch(request)
            with self.assertRaises(ProtocolBoundaryError):
                self.session.dispatch(request)
            opened.assert_called_once()

    def test_saturation_refuses_without_eviction_of_completed_effects(self):
        self.hello()
        request = self.request("diagnostic.open_logs")
        with patch("application.core.protocol_control._MAX_REQUESTS", 2), \
                patch.object(logging_setup, "open_log_directory") as opened:
            response = self.session.dispatch(request)
            with self.assertRaises(ProtocolBoundaryError):
                self.session.dispatch(self.request("diagnostic.open_logs"))
            self.assertEqual(response, self.session.dispatch(request))
            opened.assert_called_once()

    def test_strict_json_and_utf8_byte_limit(self):
        for text in ('{"a":1,"a":2}', '{"value":NaN}', '{"value":1e999}'):
            with self.subTest(text=text), self.assertRaises(ProtocolBoundaryError):
                self.session.dispatch(text)
        request = self.request("host.handshake", {
            "supported_versions": ["2.0"], "client_version": "\u00e9" * 50,
            "contract_release": "2.0.0-rc.1",
        })
        text = json.dumps(request, ensure_ascii=False)
        with patch("application.core.protocol_control._MAX_MESSAGE_BYTES", len(text)):
            with self.assertRaises(ProtocolBoundaryError):
                self.session.dispatch(text)

    def test_projection_is_frozen_snapshot_no_registry_or_project_read(self):
        context = LaunchContext(
            allplan_version="2026", country="FRA", allplan_language="deu",
            paths={"PRJ": ROOT}, project_path=None,
        )
        session = ControlSession("vob_editor", context, authorize=lambda: True)
        context.country = "DEU"
        request = self.request("host.handshake", {
            "supported_versions": ["2.0"], "client_version": "test",
            "contract_release": "2.0.0-rc.1",
        }, session_id=session.descriptor()["session_id"], app_id="vob_editor")
        result = session.dispatch(request)["result"]["context"]
        self.assertEqual(result["country"], "FRA")
        self.assertEqual(result["allplan_language"], "deu")
        self.assertIsNone(result["project_path"])
        self.assertEqual(result["paths"], {"PRJ": str(ROOT)})
        with self.assertRaisesRegex(ValueError, "represented"):
            ControlSession("vob_editor", LaunchContext(allplan_version="99"))

    def test_facade_exposes_only_dispatch_and_bootstrap_names_are_exact(self):
        facade = ControlFacade(self.session)
        self.assertEqual([name for name in dir(facade) if not name.startswith("_")], ["dispatch"])
        script = bootstrap_script(self.session.descriptor())
        client = (ROOT / "application" / "core" / "resources" / "protocol_control_client.js").read_text()
        for name in ("__allplanProtocolHost", "allplan-protocol-host-ready"):
            self.assertIn(name, script)
            self.assertIn(name, client)
        self.assertIn("__allplanProtocolClient", client)
        self.assertIn("receive_message", client)
        self.assertIn("if (!alive || handshake) return handshake", client)
        self.assertLess(client.index('addEventListener("allplan-protocol-host-ready"'), client.rindex("connect();"))
        self.assertIn("Object.freeze(value.protocol_versions)", script)
        self.assertNotIn("window.allplanHost", script + client)

    def test_missing_optional_dependency_fails_explicitly(self):
        with patch.dict(sys.modules, {"jsonschema": None}):
            with self.assertRaisesRegex(RuntimeError, "protocol-control-test"):
                ControlValidator()

    def test_mode_uses_only_native_runner_without_context_resolution(self):
        from application.launcher.main import main
        with patch("application.launcher.main.resolve_context") as resolve, \
                patch("application.launcher.main.run_app") as run, \
                patch("application.launcher.protocol_control.run_control_test") as native:
            self.assertEqual(main(["information_manager", "--protocol-control-test"]), 0)
            resolve.assert_not_called()
            run.assert_not_called()
            native.assert_called_once()
            self.assertEqual(native.call_args.args[0], "information_manager")
            self.assertEqual(native.call_args.args[1], LaunchContext())
        self.assertNotIn("--protocol-control-test", context_to_arguments(LaunchContext()))

    def test_mode_requires_app_and_refuses_business_options(self):
        from application.launcher.main import main
        from application.core.errors import LaunchError
        for arguments in (
            ["--protocol-control-test"],
            ["information_manager", "--protocol-control-test", "--paths", str(ROOT / "unused.json")],
        ):
            with self.subTest(arguments=arguments), self.assertRaises(LaunchError):
                main(arguments)

    def test_legacy_discovery_has_no_validator_dependency(self):
        probe = subprocess.run([
            sys.executable, "-I", "-S", "-c",
            f"import sys; sys.path.insert(0, {str(ROOT)!r}); "
            "from application.launcher.main import create_parser; "
            "from application.core.catalog import PLUGINS; "
            "assert len(PLUGINS) == 3; "
            "assert 'jsonschema' not in sys.modules; "
            "assert 'application.core.protocol_control' not in sys.modules; "
            "assert 'application.launcher.protocol_control' not in sys.modules; "
            "assert 'application.launcher.smartcatalog_remote_control' not in sys.modules; "
            "assert 'clr' not in sys.modules; assert 'System' not in sys.modules; "
            "assert 'webview' not in sys.modules",
        ], capture_output=True, text=True)
        self.assertEqual(probe.returncode, 0, probe.stderr)

    def test_legacy_launch_keeps_original_app_path_without_control_import(self):
        from application.launcher.main import main
        with patch("application.launcher.main.resolve_context", return_value=LaunchContext()) as resolve, \
                patch("application.launcher.main.validate_resources"), \
                patch("application.launcher.main.run_app") as run, \
                patch("application.launcher.main.resolve_plugin") as plugin:
            plugin.return_value.id = "information_manager"
            self.assertEqual(main(["information_manager"]), 0)
            resolve.assert_called_once()
            run.assert_called_once()
            self.assertFalse(run.call_args.args[2].protocol_control_test)


class ProtocolWheelTests(unittest.TestCase):
    def test_git_checkout_preserves_release_bytes_despite_parent_normalization(self):
        source = artifact_directory()
        relative = Path("docs") / "integration" / "protocol" / source.name
        with TemporaryDirectory(prefix="rc1-git-bytes-") as temporary:
            root = Path(temporary)
            repository = root / "repository"
            repository.mkdir()

            def git(*args):
                return subprocess.run(
                    ["git", "-c", f"safe.directory={repository}", *args],
                    cwd=repository, check=True, capture_output=True, text=True,
                ).stdout

            git("init", "--quiet")
            # Simulate an inherited parent rule and hostile global line-ending defaults.
            (repository / ".gitattributes").write_text(
                "*.json text eol=lf ident\n", encoding="ascii",
            )
            destination = repository / relative
            destination.mkdir(parents=True)
            policy = ROOT / relative / ".gitattributes"
            shutil.copyfile(policy, destination / ".gitattributes")
            names = ("schema.json", "fixtures.json", "manifest.json")
            originals = {name: (source / name).read_bytes() for name in names}
            for name, content in originals.items():
                (destination / name).write_bytes(content)
            for autocrlf in ("true", "false"):
                git("-c", f"core.autocrlf={autocrlf}", "add", ".")
                attributes = git(
                    "check-attr", "text", "eol", "filter", "ident", "working-tree-encoding",
                    "--", str(relative / "schema.json"),
                )
                self.assertEqual(attributes.count(": unset"), 5)
                tree = git("write-tree").strip()
                git("read-tree", tree)
                checkout = root / f"checkout-{autocrlf}"
                checkout.mkdir()
                git(
                    "-c", f"core.autocrlf={autocrlf}", "checkout-index", "--all",
                    f"--prefix={checkout.as_posix()}/",
                )
                for name, content in originals.items():
                    with self.subTest(autocrlf=autocrlf, file=name):
                        self.assertEqual((checkout / relative / name).read_bytes(), content)

    def test_wheel_contains_exact_artifacts_and_control_modules(self):
        wheel = os.environ.get("ALLPLAN_LAUNCHER_TEST_WHEEL")
        if not wheel:
            self.skipTest("Set ALLPLAN_LAUNCHER_TEST_WHEEL to a freshly built wheel.")
        with zipfile.ZipFile(wheel) as archive, TemporaryDirectory(prefix="RC1 espace \u00e9 ") as directory:
            for name in ("schema.json", "fixtures.json", "manifest.json"):
                resource = "application/core/resources/protocol/2.0.0-rc.1/" + name
                self.assertEqual(
                    archive.read(resource), (artifact_directory() / name).read_bytes(),
                )
            for name in (
                "application/core/protocol_control.py",
                "application/launcher/protocol_control.py",
                "application/launcher/smartcatalog_remote_control.py",
                "application/core/resources/protocol_control.html",
                "application/core/resources/protocol_control_client.js",
            ):
                self.assertIn(name, archive.namelist())
            archive.extractall(directory)
            result = subprocess.run([
                sys.executable, "-c",
                f"import sys; sys.path.insert(0, {directory!r}); "
                "from application.core.protocol_control import ControlValidator, artifact_directory; "
                "from application.launcher.protocol_control import control_resources; "
                "from application.launcher.smartcatalog_remote_control import RemoteRecipePolicy; "
                "assert len(control_resources()) == 2; "
                "assert not RemoteRecipePolicy('https://recipe.invalid/', "
                "frozenset({'https://assets.invalid/app.js'})).allows_navigation("
                "'https://recipe.invalid/other'); "
                "assert 'clr' not in sys.modules; assert 'webview' not in sys.modules; "
                "ControlValidator(); "
                f"assert str(artifact_directory()).startswith({directory!r})",
            ], cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
