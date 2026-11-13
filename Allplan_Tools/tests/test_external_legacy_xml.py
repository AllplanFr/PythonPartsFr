import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability, Provenance
from application.core.external_libraries.legacy_xml import (
    ADAPTER_ID, ADAPTER_VERSION, QUALIFIED_FIELDS, QUALIFIED_TYPES,
    detect_legacy_xml, read_legacy_xml,
)
from application.core.external_libraries.models import DetectionState, SourceOccurrence
from application.core.external_libraries.modern_xml import read_modern_xml
from application.core.external_libraries.xml_source import XmlDialect, detect_xml_dialect


class ExternalLegacyXmlTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "library.data"

    def read(self, body, root="Source", properties=""):
        self.path.write_bytes(f"<{root} {properties}>{body}</{root}>".encode("utf-8"))
        return read_legacy_xml(self.path)

    def test_user_synermi_example_preserves_brand_and_exact_component_fields(self):
        # Synthetic transcription of the user's snippet, not a new real export.
        result = self.read(
            '<Dossier name="…"><Composant name="1-10-0-5-0-0.0-0.0">'
            '<description>Étude béton</description><Unité>U</Unité>'
            '</Composant></Dossier>', root="Synermi",
        )
        self.assertEqual(result.state, Availability.AVAILABLE)
        self.assertEqual(result.diagnostics, ())
        doc = result.data
        assert doc is not None
        self.assertEqual(doc.root.tag, "Synermi")
        self.assertEqual(doc.root.provenance, Provenance(self.path, ADAPTER_ID, 1))
        self.assertEqual(detect_xml_dialect(doc.root), XmlDialect.LEGACY)
        folder, = doc.root.children
        self.assertEqual(folder.tag, "Dossier")
        self.assertEqual(folder.property("name"), "…")
        component, = folder.children
        self.assertEqual(component.tag, "Composant")
        self.assertEqual([(p.name, p.value) for p in component.properties],
                         [("name", "1-10-0-5-0-0.0-0.0")])
        self.assertEqual(component.property("name"), "1-10-0-5-0-0.0-0.0")
        self.assertEqual([(n.tag, n.text, n.children) for n in component.children],
                         [("description", "Étude béton", ()), ("Unité", "U", ())])
        self.assertEqual([n.tag for n in doc.occurrences()],
                         ["Synermi", "Dossier", "Composant", "description", "Unité"])
        self.assertEqual(doc.source_bytes, self.path.read_bytes())

    def test_observed_envelopes_and_field_profiles_are_explicit_source_data(self):
        for root, code in (("BASE_EXTERNE_COMPOSANT", ""), ("Synermi", ""),
                           ("Gimi", "<code_externe>0002</code_externe>")):
            with self.subTest(root=root):
                result = self.read(
                    '<Dossier name="01 - title"><Composant name="0002">'
                    '<description>raw</description><Unité>m²</Unité>'
                    f'{code}</Composant></Dossier>', root,
                )
                self.assertEqual(result.state, Availability.AVAILABLE)
                doc = result.data
                assert doc is not None
                self.assertEqual(doc.root.tag, root)
                self.assertEqual(doc.detection.adapter_id, ADAPTER_ID)
                self.assertEqual(doc.detection.adapter_version, ADAPTER_VERSION)
                self.assertEqual(doc.detection.state, DetectionState.RECOGNIZED)
                self.assertEqual(detect_legacy_xml(doc.root), doc.detection)
                leaf = doc.root.children[0].children[0]
                self.assertEqual([n.tag for n in leaf.children],
                                 ["description", "Unité"] + (["code_externe"] if code else []))
                self.assertEqual(leaf.children[1].text, "m²")
                self.assertEqual(QUALIFIED_TYPES, ("Dossier", "Composant"))
                self.assertEqual(QUALIFIED_FIELDS, ("description", "Unité", "code_externe"))

    def test_mixed_children_hierarchy_and_empty_folders_keep_order(self):
        result = self.read(
            '<Dossier name="parent"><Composant name="first">'
            '<description>A</description><Unité>U</Unité></Composant>'
            '<Dossier name="empty"/><Composant name="last">'
            '<description>B</description><Unité>F</Unité></Composant></Dossier>'
            '<Dossier name="second"/>'
        )
        self.assertEqual(result.state, Availability.AVAILABLE)
        doc = result.data
        assert doc is not None
        folder = doc.root.children[0]
        self.assertEqual([n.tag for n in folder.children], ["Composant", "Dossier", "Composant"])
        self.assertEqual([n.property("name") for n in folder.children], ["first", "empty", "last"])
        self.assertEqual(folder.children[1].children, ())
        self.assertEqual(len(doc.root.children), 2)
        self.assertFalse(any(n.tag in ("Material", "Folder") for n in doc.occurrences()))
        last = folder.children[2]
        self.assertEqual(last.element_path, (1, 3))
        self.assertEqual(last.occurrence_id, "xml:1.3")
        self.assertEqual(last.provenance, Provenance(self.path, ADAPTER_ID, 7))

    def test_repeated_codes_names_fields_and_unknown_elements_never_overwrite(self):
        result = self.read(
            '<Dossier name="same"><Composant name="same">'
            '<description>first</description><description>second</description>'
            '<Unité>U</Unité><code_externe>001</code_externe>'
            '<code_externe>001</code_externe><Other n="1"/><Other n="2"/>'
            '</Composant><Composant name="same"><description/><Unité/></Composant>'
            '</Dossier><Dossier name="same"/>'
        )
        doc = result.data
        assert doc is not None
        occurrences = tuple(doc.occurrences())
        self.assertEqual(len(occurrences), len({n.occurrence_id for n in occurrences}))
        component = doc.root.children[0].children[0]
        self.assertEqual([n.text for n in component.children[:2]], ["first", "second"])
        self.assertEqual([n.property("n") for n in component.children[-2:]], ["1", "2"])
        self.assertEqual(len(doc.root.children), 2)
        self.assertEqual(len(doc.root.children[0].children), 2)
        self.assertEqual(sum(d.code == "external_field_repeated" for d in result.diagnostics), 2)
        self.assertEqual(doc.detection.state, DetectionState.UNSUPPORTED)

    def test_exact_unicode_multiline_names_and_units_without_historical_transforms(self):
        result = self.read(
            '<Dossier name=" 01 - été - 雪 "><Composant name=" 0002 ">'
            '<description> first\n second &amp; third&#xD;\n </description>'
            '<Unité> m2 </Unité><code_externe> 0007 </code_externe>'
            '</Composant></Dossier>'
        )
        self.assertEqual(result.state, Availability.AVAILABLE)
        doc = result.data
        assert doc is not None
        folder = doc.root.children[0]
        leaf = folder.children[0]
        self.assertEqual(folder.property("name"), " 01 - été - 雪 ")
        self.assertEqual(leaf.property("name"), " 0002 ")
        self.assertEqual([n.text for n in leaf.children],
                         [" first\n second & third\r\n ", " m2 ", " 0007 "])
        self.assertEqual([p.name for p in leaf.properties], ["name"])
        self.assertEqual(len(leaf.children), 3)

    def test_absence_versus_empty_field_property_and_explicit_null_text(self):
        result = self.read(
            '<Dossier name=""><Composant name="" extra="">'
            '<description/><Unité/><code_externe/></Composant>'
            '<Composant><description></description></Composant>'
            '<Composant name="literal"><description>empty?</description>'
            '<Unité>null</Unité></Composant></Dossier>'
        )
        doc = result.data
        assert doc is not None
        empty, missing, literal = doc.root.children[0].children
        self.assertEqual(empty.property("name"), "")
        self.assertEqual(empty.property("extra"), "")
        self.assertIsNone(missing.property("name"))
        self.assertEqual([n.text for n in empty.children], [None, None, None])
        self.assertEqual([n for n in missing.children if n.tag == "Unité"], [])
        self.assertEqual(literal.children[1].text, "null")
        self.assertEqual(sum(d.code == "external_field_missing" for d in result.diagnostics), 1)

    def test_unknown_properties_elements_namespaces_mixed_content_preserved(self):
        result = self.read(
            '<Dossier name="f" extra="raw" xmlns:q="urn:test">before'
            '<Composant name="c"><description format="raw">first<q:x q:v="2"/>tail'
            '</description><Unité>U</Unité><Other>unknown</Other></Composant>after'
            '</Dossier>', properties='brand="raw"',
        )
        doc = result.data
        assert doc is not None
        folder = doc.root.children[0]
        description = folder.children[0].children[0]
        self.assertEqual(doc.root.property("brand"), "raw")
        self.assertEqual(folder.namespaces, (("q", "urn:test"),))
        self.assertEqual(folder.text, "before")
        self.assertEqual(folder.children[0].tail, "after")
        self.assertEqual(description.property("format"), "raw")
        self.assertEqual(description.text, "first")
        self.assertEqual(description.children[0].tag, "{urn:test}x")
        self.assertEqual(description.children[0].property("{urn:test}v"), "2")
        self.assertEqual(description.children[0].tail, "tail")
        self.assertEqual(doc.detection.state, DetectionState.UNSUPPORTED)
        self.assertIn("external_field_structure_unsupported", [d.code for d in result.diagnostics])

    def test_missing_fields_have_diagnostics_not_synthetic_values(self):
        result = self.read('<Dossier name="f"><Composant name="c"/></Dossier>')
        assert result.data is not None
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertEqual(result.data.detection.state, DetectionState.RECOGNIZED)
        self.assertEqual(result.data.root.children[0].children[0].children, ())
        self.assertEqual([d.code for d in result.diagnostics],
                         ["external_field_missing", "external_field_missing"])

    def test_unknown_or_misplaced_structures_remain_consultable_with_diagnostics(self):
        for extra in (
            '<Something resource="file:///not-opened"/>',
            '<description>misplaced</description>',
            '<Composant name="c"><description><Dossier name="inside"/></description>'
            '<Unité>U</Unité></Composant>',
        ):
            with self.subTest(extra=extra):
                result = self.read(f'<Dossier name="f">{extra}</Dossier>')
                assert result.data is not None
                self.assertEqual(result.data.detection.state, DetectionState.UNSUPPORTED)
                self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
                self.assertTrue(result.data.root.children[0].children)

    def test_modern_legacy_ambiguous_and_incompatible_are_distinct(self):
        def occurrence(tag, descendants=()):
            return SourceOccurrence(tag, (), descendants, None, None, (), (),
                                    Provenance(self.path, "synthetic"))

        for children, expected in (
            ((occurrence("Folder"),), XmlDialect.MODERN),
            ((occurrence("Dossier"),), XmlDialect.LEGACY),
            ((occurrence("Folder"), occurrence("Dossier")), XmlDialect.AMBIGUOUS),
            ((occurrence("Dossier", (occurrence("Component"),)),), XmlDialect.AMBIGUOUS),
            ((occurrence("Folder", (occurrence("Composant"),)),), XmlDialect.AMBIGUOUS),
            ((occurrence("Other"),), XmlDialect.INCOMPATIBLE),
        ):
            with self.subTest(expected=expected, children=children):
                root = occurrence("Export", children)
                self.assertEqual(detect_xml_dialect(root), expected)
                if expected == XmlDialect.AMBIGUOUS:
                    self.assertEqual(detect_legacy_xml(root).state, DetectionState.AMBIGUOUS)

    def test_mixed_signatures_do_not_choose_a_reader(self):
        for body in (
            '<Dossier name="f"/><Folder name="modern"/>',
            '<Dossier name="f"><Component name="modern"/></Dossier>',
            '<Folder name="f"><Composant name="old"/></Folder>',
        ):
            with self.subTest(body=body):
                self.read(body)
                for reader in (read_legacy_xml, read_modern_xml):
                    result = reader(self.path)
                    self.assertIsNone(result.data)
                    self.assertEqual(result.state, Availability.UNAVAILABLE)
                    self.assertEqual(result.diagnostics[0].code, "external_format_ambiguous")

    def test_incompatible_xml_and_modern_input_are_not_empty_success(self):
        for xml in (
            '<Export/>', '<Export><Composant/></Export>',
            '<Export><Other><Dossier/></Other></Export>',
            '<Export><Folder name="modern"/></Export>',
            '<Export xmlns="urn:other"><Dossier/></Export>',
            '<Dossier name="f"><Dossier/></Dossier>',
            '<AllplanCatalog><Dossier/></AllplanCatalog>',
        ):
            with self.subTest(xml=xml):
                self.path.write_bytes(xml.encode("utf-8"))
                result = read_legacy_xml(self.path)
                self.assertIsNone(result.data)
                self.assertEqual(result.state, Availability.UNAVAILABLE)
                self.assertEqual(result.diagnostics[0].code, "external_format_incompatible")

    def test_encoding_profiles_and_bom_preserve_original_bytes(self):
        for encoding, declaration, bom in (
            ("utf-8", "", b""),
            ("utf-8", '<?xml version="1.0" encoding="UTF-8"?>', b"\xef\xbb\xbf"),
            ("iso-8859-1", '<?xml version="1.0" encoding="ISO-8859-1"?>', b""),
        ):
            with self.subTest(encoding=encoding):
                content = (declaration + '<Gimi><Dossier name="été"><Composant name="c">'
                           '<description>déjà</description><Unité>m²</Unité>'
                           '</Composant></Dossier></Gimi>').encode(encoding)
                self.path.write_bytes(bom + content)
                result = read_legacy_xml(self.path)
                assert result.data is not None
                self.assertEqual(result.state, Availability.AVAILABLE)
                self.assertEqual(result.data.root.children[0].property("name"), "été")
                self.assertEqual(result.data.source_bytes, bom + content)

    def test_invalid_xml_or_prohibited_dtd_has_explicit_diagnostic(self):
        for xml in (
            b"", b"<Export>", b"<Export>\xff</Export>",
            b'<Export a="1" a="2"/>',
            b'<!DOCTYPE Export><Export><Dossier/></Export>',
            b'<!DOCTYPE Export SYSTEM "file:///absent"><Export><Dossier/></Export>',
            b'<!DOCTYPE Export [<!ENTITY x SYSTEM "https://invalid.example/">]>'
            b'<Export><Dossier>&x;</Dossier></Export>',
            b'<!DOCTYPE Export [<!ENTITY x "secret">]><Export>&x;</Export>',
        ):
            with self.subTest(xml=xml):
                self.path.write_bytes(xml)
                result = read_legacy_xml(self.path)
                self.assertIsNone(result.data)
                self.assertEqual(result.diagnostics[0].code, "external_xml_invalid")

    def test_unknown_or_unsupported_encoding_is_not_a_crash(self):
        for encoding in ("unknown", "UTF-7", "GB18030"):
            self.path.write_bytes(
                f'<?xml version="1.0" encoding="{encoding}"?><Export/>'.encode("ascii"))
            result = read_legacy_xml(self.path)
            self.assertIsNone(result.data)
            self.assertEqual(result.diagnostics[0].code, "external_xml_encoding_unsupported")

    def test_source_access_errors(self):
        self.assertEqual(read_legacy_xml(self.path).diagnostics[0].code, "external_source_access")
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            result = read_legacy_xml(self.path)
        self.assertIsNone(result.data)
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(result.diagnostics[0].code, "external_source_access")

    def test_single_read_only_open_and_integrity(self):
        self.read('<Dossier name="empty"/>')
        before = self.path.read_bytes()
        original_open = Path.open
        with patch.object(Path, "open", autospec=True, side_effect=original_open) as opened:
            result = read_legacy_xml(self.path)
        self.assertIsNotNone(result.data)
        assert result.data is not None
        self.assertEqual(opened.call_count, 1)
        self.assertEqual(opened.call_args.args, (self.path,))
        self.assertEqual(opened.call_args.kwargs["mode"], "rb")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(result.data.sha256, hashlib.sha256(before).hexdigest())

    def test_resource_references_and_schemas_are_data_not_requests(self):
        result = self.read(
            '<Dossier name="f" xmlns:xi="http://www.w3.org/2001/XInclude">'
            '<xi:include href="file:///absent"/><Composant name="c">'
            '<description>https://invalid.example/texture</description><Unité>U</Unité>'
            '</Composant></Dossier>',
            properties='xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            'xsi:noNamespaceSchemaLocation="https://invalid.example/schema"',
        )
        doc = result.data
        assert doc is not None
        reference = doc.root.children[0].children[0]
        self.assertEqual(reference.property("href"), "file:///absent")
        self.assertEqual(reference.children, ())
        self.assertEqual(doc.detection.state, DetectionState.UNSUPPORTED)
        self.assertEqual(doc.root.children[0].children[1].children[0].text,
                         "https://invalid.example/texture")

    def test_deep_hierarchy_is_iterative(self):
        depth = 1100
        result = self.read('<Dossier name="f">' * depth + '</Dossier>' * depth)
        assert result.data is not None
        self.assertEqual(result.state, Availability.AVAILABLE)
        self.assertEqual(len(tuple(result.data.occurrences())), depth + 1)

    def test_lexical_source_preserves_comments_pi_and_newlines(self):
        result = self.read(
            '<Dossier name="f"><!--raw--><?p keep?><Composant name="c">'
            '<description> a\r\nb </description><Unité></Unité></Composant></Dossier>'
        )
        doc = result.data
        assert doc is not None
        self.assertEqual(doc.root.children[0].children[0].children[0].text, " a\nb ")
        self.assertIn(b"<!--raw--><?p keep?>", doc.source_bytes)
        self.assertIn(b"\r\n", doc.source_bytes)
        self.assertIn(b"<Un", doc.source_bytes)

    def test_diagnostics_do_not_log_private_values(self):
        with self.assertLogs("application.core.allplan.models", level="WARNING") as logs:
            result = self.read('<Dossier name="PRIVATE" secret="PRIVATE"><Other/></Dossier>')
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertNotIn("PRIVATE", "\n".join(logs.output))
        self.assertNotIn("PRIVATE", repr(result.diagnostics))


if __name__ == "__main__":
    unittest.main()
