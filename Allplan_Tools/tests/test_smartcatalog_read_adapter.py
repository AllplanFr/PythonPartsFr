from dataclasses import replace
import hashlib
import logging
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from application.core.allplan.models import Availability
from application.core.allplan.readers.smartcatalog import read_smartcatalog
from application.plugins.smartcatalog.read_adapter import adapt_smartcatalog


class SmartCatalogReadAdapterTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "catalogue.xml"

    def adapt(self, body):
        self.path.write_text(
            f'<AllplanCatalog Region="XX" version="1.0">{body}</AllplanCatalog>',
            encoding="utf-8",
        )
        self.source = read_smartcatalog(self.path)
        return adapt_smartcatalog(self.source)

    def test_order_parents_roots_and_empty_folders(self):
        result = self.adapt(
            '<Node name="root"><Node name="same"/><Node name="same">'
            '<Group name="g"><GroupDef/></Group></Node></Node><Node name="last"/>'
        )
        self.assertEqual(result.state, Availability.AVAILABLE)
        assert result.document is not None
        doc = result.document
        self.assertEqual(doc["rootIds"], ["xml:1", "xml:2"])
        self.assertEqual(doc["nodes"]["xml:1"]["children"], ["xml:1.1", "xml:1.2"])
        self.assertEqual(doc["nodes"]["xml:1.1"]["children"], [])
        self.assertEqual(doc["nodes"]["xml:1.2.1"]["type"], "group")
        self.assertEqual(doc["nodes"]["xml:1.2.1"]["parentId"], "xml:1.2")
        self.assertIsNone(doc["nodes"]["xml:2"]["parentId"])
        self.assertEqual(doc["nodes"]["xml:1.2.1"]["children"], [])
        self.assertEqual(len(doc["nodes"]), 5)

    def test_values_description_attribute_order_and_no_fallback(self):
        result = self.adapt(
            '<Group name=" g "><GroupDef>'
            '<Attribute id="508" value="not a description"/>'
            '<Attribute id="0203" value=" 28.000 m³ &amp; "/>'
            '<Attribute id="207" value=" texte "/>'
            '<Attribute id="83" value="different code"/>'
            '</GroupDef></Group>'
        )
        assert result.document is not None
        node = result.document["nodes"]["xml:1"]
        self.assertEqual(node["name"], " g ")
        self.assertEqual(node["description"], " texte ")
        self.assertEqual(node["attrs"], {
            "508": "not a description", "203": " 28.000 m³ & ",
            "207": " texte ", "83": "different code",
        })
        self.assertEqual(node["attrOrder"], [508, 203, 207, 83])
        self.assertEqual(set(result.document), {"nodes", "rootIds"})

    def test_absent_description_is_ui_only_and_not_derived_from_material(self):
        result = self.adapt(
            '<Group name="g"><GroupDef><Attribute id="508" value="material"/>'
            '</GroupDef></Group>'
        )
        assert result.document is not None
        node = result.document["nodes"]["xml:1"]
        self.assertEqual(node["description"], "")
        self.assertNotIn("207", node["attrs"])

    def test_explicit_empty_values_stay_representable(self):
        result = self.adapt(
            '<Group name="g"><GroupDef><Attribute id="207" value=""/>'
            '<Attribute id="203" value=""/></GroupDef></Group>'
        )
        assert result.document is not None
        self.assertEqual(result.document["nodes"]["xml:1"]["attrs"], {"207": "", "203": ""})

    def test_structural_ids_do_not_depend_on_names_or_file_path(self):
        first = self.adapt('<Node name="a"><Node name="a"/></Node>')
        second = self.adapt('<Node name="b"><Node name="b"/></Node>')
        other = self.path.with_name("copy.xml")
        other.write_bytes(self.path.read_bytes())
        third = adapt_smartcatalog(read_smartcatalog(other))
        assert first.document is not None and second.document is not None
        self.assertEqual(list(first.document["nodes"]), list(second.document["nodes"]))
        self.assertEqual(second.document, third.document)

    def test_refuse_duplicate_occurrences_and_keep_original_diagnostics(self):
        result = self.adapt(
            '<Group name="g"><GroupDef><Attribute id="203" value="a"/>'
            '<Attribute id="203" value="b"/></GroupDef></Group>'
        )
        self.assertIsNone(result.document)
        self.assertIs(result.source, self.source)
        self.assertEqual(result.diagnostics[:-1], self.source.diagnostics)
        assert result.source.data is not None
        self.assertEqual(len(result.source.data.root.children[0].children[0].children), 2)

    def test_refuse_numeric_key_collisions(self):
        result = self.adapt(
            '<Group name="g"><GroupDef><Attribute id="0203" value="a"/>'
            '<Attribute id="203" value="b"/></GroupDef></Group>'
        )
        self.assertIsNone(result.document)
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(result.diagnostics[-1].code, "catalog_adaptation_attribute_collision")
        self.assertIsNotNone(result.diagnostics[-1].related)

    def test_refuse_missing_value_without_coercion(self):
        result = self.adapt(
            '<Group name="g"><GroupDef><Attribute id="207"/></GroupDef></Group>'
        )
        self.assertIsNone(result.document)
        assert result.source.data is not None
        attribute = result.source.data.root.children[0].children[0].children[0]
        self.assertIsNone(attribute.attribute("value"))
        self.assertIn("catalog_property_missing", [d.code for d in result.diagnostics])

    def test_refuse_unsupported_content_without_empty_success(self):
        for body in (
            '<Component name="x"/>',
            '<Node name="n" extra="data"/>',
            '<Group name="g"><GroupDef/><GroupDef/></Group>',
            '<Group name="g"><GroupDef><Unknown/></GroupDef></Group>',
            '<Node name="n">business text</Node>',
            '<Node name="n"><Group name="g"><GroupDef/></Group><Node name="x"/></Node>',
        ):
            with self.subTest(body=body):
                result = self.adapt(body)
                self.assertIsNone(result.document)
                self.assertIsNotNone(result.source.data)
                self.assertEqual(result.state, Availability.UNAVAILABLE)

    def test_refuse_root_mixed_types_and_blank_names(self):
        for body, code in (
            ('<Node name="n"/><Group name="g"><GroupDef/></Group>',
             "catalog_adaptation_mixed_children"),
            ('<Node name="   "/>', "catalog_adaptation_name"),
        ):
            with self.subTest(body=body):
                result = self.adapt(body)
                self.assertIsNone(result.document)
                self.assertEqual(result.diagnostics[-1].code, code)

    def test_refuse_group_names_that_collide_in_editor(self):
        result = self.adapt(
            '<Group name="G"><GroupDef/></Group><Group name=" g "><GroupDef/></Group>'
        )
        self.assertIsNone(result.document)
        self.assertEqual(result.diagnostics[-1].code, "catalog_adaptation_group_name")

    def test_frontend_number_limits(self):
        for number in ("0", "100000", "9" * 5000):
            with self.subTest(length=len(number)):
                result = self.adapt(
                    f'<Group name="g"><GroupDef><Attribute id="{number}" value="x"/>'
                    '</GroupDef></Group>'
                )
                self.assertIsNone(result.document)
                self.assertEqual(result.diagnostics[-1].code,
                                 "catalog_adaptation_attribute_number")

    def test_frontend_depth_limit(self):
        accepted = self.adapt('<Node name="n">' * 101 + '</Node>' * 101)
        self.assertIsNotNone(accepted.document)
        refused = self.adapt('<Node name="n">' * 102 + '</Node>' * 102)
        self.assertIsNone(refused.document)
        self.assertEqual(refused.diagnostics[-1].code, "catalog_adaptation_depth")

    def test_source_error_and_actual_empty_catalog(self):
        source = read_smartcatalog(self.path)
        failed = adapt_smartcatalog(source)
        self.assertIs(failed.source, source)
        self.assertIsNone(failed.document)
        empty = self.adapt("")
        self.assertEqual(empty.document, {"nodes": {}, "rootIds": []})

    def test_no_mutation_and_no_values_logged(self):
        result = self.adapt('<Node name="PRIVATE_NAME"/>')
        before = hashlib.sha256(self.path.read_bytes()).digest()
        repeated = adapt_smartcatalog(self.source)
        self.assertEqual(repeated, result)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)
        with self.assertLogs("application.core.allplan.models", level=logging.ERROR) as logs:
            failed = adapt_smartcatalog(replace(self.source, state=Availability.UNAVAILABLE))
        self.assertIsNone(failed.document)
        self.assertNotIn("PRIVATE_NAME", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
