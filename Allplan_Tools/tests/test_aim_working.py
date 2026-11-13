from copy import deepcopy
import json
from unittest import TestCase
from unittest.mock import MagicMock, patch

from application.launcher.aim_remote_review import ReviewApi, WORKING_STATE_FRONTENDS
from tests import test_aim_project_manager as fixtures


class WorkingTests(TestCase):
    def setUp(self):
        self.fixture = fixtures.ProjectManagerTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.app = self.fixture.app
        self.app._set_working_state(True)
        self.source = self.app.get_initial_data()
        self.config = deepcopy(self.fixture.configuration)

    def call(self, command, payload=None):
        return self.app.call(command, {} if payload is None else payload)

    def work(self):
        return self.call("work.get")["work"]

    def set_value(self, number="7", value="draft"):
        return self.call("work.value.set", {
            "revision": self.work()["revision"], "number": number, "value": value,
        })

    def transition(self, command, payload, discard):
        return self.call("work.transition", {
            "revision": self.work()["revision"], "command": command,
            "payload": payload, "discard": discard,
        })

    def test_values_are_separate_and_survive_presentation_and_manager(self):
        source_files = {p: p.read_bytes() for p in self.fixture.base.project.rglob("*") if p.is_file()}
        document = self.app._document
        self.fixture.add()
        settings = self.fixture.base.store._path.read_bytes()
        self.assertTrue(self.set_value()["ok"])
        response = self.call("presentation.update", {"configuration": self.config})
        self.assertTrue(response["ok"])
        self.assertFalse(response["presentation"]["model"]["readOnly"])
        rows = response["presentation"]["model"]["categories"][0]["groups"][0]["rows"]
        self.assertEqual([r["value"] for r in rows], ["draft", "draft"])
        self.assertEqual([r["id"] for r in rows], ["row-a", "row-b"])
        altered = deepcopy(self.config)
        altered["categories"][0]["groups"][0]["rows"][0]["title"] = "Occurrence only"
        self.call("presentation.update", {"configuration": altered})
        self.assertEqual(self.work()["draftValues"], {"7": "draft"})
        preview = self.call("project.manager.preview", {
            "path": str(self.fixture.base.project),
        })["preview"]
        self.assertEqual([r["value"] for r in preview["items"][0]["rows"]], ["0", "0"])
        self.assertEqual(self.app.get_initial_data(), self.source)
        self.assertIs(self.app._document, document)
        self.assertEqual(document.values()["7"], "0")
        self.assertEqual(self.fixture.base.store._path.read_bytes(), settings)
        self.assertEqual({p: p.read_bytes() for p in source_files}, source_files)
        self.assertEqual(self.work()["dirty"], {"values": True, "presentation": True, "any": True})

    def test_unset_empty_zero_and_return_to_source(self):
        for value in ("", "0", "false", None):
            self.assertTrue(self.set_value(value=value)["ok"])
            row = next(r for r in self.work()["data"]["attributes"] if r["number"] == "7")
            self.assertEqual(row["value"], value)
            self.assertEqual(row["valueState"], "unset" if value is None else "set")
        self.set_value(value="0")
        self.assertFalse(self.work()["dirty"]["values"])
        self.assertEqual(self.work()["draftValues"], {})

    def test_same_project_reload_and_stale_import_preserve_configuration(self):
        self.call("presentation.update", {"configuration": self.config})
        self.set_value()
        self.assertTrue(self.transition("project.select", {
            "path": str(self.fixture.base.project),
        }, True)["ok"])
        self.assertEqual(self.work()["draftValues"], {})
        self.assertEqual(self.work()["presentation"]["configuration"], self.config)
        path = self.fixture.base.root / "pending.json"
        path.write_text(json.dumps(self.config), encoding="utf-8")
        self.app._presentation._choose_file = lambda: path
        token = self.call("presentation.import.prepare")["token"]
        self.assertTrue(self.work()["pendingImport"])
        self.set_value(value="changed after prepare")
        self.assertEqual(self.transition("presentation.import.apply", {
            "token": token,
        }, True)["error"]["code"], "project_changed")
        self.assertEqual(self.work()["draftValues"], {"7": "changed after prepare"})
        self.assertEqual(self.work()["presentation"]["configuration"], self.config)

    def test_strict_validation_stale_revision_and_no_file_output(self):
        revision = self.work()["revision"]
        for number, value in (("007", "x"), ("unknown", "x"), ("7", True), ("7", {})):
            self.assertFalse(self.call("work.value.set", {
                "revision": revision, "number": number, "value": value,
            })["ok"])
        self.assertEqual(self.set_value("999999")["error"]["code"], "unknown_attribute")
        self.set_value()
        self.assertEqual(self.call("work.value.set", {
            "revision": revision, "number": "7", "value": "late",
        })["error"]["code"], "stale_work")
        self.app._presentation._choose_export = MagicMock()
        self.assertEqual(self.call("presentation.export", {
            "configuration": self.config,
        })["error"]["code"], "file_write_forbidden")
        self.app._presentation._choose_export.assert_not_called()
        for command in ("save", "prjtools", "project.save"):
            self.assertEqual(self.call(command)["error"]["code"], "unknown_command")
        self.assertFalse(self.work()["fileSaveAvailable"])
        self.assertFalse(self.work()["prjtoolsAvailable"])

    def test_transition_cancel_failure_and_success_are_transactional(self):
        second = self.fixture.base.outside_project()
        self.fixture.add(second)
        self.set_value()
        before = self.work()
        self.assertEqual(self.call("project.select", {"path": str(second)})["error"]["code"],
                         "work_confirmation_required")
        self.assertEqual(self.transition("project.select", {"path": str(second)}, False)["error"]["code"],
                         "work_confirmation_required")
        self.assertEqual(self.work(), before)
        self.fixture.base.chooser.return_value = None
        self.assertEqual(self.transition("project.select", {}, True)["status"], "cancelled")
        self.assertEqual(self.work(), before)
        source = second / "project.cfg"
        original = source.read_bytes()
        source.write_bytes(b"ATTR=INVALID\n")
        self.assertFalse(self.transition("project.select", {"path": str(second)}, True)["ok"])
        self.assertEqual(self.work(), before)
        source.write_bytes(original)
        result = self.transition("project.manager.open", {
            "path": str(second), "discardPresentation": True,
        }, True)
        self.assertTrue(result["ok"])
        self.assertEqual(result["work"]["source"]["project"]["path"], str(second))
        self.assertEqual(result["work"]["draftValues"], {})
        self.assertFalse(result["work"]["dirty"]["any"])

    def test_import_preserves_values_and_protects_replaced_configuration(self):
        self.call("presentation.update", {"configuration": self.config})
        self.set_value()
        path = self.fixture.base.root / "new.json"
        path.write_text(json.dumps(self.config), encoding="utf-8")
        self.app._presentation._choose_file = lambda: path
        prepared = self.call("presentation.import.prepare")
        self.assertTrue(prepared["ok"])
        body = {"token": prepared["token"]}
        self.assertEqual(self.call("presentation.import.apply", body)["error"]["code"],
                         "work_confirmation_required")
        self.assertTrue(self.transition("presentation.import.apply", body, True)["ok"])
        self.assertEqual(self.work()["draftValues"], {"7": "draft"})
        self.assertFalse(self.work()["dirty"]["presentation"])
        self.assertTrue(self.work()["dirty"]["values"])
        self.assertTrue(self.call("work.discard", {"revision": self.work()["revision"]})["ok"])
        self.assertEqual(self.work()["draftValues"], {})
        self.assertEqual(self.work()["presentation"]["configuration"], self.config)

    def test_close_guard_and_old_profiles_are_opt_in(self):
        self.assertEqual(WORKING_STATE_FRONTENDS, frozenset({
            "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
        }))
        self.assertEqual(self.app.get_app_info()["working_state_contract"], 1)
        self.assertFalse(self.app.get_app_info()["read_only"])
        self.app._attach_window(MagicMock())
        self.set_value()
        self.assertFalse(self.app._can_close_work())
        with patch("application.core.windows_ui.confirm_discard_work", return_value=False):
            self.assertFalse(self.app._confirm_close_work())
        with patch("application.core.windows_ui.confirm_discard_work", side_effect=RuntimeError("unavailable")):
            with self.assertLogs("application.plugins.information_manager.presentation", level="ERROR"):
                self.assertFalse(self.app._confirm_close_work())
        with patch("application.core.windows_ui.confirm_discard_work", return_value=True) as choose:
            self.assertTrue(self.app._confirm_close_work())
            choose.assert_called_once_with(self.app._window, values=True, presentation=False, pending=False)
        self.set_value(value="another draft")
        revision = self.work()["revision"]
        api = ReviewApi(self.app)
        api.active = True
        api.get_app_info()
        self.assertEqual(api.call("work.close", {
            "revision": revision, "discard": False,
        })["error"]["code"], "work_confirmation_required")
        self.app._window.destroy.assert_not_called()
        self.assertEqual(api.call("work.close", {
            "revision": revision, "discard": True,
        }), {"ok": True, "status": "close_requested"})
        self.app._window.destroy.assert_called_once()
        self.assertTrue(self.app._can_close_work())
        old = self.fixture.make_app()
        self.assertNotIn("working_state_contract", old.get_app_info())
        self.assertEqual(old.call("work.get", {})["error"]["code"], "unknown_command")
        self.assertEqual(old.get_initial_data()["data"], self.source["data"])
