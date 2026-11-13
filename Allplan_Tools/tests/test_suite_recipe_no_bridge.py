from types import SimpleNamespace
from unittest.mock import Mock
import hashlib
import json
import unittest

from application.launcher.suite_recipe_no_bridge import (
    BLOCKED, ORIGIN, REVISION, RecipeWindow, check_manifest,
    REJECTION_OBSERVER, diagnostic_stack, install_then_navigate, is_variant,
    AIM_FIX_REVISION, AimFixVerification, AimGuardComplement, check_asset,
)


class Event:
    def __init__(self, calls):
        self.calls = calls

    def __iadd__(self, handler):
        self.calls.append("handler")
        return self


class RecipeTests(unittest.TestCase):
    def test_unidentifiable_coverage_still_attempts_final_manifest(self):
        window = AimFixVerification(None, None)
        window.manifest = {"files": []}
        window.core = SimpleNamespace(ExecuteScriptAsync=Mock(return_value="fetch-task"))
        window.phase = "verify-coverage"
        window.task = SimpleNamespace(IsCompleted=True, GetAwaiter=lambda: SimpleNamespace(
            GetResult=lambda: json.dumps({"result": []})))
        window.tick(None, None)
        self.assertEqual(window.phase, "verify-end-fetch")
        self.assertTrue(window.result["observationLimits"])
        self.assertEqual(window.result["errors"], [])
        self.assertIn("final-manifest-attempt", window.result["events"])

    def test_complement_attempts_final_manifest_even_with_inconclusive_guard(self):
        window = AimGuardComplement(None, None)
        window.core = SimpleNamespace(ExecuteScriptAsync=Mock(return_value="fetch-task"))
        page = dict(text="", bridgeAbsent=True, legacyGlobalsAbsent=True, rejections=[])
        window.phase = "verify-page"
        window.task = SimpleNamespace(IsCompleted=True, GetAwaiter=lambda: SimpleNamespace(
            GetResult=lambda: json.dumps(json.dumps(page))))
        window.tick(None, None)
        self.assertEqual(window.phase, "verify-end-fetch")
        self.assertIn("Explicit no-adapter guard missing", window.result["errors"])
        self.assertIn("final-manifest-attempt", window.result["events"])

    def test_complement_closes_after_final_manifest_despite_prior_limits(self):
        window = AimGuardComplement(None, None)
        identity = dict(revision=AIM_FIX_REVISION, builtAt="2026-10-26T10:45:19.661Z")
        window.result["manifestStart"] = identity
        window.result["observationLimits"] = ["coverage not conclusive"]
        window.manifest = {"files": []}
        window.form = SimpleNamespace(Close=Mock())
        value = dict(value=identity | dict(
            revisionStatus="git-rev-parse-HEAD", trackedChangesAtBuild=False))
        window.phase = "verify-end-manifest"
        window.task = SimpleNamespace(IsCompleted=True, GetAwaiter=lambda: SimpleNamespace(
            GetResult=lambda: json.dumps(json.dumps(value))))
        window.tick(None, None)
        self.assertTrue(window.done)
        window.form.Close.assert_called_once()
        self.assertEqual(window.result["manifestEnd"]["revision"], AIM_FIX_REVISION)

    def test_aim_fix_reference_is_explicit_and_does_not_replace_previous_reference(self):
        value = dict(revision=AIM_FIX_REVISION, revisionStatus="git-rev-parse-HEAD",
                     trackedChangesAtBuild=False, builtAt="2026-10-26T10:50:00Z")
        self.assertEqual(check_manifest(value, AIM_FIX_REVISION)["revision"], AIM_FIX_REVISION)
        with self.assertRaises(RuntimeError):
            check_manifest(value)

    def test_asset_checks_actual_bytes_and_manifest_coverage(self):
        body = b"export const observed = true;"
        url = ORIGIN + "/assets/aim.js"
        manifest = {"files": [{"file": "/assets/aim.js",
                              "sha256": hashlib.sha256(body).hexdigest()}]}
        self.assertEqual(check_asset(manifest, url, body)["bytes"], len(body))
        for changed_url, changed_body in (
                (url, body + b" "), (ORIGIN + "/assets/unknown.js", body),
                ("https://example.invalid/assets/aim.js", body)):
            with self.assertRaises(RuntimeError):
                check_asset(manifest, changed_url, changed_body)

    def test_manifest_mismatch_stops_before_aim_navigation(self):
        import json
        value = dict(revision=REVISION, revisionStatus="git-rev-parse-HEAD",
                     trackedChangesAtBuild=False, builtAt="previous")
        window = AimFixVerification(None, None)
        window.form = SimpleNamespace(Close=Mock())
        window.core = SimpleNamespace(Navigate=Mock())
        window.phase = "verify-start-manifest"
        window.task = SimpleNamespace(IsCompleted=True, GetAwaiter=lambda: SimpleNamespace(
            GetResult=lambda: json.dumps(json.dumps(value))))
        window.tick(None, None)
        window.core.Navigate.assert_not_called()
        window.form.Close.assert_called_once()
        self.assertIn("manifest identity mismatch", window.result["errors"][0])

    def test_observer_is_passive_and_does_not_probe_native_objects(self):
        self.assertIn("addEventListener('unhandledrejection'", REJECTION_OBSERVER)
        self.assertNotIn("preventDefault", REJECTION_OBSERVER)
        self.assertNotIn("stopPropagation", REJECTION_OBSERVER)
        self.assertNotIn("hostObjects", REJECTION_OBSERVER)
        self.assertNotIn("postMessage", REJECTION_OBSERVER)
        self.assertNotIn("JSON.stringify", REJECTION_OBSERVER)
        self.assertIn("Object.getOwnPropertyDescriptor", REJECTION_OBSERVER)

    def test_diagnostic_stack_excludes_objects_and_parameters(self):
        stack = diagnostic_stack({
            "callFrames": [{"functionName": "send", "url": "https://example.invalid/a.js",
                            "lineNumber": 1, "columnNumber": 2, "parameters": "excluded"}],
            "unknown": "excluded",
        })
        self.assertNotIn("unknown", stack)
        self.assertNotIn("parameters", stack["callFrames"][0])

    def test_observer_registration_finishes_before_navigation(self):
        calls = []
        task = SimpleNamespace(IsCompleted=True, GetAwaiter=lambda: SimpleNamespace(
            GetResult=lambda: calls.append("observer-ready")))
        window = RecipeWindow(None, None, ORIGIN, BLOCKED, diagnostic=True)
        window.core = SimpleNamespace(Navigate=lambda url: calls.append("navigate"))
        window.phase, window.task = "observer-installed", task
        window.tick(None, None)
        self.assertEqual(calls, ["observer-ready", "navigate"])
        self.assertEqual(window.phase, "loading")

    def test_install_before_navigation_and_disable_native_access(self):
        calls = []
        core = SimpleNamespace(
            Settings=SimpleNamespace(),
            AddWebResourceRequestedFilter=lambda *args: calls.append("filter"),
            WebResourceRequested=Event(calls),
            Navigate=lambda url: calls.append("navigate"),
        )
        install_then_navigate(core, SimpleNamespace(All=1), SimpleNamespace(All=2),
                              lambda *args: None, ORIGIN)
        self.assertEqual(calls, ["filter", "handler", "navigate"])
        self.assertIs(core.Settings.AreHostObjectsAllowed, False)
        self.assertIs(core.Settings.IsWebMessageEnabled, False)


    def test_install_failure_never_navigates(self):
        core = SimpleNamespace(
            Settings=SimpleNamespace(),
            AddWebResourceRequestedFilter=Mock(side_effect=RuntimeError("failed")),
            Navigate=Mock(),
        )
        with self.assertRaisesRegex(RuntimeError, "failed"):
            install_then_navigate(core, SimpleNamespace(All=1), SimpleNamespace(All=2),
                                  lambda *args: None, ORIGIN)
        core.Navigate.assert_not_called()


    def test_exact_only(self):
        for url in BLOCKED:
            self.assertIn(url, BLOCKED)
            for other in (url + "?v=1", url + ".other",
                          url.replace(ORIGIN, "https://example.invalid")):
                self.assertNotIn(other, BLOCKED)
            self.assertFalse(is_variant(url))
            self.assertTrue(is_variant(url + "?v=1"))


    def test_manifest_reference_and_dirty_state(self):
        value = dict(revision=REVISION, revisionStatus="git-rev-parse-HEAD",
                     trackedChangesAtBuild=False, builtAt="2026-10-26T09:55:26.236Z")
        self.assertEqual(check_manifest(value)["revision"], REVISION)
        for change in (dict(revision="other"), dict(trackedChangesAtBuild=True),
                       dict(revisionStatus="unavailable")):
            with self.assertRaises(RuntimeError):
                check_manifest(value | change)

    def test_request_returns_local_empty_403_only_for_exact_targets(self):
        window = RecipeWindow(None, None, ORIGIN, BLOCKED)
        window.environment = SimpleNamespace(CreateWebResourceResponse=Mock(return_value="denied"))
        for url in BLOCKED:
            args = SimpleNamespace(Request=SimpleNamespace(Uri=url), Response=None)
            window.request(None, args)
            self.assertEqual(args.Response, "denied")
        window.environment.CreateWebResourceResponse.assert_called_with(
            None, 403, "Recipe blocked",
            "Content-Type: text/plain\r\nCache-Control: no-store\r\n",
        )
        args = SimpleNamespace(Request=SimpleNamespace(Uri=ORIGIN + "/assets/module.js"),
                               Response=None)
        window.request(None, args)
        self.assertIsNone(args.Response)

    def test_variant_stops_without_extending_filter(self):
        window = RecipeWindow(None, None, ORIGIN, BLOCKED)
        window.form = SimpleNamespace(Close=Mock())
        variant = ORIGIN + "/__l5e/events.changed.js"
        args = SimpleNamespace(Request=SimpleNamespace(Uri=variant), Response=None)
        window.request(None, args)
        self.assertIsNone(args.Response)
        self.assertNotIn(variant, window.blocked)
        self.assertIn(variant, window.result["errors"][0])
        window.form.Close.assert_called_once()
