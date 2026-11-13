from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess
import sys
from threading import Event
import time
import unittest
from unittest.mock import MagicMock, patch

from application.core.allplan import project_attribute_writer as writer
from application.core.allplan.readers.project_attributes import read_project_attributes
from application.plugins.information_manager import project_save, save_transport
from application.plugins.information_manager.presentation import AimPresentationApp
from tests import test_aim_project_save as service_fixture


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.base = service_fixture.ServiceTests()
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        self.f = self.base.f
        self.app = self.new_app()
        self.runner = MagicMock(return_value={"returncode": 0})
        self.app._save_transport.runner = self.runner
        self.set_value("draft")

    def new_app(self):
        app = AimPresentationApp(
            self.f.data, deepcopy(self.base.app._launch_context),
            settings_store=self.f.store, choose_directory=self.f.chooser,
            discover_installations=self.f.discover, working_state=True, project_save=True,
        )
        self.assertEqual(app.get_initial_data()["selection"], "accepted")
        return app

    def work(self, app=None):
        return (app or self.app).call("work.get", {})["work"]

    def set_value(self, value):
        reply = self.app.call("work.value.set", {
            "revision": self.app._work.revision, "number": "7", "value": value,
        })
        self.assertTrue(reply["ok"], reply)

    def request(self):
        work = self.work()
        return {k: work[k] for k in ("sessionId", "revision", "projectRevision")}

    def start(self, request=None):
        request = request or self.request()
        reply = self.app.call("project.values.save", request)
        self.assertEqual(reply["status"], "accepted", reply)
        return request, reply

    def finish(self, request):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            reply = self.app.call("project.values.save.status", request)
            if reply.get("status") == "completed":
                return reply
            time.sleep(.005)
        self.fail("Save worker did not finish")

    def block_prepare(self):
        entered, release, blocked = self.base.block_prepare()
        self.addCleanup(release.set)
        return entered, release, blocked

    def test_explicit_negotiation_and_legacy_exact_shape(self):
        old = self.base.app
        info = old.get_app_info()
        self.assertEqual(info["working_state_contract"], 1)
        self.assertNotIn("project_save_contract", info)
        work = old.call("work.get", {})["work"]
        self.assertEqual(set(work), {"revision", "source", "data", "draftValues",
                                    "pendingImport", "presentation", "dirty",
                                    "fileSaveAvailable", "prjtoolsAvailable"})
        self.assertFalse(work["fileSaveAvailable"])
        self.assertFalse(work["prjtoolsAvailable"])
        self.assertEqual(old.call("project.values.save", {})["error"]["code"], "unknown_command")
        info = self.app.get_app_info()
        self.assertEqual(info["working_state_contract"], 2)
        self.assertEqual(info["project_save_contract"], 1)
        self.assertEqual(info["project_save_capabilities"], list(save_transport.COMMANDS))
        self.assertEqual(info["capabilities"], ["project.select"])
        self.assertEqual(info["project_contract"], 2)
        self.assertTrue(self.work()["fileSaveAvailable"])

    def test_optin_requires_working_profile(self):
        with self.assertRaises(ValueError):
            AimPresentationApp(self.f.data, self.base.app._launch_context, project_save=True)
        with self.assertRaises(ValueError):
            self.app._set_working_state(False)

    def test_closed_payloads_and_integer_validation(self):
        request = self.request()
        for bad in ({}, {**request, "path": str(self.f.project)},
                    {**request, "values": {"7": "injected"}},
                    {**request, "revision": True}, {**request, "revision": -1},
                    {**request, "projectRevision": 2 ** 53},
                    {**request, "sessionId": ""}, {**request, "revision": 1.0}):
            for command in save_transport.COMMANDS:
                self.assertEqual(self.app.call(command, bad)["error"]["code"], "invalid_payload")
        self.assertEqual(list(self.app._save_transport.root.glob("*.json")), [])
        self.runner.assert_not_called()

    def test_stale_session_and_revisions(self):
        request = self.request()
        for field, value, code in (
            ("sessionId", "obsolete", "session_obsolete"),
            ("revision", request["revision"] + 1, "stale_work"),
            ("projectRevision", request["projectRevision"] + 1, "project_changed"),
        ):
            self.assertEqual(self.app.call("project.values.save", {**request, field: value})
                             ["error"]["code"], code)
        self.assertEqual(self.f.path.read_bytes(), self.base.original)

    def test_external_saved_revisions_and_closed_result_shape(self):
        request, accepted = self.start()
        completed = self.finish(request)
        result = completed["result"]
        self.assertEqual(set(completed), {"ok", "status", "operationId", "request", "result", "work"})
        self.assertEqual(set(result), {"ok", "status", "stage", "file", "tool",
                                      "acknowledged", "recoveryRequired", "error", "message"})
        self.assertEqual(result["status"], "saved")
        self.assertEqual(result["file"]["finalVerification"], "confirmed")
        self.assertTrue(result["file"]["verified"])
        self.assertEqual(result["tool"]["updateStatus"], "not_required")
        self.assertFalse(result["tool"]["launched"])
        self.assertIsNone(result["tool"]["returnCode"])
        work = completed["work"]
        self.assertEqual(work["revision"], request["revision"] + 1)
        self.assertEqual(work["projectRevision"], request["projectRevision"] + 1)
        self.assertEqual(work["save"]["request"], request)
        self.assertEqual(work["save"]["operationId"], accepted["operationId"])
        self.assertFalse(work["dirty"]["values"])
        self.runner.assert_not_called()

    def test_acceptance_response_lost_recovered_only_from_work(self):
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            request = self.request()
            self.app.call("project.values.save", request)  # Deliberately discard the entire reply.
            self.assertTrue(entered.wait(5))
            remounted_work = self.work()
            ref = remounted_work["save"]
            self.assertEqual(ref["state"], "running")
            self.assertTrue(ref["operationId"])
            self.assertEqual(ref["request"], request)
            status = self.app.call("project.values.save.status", ref["request"])
            self.assertEqual(status["operationId"], ref["operationId"])
            self.assertEqual(status["status"], "running")
            release.set()
            self.assertEqual(self.finish(ref["request"])["result"]["status"], "saved")
        self.assertEqual(len(list(self.f.project.glob("*.bak"))), 1)

    def test_acceptance_lost_after_fast_completion_still_in_work(self):
        request = self.request()
        self.app.call("project.values.save", request)
        self.finish(request)
        ref = self.work()["save"]
        self.assertEqual(ref["request"], request)
        self.assertTrue(ref["operationId"])
        self.assertEqual(self.finish(ref["request"])["result"]["status"], "saved")

    def test_followup_response_lost_and_status_never_replays(self):
        self.base.allplan()
        request, accepted = self.start()
        self.finish(request)  # Discard this first completed response.
        original = self.f.path.read_bytes()
        for _ in range(5):
            result = self.finish(request)
            self.assertEqual(result["operationId"], accepted["operationId"])
            self.assertEqual(result["result"]["status"], "saved")
        self.runner.assert_called_once()
        self.assertEqual(self.f.path.read_bytes(), original)
        self.assertEqual(len(list(self.f.project.glob("*.bak"))), 1)

    def test_duplicate_requests_before_and_after_completion_are_idempotent(self):
        self.base.allplan()
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            request, first = self.start()
            self.assertTrue(entered.wait(5))
            self.assertEqual(self.app.call("project.values.save", request), first)
            release.set()
            self.finish(request)
        self.assertEqual(self.app.call("project.values.save", request), first)
        self.runner.assert_called_once()
        self.assertEqual(len(list(self.f.project.glob("*.bak"))), 1)

    def test_all_mutations_and_normal_close_frozen(self):
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            request, _ = self.start()
            self.assertTrue(entered.wait(5))
            for command in ("work.value.set", "work.discard", "work.transition", "work.close",
                            "project.select", "project.manager.open", "presentation.update",
                            "presentation.import.prepare", "presentation.import.apply",
                            "presentation.export"):
                self.assertEqual(self.app.call(command, {})["error"]["code"], "save_busy", command)
            self.assertFalse(self.app._confirm_close_work())
            self.assertEqual(self.app._save_transport.identity(), request["sessionId"])
            self.assertEqual(self.work()["draftValues"], {"7": "draft"})
            release.set()
            self.finish(request)

    def test_other_request_while_running_is_rejected(self):
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            request, _ = self.start()
            self.assertTrue(entered.wait(5))
            self.app._work.changed()  # Simulate an out-of-band mutation.
            other = {**request, "revision": self.app._work.revision}
            self.assertEqual(self.app.call("project.values.save", other)["error"]["code"], "save_busy")
            release.set()
            self.assertEqual(self.finish(request)["result"]["status"], "failed")

    def test_invalidation_before_publication_is_unwritten(self):
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            request, _ = self.start()
            self.assertTrue(entered.wait(5))
            self.app._close_session()
            release.set()
            completed = self.finish(request)
        self.assertEqual(completed["result"]["status"], "failed")
        self.assertFalse(completed["result"]["file"]["written"])
        self.assertIsNone(completed["work"])
        self.assertEqual(self.f.path.read_bytes(), self.base.original)

    def test_late_old_session_after_publication_never_looks_unwritten(self):
        self.base.allplan()
        def rearm(*args):
            session = self.app._invalidate_session()
            self.app._rearm_session(session)
            return {"returncode": 0}
        self.runner.side_effect = rearm
        request, _ = self.start()
        completed = self.finish(request)
        result = completed["result"]
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["file"]["written"])
        self.assertTrue(result["file"]["verified"])
        self.assertTrue(result["tool"]["finished"])
        self.assertIsNone(completed["work"])
        self.assertNotEqual(self.work()["sessionId"], request["sessionId"])
        self.assertEqual(self.work()["save"]["state"], "recovery_required")

    def test_allplan_code_zero_effects(self):
        self.base.allplan()
        self.assertTrue(self.work()["prjtoolsAvailable"])
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "saved")
        self.assertEqual(result["tool"], {
            "required": True, "launched": True, "finished": True, "returnCode": 0,
            "updateStatus": "unconfirmed", "diagnosticId": None,
        })

    def test_missing_tool_is_partial_after_verified_file(self):
        self.base.allplan(create_tool=False)
        self.assertTrue(self.work()["fileSaveAvailable"])
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["error"]["code"], "tool_missing")
        self.assertTrue(result["file"]["verified"])
        self.assertFalse(result["tool"]["launched"])
        self.assertIsNone(result["tool"]["returnCode"])
        self.runner.assert_not_called()

    def test_tool_failed_keeps_detailed_facts_and_drafts(self):
        self.base.allplan()
        self.runner.return_value = {"returncode": 9}
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["file"]["written"])
        self.assertTrue(result["file"]["verified"])
        self.assertEqual(result["file"]["finalVerification"], "not_attempted")
        self.assertTrue(result["tool"]["launched"])
        self.assertTrue(result["tool"]["finished"])
        self.assertEqual(result["tool"]["returnCode"], 9)
        self.assertEqual(self.work()["draftValues"], {"7": "draft"})
        self.assertFalse(self.work()["fileSaveAvailable"])

    def test_uncertain_tool_does_not_invent_launch_or_exit(self):
        self.base.allplan()
        self.runner.side_effect = OSError("simulated lost observation")
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["tool"]["launched"])
        self.assertIsNone(result["tool"]["finished"])
        self.assertIsNone(result["tool"]["returnCode"])
        for _ in range(3):
            self.finish(request)
        self.runner.assert_called_once()

    def test_null_only_in_modified_values(self):
        self.app._state["data"]["attributes"].append({
            "number": "8", "label": "Unset", "definition": {"label": "Unset"},
            "valueState": "unset", "value": None,
        })
        request, _ = self.start()
        self.assertEqual(self.finish(request)["result"]["status"], "saved")
        self.set_value(None)
        self.assertIn("null_unspecified", self.work()["save"]["blockedReasons"])
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["error"]["code"], "null_unspecified")
        self.assertFalse(result["file"]["written"])
        self.assertIsNone(result["file"]["backupId"])
        self.assertEqual(self.work()["draftValues"], {"7": None})

    def test_config_changed_since_load_is_refused(self):
        (self.f.project / "project.cfg").write_bytes(b"ATTR=PRJ\r\n;changed\r\n")
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["error"]["code"], "project_changed")
        self.assertFalse(result["file"]["written"])

    def test_directory_replaced_since_load_is_refused(self):
        old = self.f.project.with_name("Original.prj")
        self.f.project.rename(old)
        shutil.copytree(old, self.f.project)
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["error"]["code"], "project_changed")
        self.assertEqual(self.f.path.read_bytes(), self.base.original)

    def test_identity_follows_isolated_reader_adoption_and_saved_document(self):
        self.assertIsNotNone(self.app._document.project_identity)
        self.assertEqual(self.app._document.project_config, b"ATTR=PRJ\r\n")
        request, _ = self.start()
        self.assertEqual(self.finish(request)["result"]["status"], "saved")
        self.set_value("next")
        request, _ = self.start()
        self.assertEqual(self.finish(request)["result"]["status"], "saved")
        self.assertEqual(read_project_attributes(self.f.project).data.values()["7"], "next")

    def test_post_snapshot_edit_not_cleared(self):
        self.base.allplan()
        def edit(*args):
            self.app._work.values["7"] = "newer"
            self.app._work.changed()
            return {"returncode": 0}
        self.runner.side_effect = edit
        request, _ = self.start()
        self.assertEqual(self.finish(request)["result"]["status"], "partial")
        self.assertEqual(self.work()["draftValues"], {"7": "newer"})

    def test_presentation_dirty_and_baseline_not_acknowledged(self):
        self.app._presentation._current = {"configuration": {"marker": "new"}}
        self.app._work.baseline = {"configuration": {"marker": "old"}}
        baseline = deepcopy(self.app._work.baseline)
        # Keep the presentation service's independent model out of this synthetic marker test.
        original_call = self.app._presentation.call
        def presentation(command, payload):
            if command == "presentation.get":
                return {"ok": True, "presentation": None}
            return original_call(command, payload)
        with patch.object(self.app._presentation, "call", side_effect=presentation):
            request, _ = self.start()
            completed = self.finish(request)
        self.assertEqual(completed["result"]["status"], "saved")
        self.assertTrue(completed["work"]["dirty"]["presentation"])
        self.assertTrue(completed["work"]["dirty"]["any"])
        self.assertFalse(completed["work"]["dirty"]["values"])
        self.assertEqual(self.app._work.baseline, baseline)

    def test_journal_acceptance_failure_prevents_all_effects(self):
        with patch.object(self.app._save_transport, "_write", side_effect=PermissionError("test")):
            result = self.app.call("project.values.save", self.request())
        self.assertEqual(result["error"]["code"], "journal_unavailable")
        self.assertEqual(self.f.path.read_bytes(), self.base.original)
        self.runner.assert_not_called()

    def test_journal_failure_before_publication_prevents_write(self):
        transport = self.app._save_transport
        original = transport._write
        def fail(record):
            if record["phase"] == "publication":
                raise OSError("simulated journal failure")
            original(record)
        with patch.object(transport, "_write", side_effect=fail):
            request, _ = self.start()
            result = self.finish(request)["result"]
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["file"]["written"])
        self.assertEqual(self.f.path.read_bytes(), self.base.original)

    def test_interruption_after_replace_before_post_publication_journal(self):
        transport = self.app._save_transport
        original = transport._checkpoint
        def interrupt(key, event, facts):
            if event == "published":
                raise RuntimeError("simulated interruption after external action")
            original(key, event, facts)
        with patch.object(transport, "_checkpoint", side_effect=interrupt):
            request, _ = self.start()
            result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["file"]["written"])
        self.assertIsNone(result["file"]["verified"])
        self.assertTrue(result["recoveryRequired"])
        self.assertEqual(read_project_attributes(self.f.project).data.values()["7"], "draft")
        self.assertEqual(self.work()["draftValues"], {"7": "draft"})

    def test_final_journal_failure_restores_value_drafts(self):
        transport = self.app._save_transport
        original = transport._write
        def fail(record):
            if record["result"] is not None:
                raise OSError("simulated terminal journal loss")
            original(record)
        with patch.object(transport, "_write", side_effect=fail):
            request, _ = self.start()
            result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["file"]["written"])
        self.assertEqual(self.work()["draftValues"], {"7": "draft"})
        self.assertEqual(self.app._document.source_bytes, self.base.original)
        self.assertEqual(self.app._project_revision, request["projectRevision"])
        self.assertEqual(self.app._work.revision, request["revision"])

    def test_closed_session_status_retained_but_work_not_exposed(self):
        request, accepted = self.start()
        self.finish(request)
        self.app._close_session()
        completed = self.finish(request)
        self.assertIsNone(completed["work"])
        self.assertEqual(completed["operationId"], accepted["operationId"])
        self.assertTrue(completed["result"]["file"]["written"])

    def test_new_app_reads_completed_journal_without_replay(self):
        self.base.allplan()
        request, _ = self.start()
        self.finish(request)
        restarted = self.new_app()
        result = restarted.call("project.values.save.status", request)
        self.assertEqual(result["result"]["status"], "saved")
        self.assertIsNone(result["work"])
        self.assertEqual(restarted.call("project.values.save", request)["operationId"],
                         result["operationId"])
        self.runner.assert_called_once()

    def test_real_python_restart_reads_uncertainty_without_replaying(self):
        transport = self.app._save_transport
        request = self.request()
        # Create a durable publication-intent record, with no known post-action facts.
        record = {
            "version": 1, "request": request, "operationId": "interrupted-operation",
            "project": str(self.f.project), "phase": "publication", "result": None,
            "file": {"written": None, "verified": None,
                     "finalVerification": "not_attempted", "sourceSHA256": None, "backupId": None},
            "tool": {"required": True, "launched": False, "finished": False,
                     "returnCode": None, "updateStatus": "unconfirmed", "diagnosticId": None},
        }
        transport._write(record)
        script = """
import json, sys
from pathlib import Path
from types import SimpleNamespace
from application.plugins.information_manager.save_transport import SaveTransport
app = SimpleNamespace(_data_dir=Path(sys.argv[1]))
transport = SaveTransport(app)
record = next(iter(transport.records.values()))
print(json.dumps(record["result"]))
"""
        child = subprocess.run([sys.executable, "-B", "-c", script, str(self.f.data)],
                               cwd=Path(__file__).parents[1], capture_output=True, text=True,
                               timeout=15, check=True)
        result = json.loads(child.stdout)
        self.assertEqual(result["status"], "partial")
        self.assertIsNone(result["file"]["written"])
        self.assertFalse(result["tool"]["launched"])
        self.assertTrue(result["recoveryRequired"])
        restarted = self.new_app()
        work = self.work(restarted)
        self.assertEqual(work["save"]["state"], "recovery_required")
        self.assertEqual(work["save"]["request"], request)
        self.assertEqual(self.f.path.read_bytes(), self.base.original)
        self.runner.assert_not_called()

    def test_unknown_status_is_read_only_not_proof_of_no_write(self):
        reply = self.app.call("project.values.save.status", self.request())
        self.assertEqual(reply["status"], "not_found")
        self.assertNotIn("written", reply)
        self.assertEqual(list(self.app._save_transport.root.glob("*.json")), [])

    def test_real_runner_observation_checkpoints_with_mock_process_only(self):
        self.base.allplan()
        self.app._save_transport.runner = project_save.execute_tool
        process = MagicMock()
        process.wait.return_value = 0
        with patch.object(project_save.subprocess, "Popen", return_value=process) as popen:
            request, _ = self.start()
            result = self.finish(request)["result"]
        self.assertEqual(result["status"], "saved")
        self.assertTrue(result["tool"]["launched"])
        self.assertTrue(result["tool"]["finished"])
        self.assertEqual(result["tool"]["returnCode"], 0)
        self.assertTrue(result["tool"]["diagnosticId"])
        self.assertTrue(popen.call_args.kwargs["shell"])
        process.wait.assert_called_once()

    def test_lost_observation_after_launch_is_not_false_unlaunched(self):
        self.base.allplan()
        self.app._save_transport.runner = project_save.execute_tool
        process = MagicMock()
        process.wait.side_effect = OSError("simulated observation loss")
        with patch.object(project_save.subprocess, "Popen", return_value=process):
            request, _ = self.start()
            result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["tool"]["launched"])
        self.assertIsNone(result["tool"]["finished"])
        self.assertIsNone(result["tool"]["returnCode"])

    def test_exit_observed_but_not_journalled_stays_unknown(self):
        self.base.allplan()
        self.app._save_transport.runner = project_save.execute_tool
        transport = self.app._save_transport
        original = transport._checkpoint
        def interrupt(key, event, facts):
            if event == "tool_finished":
                raise RuntimeError("interruption between wait and journal")
            original(key, event, facts)
        process = MagicMock()
        process.wait.return_value = 0
        with patch.object(project_save.subprocess, "Popen", return_value=process), \
                patch.object(transport, "_checkpoint", side_effect=interrupt):
            request, _ = self.start()
            result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["tool"]["launched"])
        self.assertIsNone(result["tool"]["finished"])
        self.assertIsNone(result["tool"]["returnCode"])
        self.assertEqual(self.work()["draftValues"], {"7": "draft"})
        process.wait.assert_called_once()

    def test_after_saved_newer_draft_survives_old_status(self):
        request, _ = self.start()
        self.finish(request)
        self.set_value("later")
        for _ in range(3):
            completed = self.finish(request)
            self.assertEqual(completed["work"]["draftValues"], {"7": "later"})
        self.assertTrue(self.work()["dirty"]["values"])

    def test_new_app_keeps_partial_recovery_block_and_never_reruns(self):
        self.base.allplan()
        self.runner.return_value = {"returncode": 7}
        request, _ = self.start()
        self.finish(request)
        restarted = self.new_app()
        work = self.work(restarted)
        self.assertEqual(work["save"]["state"], "recovery_required")
        reply = restarted.call("project.values.save", {
            k: work[k] for k in ("sessionId", "revision", "projectRevision")
        })
        self.assertEqual(reply["error"]["code"], "recovery_required")
        for _ in range(3):
            result = restarted.call("project.values.save.status", request)
            self.assertEqual(result["result"]["tool"]["returnCode"], 7)
        self.runner.assert_called_once()

    def test_backup_failure_reports_no_publication_no_tool(self):
        self.base.allplan()
        original_open = Path.open
        def denied(path, *args, **kwargs):
            if path.suffix == ".bak":
                raise PermissionError("backup simulation")
            return original_open(path, *args, **kwargs)
        with patch.object(Path, "open", denied):
            request, _ = self.start()
            result = self.finish(request)["result"]
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["file"]["written"])
        self.assertFalse(result["tool"]["launched"])
        self.assertIsNone(result["file"]["backupId"])
        self.runner.assert_not_called()

    def test_verification_failed_after_successful_tool_is_partial(self):
        self.base.allplan()
        def changed(*args):
            self.f.path.write_bytes(b"Version 3\r\n7|Name|changed externally\r\n")
            return {"returncode": 0}
        self.runner.side_effect = changed
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["file"]["verified"])
        self.assertEqual(result["file"]["finalVerification"], "failed")
        self.assertEqual(result["tool"]["returnCode"], 0)
        self.assertEqual(self.work()["draftValues"], {"7": "draft"})

    def test_restart_preserves_tool_intent_and_known_launch_without_code(self):
        transport = self.app._save_transport
        request = self.request()
        for revision, launched in ((20, None), (21, True)):
            record = {
                "version": 1, "request": {**request, "revision": revision},
                "operationId": "interrupted-" + str(revision), "project": str(self.f.project),
                "phase": "tool", "result": None,
                "file": {"written": True, "verified": True,
                         "finalVerification": "not_attempted",
                         "sourceSHA256": "a" * 64, "backupId": "backup-test"},
                "tool": {"required": True, "launched": launched, "finished": None,
                         "returnCode": None, "updateStatus": "unconfirmed", "diagnosticId": None},
            }
            transport._write(record)
        script = """
import json, sys
from pathlib import Path
from types import SimpleNamespace
from application.plugins.information_manager.save_transport import SaveTransport
transport = SaveTransport(SimpleNamespace(_data_dir=Path(sys.argv[1])))
print(json.dumps({r["operationId"]: r["result"] for r in transport.records.values()}))
"""
        child = subprocess.run([sys.executable, "-B", "-c", script, str(self.f.data)],
                               cwd=Path(__file__).parents[1], capture_output=True, text=True,
                               timeout=15, check=True)
        results = json.loads(child.stdout)
        for revision, launched in ((20, None), (21, True)):
            result = results["interrupted-" + str(revision)]
            self.assertEqual(result["status"], "partial")
            self.assertTrue(result["file"]["verified"])
            self.assertEqual(result["tool"]["launched"], launched)
            self.assertIsNone(result["tool"]["finished"])
            self.assertIsNone(result["tool"]["returnCode"])
            self.assertTrue(result["recoveryRequired"])
        self.runner.assert_not_called()

    def test_interruption_before_acknowledgement_keeps_snapshot(self):
        transport = self.app._save_transport
        original = transport._checkpoint
        def interrupt(key, event, facts):
            if event == "acknowledgement":
                raise RuntimeError("interruption before acknowledgement")
            original(key, event, facts)
        with patch.object(transport, "_checkpoint", side_effect=interrupt):
            request, _ = self.start()
            result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["file"]["written"])
        self.assertFalse(result["acknowledged"])
        self.assertEqual(self.app._document.source_bytes, self.base.original)
        self.assertEqual(self.work()["draftValues"], {"7": "draft"})

    def test_acceptance_does_not_wait_for_project_discovery(self):
        request = self.request()
        entered, release = Event(), Event()
        self.addCleanup(release.set)
        original = self.app._discover_installations
        def discovery():
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test discovery barrier not released")
            return original()
        with patch.object(self.app, "_discover_installations", side_effect=discovery):
            accepted = self.app.call("project.values.save", request)
            self.assertEqual(accepted["status"], "accepted")
            self.assertTrue(entered.wait(5))
            self.assertEqual(self.app.call("project.values.save.status", request)["status"], "running")
            release.set()
            self.assertEqual(self.finish(request)["result"]["status"], "saved")

    def assert_membership_fixture(self, case):
        fixture = json.loads((Path(__file__).parent /
                              "fixtures/project-save/work-v2-membership.json").read_text("utf-8"))[case]
        work = self.work()
        for field in ("projectInstallation", "prjtoolsAvailable", "fileSaveAvailable"):
            self.assertEqual(work[field], fixture[field], field)
        self.assertEqual(set(work["projectInstallation"]), {"status"})
        return fixture

    def test_membership_external_with_definitions_matches_save(self):
        self.assertIsNotNone(self.work()["source"]["installation"])
        fixture = self.assert_membership_fixture("externalWithDefinitions")
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "saved")
        self.assertEqual(result["tool"]["required"], fixture["toolRequired"])
        self.assertEqual(result["tool"]["updateStatus"], "not_required")
        self.runner.assert_not_called()
        self.assertNotIn("projectInstallation", self.base.app.call("work.get", {})["work"])
        self.assertNotIn("projectInstallation", self.work()["source"])

    def test_membership_associated_with_tool_matches_save(self):
        self.base.allplan()
        fixture = self.assert_membership_fixture("associatedWithTool")
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "saved")
        self.assertEqual(result["tool"]["required"], fixture["toolRequired"])
        self.runner.assert_called_once()

    def test_membership_associated_without_executable_matches_save(self):
        self.base.allplan(create_tool=False)
        fixture = self.assert_membership_fixture("associatedWithoutTool")
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["error"]["code"], "tool_missing")
        self.assertEqual(result["tool"]["required"], fixture["toolRequired"])
        self.assertTrue(result["file"]["verified"])
        self.runner.assert_not_called()

    def test_membership_associated_without_prg_stays_associated(self):
        self.base.context.paths["PRJ"] = self.f.project.parent
        self.base.context.paths.pop("PRG", None)
        self.assert_membership_fixture("associatedWithoutTool")
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["tool"]["required"], True)
        self.assertEqual(result["error"]["code"], "tool_missing")
        self.runner.assert_not_called()

    def test_membership_unknown_discovery_error_blocks_before_write(self):
        request = self.request()
        self.f.discover.side_effect = OSError("discovery unavailable simulation")
        fixture = self.assert_membership_fixture("unknown")
        self.assertIn("discovery_failed", self.work()["save"]["blockedReasons"])
        self.start(request)
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["file"]["written"])
        self.assertEqual(result["tool"]["required"], fixture["toolRequired"])
        self.assertEqual(result["error"]["code"], "discovery_failed")
        self.assertEqual(self.f.path.read_bytes(), self.base.original)
        self.runner.assert_not_called()

    def test_membership_unknown_ambiguous_matches_save(self):
        self.base.allplan()
        other = deepcopy(self.base.context)
        other.allplan_version = "2026"
        self.f.discover.return_value = ([self.base.context, other], [])
        self.assert_membership_fixture("unknown")
        self.assertIn("installation_ambiguous", self.work()["save"]["blockedReasons"])
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["error"]["code"], "installation_ambiguous")
        self.assertIsNone(result["tool"]["required"])
        self.assertFalse(result["file"]["written"])
        self.runner.assert_not_called()

    def test_membership_unknown_unresolvable_prj_not_external(self):
        self.base.context.paths["PRJ"] = self.f.root / "missing-prj-root"
        self.assert_membership_fixture("unknown")
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["tool"]["required"])
        self.assertFalse(result["file"]["written"])
        self.runner.assert_not_called()

    def test_membership_associated_unsafe_tool_path_not_unknown_or_external(self):
        self.base.allplan()
        bad = self.f.root / "unsafe & folder"
        bad.mkdir()
        self.base.context.paths["PRG"] = bad
        work = self.work()
        self.assertEqual(work["projectInstallation"], {"status": "associated"})
        self.assertFalse(work["fileSaveAvailable"])
        self.assertFalse(work["prjtoolsAvailable"])
        self.assertIn("unsafe_tool_path", work["save"]["blockedReasons"])
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["error"]["code"], "unsafe_tool_path")
        self.assertTrue(result["tool"]["required"])
        self.assertFalse(result["file"]["written"])
        self.runner.assert_not_called()

    def test_membership_active_context_override_shared_with_save(self):
        self.base.allplan()
        active = deepcopy(self.base.context)
        active.paths["PRJ"] = self.f.root / "external-override-prj"
        active.paths["PRJ"].mkdir()
        self.app._launch_context = active
        self.assert_membership_fixture("externalWithDefinitions")
        request, _ = self.start()
        result = self.finish(request)["result"]
        self.assertEqual(result["status"], "saved")
        self.assertFalse(result["tool"]["required"])
        self.runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
