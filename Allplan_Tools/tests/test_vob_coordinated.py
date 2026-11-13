from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from application.core.allplan.paths import AllplanPaths
from application.core.configuration import SettingsStore
from application.core.context import LaunchContext
from application.launcher.vob_online import VobProtectedApi, run_protected
from application.plugins.vob_editor.allplan import VobEditorAllplanDatas
from application.plugins.vob_editor.application import VobEditorApp
from application.plugins.vob_editor.close_coordinator import CLOSE_COMMANDS, VobCloseCoordinator
from application.plugins.vob_editor.coordinated_host import prepare_coordinated_host
from application.plugins.vob_editor.coordinated_references import (
    load_coordinated_references, normalize_trade_code,
)
from webview.event import Event


class CloseTests(unittest.TestCase):
    def setUp(self):
        self.deferred = []
        self.scheduled = []
        self.emitted = []
        self.destroyed = []
        self.identity = True
        self.logger = Mock()
        self.coordinator = VobCloseCoordinator(
            identified=lambda: self.identity,
            emit=lambda event, payload: self.emitted.append((event, payload)),
            defer=self.deferred.append, schedule_close=self.scheduled.append,
            destroy=self.destroy, logger=self.logger,
        )

    def destroy(self):
        self.destroyed.append(self.coordinator.native_closing())

    def drain(self):
        while self.deferred:
            self.deferred.pop(0)()

    def request(self):
        return self.coordinator.request({})["requestId"]

    def test_cancel_then_new_id(self):
        old = self.request()
        self.assertEqual(self.coordinator.cancel({"requestId": old})["status"], "cancelled")
        new = self.request()
        self.assertNotEqual(old, new)
        self.assertEqual(self.coordinator.cancel({"requestId": old})["status"], "ignored")
        self.assertEqual(self.coordinator.authorize({"requestId": old})["status"], "ignored")
        self.assertEqual(self.coordinator.request({})["requestId"], new)

    def test_authorization_and_callback_are_single_use(self):
        request_id = self.request()
        self.assertEqual(self.coordinator.authorize({"requestId": request_id})["status"],
                         "authorized")
        self.assertEqual(self.coordinator.authorize({"requestId": request_id})["status"],
                         "ignored")
        self.assertEqual(len(self.scheduled), 1)
        self.scheduled[0]()
        self.scheduled[0]()
        self.assertEqual(self.destroyed, [True])

    def test_clicks_during_authorized_are_absorbed(self):
        request_id = self.request()
        self.coordinator.authorize({"requestId": request_id})
        self.assertFalse(self.coordinator.native_closing())
        self.assertEqual(self.coordinator.request({}),
                         {"requestId": request_id, "status": "closing"})
        self.assertEqual(self.coordinator.cancel({"requestId": request_id})["status"],
                         "ignored")
        self.assertEqual(self.deferred, [])

    def test_concurrent_requests_share_one_id(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(pool.map(lambda _: self.coordinator.request({}), range(32)))
        self.assertEqual(len({r["requestId"] for r in replies}), 1)
        self.assertEqual(sum(r["status"] == "requested" for r in replies), 1)

    def test_cross_and_button_share_first_reason(self):
        self.coordinator.ready({})
        self.assertFalse(self.coordinator.native_closing())
        request_id = self.request()
        self.drain()
        self.assertTrue(self.emitted)
        self.assertTrue(all(p == {
            "requestId": request_id, "reason": "native_window_close",
        } for _, p in self.emitted))

    def test_native_veto_queues_without_executing_frontend(self):
        self.coordinator.ready({})
        self.assertFalse(self.coordinator.native_closing())
        self.assertEqual(self.emitted, [])
        self.assertEqual(len(self.deferred), 1)
        self.assertEqual(self.scheduled, [])
        self.assertEqual(self.destroyed, [])

    def test_not_ready_keeps_request_and_ready_replays(self):
        self.assertFalse(self.coordinator.native_closing())
        request_id = self.request()
        self.assertEqual(self.deferred, [])
        self.coordinator.ready({})
        self.drain()
        self.assertEqual(self.emitted[0][1]["requestId"], request_id)
        self.assertEqual(self.destroyed, [])

    def test_ready_scheduling_error_retains_request_and_allows_retry(self):
        request_id = self.request()
        with patch.object(self.coordinator, "_defer", side_effect=RuntimeError("queue failed")):
            with self.assertRaisesRegex(RuntimeError, "queue failed"):
                self.coordinator.ready({})
        self.assertEqual(self.coordinator.request({})["requestId"], request_id)
        self.coordinator.ready({})
        self.drain()
        self.assertEqual(self.emitted[0][1]["requestId"], request_id)
        self.assertEqual(self.destroyed, [])
        self.logger.exception.assert_called()

    def test_event_error_is_logged_and_request_retained(self):
        request_id = self.request()
        self.coordinator.ready({})
        with patch.object(self.coordinator, "_emit", side_effect=RuntimeError("view failed")):
            self.drain()
        self.assertEqual(self.coordinator.request({})["requestId"], request_id)
        self.assertEqual(self.deferred, [])
        self.coordinator.ready({})
        self.drain()
        self.assertEqual(self.emitted[0][1]["requestId"], request_id)
        self.assertEqual(self.destroyed, [])
        self.logger.exception.assert_called()

    def test_cancelled_queued_event_is_not_delivered(self):
        self.coordinator.ready({})
        request_id = self.request()
        self.coordinator.cancel({"requestId": request_id})
        self.drain()
        self.assertEqual(self.emitted, [])

    def test_scheduling_failure_disarms_authorization(self):
        request_id = self.request()
        with patch.object(self.coordinator, "_schedule_close",
                          side_effect=OSError("BeginInvoke failed")):
            with self.assertRaisesRegex(OSError, "BeginInvoke"):
                self.coordinator.authorize({"requestId": request_id})
        self.assertEqual(self.coordinator.authorize({"requestId": request_id})["status"],
                         "ignored")
        self.assertFalse(self.coordinator.native_closing())
        self.assertNotEqual(self.request(), request_id)
        self.logger.exception.assert_called()

    def test_destroy_failure_disarms_consumed_authorization(self):
        request_id = self.request()
        self.coordinator.authorize({"requestId": request_id})

        def fail():
            self.assertTrue(self.coordinator.native_closing())
            raise RuntimeError("Close failed")

        with patch.object(self.coordinator, "_destroy", side_effect=fail):
            self.scheduled[0]()
        self.assertFalse(self.coordinator.native_closing())
        self.assertNotEqual(self.request(), request_id)
        self.logger.exception.assert_called()

    def test_startup_cleanup_does_not_require_identity(self):
        self.identity = False
        self.assertFalse(self.coordinator.native_closing())
        self.coordinator.abort_startup()
        self.assertTrue(self.coordinator.native_closing())
        self.assertEqual(self.deferred, [])

    def test_cleanup_invalidates_scheduled_authorization(self):
        request_id = self.request()
        self.coordinator.authorize({"requestId": request_id})
        self.coordinator.abort_startup()
        self.scheduled[0]()
        self.assertEqual(self.destroyed, [])

    def test_invalid_payloads_do_not_create_or_authorize_requests(self):
        for method, payload in (
            (self.coordinator.request, {"requestId": "frontend-invented"}),
            (self.coordinator.ready, {"unexpected": True}),
            (self.coordinator.cancel, {"requestId": ""}),
            (self.coordinator.authorize, {"requestId": 1}),
        ):
            with self.assertRaises(ValueError):
                method(payload)
        self.assertEqual(self.scheduled, [])
        with self.assertRaises(RuntimeError):
            self.identity = False
            self.coordinator.request({})


class PreparedHostTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.paths = AllplanPaths("2026", "FRA", paths={"STD": self.root, "ETC": self.root})
        self.app = VobEditorApp(
            self.root / "data",
            allplan_datas=VobEditorAllplanDatas(self.paths),
            settings_store=SettingsStore(self.root / "settings.json"),
        )
        self.addCleanup(self.app._close)

    def test_default_handler_and_capabilities_stay_unmodified(self):
        self.assertFalse(set(CLOSE_COMMANDS) & set(self.app.get_app_info()["capabilities"]))
        data = self.app.call("reference.load", {"lang": "fr"})["data"]
        self.assertEqual(data["units"], [])
        self.assertEqual(data["methods"], [])
        self.assertFalse(any(source["scope"] == "USER"
                             for meta in data["metadata"].values()
                             for source in meta["sources"]))

    def test_unverified_revision_cannot_activate_before_window_or_storage_creation(self):
        with patch("application.launcher.vob_online.published_resources",
                   return_value=({"revision": "a" * 40}, {})):
            with self.assertRaisesRegex(ValueError, "revision not verified"):
                run_protected(
                    Mock(), self.root / "unused-workspace", self.root / "unused-profile",
                    coordinated_revision="8ccf3679c2bc43948bf6b7bd77a544424d71fc0c",
                )
        self.assertFalse((self.root / "unused-workspace").exists())
        self.assertFalse((self.root / "unused-profile").exists())

    def test_user_exact_codes_partial_metadata_and_missing_trade_source(self):
        data = load_coordinated_references(
            LaunchContext(allplan_version="2026", country="FRA",
                          paths={"STD": self.root, "ETC": self.root}), "fr",
        )
        self.assertEqual([u["index"] for u in data["units"]], ["00", "01", "02", "05"])
        self.assertEqual([m["value"] for m in data["methods"]],
                         ["01", "02", "03", "04", "05", "06", "13"])
        for category in ("units", "methods"):
            meta = data["metadata"][category]
            self.assertEqual(meta["status"], "available_with_diagnostics")
            source = meta["sources"][0]
            self.assertEqual(set(source), {"scope", "label", "language", "coverage"})
            self.assertEqual(source["scope"], "USER")
            self.assertEqual(source["coverage"], "specified_codes_only")
        self.assertEqual(data["metadata"]["methods"]["diagnostics"][1]["id"], "13")
        self.assertEqual(data["metadata"]["trades"]["status"], "unavailable")
        self.assertTrue(data["metadata"]["trades"]["diagnostics"])
        self.assertEqual(data["trades"], [])

    def test_trade_normalization_is_textual_and_category_specific(self):
        for source, expected in (
            ("035", "35"), ("000", "0"), ("0", "0"), ("-1", "-1"),
            ("05", "5"), ("", ""), (" 035", " 035"), ("01a", "01a"),
            ("١", "١"), ("000123456789012345678901234567890",
                          "123456789012345678901234567890"),
        ):
            self.assertEqual(normalize_trade_code(source), expected)

    def test_normalized_trade_collisions_preserve_occurrences_and_source_ids(self):
        from application.core.allplan.models import Availability, Provenance
        origin = Provenance(self.root / "attributes.xml", "etc", 209)
        options = [
            SimpleNamespace(code=code, label=label, provenance=origin)
            for code, label in (
                ("035", "First"), ("35", "Second"), ("000", ""), ("0", ""),
                ("-1", "Sentinel"), ("01a", "Text"),
            )
        ]
        trades = SimpleNamespace(
            diagnostics=[], state=Availability.AVAILABLE,
            data=SimpleNamespace(
                selected=SimpleNamespace(provenance=origin), options=options,
                source=SimpleNamespace(data=SimpleNamespace(
                    files=SimpleNamespace(language="fr"),
                )),
            ),
        )
        with patch("application.plugins.vob_editor.coordinated_references.load_attribute_references"), \
                patch("application.plugins.vob_editor.coordinated_references.build_trade_references",
                      return_value=trades):
            data = load_coordinated_references(
                LaunchContext(allplan_version="2026", country="FRA",
                              paths={"STD": self.root, "ETC": self.root}), "fr",
            )
        self.assertEqual(data["trades"], [
            {"index": "35", "name": "First"}, {"index": "35", "name": "Second"},
            {"index": "0", "name": ""}, {"index": "0", "name": ""},
            {"index": "01a", "name": "Text"},
        ])
        issues = data["metadata"]["trades"]["diagnostics"]
        self.assertEqual([d["id"] for d in issues if d["code"] == "reference_id_ambiguous"],
                         ["35"])
        self.assertTrue(any("'035'" in d["message"] and d["id"] == "35"
                            for d in issues if d["code"] == "trade_code_normalized"))
        self.assertTrue(any("'000'" in d["message"] and d["id"] == "0"
                            for d in issues if d["code"] == "trade_code_normalized"))

    def test_bridge_errors_identity_and_ready_retry(self):
        window = Mock()
        window.events.closing = Event(window, should_lock=True)
        window.events.closed = Event(window)
        api = VobProtectedApi(self.app)
        coordinator = prepare_coordinated_host(
            self.app, window, identified=lambda: api.active and api.identified,
            schedule_close=lambda callback: None,
        )
        self.addCleanup(window.events.closed.set)
        self.assertEqual(set(CLOSE_COMMANDS) & set(self.app._capabilities()),
                         set(CLOSE_COMMANDS))
        with self.assertRaises(RuntimeError):
            api.call("vob.close.request", {})
        api.active = True
        api.get_app_info()
        request_id = api.call("vob.close.request", {})["data"]["requestId"]
        with patch.object(coordinator, "_defer", side_effect=RuntimeError("ready failed")):
            reply = api.call("vob.close.ready", {})
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["error"]["code"], "internal-error")
        self.assertEqual(api.call("vob.close.request", {})["data"]["requestId"], request_id)
        self.assertTrue(api.call("vob.close.ready", {})["ok"])
        # A pending ETC confirmation must not survive cancellation of this close.
        self.app._pending_etc_write = Mock()
        self.assertTrue(api.call("vob.close.cancel", {"requestId": request_id})["ok"])
        self.assertIsNone(self.app._pending_etc_write)
        self.assertFalse(api.call("vob.close.authorize", {"requestId": 1})["ok"])
        api.identified = False
        coordinator.abort_startup()
        self.assertFalse(window.events.closing.set())  # No veto for internal cleanup.

    def test_prepared_handler_keeps_rule_values(self):
        window = Mock()
        window.events.closing = Event(window, should_lock=True)
        window.events.closed = Event(window)
        prepare_coordinated_host(
            self.app, window, identified=lambda: True,
            schedule_close=lambda callback: None,
        )
        self.addCleanup(window.events.closed.set)
        self.app._current_document = {"file": None, "header": [], "rules": [{
            "trade": "001", "object": "112", "unit": "1", "method": "-1",
            "formula": "", "comment": "",
        }]}
        before = deepcopy(self.app._current_document)
        reply = self.app.call("reference.load", {"lang": "fr"})
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(self.app._current_document, before)
        self.assertFalse((self.root / "settings.json").exists())


if __name__ == "__main__":
    unittest.main()
