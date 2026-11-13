from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.context import LaunchContext
from application.launcher.aim_remote_review import ReviewApi
from application.plugins.information_manager.presentation import (
    AimPresentationApp, EditablePresentationImport,
)
from tests import test_aim_presentation_import as fixtures


class PresentationUpdateTests(unittest.TestCase):
    def setUp(self):
        self.base = fixtures.PresentationImportTests()
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        old = self.base.service
        self.service = EditablePresentationImport(old._snapshot, self.base.select, self.base.save)
        prepared = self.service.call("presentation.import.prepare", {})
        self.before = self.service.call(
            "presentation.import.apply", {"token": prepared["token"]},
        )["presentation"]

    def update(self, configuration):
        return self.service.call("presentation.update", {"configuration": configuration})

    def current(self):
        return self.service.call("presentation.get", {})["presentation"]

    def test_update_preserves_ids_repeats_order_parameters_and_uses_current_python_values(self):
        source = self.base.fixture.source.read_bytes()
        configuration = deepcopy(self.before["configuration"])
        rows = [r for c in configuration["categories"] for g in c["groups"] for r in g["rows"]]
        self.assertEqual([r["num"] for r in rows], [7, 7, 8])
        group = next(g for c in configuration["categories"] for g in c["groups"] if len(g["rows"]) > 1)
        group["rows"].reverse()
        for i, row in enumerate(group["rows"], 1):
            row["position"] = i
        self.base.snapshot["_presentationValues"] = {"7": "latest exact value", "8": ""}
        snapshot_before = deepcopy(self.base.snapshot)
        result = self.update(configuration)
        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["presentation"]["configuration"], configuration)
        self.assertIsNone(result["presentation"]["report"])
        model = result["presentation"]["model"]
        displayed = fixtures.PresentationImportTests.rows(model)
        self.assertEqual([r["id"] for r in displayed],
                         [r["id"] for c in configuration["categories"] for g in c["groups"] for r in g["rows"]])
        self.assertEqual([r["value"] for r in displayed if r["number"] == "7"],
                         ["latest exact value", "latest exact value"])
        self.assertEqual([r["value"] for r in displayed if r["number"] == "8"], [""])
        result["presentation"]["configuration"]["categories"].clear()
        self.assertEqual(self.current()["configuration"], configuration)
        self.assertEqual(self.base.snapshot, snapshot_before)
        self.assertEqual(self.base.fixture.source.read_bytes(), source)
        self.base.save.assert_not_called()

    def test_add_occurrence_gets_python_value_and_unknown_definition_is_not_fabricated(self):
        configuration = deepcopy(self.before["configuration"])
        group = configuration["categories"][0]["groups"][0]
        row = deepcopy(group["rows"][0])
        row.update(id="new-occurrence", num=999, position=len(group["rows"]) + 1)
        group["rows"].append(row)
        result = self.update(configuration)
        added = next(r for r in fixtures.PresentationImportTests.rows(result["presentation"]["model"])
                     if r["id"] == "new-occurrence")
        self.assertEqual(added["value"], "not displayed")
        self.assertIsNone(added["definition"])
        self.assertIn("definition_missing", added["diagnostics"])

    def test_invalid_business_fields_or_model_failure_preserve_active_and_pending(self):
        token = self.service.call("presentation.import.prepare", {})["token"]
        for field in ("value", "valueState", "definition", "number"):
            bad = deepcopy(self.before["configuration"])
            bad["categories"][0]["groups"][0]["rows"][0][field] = "browser data"
            self.assertFalse(self.update(bad)["ok"])
            self.assertEqual(self.current(), self.before)
            self.assertEqual(self.service._pending[0], token)
        with patch("application.plugins.information_manager.presentation.display_model",
                   side_effect=RuntimeError("Synthetic model failure")):
            self.assertEqual(self.update(self.before["configuration"])["error"]["code"], "model_unavailable")
        self.assertEqual(self.current(), self.before)
        self.assertEqual(self.service._pending[0], token)
        self.assertTrue(self.update(self.before["configuration"])["ok"])
        self.assertEqual(self.service.call("presentation.import.apply", {"token": token})["error"]["code"],
                         "stale_candidate")

    def test_no_project_and_bad_payloads_and_real_host_capability(self):
        self.base.snapshot = {
            **AimPresentationApp._empty("required", []), "_presentationValues": None,
        }
        result = self.update(self.before["configuration"])
        self.assertTrue(result["ok"])
        self.assertTrue(all(r["value"] is None and r["valueState"] == "unavailable"
                            for r in fixtures.PresentationImportTests.rows(result["presentation"]["model"])))
        for payload in ({}, {"configuration": {}, "values": []}, None):
            self.assertEqual(self.service.call("presentation.update", payload)["error"]["code"],
                             "invalid_payload")
        with TemporaryDirectory() as directory:
            app = AimPresentationApp(Path(directory), LaunchContext(), choose_directory=lambda: None,
                                     presentation_update=True)
            api = ReviewApi(app)
            api.active = True
            self.assertIn("presentation.update", api.get_app_info()["presentation_capabilities"])
            self.assertEqual(app.get_app_info()["presentation_contract"], 1)
            self.assertTrue(api.call("presentation.update", {
                "configuration": self.before["configuration"],
            })["ok"])
            legacy = AimPresentationApp(Path(directory), LaunchContext())
            self.assertNotIn("presentation.update", legacy.get_app_info()["presentation_capabilities"])
            self.assertEqual(legacy.call("presentation.update", {
                "configuration": self.before["configuration"],
            })["error"]["code"], "unknown_command")

    def test_complete_handoff_example_produces_both_occurrences_from_python_snapshot(self):
        example = json.loads((Path(__file__).parent / "fixtures" /
                              "aim_frontend_update_example.json").read_text("utf-8"))
        self.base.snapshot = example["snapshot"]
        response = self.update(example["configuration"])
        self.assertTrue(response["ok"])
        rows = fixtures.PresentationImportTests.rows(response["presentation"]["model"])
        self.assertEqual([(r["id"], r["number"], r["value"]) for r in rows],
                         [("row-a", "7", "0"), ("row-b", "7", "0")])
        for selection in ("required", "error", "cancelled"):
            self.base.snapshot = AimPresentationApp._empty(selection, [])
            result = self.update(example["configuration"])
            self.assertTrue(all(r["value"] is None and r["valueState"] == "unavailable"
                                for r in fixtures.PresentationImportTests.rows(result["presentation"]["model"])))


if __name__ == "__main__":
    unittest.main()
