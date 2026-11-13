"""Conformance of the candidate artifacts, not of any running host or frontend."""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import re
import unittest

from jsonschema import Draft202012Validator, FormatChecker


RELEASE = (
    Path(__file__).resolve().parents[1]
    / "docs" / "integration" / "protocol" / "2.0.0-rc.1"
)


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    def reject_constant(value):
        raise ValueError(f"Non-finite JSON constant: {value}")

    def finite_float(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError(f"Non-finite JSON number: {value}")
        return number

    return json.loads(
        text, object_pairs_hook=pairs, parse_constant=reject_constant,
        parse_float=finite_float,
    )


def modified(base, case):
    result = deepcopy(base)
    for path in case.get("remove", []):
        del result[path]
    for path, value in case.get("set", {}).items():
        keys = path.split(".")
        parent = result
        for key in keys[:-1]:
            parent = parent[key]
        parent[keys[-1]] = deepcopy(value)
    return result


def report_matches_snapshot(report, snapshot):
    if (
        report["snapshot_id"] != snapshot["snapshot_id"]
        or report["document_id"] != snapshot["document_id"]
        or report["submitted_document_revision"] != snapshot["document_revision"]
    ):
        return False
    return all(
        item["attribute_number"] in snapshot["values"]
        and item["value"] == snapshot["values"][item["attribute_number"]]
        for item in report["confirmed_values"]
    )


def disjoint_report(report, snapshot):
    groups = [
        [item["attribute_number"] for item in report["confirmed_values"]],
        [item["attribute_number"] for item in report["failed_attributes"]],
        report["unconfirmed_attribute_numbers"],
    ]
    numbers = [number for group in groups for number in group]
    return (
        len(numbers) == len(set(numbers))
        and set(numbers) == set(snapshot["values"])
    )


class ProtocolReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = strict_json((RELEASE / "schema.json").read_text(encoding="utf-8"))
        cls.fixtures = strict_json((RELEASE / "fixtures.json").read_text(encoding="utf-8"))
        cls.valid = {case["name"]: case for case in cls.fixtures["valid"]}

    def validator(self, target):
        schema = deepcopy(self.schema)
        del schema["oneOf"]
        schema["$ref"] = f"#/$defs/{target}"
        return Draft202012Validator(schema, format_checker=FormatChecker())

    def test_schema_and_all_valid_fixtures(self):
        Draft202012Validator.check_schema(self.schema)
        for case in self.fixtures["valid"]:
            with self.subTest(case=case["name"]):
                self.validator(case["target"]).validate(case["value"])
                if case["target"] in ("request", "response", "event"):
                    Draft202012Validator(
                        self.schema, format_checker=FormatChecker()
                    ).validate(case["value"])

    def test_all_invalid_structural_fixtures(self):
        for case in self.fixtures["invalid"]:
            base = self.valid[case["base"]]
            with self.subTest(case=case["name"]):
                self.assertFalse(
                    self.validator(base["target"]).is_valid(modified(base["value"], case))
                )

    def test_strict_json_rejects_duplicate_keys_and_non_finite_constants(self):
        for case in self.fixtures["invalid_json"]:
            with self.subTest(case=case["name"]), self.assertRaises(ValueError):
                strict_json(case["text"])

    def test_relational_rules_not_claimed_as_schema_validation(self):
        snapshot = self.fixtures["scenarios"][0]["snapshot"]
        for case in self.fixtures["semantic_invalid"]:
            base = self.valid[case["base"]]
            value = modified(base["value"], case)
            with self.subTest(case=case["name"]):
                self.validator(base["target"]).validate(value)
                rule = case["rule"]
                if rule == "session_correlation":
                    accepted = value["session_id"] == "session-new"
                elif rule == "handshake_identity":
                    accepted = all(
                        value[key] == value["result"][key]
                        for key in ("session_id", "app_id")
                    )
                elif rule == "unique_capability":
                    commands = [item["command"] for item in value["result"]["capabilities"]]
                    accepted = len(commands) == len(set(commands))
                elif rule == "snapshot_confirmation":
                    accepted = report_matches_snapshot(value, snapshot)
                elif rule == "disjoint_report":
                    accepted = disjoint_report(value, snapshot)
                else:
                    self.fail(f"Unknown semantic rule: {rule}")
                self.assertFalse(accepted)

    def test_partial_baseline_uses_sent_snapshot_not_current_values(self):
        case = self.fixtures["scenarios"][0]
        report = self.valid[case["report_fixture"]]["value"]
        self.assertTrue(report_matches_snapshot(report, case["snapshot"]))
        self.assertTrue(disjoint_report(report, case["snapshot"]))
        baseline = deepcopy(case["baseline_before"])
        for item in report["confirmed_values"]:
            number = item["attribute_number"]
            baseline[number] = deepcopy(case["snapshot"]["values"][number])
        self.assertEqual(baseline, case["baseline_after"])
        dirty = sorted(
            number for number, value in case["current"].items()
            if number not in baseline or baseline[number] != value
        )
        self.assertEqual(dirty, case["dirty_attribute_numbers"])
        self.assertFalse(case["close_allowed"])

    def test_release_hashes(self):
        manifest = strict_json((RELEASE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["release"], self.fixtures["release"])
        for name, expected in manifest["sha256"].items():
            with self.subTest(file=name):
                self.assertEqual(
                    hashlib.sha256((RELEASE / name).read_bytes()).hexdigest(), expected
                )

    def test_documented_json_and_supported_message_examples(self):
        text = (RELEASE.parents[1] / "allplan_host_protocol.md").read_text(encoding="utf-8")
        supported = set(self.schema["$defs"]["command"]["enum"])
        blocks = re.findall(r"```json\s*\n(.*?)\n```", text, re.DOTALL)
        self.assertTrue(blocks)
        for index, block in enumerate(blocks):
            with self.subTest(block=index):
                value = strict_json(block)
                if "kind" in value and "protocol_version" in value:
                    self.assertIn("session_id", value)
                    if value.get("command") in supported or value["kind"] == "event":
                        Draft202012Validator(
                            self.schema, format_checker=FormatChecker()
                        ).validate(value)
                elif "bootstrap_version" in value:
                    self.validator("bootstrap").validate(value)


if __name__ == "__main__":
    unittest.main()
