import copy
import hashlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from application.core.context import LaunchContext
from application.launcher import aim_local_review as host
from application.plugins.information_manager import organized
from tests import test_aim_legacy_presentation as legacy_tests
from tests import test_aim_project_reading as project_tests


class OrganizedReviewTests(unittest.TestCase):
    def setUp(self):
        self.legacy = legacy_tests.LegacyPresentationTests()
        self.legacy.setUp()
        self.addCleanup(self.legacy.doCleanups)
        self.native = project_tests.ProjectReadingTests()
        self.native.setUp()
        self.addCleanup(self.native.doCleanups)
        self.context = LaunchContext(
            allplan_version="2026", project_path=self.native.project,
            paths=self.native.context.paths,
        )
        self.legacy.line("INFOS_LINEEDIT", 1, number="7", defaut="not applied",
                         formatage="Date", option="n\u00b0 yy/MM/dd")
        self.legacy.line("INFOS_LINEEDIT", 2, number="7", defaut="0", formatage="Texte")
        self.legacy.line("INFOS_CHECKBOX", 3, number="8", defaut=None)
        self.configuration, self.report = self.legacy.build()

    def assemble(self):
        return organized.assemble(self.configuration, self.report, self.context, language="en")

    @staticmethod
    def rows(model):
        return [r for c in model["categories"] for g in c["groups"] for r in g["rows"]]

    def test_exact_values_repeated_rows_date_and_no_source_mutation(self):
        self.native.content("Version 3\r\n7|Name|0\r\n8|Checkbox|\r\n")
        before = {p: p.read_bytes() for p in self.native.root.rglob("*") if p.is_file()}
        configuration = copy.deepcopy(self.configuration)
        model = self.assemble()
        rows = self.rows(model)
        self.assertEqual(model["counts"], dict(
            configurationLines=3, matchedDefinitions=2, missingDefinitions=1,
            set=3, unset=0, unavailable=0,
        ))
        self.assertEqual([(r["number"], r["value"]) for r in rows],
                         [("7", "0"), ("7", "0"), ("8", "")])
        self.assertNotEqual(rows[0]["id"], rows[1]["id"])
        self.assertEqual(rows[0]["dateFormat"]["pattern"], "n\u00b0 yy/MM/dd")
        self.assertEqual(rows[2]["resetDefault"], {"state": "absent"})
        self.assertEqual(rows[2]["diagnostics"], ["definition_missing"])
        self.assertEqual(self.configuration, configuration)
        self.assertEqual(before, {p: p.read_bytes() for p in self.native.root.rglob("*") if p.is_file()})
        self.assertFalse((self.native.data / "aim-settings.json").exists())

    def test_missing_values_never_apply_defaults(self):
        model = self.assemble()
        self.assertEqual(model["counts"]["unset"], 3)
        self.assertTrue(all(r["value"] is None for r in self.rows(model)))
        self.assertEqual(model["sources"]["valuesStatus"], "missing")

    def test_unreadable_values_are_not_an_empty_project(self):
        self.native.content("Version 9\r\n7|Name|should not leak\r\n")
        model = self.assemble()
        self.assertEqual(model["counts"]["unavailable"], 3)
        self.assertEqual(model["sources"]["valuesStatus"], "error")
        self.assertTrue(all("invalid_header" in r["diagnostics"] for r in self.rows(model)))
        self.assertNotIn("should not leak", json.dumps(model))

    def test_text_pipes_whitespace_and_empty_are_preserved(self):
        for value in ("  a|b  ", "", "0"):
            with self.subTest(value=value):
                self.native.content(f"Version 3\r\n7|Name|{value}\r\n")
                self.assertEqual(self.rows(self.assemble())[0]["value"], value)

    def test_xml_diagnostics_link_all_affected_occurrences(self):
        # A nonnumeric group is rejected by the existing XML reader.
        self.native.xml(self.native.etc, "AttributeDefinitionCollectionAllplan_en.xml",
                        self.native.definition("7", "Invalid", group="bad"))
        model = self.assemble()
        issue = next(d for d in model["diagnostics"] if d["code"] == "invalid_definition")
        self.assertEqual(issue["lineIds"], [r["id"] for r in self.rows(model)[:2]])
        self.assertEqual(model["counts"]["missingDefinitions"], 3)
        missing = [d for d in model["diagnostics"]
                   if d["code"] == "definition_missing" and d["attributeNumber"] == "7"]
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0]["lineIds"], issue["lineIds"])

    def test_invalid_attr_stops_before_value_read(self):
        (self.native.project / "project.cfg").write_bytes(b"ATTR=???\r\n")
        with patch("application.plugins.information_manager.organized.read_project_attributes") as read:
            with self.assertRaises(ValueError):
                self.assemble()
        read.assert_not_called()

    def test_wrong_installation_rejected(self):
        self.context = LaunchContext(allplan_version="2025", project_path=self.native.project,
                                     paths=self.native.context.paths)
        with self.assertRaises(ValueError):
            self.assemble()

    def test_validation_counts_identity_order_and_states(self):
        good = self.assemble()
        for mutate in (
            lambda m: m.update(organized_presentation_contract=2),
            lambda m: m["counts"].update(set=99),
            lambda m: self.rows(m)[0].update(value="invented"),
            lambda m: self.rows(m)[0].update(position=99),
            lambda m: self.rows(m)[1].update(id=self.rows(m)[0]["id"]),
        ):
            model = copy.deepcopy(good)
            mutate(model)
            with self.assertRaises(ValueError):
                organized.validate_model(model)

    def test_contract_snapshot_without_real_project_data(self):
        model = self.assemble()
        snapshot = {
            "identity": {k: model[k] for k in ("app", "organized_presentation_contract",
                                              "read_only", "capabilities", "validationOnly")},
            "counts": model["counts"],
            "rows": [{k: r[k] for k in ("id", "number", "widget", "valueState", "value")}
                     for r in self.rows(model)],
        }
        expected = json.loads((Path(__file__).parent / "fixtures" /
                               "aim-organized-snapshot.json").read_text("utf-8"))
        self.assertEqual(snapshot, expected)

    def test_archive_hashes_are_checked(self):
        directory = self.legacy.root / "archive"
        directory.mkdir()
        outputs = {}
        for name, value in (("presentation.json", self.configuration),
                            ("conversion-report.json", self.report)):
            data = json.dumps(value).encode()
            (directory / name).write_bytes(data)
            outputs[name] = hashlib.sha256(data).hexdigest()
        (directory / "tested-source-manifest.json").write_text(json.dumps({"outputs": outputs}))
        self.assertEqual(host.load_inputs(directory), (self.configuration, self.report))
        (directory / "presentation.json").write_text("{}")
        with self.assertRaises(ValueError):
            host.load_inputs(directory)

    @staticmethod
    def request(target="/review-model.json", headers=None, method="GET"):
        handler_type = host.handler_for(
            {"/review-model.json": ("application/json", b'{"synthetic":true}')}, 8765,
        )
        handler = handler_type.__new__(handler_type)
        handler.rfile = io.BytesIO((
            f"{method} {target} HTTP/1.1\r\nHost: 127.0.0.1:8765\r\n"
            + (headers or "") + "\r\n"
        ).encode())
        handler.wfile = io.BytesIO()
        handler.client_address = ("127.0.0.1", 1)
        handler.server = None
        handler.handle_one_request()
        return handler.wfile.getvalue()

    def test_http_confinement_without_binding_or_starting_server(self):
        with patch("application.launcher.aim_local_review.HTTPServer") as server:
            response = self.request()
            self.assertIn(b"200 OK", response)
            for header in (b"Cache-Control: no-store", b"frame-ancestors 'none'",
                           b"X-Content-Type-Options: nosniff"):
                self.assertIn(header, response)
            for target in ("/", "/../project.cfg", "/%2e%2e/project.cfg",
                           "/review-model.json?", "/review-model.json?x=1",
                           "http://127.0.0.1:8765/review-model.json"):
                self.assertIn(b"404", self.request(target))
            for header in ("Origin: https://example.com\r\n",
                           "Sec-Fetch-Site: cross-site\r\n", "Host: evil.test\r\n"):
                self.assertIn(b"403", self.request(headers=header))
            for method in ("POST", "PUT", "DELETE", "OPTIONS"):
                self.assertIn(b"501", self.request(method=method))
            server.assert_not_called()

    def test_prepare_only_exposes_approved_resources_and_keeps_model_in_memory(self):
        root = self.legacy.root
        icons, build = root / "icons", root / "build"
        icons.mkdir()
        (build / "assets").mkdir(parents=True)
        (build / "aim-local-review.html").write_text("<html>synthetic</html>")
        (build / "assets" / "app.js").write_text("/* synthetic */")
        (build / "not-served.txt").write_text("not exposed")
        for category in self.configuration["categories"]:
            (icons / category["icon"].removeprefix("[icones_aim]")).write_bytes(b"synthetic")
        with patch("application.launcher.aim_local_review.discover_project_installations",
                   return_value=([self.context], [])), patch(
                       "application.launcher.aim_local_review.load_inputs",
                       return_value=(self.configuration, self.report),
                   ):
            model, resources = host.prepare(self.native.project, root, icons, build)
        self.assertEqual(set(resources), {
            "/information-manager", "/assets/app.js", "/icons/category-1.png",
            "/icons/category-2.png", "/review-model.json",
        })
        self.assertEqual(json.loads(resources["/review-model.json"][1]), model)
        self.assertEqual(resources["/assets/app.js"][0], "text/javascript")
        self.assertFalse((build / "review-model.json").exists())

    def test_server_lifetime_clears_resources_without_real_socket(self):
        resources = {"/review-model.json": ("application/json", b"synthetic")}
        with patch("application.launcher.aim_local_review.HTTPServer") as constructor:
            with self.assertRaisesRegex(RuntimeError, "synthetic stop"):
                with host.local_server(resources, 8765):
                    raise RuntimeError("synthetic stop")
            self.assertEqual(constructor.call_args.args[0], ("127.0.0.1", 8765))
            constructor.return_value.__exit__.assert_called_once()
            constructor.return_value.__enter__.return_value.serve_forever.assert_not_called()
        self.assertEqual(resources, {})


if __name__ == "__main__":
    unittest.main()
