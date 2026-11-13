import hashlib
import json
import logging
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from application.launcher.aim_remote_review import (
    COMMANDS, ORIGIN, ROUTE, PublishedBoundary, ReviewApi, published_resources,
    REVIEW_COMMANDS, python_log_diagnostic, runtime_diagnostic,
    AimLogSummary, UPDATE_FRONTENDS, TREE_FRONTENDS,
)
from application.plugins.information_manager.presentation import AimPresentationApp
from application.core.context import LaunchContext


class RemoteReviewTests(unittest.TestCase):
    def test_exact_reviewed_frontend_profiles_preserve_legacy_and_v1(self):
        reviewed = "05427002aaa64bd20f72ba27afc7586cd5b177fa"
        self.assertIn(reviewed, UPDATE_FRONTENDS)
        self.assertIn(reviewed, TREE_FRONTENDS)
        previous = "2bd4fbbad1f9d8c2a86db515377bfb32778395de"
        self.assertIn(previous, UPDATE_FRONTENDS)
        self.assertNotIn(previous, TREE_FRONTENDS)
        for revision in ("0542700", reviewed + "-modified", "unreviewed"):
            self.assertNotIn(revision, UPDATE_FRONTENDS)
            self.assertNotIn(revision, TREE_FRONTENDS)

    def public_fixture(self):
        script = ("presentation_contract presentation_capabilities "
                  "aim-organized-presentation " + " ".join(COMMANDS)).encode()
        path = "/assets/information-manager-test.js"
        manifest = {
            "schema": "build-identity/1", "revision": "test",
            "trackedChangesAtBuild": False,
            "files": [{"file": path, "sha256": hashlib.sha256(script).hexdigest()}],
        }
        documents = {
            ROUTE: b"<html>published</html>", ORIGIN + path: script,
            ORIGIN + "/build-manifest.json": json.dumps(manifest).encode(),
        }
        return documents

    def test_published_assets_hashes_and_revision_are_pinned(self):
        docs = self.public_fixture()
        manifest, resources = published_resources("test", docs.__getitem__)
        self.assertEqual(manifest["revision"], "test")
        self.assertEqual(resources[ROUTE][1], docs[ROUTE])
        self.assertNotIn(ORIGIN + "/~flock.js", resources)
        with self.assertRaises(ValueError):
            published_resources("other", docs.__getitem__)
        docs[ORIGIN + "/assets/information-manager-test.js"] = b"changed"
        with self.assertRaises(ValueError):
            published_resources("test", docs.__getitem__)

    def test_block_all_unlisted_requests_and_non_gets_before_network(self):
        environment = MagicMock()
        denied = object()
        environment.CreateWebResourceResponse.return_value = denied
        boundary = PublishedBoundary(
            {ROUTE: ("text/html", b"published")}, environment,
            SimpleNamespace(Document="document"), None, [], lambda: None,
        )
        for uri, method, context in (
            (ORIGIN + "/~flock.js", "GET", "script"),
            (ORIGIN + "/__l5e/events.changed.js", "GET", "script"),
            ("https://third-party.invalid/collect", "POST", "fetch"),
            (ORIGIN + "/~api/analytics", "POST", "fetch"),
            (ROUTE, "POST", "document"),
            (ROUTE + "?x=1", "GET", "document"),
            ("file:///C:/private", "GET", "image"),
        ):
            args = SimpleNamespace(Request=SimpleNamespace(Uri=uri, Method=method),
                                   ResourceContext=context, Response=None)
            boundary.request(None, args)
            self.assertIs(args.Response, denied)

    def test_allowed_response_gets_csp_and_no_store(self):
        environment = MagicMock()
        native = SimpleNamespace(MemoryStream=lambda x: x, Array={int: lambda x: x}, Byte=int)
        boundary = PublishedBoundary(
            {ROUTE: ("text/html", b"published")}, environment,
            SimpleNamespace(Document="document"), None, [], lambda: None,
        )
        boundary.native = native
        args = SimpleNamespace(Request=SimpleNamespace(Uri=ROUTE, Method="GET"),
                               ResourceContext="document", Response=None)
        boundary.request(None, args)
        headers = environment.CreateWebResourceResponse.call_args.args[3]
        self.assertIn("connect-src 'none'", headers)
        self.assertIn("Cache-Control: no-store", headers)

    def test_identity_gated_facade_only_delegates_recipe_commands(self):
        app = MagicMock()
        app.get_initial_data.return_value = {
            "selection": "accepted", "data": {"attributes": []}, "diagnostics": [],
        }
        app.call.return_value = {"ok": True, "status": "cancelled"}
        api = ReviewApi(app)
        with self.assertRaises(RuntimeError):
            api.get_app_info()
        api.active = True
        with self.assertRaises(RuntimeError):
            api.get_initial_data()
        api.get_app_info()
        api.get_initial_data()
        for command in ("save", "prjtool", "open_app", None, []):
            self.assertFalse(api.call(command, {})["ok"])
        app.call.assert_not_called()
        for command in REVIEW_COMMANDS:
            api.call(command, {})
        self.assertEqual(app.call.call_count, len(REVIEW_COMMANDS))
        api.active = False
        with self.assertRaises(RuntimeError):
            api.call(COMMANDS[0], {})

    def test_favorite_updated_reply_is_returned_without_presentation_logging(self):
        app = MagicMock()
        reply = {"ok": True, "status": "updated",
                 "path": r"C:\Projects\Example.prj", "favorite": True}
        app.call.return_value = reply
        api = ReviewApi(app)
        api.active = True
        api.get_app_info()
        with patch("application.launcher.aim_remote_review.trace") as trace:
            self.assertIs(api.call("project.manager.favorite.set", {
                "path": reply["path"], "favorite": True,
            }), reply)
        events = [call.args[0].split(" ", 1)[0] for call in trace.call_args_list]
        self.assertEqual(events, ["AIM_NATIVE_COMMAND", "AIM_NATIVE_REPLY"])
        app.call.assert_called_once_with("project.manager.favorite.set", {
            "path": reply["path"], "favorite": True,
        })

    def test_presentation_updated_reply_keeps_structural_logging(self):
        app = MagicMock()
        app.call.return_value = {
            "ok": True, "status": "updated",
            "presentation": {"configuration": {"version": 2},
                             "model": {"version": 2, "categories": [],
                                       "counts": {"rows": 0}}},
        }
        api = ReviewApi(app)
        api.active = True
        api.get_app_info()
        with patch("application.launcher.aim_remote_review.trace") as trace:
            self.assertIs(api.call("presentation.update", {}), app.call.return_value)
        events = [call.args[0].split(" ", 1)[0] for call in trace.call_args_list]
        self.assertEqual(events, [
            "AIM_NATIVE_COMMAND", "AIM_NATIVE_REPLY", "AIM_PRESENTATION_COUNTS",
        ])

    def test_project_select_reaches_existing_service_and_keeps_normal_guard(self):
        with TemporaryDirectory() as directory:
            choose = MagicMock(return_value=None)
            app = AimPresentationApp(
                Path(directory), LaunchContext(), choose_directory=choose,
            )
            api = ReviewApi(app)
            api.active = True
            api.get_app_info()
            self.assertEqual(app.get_app_info()["capabilities"], ["project.select"])
            self.assertTrue(app._requires_protected_host)
            with patch("application.launcher.aim_remote_review.trace") as output:
                refused = api.call("project.select", {"path": "PRIVATE_VALUE"})
                self.assertFalse(refused["ok"])
                choose.assert_not_called()
                reply = api.call("project.select", {})
                self.assertTrue(reply["ok"])
                self.assertEqual(reply["data"]["selection"], "cancelled")
                choose.assert_called_once_with()
                self.assertNotIn("PRIVATE_VALUE", str(output.call_args_list))

    def test_project_select_uses_native_loader_and_logs_only_structure(self):
        with TemporaryDirectory() as directory:
            app = AimPresentationApp(
                Path(directory), LaunchContext(),
                choose_directory=lambda: r"C:\PRIVATE_PROJECT.prj",
            )
            state = app._empty("accepted", [])
            state["project"] = {"path": r"C:\PRIVATE_PROJECT.prj", "name": "PRIVATE_PROJECT"}
            api = ReviewApi(app)
            api.active = True
            api.get_app_info()
            with patch.object(app, "_load", return_value=state) as load:
                with patch("application.launcher.aim_remote_review.trace") as output:
                    reply = api.call("project.select", {})
            load.assert_called_once()
            self.assertEqual(reply["data"]["project"], state["project"])
            self.assertNotIn("PRIVATE_PROJECT", str(output.call_args_list))

    def test_recent_history_is_exposed_through_protected_facade_without_business_logs(self):
        with TemporaryDirectory() as directory:
            app = AimPresentationApp(Path(directory), LaunchContext())
            app._settings_store.save(app.app_id, {
                "version": 1, "aimProject": {"lastProject": r"C:\PRIVATE_PROJECT.prj"},
            })
            api = ReviewApi(app)
            with self.assertRaises(RuntimeError):
                api.call("project.recent", {})
            api.active = True
            info = api.get_app_info()
            self.assertEqual(info["project_history_contract"], 1)
            self.assertEqual(info["capabilities"], ["project.select"])
            with patch("application.launcher.aim_remote_review.trace") as output:
                reply = api.call("project.recent", {})
                self.assertTrue(reply["ok"])
                self.assertEqual(reply["projects"][0]["path"], r"C:\PRIVATE_PROJECT.prj")
                self.assertNotIn("PRIVATE_PROJECT", str(output.call_args_list))
            for payload in (None, [], {"path": r"C:\PRIVATE_PROJECT.prj"}):
                self.assertFalse(api.call("project.recent", payload)["ok"])

    def test_python_capture_never_formats_business_messages_or_arguments(self):
        record = logging.LogRecord(
            "application.reader", logging.ERROR, __file__, 1,
            "Cannot read PRIVATE_PATH: %s", ("PRIVATE_VALUE",), None,
        )
        self.assertEqual(python_log_diagnostic(record), {
            "logger": "application.reader", "level": "ERROR", "exceptionType": None,
        })

    def test_summary_retains_safe_codes_counts_but_not_paths_values_or_empty_repetition(self):
        summary = AimLogSummary()
        with patch("application.launcher.aim_remote_review.trace") as output:
            for _ in range(5):
                summary.emit(logging.LogRecord(
                    "application.core.allplan.models", logging.WARNING, __file__, 1,
                    "Allplan reader: category=%s code=%s attribute=%s conflict=%s",
                    ("private category", "uid_conflict", "private number", "private hash"), None,
                ))
            summary.emit(logging.LogRecord(
                "pywebview", logging.WARNING, __file__, 1,
                "Cannot delete PRIVATE_PATH: PRIVATE_VALUE", (), None,
            ))
            output.assert_not_called()
            summary.flush()
            output.assert_called_once()
            text = output.call_args.args[0]
            result = json.loads(text.split(" ", 1)[1])
            self.assertEqual(result["total"], 6)
            self.assertEqual({r["code"]: r["count"] for r in result["codes"]},
                             {"uid_conflict": 5, "python_warning": 1})
            self.assertNotIn("private", text.lower())
            output.reset_mock()
            summary.flush()
            output.assert_not_called()

    def test_navigation_popup_and_download_remain_blocked(self):
        boundary = PublishedBoundary(
            {}, None, SimpleNamespace(Document="document"), None, [], lambda: None,
        )
        args = SimpleNamespace(Uri="https://elsewhere.invalid", Cancel=False, Handled=False)
        boundary.navigation(None, args)
        self.assertTrue(args.Cancel)
        boundary.popup(None, args)
        self.assertTrue(args.Handled)
        boundary.download(None, args)
        self.assertTrue(args.Cancel)

    def test_runtime_observation_drops_business_objects_and_url_parameters(self):
        result = runtime_diagnostic({"exceptionDetails": {
            "exception": {"className": "Error", "description": "private business text",
                          "value": {"private": "project value"}},
            "stackTrace": {"callFrames": [{
                "functionName": "render", "url": ORIGIN + "/assets/test.js?secret=hidden",
                "lineNumber": 1, "columnNumber": 2,
            }]},
        }})
        serialized = json.dumps(result)
        self.assertNotIn("private", serialized)
        self.assertNotIn("secret", serialized)
        self.assertNotIn("project value", serialized)
        self.assertEqual(result["frames"][0]["path"], "/assets/test.js")
        self.assertIsNone(result["message"])


if __name__ == "__main__":
    unittest.main()
