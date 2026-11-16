import hashlib
import logging
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability
from application.core.allplan.readers.smartcatalog import read_smartcatalog


class SmartCatalogReaderTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "catalogue.xml"

    def read(self, body, metadata='Region="GB" version="1.0"'):
        self.path.write_bytes(
            f'<AllplanCatalog {metadata}>{body}</AllplanCatalog>'.encode("utf-8")
        )
        return read_smartcatalog(self.path)

    def test_hierarchy_order_empty_elements_and_provenance(self):
        result = self.read(
            '<Node name="first"><Node name="nested"/>'
            '<Node name="empty"/></Node><Group name="last"><GroupDef/></Group>'
        )
        self.assertEqual(result.state, Availability.AVAILABLE)
        assert result.data is not None
        root = result.data.root
        self.assertEqual(root.attribute("Region"), "GB")
        self.assertEqual([n.tag for n in root.children], ["Node", "Group"])
        self.assertEqual([n.attribute("name") for n in root.children[0].children],
                         ["nested", "empty"])
        empty = root.children[0].children[1]
        self.assertEqual(empty.children, ())
        self.assertEqual(empty.element_path, (1, 2))
        self.assertEqual(empty.provenance.path, self.path)
        self.assertEqual(empty.provenance.position, 4)
        self.assertEqual(root.children[1].children[0].tag, "GroupDef")

    def test_unicode_entities_whitespace_and_raw_numbers(self):
        result = self.read(
            '<Group name=" été &amp; &quot;雪&quot; "><GroupDef>'
            '<Attribute id="0203" value=" 28.000 m³ &lt;x&gt; &#xA; "/>'
            '</GroupDef></Group>'
        )
        assert result.data is not None
        group = result.data.root.children[0]
        value = group.children[0].children[0]
        self.assertEqual(group.attribute("name"), ' été & "雪" ')
        self.assertEqual(value.attribute("id"), "0203")
        self.assertEqual(value.attribute("value"), " 28.000 m³ <x> \n ")

    def test_missing_versus_empty_attributes(self):
        result = self.read(
            '<Group name=""><GroupDef><Attribute id="83"/>'
            '<Attribute id="207" value=""/><Attribute value=""/></GroupDef></Group>'
        )
        assert result.data is not None
        attrs = result.data.root.children[0].children[0].children
        self.assertIsNone(attrs[0].attribute("value"))
        self.assertEqual(attrs[1].attribute("value"), "")
        self.assertIsNone(attrs[2].attribute("id"))
        self.assertEqual(attrs[2].attribute("value"), "")
        self.assertEqual(sum(d.code == "catalog_property_missing"
                             for d in result.diagnostics), 2)

    def test_duplicates_preserve_all_occurrences_and_related_origin(self):
        result = self.read(
            '<Group name="g"><GroupDef><Attribute id="83" value="a"/>'
            '<Attribute id="83" value="b"/><Attribute id="83" value=""/>'
            '</GroupDef></Group>'
        )
        assert result.data is not None
        attrs = result.data.root.children[0].children[0].children
        self.assertEqual([a.attribute("value") for a in attrs], ["a", "b", ""])
        duplicates = [d for d in result.diagnostics
                      if d.code == "catalog_attribute_duplicate"]
        self.assertEqual(len(duplicates), 2)
        self.assertEqual(duplicates[0].provenance, attrs[1].provenance)
        self.assertEqual(duplicates[1].related, attrs[0].provenance)
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)

    def test_multiple_groupdefs_and_nondecimal_numbers_are_not_rewritten(self):
        result = self.read(
            '<Group name="g"><GroupDef><Attribute id=" 83 " value="x"/>'
            '<Attribute id="" value="y"/></GroupDef><GroupDef/>'
            '</Group>'
        )
        assert result.data is not None
        definitions = result.data.root.children[0].children
        self.assertEqual(len(definitions), 2)
        self.assertEqual([a.attribute("id") for a in definitions[0].children], [" 83 ", ""])
        self.assertEqual(sum(d.code == "catalog_attribute_number_invalid"
                             for d in result.diagnostics), 2)
        self.assertIn("catalog_group_definition_count", [d.code for d in result.diagnostics])

    def test_deep_hierarchy_does_not_depend_on_python_recursion_limit(self):
        depth = 1100
        result = self.read('<Node name="n">' * depth + '</Node>' * depth)
        self.assertEqual(result.state, Availability.AVAILABLE)
        assert result.data is not None
        node = result.data.root
        count = 0
        while node.children:
            node = node.children[0]
            count += 1
        self.assertEqual(count, depth)
        self.assertEqual(len(node.element_path), depth)

    def test_unknown_elements_properties_and_unsupported_structure_retained(self):
        result = self.read(
            '<Node name="x" extra=" raw "><Unknown value="secret"><Attribute/>'
            '</Unknown><Group name="g"/><Node name="n"/></Node>'
        )
        assert result.data is not None
        node = result.data.root.children[0]
        self.assertEqual(node.attribute("extra"), " raw ")
        self.assertEqual(node.children[0].tag, "Unknown")
        self.assertEqual(node.children[0].children[0].tag, "Attribute")
        codes = {d.code for d in result.diagnostics}
        self.assertTrue({"catalog_element_unknown", "catalog_structure_unsupported",
                         "catalog_property_unknown", "catalog_mixed_children",
                         "catalog_group_definition_count"} <= codes)

    def test_namespaces_metadata_and_text_preserved(self):
        result = self.read(
            '<Node name="n" xmlns:q="urn:test"> before <q:item/> after </Node>',
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            'xsi:noNamespaceSchemaLocation="../Xsd/AllplanCatalog.xsd" version="2"',
        )
        assert result.data is not None
        root = result.data.root
        self.assertEqual(root.namespaces,
                         (("xsi", "http://www.w3.org/2001/XMLSchema-instance"),))
        self.assertEqual(root.attribute(
            "{http://www.w3.org/2001/XMLSchema-instance}noNamespaceSchemaLocation"),
            "../Xsd/AllplanCatalog.xsd")
        node = root.children[0]
        self.assertEqual(node.namespaces, (("q", "urn:test"),))
        self.assertEqual(node.children[0].tag, "{urn:test}item")
        self.assertEqual(node.text, " before ")
        self.assertEqual(node.children[0].tail, " after ")
        self.assertIn("catalog_version_unsupported", [d.code for d in result.diagnostics])
        self.assertIn("catalog_text_unsupported", [d.code for d in result.diagnostics])

    def test_invalid_xml(self):
        for content in (b"", b"<AllplanCatalog>", b"<AllplanCatalog>\xff</AllplanCatalog>",
                        b'<?xml version="1.0" encoding="unknown"?><AllplanCatalog/>',
                        b'<AllplanCatalog version="1" version="2"/>'):
            with self.subTest(content=content):
                self.path.write_bytes(content)
                result = read_smartcatalog(self.path)
                self.assertIsNone(result.data)
                self.assertEqual(result.state, Availability.UNAVAILABLE)
                self.assertEqual(result.diagnostics[0].code, "catalog_xml_invalid")

    def test_incompatible_roots_do_not_succeed_with_empty_document(self):
        for content in ('<SmartCatalog/>', '<Other><Node/></Other>',
                        '<AllplanCatalog xmlns="urn:other"/>'):
            with self.subTest(content=content):
                self.path.write_text(content, encoding="utf-8")
                result = read_smartcatalog(self.path)
                self.assertIsNone(result.data)
                self.assertEqual(result.diagnostics[0].code, "catalog_format_incompatible")
                self.assertEqual(result.state, Availability.UNAVAILABLE)

    def test_empty_recognized_catalog_is_preserved(self):
        result = self.read("")
        assert result.data is not None
        self.assertEqual(result.data.root.children, ())
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_dtd_entities_and_external_resources_forbidden(self):
        for declaration, body in (
            ('<!DOCTYPE AllplanCatalog>', ""),
            ('<!DOCTYPE AllplanCatalog [<!ENTITY x "secret">]>', "&x;"),
            ('<!DOCTYPE AllplanCatalog SYSTEM "file:///unread">', ""),
        ):
            with self.subTest(declaration=declaration):
                self.path.write_text(
                    f"{declaration}<AllplanCatalog>{body}</AllplanCatalog>", encoding="utf-8"
                )
                result = read_smartcatalog(self.path)
                self.assertIsNone(result.data)
                self.assertEqual(result.diagnostics[0].code, "catalog_xml_invalid")

    def test_missing_and_inaccessible_file(self):
        self.assertEqual(read_smartcatalog(self.path).diagnostics[0].code, "catalog_access")
        self.read("")
        with patch.object(Path, "open", side_effect=PermissionError):
            result = read_smartcatalog(self.path)
        self.assertIsNone(result.data)
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(result.diagnostics[0].code, "catalog_access")

    def test_source_unchanged_and_opened_only_for_reading(self):
        self.read('<Node name="n"/>')
        before = hashlib.sha256(self.path.read_bytes()).digest()
        with patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened:
            result = read_smartcatalog(self.path)
        self.assertIsNotNone(result.data)
        self.assertEqual(opened.call_args.args, (self.path, "rb"))
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)

    def test_diagnostics_do_not_log_source_values(self):
        with self.assertLogs("application.core.allplan.models", level=logging.WARNING) as logs:
            result = self.read('<Unknown value="PRIVATE_VALUE"/>')
        self.assertIsNotNone(result.data)
        self.assertNotIn("PRIVATE_VALUE", "\n".join(logs.output))
        self.assertNotIn("PRIVATE_VALUE", repr(result.diagnostics))


if __name__ == "__main__":
    unittest.main()
