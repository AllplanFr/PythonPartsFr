from copy import deepcopy
from pathlib import Path
import os
import subprocess
import tempfile
from threading import Event, current_thread
import unittest
from unittest.mock import MagicMock, patch

from application.core.context import LaunchContext
from application.core.allplan import project_attribute_writer as writer
from application.core.allplan import project_tools
from application.core.allplan.readers.project_attributes import read_project_attributes
from application.plugins.information_manager import project_save
from application.plugins.information_manager.presentation import AimPresentationApp
from tests import test_aim_project_reading as reading_fixture


FIXTURE = b"Version 3\r\n479|Architect|Synthetic value\r\n474|Unknown|  keep|pipes||  \r\n"


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name) / "external.prj"
        self.project.mkdir()
        self.path = self.project / "prjatt.dat"
        self.source = FIXTURE
        self.path.write_bytes(self.source)

    def commit(self, changes, names=None):
        prepared = writer.prepare(self.path, self.source, changes, names or {})
        self.addCleanup(prepared.cleanup)
        prepared.commit()
        return prepared

    def test_reference_bytes_preserved_except_target_value(self):
        before = read_project_attributes(self.project).data
        self.assertEqual(before.status, "read")
        original = next(row for row in before.records if row.number == "479")
        value = "  \u00e9t\u00e9 \u20ac |A||B|  "
        prepared = self.commit({"479": value})
        old_line = ("479|" + original.name + "|" + original.value).encode("cp1252")
        new_line = ("479|" + original.name + "|" + value).encode("cp1252")
        self.assertEqual(self.path.read_bytes(), self.source.replace(old_line, new_line, 1))
        self.assertEqual(prepared.backup.read_bytes(), self.source)
        self.assertEqual(read_project_attributes(self.project).data.values()["479"], value)

    def test_roundtrip_leading_trailing_consecutive_and_multiple_pipes(self):
        for value in ("|A||B|", "|||", "|", "  |A|B||  ", "", "0", "\u00e9\u20ac"):
            with self.subTest(value=value):
                result = writer.render(self.source, {"474": value}, {})
                self.path.write_bytes(result)
                self.assertEqual(read_project_attributes(self.project).data.values()["474"], value)
                self.assertEqual(writer.render(result, {}, {}), result)

    def test_utf16le_bom_preserves_unmodified_bytes_and_mixed_endings(self):
        self.source = b"\xff\xfe" + "Version 3\r\n479|Architect|old\n474|Unknown| keep|| ".encode("utf-16-le")
        self.path.write_bytes(self.source)
        value = "  \u6f22 |A||B|  "
        prepared = self.commit({"479": value})
        expected = self.source.replace("479|Architect|old".encode("utf-16-le"),
                                       ("479|Architect|" + value).encode("utf-16-le"))
        self.assertEqual(prepared.body, expected)
        self.assertEqual(prepared.backup.read_bytes(), self.source)
        self.assertEqual(read_project_attributes(self.project).data.values()["479"], value)
        self.assertEqual(writer.render(expected, {}, {}), expected)

    def test_unsupported_boms_and_null_are_explicitly_refused(self):
        for encoding in ("utf-8-sig", "utf-16-be", "utf-32"):
            source = "Version 3\r\n479|Architect|old\r\n".encode(encoding)
            if encoding == "utf-16-be":
                source = b"\xfe\xff" + source
            with self.subTest(encoding=encoding), self.assertRaises(writer.SaveError) as caught:
                writer.render(source, {"479": "new"}, {})
            self.assertEqual(caught.exception.code, "unsupported_encoding")
        source = b"\xff\xfe" + "Version 3\n479|Architect|old".encode("utf-16-le")
        with self.assertRaises(writer.SaveError) as caught:
            writer.render(source, {"479": None}, {})
        self.assertEqual(caught.exception.code, "null_unspecified")

    def test_added_records_use_existing_line_ending(self):
        source = b"\xff\xfe" + "Version 3\n479|Architect|old".encode("utf-16-le")
        expected = b"\xff\xfe" + "Version 3\n479|Architect|old\n7|Definition|new\n".encode("utf-16-le")
        self.assertEqual(writer.render(source, {"7": "new"}, {"7": "Definition"}), expected)

    def test_original_474_pipes_and_spaces_untouched(self):
        prepared = self.commit({"479": "other"})
        original = next(r for r in read_project_attributes(self.project).data.records if r.number == "474")
        source_line = next(line for line in self.source.split(b"\r\n") if line.startswith(b"474|"))
        self.assertIn(b"|", original.value.encode("cp1252"))
        self.assertIn(source_line, prepared.body)

    def test_canonical_identity_preserves_original_number_name_order_and_endings(self):
        self.source = b"Version 3\r\n0007|Original name|old\n9|Unknown|  keep||  "
        self.path.write_bytes(self.source)
        self.commit({"7": "new"})
        self.assertEqual(self.path.read_bytes(),
                         b"Version 3\r\n0007|Original name|new\n9|Unknown|  keep||  ")

    def test_added_name_from_definition_and_windows_newline(self):
        self.source = b"Version 3\r\n7|Old|0"
        self.path.write_bytes(self.source)
        self.commit({"8": "\u20ac"}, {"8": "Allplan definition"})
        self.assertEqual(self.path.read_bytes(),
                         b"Version 3\r\n7|Old|0\r\n8|Allplan definition|\x80\r\n")

    def test_new_file_no_original_backup(self):
        self.path.unlink()
        prepared = writer.prepare(self.path, None, {"7": "0"}, {"7": "Definition"})
        self.addCleanup(prepared.cleanup)
        prepared.commit()
        self.assertIsNone(prepared.backup)
        self.assertEqual(self.path.read_bytes(), b"Version 3\r\n7|Definition|0\r\n")

    def test_concurrent_creator_not_overwritten(self):
        self.path.unlink()
        prepared = writer.prepare(self.path, None, {"7": "0"}, {"7": "Definition"})
        self.addCleanup(prepared.cleanup)
        self.path.write_bytes(b"concurrent")
        with self.assertRaises(writer.SaveError):
            prepared.commit()
        self.assertEqual(self.path.read_bytes(), b"concurrent")

    def test_null_unencodable_and_multiline_fail_before_any_backup(self):
        for value, code in ((None, "null_unspecified"), ("\u6f22", "encoding_failed"),
                            ("a\nb", "invalid_value"), ("a\rb", "invalid_value"),
                            ("a\x00b", "invalid_value")):
            with self.subTest(code=code):
                with self.assertRaises(writer.SaveError) as caught:
                    writer.prepare(self.path, self.source, {"479": value}, {})
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(self.path.read_bytes(), self.source)
                self.assertEqual(list(self.project.glob("*.bak")), [])
                self.assertEqual(list(self.project.glob("*.tmp")), [])

    def test_add_without_allplan_name_refused(self):
        with self.assertRaisesRegex(writer.SaveError, "Nom Allplan"):
            writer.prepare(self.path, self.source, {"999999": "new"}, {})

    def test_conflict_after_prepare_preserved(self):
        prepared = writer.prepare(self.path, self.source, {"479": "new"}, {})
        self.addCleanup(prepared.cleanup)
        self.path.write_bytes(self.source + b"99999|Other|changed\r\n")
        concurrent = self.path.read_bytes()
        with self.assertRaises(writer.SaveError) as caught:
            prepared.commit()
        self.assertEqual(caught.exception.code, "external_conflict")
        self.assertEqual(self.path.read_bytes(), concurrent)
        self.assertIsNone(prepared.backup)

    def test_backup_creation_failure_prevents_replacement(self):
        prepared = writer.prepare(self.path, self.source, {"479": "new"}, {})
        self.addCleanup(prepared.cleanup)
        original = Path.open

        def denied(path, *args, **kwargs):
            if path.suffix == ".bak":
                raise PermissionError("test backup refused")
            return original(path, *args, **kwargs)

        with patch.object(Path, "open", denied), patch.object(writer.os, "replace") as replace:
            with self.assertRaises(PermissionError):
                prepared.commit()
        replace.assert_not_called()
        self.assertEqual(self.path.read_bytes(), self.source)

    def test_replace_failure_preserves_backup_and_original(self):
        prepared = writer.prepare(self.path, self.source, {"479": "new"}, {})
        self.addCleanup(prepared.cleanup)
        with patch.object(writer.os, "replace", side_effect=PermissionError("test replace")):
            with self.assertRaises(PermissionError):
                prepared.commit()
        self.assertEqual(prepared.backup.read_bytes(), self.source)
        self.assertEqual(self.path.read_bytes(), self.source)
        self.assertFalse(prepared.replaced)

    def test_readonly_refused(self):
        self.path.chmod(0o444)
        self.addCleanup(lambda: self.path.chmod(0o666))
        with self.assertRaises(writer.SaveError) as caught:
            writer.prepare(self.path, self.source, {"479": "new"}, {})
        self.assertEqual(caught.exception.code, "read_only")

    def test_unrelated_control_character_not_a_line_break(self):
        source = b"Version 3\r\n7|Name|keep\x0bthis\x0cvalue\r\n"
        self.assertEqual(writer.render(source, {}, {}), source)

    def test_backup_is_exclusive_never_overwrites_existing_backup(self):
        prepared = writer.prepare(self.path, self.source, {"479": "new"}, {})
        self.addCleanup(prepared.cleanup)
        identifier = MagicMock(hex="fixed")
        backup = self.path.with_name("prjatt.dat.fixed.bak")
        backup.write_bytes(b"previous proof")
        with patch.object(writer, "uuid4", return_value=identifier):
            with self.assertRaises(FileExistsError):
                prepared.commit()
        self.assertEqual(backup.read_bytes(), b"previous proof")
        self.assertEqual(self.path.read_bytes(), self.source)

    def test_temporary_is_revalidated_and_cleaned_on_failure(self):
        original = Path.read_bytes

        def corrupt(path):
            if path.name.startswith(".aim-prjatt-"):
                return b"corrupt"
            return original(path)

        with patch.object(Path, "read_bytes", corrupt):
            with self.assertRaises(writer.SaveError):
                writer.prepare(self.path, self.source, {"479": "new"}, {})
        self.assertEqual(list(self.project.glob("*.tmp")), [])
        self.assertEqual(self.path.read_bytes(), self.source)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.f = reading_fixture.ProjectReadingTests()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.f.content("Version 3\r\n7|Original name|0\r\n999|Unknown|keep||\r\n")
        other = self.f.root / "other-PRJ"
        other.mkdir()
        self.context = deepcopy(self.f.context)
        self.context.paths["PRJ"] = other
        self.f.discover.return_value = ([self.context], [])
        self.app = AimPresentationApp(
            self.f.data, LaunchContext(project_path=self.f.project),
            settings_store=self.f.store, choose_directory=self.f.chooser,
            discover_installations=self.f.discover, working_state=True,
        )
        self.assertEqual(self.app.get_initial_data()["selection"], "accepted")
        self.runner = MagicMock(return_value={"returncode": 0})
        self.service = project_save.ProjectValueSave(self.app, runner=self.runner)
        self.original = self.f.path.read_bytes()
        self.set_value("draft")

    def set_value(self, value, number="7"):
        reply = self.app.call("work.value.set", {
            "revision": self.app._work.revision, "number": number, "value": value,
        })
        self.assertTrue(reply["ok"])

    def payload(self):
        return {"revision": self.app._work.revision, "projectRevision": self.app._project_revision}

    def save(self, payload=None):
        return self.service.submit(self.payload() if payload is None else payload).result(timeout=10)

    def allplan(self, *, create_tool=True):
        self.context.paths["PRJ"] = self.f.project.parent
        prg = self.f.root / "Program files" / "Allplan" / "Prg"
        prg.mkdir(parents=True, exist_ok=True)
        self.context.paths["PRG"] = prg
        if create_tool:
            (prg / "prjtool.exe").write_bytes(b"fake; must never be executed")

    def block_prepare(self):
        entered, release = Event(), Event()
        original = project_save.prepare

        def blocked(*args):
            result = original(*args)
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test barrier not released")
            return result

        self.addCleanup(release.set)
        return entered, release, blocked

    def test_external_saved_without_any_process_and_work_get_reflects_disk(self):
        result = self.save()
        self.assertEqual(result["status"], "saved")
        self.assertIsNone(result["tool"])
        self.runner.assert_not_called()
        self.assertEqual(Path(result["backup"]).read_bytes(), self.original)
        work = self.app.call("work.get", {})["work"]
        self.assertEqual(work["source"]["data"]["attributes"][0]["value"], "draft")
        self.assertEqual(work["draftValues"], {})
        self.assertFalse(work["dirty"]["values"])
        self.assertFalse(work["fileSaveAvailable"])
        self.assertFalse(work["prjtoolsAvailable"])
        self.assertEqual(self.app.call("work.save", self.payload())["error"]["code"], "unknown_command")

    def test_file_added_with_name_from_definition_not_presentation(self):
        self.f.xml(self.f.etc, "AttributeDefinitionCollectionAllplan_en.xml",
                   self.f.definition("7", "Allplan original") + self.f.definition("8", "Allplan added"))
        self.app._state = self.app._load(self.f.project, [], remember=False)
        self.app._work.values.clear()
        self.set_value("", "8")
        self.assertTrue(self.save()["ok"])
        self.assertIn(b"8|Allplan added|\r\n", self.f.path.read_bytes())

    def test_null_and_encoding_failure_keep_dirty(self):
        for value, code in ((None, "null_unspecified"), ("\u6f22", "encoding_failed")):
            self.set_value(value)
            result = self.save()
            self.assertEqual(result["error"]["code"], code)
            self.assertFalse(result["written"])
            self.assertTrue(self.app._work.dirty()["values"])
            self.assertEqual(self.f.path.read_bytes(), self.original)
        self.runner.assert_not_called()

    def test_external_conflict_at_loaded_snapshot(self):
        self.f.path.write_bytes(self.original + b"800|Added|external\r\n")
        self.assertEqual(self.save()["error"]["code"], "external_conflict")
        self.runner.assert_not_called()
        self.assertTrue(self.app._work.dirty()["values"])

    def test_closed_session_and_stale_revisions(self):
        payload = self.payload()
        self.set_value("new revision")
        self.assertEqual(self.save(payload)["error"]["code"], "stale_work")
        payload = self.payload()
        payload["projectRevision"] -= 1
        self.assertEqual(self.save(payload)["error"]["code"], "project_changed")
        self.app._close_session()
        self.assertEqual(self.save()["error"]["code"], "session_obsolete")
        self.assertEqual(self.f.path.read_bytes(), self.original)

    def test_close_before_commit_prevents_write(self):
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            task = self.service.submit(self.payload())
            self.assertTrue(entered.wait(5))
            self.app._close_session()
            release.set()
            self.assertEqual(task.result(5)["error"]["code"], "session_obsolete")
        self.assertEqual(self.f.path.read_bytes(), self.original)
        self.runner.assert_not_called()

    def test_work_change_during_prepare_and_double_save(self):
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            task = self.service.submit(self.payload())
            self.assertTrue(entered.wait(5))
            self.assertEqual(self.save()["error"]["code"], "save_busy")
            self.set_value("concurrent")
            release.set()
            self.assertEqual(task.result(5)["error"]["code"], "stale_work")
        self.assertEqual(self.f.path.read_bytes(), self.original)

    def test_allplan_correct_prg_arguments_and_worker(self):
        self.allplan()
        thread_names = []

        def run(plan, diagnostics):
            thread_names.append(current_thread().name)
            self.assertEqual(plan.executable, self.context.paths["PRG"] / "prjtool.exe")
            self.assertEqual(plan.cwd, self.context.paths["PRG"])
            self.assertEqual(plan.project, self.f.project)
            self.assertEqual(plan.command, subprocess.list2cmdline([
                str(plan.executable), str(self.f.project), "-updateattr",
            ]))
            self.assertEqual(read_project_attributes(self.f.project).data.values()["7"], "draft")
            return {"returncode": 0}

        self.runner.side_effect = run
        result = self.save()
        self.assertEqual(result["status"], "saved")
        self.assertEqual(thread_names, ["aim-project-save"])
        self.runner.assert_called_once()

    def test_tool_missing_partial_after_write_no_ack(self):
        self.allplan(create_tool=False)
        result = self.save()
        self.assertEqual((result["status"], result["error"]["code"]), ("partial", "tool_missing"))
        self.assertTrue(result["written"])
        self.assertTrue(self.app._work.dirty()["values"])
        self.runner.assert_not_called()
        self.assertEqual(self.save()["error"]["code"], "recovery_required")

    def test_tool_failure_and_uncertainty_never_ack(self):
        self.allplan()
        self.runner.return_value = {"returncode": 9}
        result = self.save()
        self.assertEqual((result["status"], result["tool"]["returncode"]), ("partial", 9))
        self.assertTrue(self.app._work.dirty()["values"])
        self.runner.assert_called_once()

    def test_tool_timeout_no_kill_or_retry(self):
        self.allplan()
        self.runner.side_effect = subprocess.TimeoutExpired("simulated", 1)
        result = self.save()
        self.assertEqual(result["error"]["code"], "tool_uncertain")
        self.assertTrue(self.app._work.dirty()["values"])
        self.runner.assert_called_once()

    def test_final_reverification_failure(self):
        self.allplan()

        def change_disk(*args):
            self.f.path.write_bytes(b"Version 3\r\n7|Name|unexpected\r\n")
            return {"returncode": 0}

        self.runner.side_effect = change_disk
        result = self.save()
        self.assertEqual((result["status"], result["error"]["code"]), ("partial", "verification_failed"))
        self.assertEqual(self.app._work.values, {"7": "draft"})

    def test_edits_during_tool_remain_dirty(self):
        self.allplan()
        self.runner.side_effect = lambda *args: (self.set_value("newer") or {"returncode": 0})
        self.assertEqual(self.save()["error"]["code"], "stale_work")
        self.assertEqual(self.app._work.values, {"7": "newer"})

    def test_close_during_tool_does_not_ack_old_session(self):
        self.allplan()
        self.runner.side_effect = lambda *args: (self.app._close_session() or {"returncode": 0})
        result = self.save()
        self.assertEqual((result["status"], result["error"]["code"]), ("partial", "session_obsolete"))
        self.assertTrue(self.app._work.dirty()["values"])

    def test_write_failed_never_calls_tool(self):
        self.allplan()
        with patch.object(writer.os, "replace", side_effect=PermissionError("test")):
            result = self.save()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(self.f.path.read_bytes(), self.original)
        self.runner.assert_not_called()

    def test_unsafe_shell_path_refused_before_any_file_change(self):
        self.allplan()
        bad = self.f.root / "unsafe & folder"
        bad.mkdir()
        self.context.paths["PRG"] = bad
        result = self.save()
        self.assertEqual(result["error"]["code"], "unsafe_tool_path")
        self.assertEqual(self.f.path.read_bytes(), self.original)
        self.assertEqual(list(self.f.project.glob("*.bak")), [])

    def test_external_without_any_discovered_installation_can_save(self):
        self.f.discover.return_value = ([], [])
        self.assertEqual(self.save()["status"], "saved")
        self.runner.assert_not_called()

    def test_discovery_error_is_not_misclassified_as_external(self):
        self.f.discover.side_effect = OSError("test discovery")
        result = self.save()
        self.assertEqual(result["error"]["code"], "discovery_failed")
        self.assertEqual(self.f.path.read_bytes(), self.original)

    def test_close_refused_new_session_does_not_restore_pending_save(self):
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            task = self.service.submit(self.payload())
            self.assertTrue(entered.wait(5))
            session = self.app._invalidate_session()
            self.app._rearm_session(session)
            release.set()
            self.assertEqual(task.result(5)["error"]["code"], "session_obsolete")
        self.assertEqual(self.f.path.read_bytes(), self.original)
        self.assertEqual(self.save()["status"], "saved")

    def test_request_queued_before_rearm_cannot_start_in_new_session(self):
        with patch.object(project_save, "Thread") as thread:
            future = self.service.submit(self.payload())
            session = self.app._invalidate_session()
            self.app._rearm_session(session)
            thread.call_args.kwargs["target"]()
        self.assertEqual(future.result(5)["error"]["code"], "session_obsolete")
        self.assertEqual(self.f.path.read_bytes(), self.original)

    def test_request_revisions_are_copied_at_submission(self):
        payload = self.payload()
        with patch.object(project_save, "Thread") as thread:
            future = self.service.submit(payload)
            self.set_value("edited while queued")
            payload.update(self.payload())
            thread.call_args.kwargs["target"]()
        self.assertEqual(future.result(5)["error"]["code"], "stale_work")
        self.assertEqual(self.f.path.read_bytes(), self.original)

    def test_project_identity_change_during_prepare_refused(self):
        entered, release, blocked = self.block_prepare()
        with patch.object(project_save, "prepare", blocked):
            task = self.service.submit(self.payload())
            self.assertTrue(entered.wait(5))
            (self.f.project / "project.cfg").write_bytes(b"changed externally")
            release.set()
            self.assertEqual(task.result(5)["error"]["code"], "project_changed")
        self.assertEqual(self.f.path.read_bytes(), self.original)

    def test_ambiguous_installation_refused_before_write(self):
        self.allplan()
        other = deepcopy(self.context)
        other.allplan_version = "2026"
        self.f.discover.return_value = ([self.context, other], [])
        self.assertEqual(self.save()["error"]["code"], "installation_ambiguous")
        self.assertEqual(self.f.path.read_bytes(), self.original)

    def test_tool_uncertain_result_is_partial(self):
        self.allplan()
        self.runner.return_value = {"returncode": None}
        result = self.save()
        self.assertEqual((result["status"], result["error"]["code"]), ("partial", "tool_uncertain"))
        self.assertTrue(self.app._work.dirty()["values"])

    def test_post_replacement_error_is_partial_not_unwritten(self):
        original_replace = writer.os.replace

        def replaced_then_error(source, destination):
            original_replace(source, destination)
            raise OSError("test error after replacement")

        with patch.object(writer.os, "replace", replaced_then_error):
            result = self.save()
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["written"])
        self.assertTrue(self.app._work.dirty()["values"])
        self.runner.assert_not_called()

    def test_post_commit_relecture_failure_never_launches_tool(self):
        self.allplan()
        with patch.object(writer.PreparedWrite, "verify",
                          side_effect=writer.SaveError("verification_failed", "test readback")):
            result = self.save()
        self.assertEqual((result["status"], result["error"]["code"]), ("partial", "verification_failed"))
        self.runner.assert_not_called()

    def test_value_success_does_not_ack_presentation_changes(self):
        self.app._work.baseline = {"configuration": {"version": 1}}
        self.app._presentation._current = {"configuration": {"version": 2}}
        before = deepcopy(self.app._presentation._current)
        self.assertTrue(self.save()["ok"])
        self.assertTrue(self.app._work.dirty()["presentation"])
        self.assertEqual(self.app._presentation._current, before)

    def test_different_drive_accents_spaces_and_refused_metacharacters(self):
        for root, project in (
            (Path("D:\\Allplan \u00e9t\u00e9\\Prj"), Path("D:\\Allplan \u00e9t\u00e9\\Prj\\Projet 1.prj")),
        ):
            context = LaunchContext(allplan_version="2026", paths={
                "PRJ": root, "PRG": Path("E:\\Allplan \u00e9t\u00e9\\Prg"),
            })
            with patch.object(project_tools, "safe_path"), patch.object(Path, "resolve", lambda p, **kw: p):
                plan = project_save.tool_plan(project, [context])
            self.assertEqual(plan.cwd, context.paths["PRG"])
            self.assertEqual(plan.command, subprocess.list2cmdline([
                str(plan.executable), str(project), "-updateattr",
            ]))
        for unsafe in ("x%PATH%", "x!y", "x^y", "x&y", "x(y)", "x|y"):
            project = Path("D:\\Prj\\" + unsafe + ".prj")
            context = LaunchContext(allplan_version="2026", paths={
                "PRJ": Path("D:\\Prj"), "PRG": Path("E:\\Prg"),
            })
            with patch.object(project_tools, "safe_path"), patch.object(Path, "resolve", lambda p, **kw: p):
                with self.assertRaises(writer.SaveError):
                    project_save.tool_plan(project, [context])

    def test_runner_uses_system_shell_true_cwd_and_waits(self):
        self.allplan()
        plan = project_save.tool_plan(self.f.project, [self.context])
        diagnostics = self.f.root / "diagnostics"
        process = MagicMock()
        process.wait.return_value = 0
        with patch.object(project_save.subprocess, "Popen", return_value=process) as popen:
            result = project_save.execute_tool(plan, diagnostics)
        self.assertEqual(result["returncode"], 0)
        self.assertTrue(popen.call_args.kwargs["shell"])
        self.assertEqual(popen.call_args.kwargs["cwd"], self.context.paths["PRG"])
        self.assertEqual(popen.call_args.args[0], plan.command)
        process.wait.assert_called_once_with()
        self.assertTrue((diagnostics / result["stdout"]).is_file())


if __name__ == "__main__":
    unittest.main()
