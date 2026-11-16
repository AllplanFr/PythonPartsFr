from contextlib import closing
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

from application.plugins.information_manager.presentation import EditablePresentationImport
from application.plugins.information_manager.presentation_import import validation_report
from application.plugins.information_manager.presentation_structure import (
    groups, rows, upgrade_configuration,
)
from tests import test_aim_presentation_import as fixtures


class PresentationTreeTests(unittest.TestCase):
    def setUp(self):
        self.base = fixtures.PresentationImportTests()
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        old = self.base.service
        prepared = old.call("presentation.import.prepare", {})
        self.legacy = prepared["candidate"]["configuration"]
        self.service = EditablePresentationImport(
            old._snapshot, self.base.select, self.base.save, mixed=True,
        )
        self.configuration = upgrade_configuration(self.legacy)
        category = self.configuration["categories"][0]
        group = category["children"][0]
        direct = group["rows"].pop(0)
        category["children"].insert(0, direct)
        self.positions(self.configuration)

    @staticmethod
    def positions(configuration):
        for i, category in enumerate(configuration["categories"], 1):
            category["position"] = i
            for j, child in enumerate(category["children"], 1):
                child["position"] = j
                if child["kind"] == "group":
                    for k, row in enumerate(child["rows"], 1):
                        row["position"] = k

    def update(self, configuration=None):
        return self.service.call("presentation.update", {
            "configuration": self.configuration if configuration is None else configuration,
        })

    def current(self):
        return self.service.call("presentation.get", {})["presentation"]

    def test_lossless_upgrade_preserves_legacy_fields_ids_order_and_parameters(self):
        before = deepcopy(self.legacy)
        result = upgrade_configuration(before)
        self.assertEqual(self.legacy, before)
        self.assertEqual([r["id"] for r in rows(result)], [r["id"] for r in rows(before)])
        self.assertEqual([g["id"] for g in groups(result)], [g["id"] for g in groups(before)])
        for old, new in zip(rows(before), rows(result)):
            self.assertEqual(old, {k: v for k, v in new.items() if k != "kind"})
        self.assertEqual(upgrade_configuration(result), result)
        validation_report(result)

    def test_mixed_import_model_snapshot_update_export_reimport_is_exact(self):
        source = self.base.fixture.root / "mixed.json"
        source.write_text(json.dumps(self.configuration), encoding="utf-8")
        self.base.select.return_value = source
        snapshot_before = deepcopy(self.base.snapshot)
        prepared = self.service.call("presentation.import.prepare", {})
        self.assertEqual(prepared["status"], "prepared")
        self.assertEqual(prepared["candidate"]["model"]["version"], 2)
        self.assertEqual(self.service.call("presentation.get", {})["status"], "empty")
        self.service.call("presentation.import.apply", {"token": prepared["token"]})
        category = self.configuration["categories"][0]
        direct = deepcopy(category["children"][0])
        direct["id"] = "direct-after-group"
        category["children"].append(direct)
        self.positions(self.configuration)
        result = self.update()
        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["presentation"]["configuration"], self.configuration)
        self.assertEqual([item["kind"] for item in result["presentation"]["model"]["categories"][0]["children"]],
                         ["row", "group", "row"])
        self.assertEqual([r["value"] for r in rows(result["presentation"]["model"])], ["0", "0", None, "0"])
        self.assertEqual(self.base.snapshot, snapshot_before)
        self.assertTrue(self.service.call("presentation.export", {
            "configuration": self.configuration,
        })["ok"])
        exported = json.loads(self.base.destination.read_text("utf-8"))
        self.assertEqual(exported, self.configuration)
        self.base.select.return_value = self.base.destination
        prepared = self.service.call("presentation.import.prepare", {})
        restored = self.service.call("presentation.import.apply", {"token": prepared["token"]})
        self.assertEqual(restored["presentation"]["configuration"], self.configuration)
        self.assertEqual(self.current()["configuration"], self.configuration)

    def test_moves_preserve_occurrence_identity_properties_and_common_order(self):
        self.update()
        originals = {r["id"]: deepcopy(r) for r in rows(self.configuration)}
        first, second = self.configuration["categories"]
        row = first["children"].pop(0)
        second["children"].insert(0, row)
        group = first["children"].pop()
        second["children"].insert(0, group)
        self.configuration["categories"].reverse()
        self.positions(self.configuration)
        reply = self.update()
        self.assertTrue(reply["ok"])
        self.assertEqual([c["id"] for c in self.current()["configuration"]["categories"]],
                         [second["id"], first["id"]])
        for current in rows(self.current()["configuration"]):
            before = originals[current["id"]]
            self.assertEqual({k:v for k,v in current.items() if k != "position"},
                             {k:v for k,v in before.items() if k != "position"})
        group["rows"].append(second["children"].pop(1))
        self.positions(self.configuration)
        self.assertTrue(self.update()["ok"])
        moved = group["rows"].pop()
        second["children"].insert(1, moved)
        self.positions(self.configuration)
        self.assertTrue(self.update()["ok"])
        self.assertEqual([r["id"] for r in rows(self.configuration)].count(moved["id"]), 1)

    def test_group_delete_keeps_sibling_rows_and_other_occurrences_then_category_delete(self):
        first = self.configuration["categories"][0]
        sibling = deepcopy(first["children"][0])
        sibling["id"] = "other-occurrence"
        first["children"].append(sibling)
        self.positions(self.configuration)
        self.update()
        first["children"] = [c for c in first["children"] if c["kind"] != "group"]
        self.positions(self.configuration)
        reply = self.update()
        self.assertEqual([r["id"] for r in rows(reply["presentation"]["model"])][:2],
                         [first["children"][0]["id"], "other-occurrence"])
        self.configuration["categories"].pop(0)
        self.positions(self.configuration)
        self.assertTrue(self.update()["ok"])
        self.assertEqual(self.base.snapshot["_presentationValues"]["7"], "0")
        self.assertEqual(len(rows(self.configuration)), 0)

    def test_invalid_virtual_nested_duplicate_parent_or_business_values_keep_current(self):
        self.update()
        before = self.current()
        bads = []
        virtual = deepcopy(self.configuration)
        virtual["categories"][0]["id"] = "all"
        bads.append(virtual)
        nested = deepcopy(self.configuration)
        group = nested["categories"][0]["children"][1]
        group["rows"].append(deepcopy(group))
        bads.append(nested)
        duplicate = deepcopy(self.configuration)
        duplicate["categories"][1]["children"].insert(0, deepcopy(duplicate["categories"][0]["children"][0]))
        self.positions(duplicate)
        bads.append(duplicate)
        values = deepcopy(self.configuration)
        values["categories"][0]["children"][0]["value"] = "browser data"
        bads.append(values)
        for invalid in bads:
            with self.subTest(invalid=invalid):
                self.assertFalse(self.update(invalid)["ok"])
                self.assertEqual(self.current(), before)
        with patch("application.plugins.information_manager.presentation.display_model",
                   side_effect=RuntimeError("test model failure")):
            self.assertEqual(self.update()["error"]["code"], "model_unavailable")
        self.assertEqual(self.current(), before)

    def test_legacy_profile_refuses_v2_without_changing_confirmed_presentation(self):
        legacy = self.base.service
        legacy._current = deepcopy(self.update()["presentation"])
        legacy._current["configuration"] = self.legacy
        before = legacy.call("presentation.get", {})
        source = self.base.fixture.root / "mixed.json"
        source.write_text(json.dumps(self.configuration), encoding="utf-8")
        self.base.select.return_value = source
        self.assertEqual(legacy.call("presentation.import.prepare", {})["error"]["code"],
                         "unsupported_presentation_version")
        self.assertEqual(legacy.call("presentation.export", {
            "configuration": self.configuration,
        })["error"]["code"], "unsupported_presentation_version")
        self.assertEqual(legacy.call("presentation.get", {}), before)

    def test_db_import_preserves_interleaved_direct_attachments_and_legacy_group_ids(self):
        fixture = self.base.fixture
        with closing(sqlite3.connect(fixture.source, isolation_level=None)) as db:
            name = db.execute("SELECT nom_objet FROM INFOS_CHECKBOX LIMIT 1").fetchone()[0]
            db.execute("INSERT INTO INFOS_ITEMS_ONGLETS(rowid,nom_onglet,nom_item,type_item) VALUES(0,'Projet',?,'INFOS_CHECKBOX')", (name,))
            db.execute("INSERT INTO INFOS_ITEMS_ONGLETS(rowid,nom_onglet,nom_item,type_item) VALUES(3,'Projet',?,'INFOS_CHECKBOX')", (name,))
        source_bytes = fixture.source.read_bytes()
        prepared = self.service.call("presentation.import.prepare", {})
        self.assertEqual(prepared["status"], "prepared")
        configuration = prepared["candidate"]["configuration"]
        self.assertEqual([c["kind"] for c in configuration["categories"][0]["children"]],
                         ["row", "group", "row"])
        self.assertEqual(groups(configuration)[0]["id"], groups(self.legacy)[0]["id"])
        self.assertEqual([r["id"] for r in groups(configuration)[0]["rows"]],
                         [r["id"] for r in groups(self.legacy)[0]["rows"]])
        self.assertEqual(configuration["categories"][0]["children"][0]["id"], "category-1-line-0")
        self.assertEqual(fixture.source.read_bytes(), source_bytes)

    def test_complete_handoff_updated_example_matches_backend_and_keeps_mixed_order(self):
        examples = json.loads((Path(__file__).parent / "fixtures" /
                               "aim_project_manager_examples.json").read_text("utf-8"))
        self.base.snapshot = {
            **examples["snapshot"],
            "_presentationValues": {
                item["number"]: item["value"]
                for item in examples["snapshot"]["data"]["attributes"]
                if item["valueState"] == "set"
            },
        }
        request = next(call for call in examples["calls"] if call["command"] == "presentation.update")
        actual = self.service.call(request["command"], request["payload"])
        self.assertEqual(actual, request["response"])
        configuration = examples["configurationV2"]
        self.assertEqual([child["kind"] for child in configuration["categories"][0]["children"]],
                         ["row", "group", "row", "group"])
        self.assertEqual([row["id"] for row in rows(actual["presentation"]["model"])],
                         ["row-a", "row-b", "row-c", "row-d", "row-e"])


if __name__ == "__main__":
    unittest.main()
