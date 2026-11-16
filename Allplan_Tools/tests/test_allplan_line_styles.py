import codecs
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability
from application.core.allplan.readers.line_styles import read_line_styles_file


HEADER = "//MODULE=LAYER, LINESTYLE\r\n"


def style(code="0042", name=" Nom ", rules=' <sc>100<sti="0"><str99="99"><f256="255"></sc>\n'):
    return f"<ls>\n <wname>{name}</wname>\n <nr>{code}</nr>\n{rules}</ls>\n"


class LineStyleReaderTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "linestyle.sty"

    def load(self, body, encoding="utf-16"):
        self.path.write_bytes((HEADER + body).encode(encoding))
        return read_line_styles_file(self.path, "std")

    def test_order_ids_and_occurrence_scope(self):
        result = self.load(style() + style("7"))
        assert result.data is not None
        ids = [(x.block, f.value) for x in result.data.lines for f in x.fields if f.tag == "nr"]
        self.assertEqual(ids, [(2, "0042"), (7, "7")])
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_raw_special_values_not_resolved(self):
        result = self.load(style())
        assert result.data is not None
        field = result.data.lines[4].fields[0]
        self.assertEqual(field.tag, "sc")
        self.assertEqual(field.value, "100")
        self.assertEqual(field.properties, (("sti", "0"), ("str99", "99"), ("f256", "255")))

    def test_groups_and_reference_preserved(self):
        text = style().replace("<nr>0042</nr>", "<nr>0042</nr> <grp>0007</grp>")
        text += '<grp><nr>0007</nr><wname> G </wname></grp>\n'
        result = self.load(text)
        assert result.data is not None
        self.assertEqual(result.data.lines[3].fields[1].value, "0007")
        self.assertEqual(result.data.lines[-1].kind, "group")
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_unresolved_group_not_numeric_coerced(self):
        text = style().replace("<nr>0042</nr>", "<nr>0042</nr> <grp>0007</grp>")
        result = self.load(text + '<grp><nr>7</nr><wname>G</wname></grp>\n')
        self.assertIn("line_styles_group_unresolved", [d.code for d in result.diagnostics])

    def test_empty_fields_distinct_from_absent_property(self):
        result = self.load(style(name="", rules=' <dt><sti=""><str99="1"></dt>\n'))
        assert result.data is not None
        self.assertEqual(result.data.lines[2].fields[0].value, "")
        self.assertEqual(result.data.lines[4].fields[0].properties, (("sti", ""), ("str99", "1")))
        self.assertIn("line_styles_properties_incomplete", [d.code for d in result.diagnostics])

    def test_duplicate_ids_and_fields_preserved(self):
        result = self.load(style() + style().replace("<nr>0042</nr>", "<nr>0042</nr>\n <nr>7</nr>"))
        self.assertIn("line_styles_id_repeated", [d.code for d in result.diagnostics])
        self.assertIn("line_styles_field_repeated", [d.code for d in result.diagnostics])
        repeated = self.load(style(rules=' <sc>100<sti="1"><str99="1"><f256="1"></sc>\n' * 2))
        self.assertIn("line_styles_rule_repeated", [d.code for d in repeated.diagnostics])
        groups = self.load(style() + '<grp><nr></nr><wname></wname></grp>\n' * 2)
        self.assertIn("line_styles_id_empty", [d.code for d in groups.diagnostics])
        self.assertIn("line_styles_id_repeated", [d.code for d in groups.diagnostics])

    def test_unknown_and_repeated_properties(self):
        result = self.load(style(rules=' <dt>9<sti="1"><sti="2"><str99="1"><f256="3"><extra=" x "></dt>\n'))
        assert result.data is not None
        self.assertEqual(len(result.data.lines[4].fields[0].properties), 5)
        self.assertIn("line_styles_property_unknown", [d.code for d in result.diagnostics])
        self.assertIn("line_styles_properties_incomplete", [d.code for d in result.diagnostics])

    def test_invalid_line_retained_and_no_xml_entity_conversion(self):
        result = self.load(style(name=" A &amp; B ", rules="<unknown> x </unknown>\n"))
        assert result.data is not None
        self.assertEqual(result.data.lines[2].fields[0].value, " A &amp; B ")
        self.assertEqual(result.data.lines[4].kind, "unknown")
        self.assertIn("line_styles_line_unknown", [d.code for d in result.diagnostics])

    def test_missing_nested_and_orphan_blocks(self):
        for body, expected in [
            ("<ls>\n", "line_styles_block_unclosed"),
            ("<ls>\n<ls>\n</ls>\n", "line_styles_nested_block"),
            ("</ls>\n" + style(), "line_styles_close_orphan"),
            ("<ls>\n</ls>\n", "line_styles_id_missing"),
            (" <nr>7</nr>\n" + style(), "line_styles_field_orphan"),
        ]:
            self.assertIn(expected, [d.code for d in self.load(body).diagnostics])

    def test_unicode_encodings(self):
        for encoding in ("utf-16", "utf-8-sig", "utf-32"):
            result = self.load(style(name="\u00e9\u4e2d\u2028x"), encoding)
            assert result.data is not None
            self.assertEqual(result.data.lines[2].fields[0].value, "\u00e9\u4e2d\u2028x")

    def test_incompatible_source_preserves_text(self):
        for text in ("", "random\n", HEADER, HEADER.replace("LINESTYLE", "OTHER") + style()):
            self.path.write_bytes(text.encode("utf-8"))
            result = read_line_styles_file(self.path, "std")
            self.assertEqual(result.state, Availability.UNAVAILABLE)
            assert result.data is not None
            self.assertEqual(result.data.text, text)

    def test_reconstruct_and_provenance(self):
        result = self.load("// comment\r\n\n" + style())
        assert result.data is not None
        self.assertEqual("".join(x.raw for x in result.data.lines), result.data.text)
        self.assertEqual(result.data.lines[-1].provenance.position, 8)
        self.assertEqual(result.data.lines[-1].provenance.path, self.path)

    def test_access_and_encoding_errors(self):
        self.assertEqual(read_line_styles_file(self.path, "std").state, Availability.UNAVAILABLE)
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            self.assertIn("file_access", [d.code for d in read_line_styles_file(self.path, "std").diagnostics])
        self.path.write_bytes(codecs.BOM_UTF16_LE + b"\x00")
        self.assertIn("decode_failed", [d.code for d in read_line_styles_file(self.path, "std").diagnostics])

    def test_independent_sources_and_integrity(self):
        result = self.load(style())
        before = hashlib.sha256(self.path.read_bytes()).digest()
        other = self.path.with_name("linestyle_fra.fra")
        other.write_bytes((HEADER + style(name="Autre")).encode("utf-16"))
        etc = read_line_styles_file(other, "etc")
        read_line_styles_file(self.path, "std")
        assert result.data is not None and etc.data is not None
        self.assertNotEqual(result.data.lines[2].fields, etc.data.lines[2].fields)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)


if __name__ == "__main__":
    unittest.main()
