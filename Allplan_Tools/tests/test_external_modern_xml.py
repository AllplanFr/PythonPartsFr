import hashlib
import logging
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability
from application.core.external_libraries.models import DetectionState
from application.core.external_libraries.modern_xml import (
    ADAPTER_ID, ADAPTER_VERSION, QUALIFIED_TYPES, detect_modern_xml, read_modern_xml,
)


class ExternalModernXmlTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "library.data"

    def read(self, body, properties=""):
        self.path.write_bytes(f"<Export {properties}>{body}</Export>".encode("utf-8"))
        return read_modern_xml(self.path)

    def test_hierarchy_order_empty_folders_and_structural_identity(self):
        result = self.read(
            '<Folder name="01"><Folder name="01.01">'
            '<Component name="second"/><Component name="first"/>'
            '</Folder><Folder name="empty"/></Folder><Folder name="11"/>'
        )
        self.assertEqual(result.state, Availability.AVAILABLE)
        doc = result.data
        assert doc is not None
        self.assertEqual(doc.detection.adapter_id, ADAPTER_ID)
        self.assertEqual(doc.detection.adapter_version, ADAPTER_VERSION)
        self.assertEqual(doc.detection.state, DetectionState.RECOGNIZED)
        self.assertEqual(detect_modern_xml(doc.root), doc.detection)
        self.assertEqual([n.tag for n in doc.occurrences()],
                         ["Export", "Folder", "Folder", "Component", "Component",
                          "Folder", "Folder"])
        folder = doc.root.children[0]
        self.assertEqual([n.property("name") for n in folder.children[0].children],
                         ["second", "first"])
        self.assertEqual(folder.children[1].children, ())
        component = folder.children[0].children[1]
        self.assertEqual(component.element_path, (1, 1, 2))
        self.assertEqual(component.occurrence_id, "xml:1.1.2")
        self.assertEqual(component.provenance.path, self.path)
        self.assertEqual(component.provenance.position, 5)
        self.assertEqual(doc.root.occurrence_id, "xml:root")
        self.assertNotIn("Material", [n.tag for n in doc.occurrences()])

    def test_repeated_codes_names_and_fields_are_not_merged(self):
        result = self.read(
            '<Folder name="same"><Component name="same" unit="a"/>'
            '<Component name="same" unit="b"/></Folder>'
            '<Folder name="same"><Field value="1"/><Field value="2"/></Folder>'
        )
        doc = result.data
        assert doc is not None
        nodes = tuple(doc.occurrences())
        self.assertEqual(len({n.occurrence_id for n in nodes}), len(nodes))
        self.assertEqual([n.property("unit") for n in nodes if n.tag == "Component"],
                         ["a", "b"])
        self.assertEqual([n.property("value") for n in nodes if n.tag == "Field"],
                         ["1", "2"])
        self.assertEqual(len(doc.root.children), 2)

    def test_unicode_spaces_properties_and_lexical_bytes(self):
        result = self.read(
            '<Folder name=" 01 " description=" été &amp; 雪 ">'
            '<Component name=" 001 " description=" a&#xA;b &lt; c " unit=" m² "/>'
            '</Folder>'
        )
        doc = result.data
        assert doc is not None
        folder = doc.root.children[0]
        component = folder.children[0]
        self.assertEqual(folder.property("name"), " 01 ")
        self.assertEqual(folder.property("description"), " été & 雪 ")
        self.assertEqual(component.property("description"), " a\nb < c ")
        self.assertEqual(component.property("unit"), " m² ")
        self.assertEqual([p.name for p in component.properties],
                         ["name", "description", "unit"])
        self.assertEqual(doc.source_bytes, self.path.read_bytes())
        self.assertEqual(doc.sha256, hashlib.sha256(doc.source_bytes).hexdigest())
        self.assertEqual(result.diagnostics, ())

    def test_absent_and_empty_values_are_distinct(self):
        result = self.read(
            '<Folder name=""><Component description="" unit=""/>'
            '<Component name=" " description="kept"/>'
            '<Component name="ok"/></Folder>'
        )
        doc = result.data
        assert doc is not None
        folder = doc.root.children[0]
        first, second, third = folder.children
        self.assertEqual(folder.property("name"), "")
        self.assertIsNone(folder.property("description"))
        self.assertIsNone(first.property("name"))
        self.assertEqual(first.property("description"), "")
        self.assertEqual(first.property("unit"), "")
        self.assertIsNone(second.property("unit"))
        self.assertIsNone(third.property("description"))
        self.assertEqual([d.code for d in result.diagnostics],
                         ["external_name_blank", "external_name_missing",
                          "external_name_blank"])
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertEqual(doc.detection.state, DetectionState.RECOGNIZED)

    def test_unknown_properties_elements_text_namespaces_and_references_retained(self):
        result = self.read(
            '<Folder name="f" xmlns:q="urn:test" extra=" raw "> before '
            '<q:Field q:flag="v">inside<Other/>after</q:Field> tail '
            '<Component name="c" resource="https://invalid.example/no-fetch"/>'
            '</Folder>', 'schema="file:///not-opened.xsd"'
        )
        doc = result.data
        assert doc is not None
        folder = doc.root.children[0]
        unknown = folder.children[0]
        self.assertEqual(doc.root.property("schema"), "file:///not-opened.xsd")
        self.assertEqual(folder.namespaces, (("q", "urn:test"),))
        self.assertEqual(folder.property("extra"), " raw ")
        self.assertEqual(folder.text, " before ")
        self.assertEqual(unknown.tag, "{urn:test}Field")
        self.assertEqual(unknown.property("{urn:test}flag"), "v")
        self.assertEqual(unknown.text, "inside")
        self.assertEqual(unknown.children[0].tail, "after")
        self.assertEqual(unknown.tail, " tail ")
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertEqual(doc.detection.state, DetectionState.UNSUPPORTED)
        self.assertEqual(unknown.provenance.position, 3)
        codes = {d.code for d in result.diagnostics}
        self.assertTrue({"external_property_unknown", "external_element_unsupported",
                         "external_text_unqualified"} <= codes)

    def test_unqualified_material_link_and_relations_never_report_success(self):
        for body in (
            '<Folder name="f"><Material name="m"><Component name="c"/></Material></Folder>',
            '<Folder name="f"><Link name="l"/></Folder>',
            '<Folder name="f"/><Component name="root-leaf"/>',
            '<Folder name="f"><Component name="c"><Folder name="child"/></Component></Folder>',
        ):
            with self.subTest(body=body):
                result = self.read(body)
                assert result.data is not None
                self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
                self.assertEqual(result.data.detection.state, DetectionState.UNSUPPORTED)
                self.assertTrue(result.diagnostics)
        self.assertEqual(QUALIFIED_TYPES, ("Folder", "Component"))

    def test_synthetic_historical_material_branch_is_preserved_without_transformations(self):
        # H:4639-5082 describes Material/Component/Attribute, not a verified export.
        result = self.read(
            '<Folder name="f"><Material name=" 001 - ouvrage " description=" raw " unit="m2">'
            '<Attribute id="267" value=""/><Attribute id="207" value=" source "/>'
            '<Attribute id="267" value="second"/>'
            '<Component name=" c " unit="U"><Attribute id="202" value=" original "/>'
            '</Component></Material></Folder>'
        )
        doc = result.data
        assert doc is not None
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertEqual(doc.detection.state, DetectionState.UNSUPPORTED)
        material, = doc.root.children[0].children
        self.assertEqual(material.tag, "Material")
        self.assertEqual([(p.name, p.value) for p in material.properties],
                         [("name", " 001 - ouvrage "), ("description", " raw "), ("unit", "m2")])
        self.assertEqual([n.tag for n in material.children],
                         ["Attribute", "Attribute", "Attribute", "Component"])
        self.assertEqual([(n.property("id"), n.property("value"))
                          for n in material.children[:3]],
                         [("267", ""), ("207", " source "), ("267", "second")])
        component = material.children[3]
        self.assertEqual(component.property("name"), " c ")
        self.assertEqual(component.property("unit"), "U")
        self.assertEqual([(n.property("id"), n.property("value")) for n in component.children],
                         [("202", " original ")])
        self.assertEqual(len(tuple(doc.occurrences())), 8)
        self.assertEqual(len({n.occurrence_id for n in doc.occurrences()}), 8)
        self.assertTrue(result.diagnostics)
        self.assertEqual(doc.source_bytes, self.path.read_bytes())

    def test_synthetic_link_variants_preserve_raw_data_without_inferred_resolution(self):
        # Link exists in historical Qt models, but its custom XML schema is unproven.
        for attributes in ('name=" target "', 'name="target" target="missing"',
                           'name="target" ref="duplicate"'):
            with self.subTest(attributes=attributes):
                result = self.read(
                    '<Folder name="f"><Material name="duplicate"/>'
                    '<Material name="duplicate"/>'
                    f'<Link {attributes}><Attribute id="267" value=" raw "/></Link>'
                    '</Folder>'
                )
                doc = result.data
                assert doc is not None
                self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
                self.assertEqual(doc.detection.state, DetectionState.UNSUPPORTED)
                first, second, link = doc.root.children[0].children
                self.assertEqual(first.property("name"), second.property("name"))
                self.assertNotEqual(first.occurrence_id, second.occurrence_id)
                self.assertEqual(link.tag, "Link")
                self.assertEqual(link.children[0].property("value"), " raw ")
                self.assertEqual([p.name for p in link.properties],
                                 ["name"] + (["target"] if "target=" in attributes else
                                             ["ref"] if "ref=" in attributes else []))
                self.assertEqual(len(tuple(doc.occurrences())), 6)
                self.assertEqual(doc.source_bytes, self.path.read_bytes())
                self.assertEqual(QUALIFIED_TYPES, ("Folder", "Component"))

    def test_mixed_dialect_is_ambiguous_not_partial_modern_success(self):
        result = self.read('<Folder name="f"/><Dossier name="old"><Composant/></Dossier>')
        self.assertIsNone(result.data)
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(result.diagnostics[0].code, "external_format_ambiguous")

    def test_mixed_folder_and_component_children_keep_order(self):
        result = self.read(
            '<Folder name="f"><Component name="a"/><Folder name="nested"/>'
            '<Component name="b"/></Folder>'
        )
        assert result.data is not None
        self.assertEqual(result.state, Availability.AVAILABLE)
        self.assertEqual([n.tag for n in result.data.root.children[0].children],
                         ["Component", "Folder", "Component"])

    def test_old_dialect_empty_or_foreign_content_is_not_empty_success(self):
        for xml in (
            '<Gimi><Dossier><Composant/></Dossier></Gimi>',
            '<Export/>', '<Export><Other/></Export>',
            '<Export><Material name="m"/></Export>',
            '<Export xmlns="urn:other"><Folder/></Export>',
            '<AllplanCatalog><Folder name="f"/></AllplanCatalog>',
            '<Folder name="f"><Folder name="child"/></Folder>',
        ):
            with self.subTest(xml=xml):
                self.path.write_text(xml, encoding="utf-8")
                result = read_modern_xml(self.path)
                self.assertIsNone(result.data)
                self.assertEqual(result.state, Availability.UNAVAILABLE)
                self.assertEqual(result.diagnostics[0].code, "external_format_incompatible")

    def test_invalid_xml_and_dtd_are_distinct_from_incompatible_format(self):
        for xml in (
            b"", b"<Export>", b"<Export>\xff</Export>",
            b'<Export a="1" a="2"/>',
            b'<!DOCTYPE Export><Export><Folder/></Export>',
            b'<!DOCTYPE Export SYSTEM "file:///unread"><Export><Folder/></Export>',
            b'<!DOCTYPE Export [<!ENTITY x "secret">]><Export>&x;</Export>',
            b'<!DOCTYPE Export [<!ENTITY x SYSTEM "https://invalid.example/">]>'
            b'<Export>&x;</Export>',
        ):
            with self.subTest(xml=xml):
                self.path.write_bytes(xml)
                result = read_modern_xml(self.path)
                self.assertIsNone(result.data)
                self.assertEqual(result.state, Availability.UNAVAILABLE)
                self.assertEqual(result.diagnostics[0].code, "external_xml_invalid")

    def test_parser_unsupported_encodings_are_explicit_unavailable_results(self):
        for encoding in ("unknown", "UTF-7", "GB18030"):
            with self.subTest(encoding=encoding):
                xml = (f'<?xml version="1.0" encoding="{encoding}"?>'
                       '<Export><Folder name="f"/></Export>')
                self.path.write_bytes(xml.encode("ascii"))
                result = read_modern_xml(self.path)
                self.assertIsNone(result.data)
                self.assertEqual(result.state, Availability.UNAVAILABLE)
                self.assertEqual(result.diagnostics[0].code,
                                 "external_xml_encoding_unsupported")

    def test_missing_and_inaccessible_source(self):
        self.assertEqual(read_modern_xml(self.path).diagnostics[0].code,
                         "external_source_access")
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            result = read_modern_xml(self.path)
        self.assertIsNone(result.data)
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(result.diagnostics[0].code, "external_source_access")

    def test_input_opened_once_read_only_and_unchanged(self):
        self.read('<Folder name="f"/>')
        before = self.path.read_bytes()
        original_open = Path.open
        with patch.object(Path, "open", autospec=True, side_effect=original_open) as opened:
            result = read_modern_xml(self.path)
        self.assertIsNotNone(result.data)
        self.assertEqual(opened.call_count, 1)
        self.assertEqual(opened.call_args.args, (self.path,))
        self.assertEqual(opened.call_args.kwargs["mode"], "rb")
        self.assertEqual(self.path.read_bytes(), before)

    def test_deep_hierarchy_does_not_use_python_recursion(self):
        depth = 1100
        result = self.read('<Folder name="n">' * depth + '</Folder>' * depth)
        assert result.data is not None
        self.assertEqual(result.state, Availability.AVAILABLE)
        self.assertEqual(len(tuple(result.data.occurrences())), depth + 1)

    def test_comments_instructions_and_xml_normalization_have_raw_counterpart(self):
        body = '<Folder name="f" description="a\tb\r\nc"><!--kept--><?p keep?>text\r\n</Folder>'
        result = self.read(body)
        assert result.data is not None
        folder = result.data.root.children[0]
        self.assertEqual(folder.property("description"), "a b c")
        self.assertEqual(folder.text, "text\n")
        self.assertIn(b"<!--kept--><?p keep?>", result.data.source_bytes)
        self.assertIn(b"\r\n", result.data.source_bytes)

    def test_declared_encoding_is_respected_without_conversion(self):
        content = (
            '<?xml version="1.0" encoding="ISO-8859-1"?>'
            '<Export><Folder name="été"><Component name="c" unit="m²"/></Folder></Export>'
        ).encode("iso-8859-1")
        self.path.write_bytes(content)
        result = read_modern_xml(self.path)
        assert result.data is not None
        self.assertEqual(result.data.root.children[0].property("name"), "été")
        self.assertEqual(result.data.source_bytes, content)

    def test_xinclude_and_schema_locations_are_data_not_resource_requests(self):
        result = self.read(
            '<Folder name="f" xmlns:xi="http://www.w3.org/2001/XInclude">'
            '<xi:include href="file:///absent" parse="text"/></Folder>',
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            'xsi:noNamespaceSchemaLocation="https://invalid.example/schema.xsd"',
        )
        assert result.data is not None
        included = result.data.root.children[0].children[0]
        self.assertEqual(included.tag, "{http://www.w3.org/2001/XInclude}include")
        self.assertEqual(included.property("href"), "file:///absent")
        self.assertIsNone(included.text)
        self.assertEqual(included.children, ())
        self.assertEqual(result.data.detection.state, DetectionState.UNSUPPORTED)

    def test_diagnostics_log_codes_not_private_values(self):
        with self.assertLogs("application.core.allplan.models", level=logging.WARNING) as logs:
            result = self.read('<Folder name="PRIVATE" secret="PRIVATE"><Other/></Folder>')
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertNotIn("PRIVATE", "\n".join(logs.output))
        self.assertNotIn("PRIVATE", repr(result.diagnostics))


if __name__ == "__main__":
    unittest.main()
