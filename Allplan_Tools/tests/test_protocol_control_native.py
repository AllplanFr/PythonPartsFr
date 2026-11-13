"""Boundary unit tests: never create a CLR window or change release artifacts."""
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from application.core.context import LaunchContext
from application.core.protocol_control import ProtocolBoundaryError
from application.launcher.protocol_control import (
    CSP, DOCUMENT, SCRIPT, NativeControl, control_resources, load_native,
)


class NativeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.n = SimpleNamespace(
            ResourceContext=SimpleNamespace(Document=1, Script=2, All=3),
            RequestSourceKinds=SimpleNamespace(All=7),
            PermissionState=SimpleNamespace(Deny=0),
            MemoryStream=lambda value: value, Array={int: bytes}, Byte=int,
        )
        self.adapter = NativeControl("information_manager", LaunchContext(), self.n, control_resources())
        self.adapter.core = Mock(Source=DOCUMENT)
        self.adapter.environment = Mock()
        self.adapter.denied_response = Mock()
        self.adapter.form = Mock(IsDisposed=False)

    def navigation(self, uri=DOCUMENT, redirect=False, identity=1):
        args = SimpleNamespace(Uri=uri, IsRedirected=redirect, NavigationId=identity, Cancel=False)
        self.adapter.navigation_starting(None, args)
        return args

    def ready(self):
        self.navigation()
        self.adapter.navigation_completed(None, SimpleNamespace(IsSuccess=True, NavigationId=1))
        return self.adapter.session

    def test_closed_allowlist_packaged_resources(self):
        self.assertEqual(set(control_resources()), {DOCUMENT, SCRIPT})
        with self.assertRaises(TypeError):
            control_resources()["https://attack.invalid"] = (b"", "text/html")
        with self.assertRaisesRegex(ValueError, "allowlist"):
            NativeControl("information_manager", LaunchContext(), self.n, {})
        self.assertIn("frame-src 'none'", CSP)
        self.assertIn("frame-ancestors 'none'", CSP)
        for uri, method, context, accepted in (
            (DOCUMENT, "GET", 1, True), (SCRIPT, "GET", 2, True),
            (DOCUMENT, "POST", 1, False), (SCRIPT, "GET", 1, False),
            (DOCUMENT + "?x", "GET", 1, False), (SCRIPT + "#x", "GET", 2, False),
            ("https://other.invalid/a", "GET", 2, False), ("file:///a", "GET", 1, False),
            ("data:text/html,x", "GET", 1, False), ("about:blank", "GET", 1, False),
        ):
            with self.subTest(uri=uri, method=method, context=context):
                args = SimpleNamespace(Request=SimpleNamespace(Uri=uri, Method=method),
                                       ResourceContext=context)
                self.adapter.resource_requested(None, args)
                call = self.adapter.environment.CreateWebResourceResponse.call_args.args
                self.assertEqual(call[1], 200 if accepted else 403)
                self.assertIn("Content-Security-Policy:", call[3])
                self.assertIn("nosniff", call[3])

    def test_navigation_exact_target_redirect_and_invalidation(self):
        for uri, redirect in (
            (DOCUMENT + "?a", False), (DOCUMENT + "#x", False), (SCRIPT, False),
            ("https://external.invalid/", False), ("file:///x", False),
            ("javascript:alert(1)", False), (DOCUMENT, True),
        ):
            with self.subTest(uri=uri, redirect=redirect):
                session = self.ready()
                args = self.navigation(uri, redirect)
                self.assertTrue(args.Cancel)
                self.assertIsNone(self.adapter.session)
                self.assertFalse(self.adapter.authorized(session))
                with self.assertRaises(ProtocolBoundaryError):
                    session.dispatch({})

    def test_reload_new_session_and_no_stale_delivery(self):
        old = self.ready()
        self.adapter.enqueue_delivery(old, {"kind": "response"})
        new = self.ready()
        self.assertNotEqual(old.descriptor()["session_id"], new.descriptor()["session_id"])
        self.adapter.tick(None, None)
        self.adapter.core.PostWebMessageAsJson.assert_not_called()
        self.assertIn("stale-delivery-dropped", self.adapter.audit)
        self.assertEqual(new.descriptor()["transport"], "webview2_post_message")

    def test_main_message_source_document_and_native_state_checked_before_dispatch(self):
        for source, current, ready in (
            (DOCUMENT + "#x", DOCUMENT, True),
            ("https://external.invalid/", DOCUMENT, True),
            (DOCUMENT, SCRIPT, True), (DOCUMENT, DOCUMENT, False),
        ):
            with self.subTest(source=source, current=current, ready=ready):
                session = self.ready()
                self.adapter.core.Source, self.adapter.ready = current, ready
                args = SimpleNamespace(Source=source, WebMessageAsJson="{}")
                self.adapter.message_received(None, args)
                self.assertTrue(self.adapter.tasks.empty())
                self.assertFalse(self.adapter.authorized(session))
                self.adapter.core.Source = DOCUMENT
        session = self.ready()
        self.adapter.message_received(None, SimpleNamespace(Source=DOCUMENT, WebMessageAsJson="{}"))
        queued = self.adapter.tasks.get_nowait()
        self.assertIs(queued[0], session)

    def test_navigation_complete_requires_matching_identity_success_and_source(self):
        for success, identity, source in (
            (False, 1, DOCUMENT), (True, 2, DOCUMENT), (True, 1, SCRIPT),
        ):
            self.navigation()
            self.adapter.core.Source = source
            self.adapter.navigation_completed(None, SimpleNamespace(
                IsSuccess=success, NavigationId=identity,
            ))
            self.assertIsNone(self.adapter.session)

    def test_popup_frames_close_and_permissions_fail_closed(self):
        session = self.ready()
        args = SimpleNamespace(Handled=False)
        self.adapter.popup(None, args)
        self.assertTrue(args.Handled)
        self.adapter.frame(None, Mock())
        self.adapter.form.Close.assert_called_once()
        self.assertFalse(self.adapter.authorized(session))
        args = SimpleNamespace(Handled=False)
        self.adapter.permission(None, args)
        self.assertEqual(args.State, 0)
        self.assertTrue(args.Handled)
        args = SimpleNamespace(Cancel=False)
        self.adapter.download(None, args)
        self.assertTrue(args.Cancel)
        self.adapter.on_closed(None, None)
        self.assertTrue(self.adapter.closed)

    def test_boundary_subscriptions_precede_first_navigation_and_no_frame_transport(self):
        self.adapter.view = Mock(CoreWebView2=self.adapter.core)
        order = []
        with patch.object(self.adapter, "subscribe", side_effect=lambda obj, name, handler: order.append(name)):
            self.adapter.core.Navigate.side_effect = lambda url: order.append(url)
            self.adapter.install_boundary()
        self.assertEqual(order[-1], DOCUMENT)
        for name in ("WebResourceRequested", "NavigationStarting", "NewWindowRequested",
                     "FrameCreated", "WebMessageReceived", "ProcessFailed"):
            self.assertLess(order.index(name), order.index(DOCUMENT))
        self.assertFalse(self.adapter.core.Settings.AreHostObjectsAllowed)

    def test_missing_python_and_native_dependencies_are_explicit(self):
        with patch("application.launcher.protocol_control.find_spec", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Python dependency"):
                load_native()
        with patch.object(Path, "is_file", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "assembly/loader missing"):
                load_native()

    def test_missing_packaged_page_is_not_replaced_by_remote_or_legacy(self):
        with patch.object(Path, "is_file", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "packaged resource missing"):
                control_resources()

    def test_resource_failure_still_has_precreated_deny_response(self):
        args = SimpleNamespace(Request=Mock(), ResourceContext=1)
        with patch.dict(self.n.__dict__, {"MemoryStream": Mock(side_effect=RuntimeError("controlled"))}):
            with self.assertRaises(RuntimeError):
                self.adapter.resource_requested(None, args)
        self.assertIs(args.Response, self.adapter.denied_response)

    def test_source_replacement_and_window_close_invalidate_session(self):
        old = self.ready()
        self.adapter.source_changed(None, SimpleNamespace(IsNewDocument=True))
        self.assertFalse(self.adapter.authorized(old))
        old = self.ready()
        self.adapter.core.Source = DOCUMENT + "#replaced"
        self.adapter.source_changed(None, SimpleNamespace(IsNewDocument=False))
        self.assertFalse(self.adapter.authorized(old))

    def test_cleanup_never_deletes_unowned_path(self):
        with patch("application.launcher.protocol_control.shutil.rmtree") as remove:
            self.adapter.dispose()
        remove.assert_not_called()

    def test_cleanup_failure_reports_owned_profile_path(self):
        self.adapter.owns_profile = True
        with patch.object(Path, "exists", return_value=True), \
                patch("application.launcher.protocol_control.shutil.rmtree", side_effect=OSError("locked")), \
                patch("application.launcher.protocol_control.time.sleep"), \
                self.assertLogs("application.launcher.protocol_control", level="ERROR") as logs:
            self.adapter.dispose()
        self.assertIn(str(self.adapter.profile), self.adapter.errors[-1])
        self.assertIn(str(self.adapter.profile), logs.output[-1])


if __name__ == "__main__":
    unittest.main()
