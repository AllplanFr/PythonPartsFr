import codecs
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability
from application.core.allplan.readers.surface_styles import read_surface_styles_file


HEADER = "//MODULE=DEFINITION, FaceStyle\r\n"


def style(code="0042", name=" Nom ", rules=' <sc>100<sch="007"><sch-bzm="-1"></sc>\n'):
    return f"<fs>\n <wname>{name}</wname>\n <nr>{code}</nr>\n{rules}</fs>\n"


class SurfaceStyleReaderTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "facestyle.sty"

    def load(self, body, encoding="utf-16"):
        self.path.write_bytes((HEADER + body).encode(encoding))
        return read_surface_styles_file(self.path, "std")

    @staticmethod
    def codes(result):
        return [d.code.removeprefix("surface_styles_") for d in result.diagnostics]

    def test_order_and_noncontiguous_text_ids(self):
        result = self.load(style() + style("900"))
        assert result.data is not None
        self.assertEqual(result.state, Availability.AVAILABLE)
        self.assertEqual([(r.block, f.value) for r in result.data.records for f in r.fields
                          if f.tag == "nr"], [(2, "0042"), (7, "900")])

    def test_multiline_rule_and_provenance(self):
        rule = ' <dt>310<sch="313"><sch-bzm="-1">\r\n      <fil="107"></dt>\n'
        result = self.load(style(rules=rule))
        assert result.data is not None
        record = result.data.records[4]
        self.assertEqual(record.raw, rule)
        self.assertEqual((record.provenance.position, record.end_position), (5, 6))
        self.assertEqual(record.fields[0].properties,
                         (("sch", "313"), ("sch-bzm", "-1"), ("fil", "107")))
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_empty_rules_and_values_are_not_defaults(self):
        result = self.load(style(name="", rules=' <sc></sc>\n <dt>0<fil=""></dt>\n'))
        assert result.data is not None
        self.assertEqual(result.data.records[2].fields[0].value, "")
        self.assertEqual(result.data.records[4].fields[0].properties, ())
        self.assertEqual(result.data.records[5].fields[0].properties, (("fil", ""),))
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_exact_precision_signs_and_unknown_paths_not_followed(self):
        with patch.object(Path, "read_bytes", autospec=True, side_effect=Path.read_bytes) as read:
            result = self.load(style(rules=' <dt> 09 <mus-bre="+0.0100"><tex="..\\missing.surf"></dt>\n'))
        self.assertEqual(read.call_count, 1)
        self.assertEqual(read.call_args.args, (self.path,))
        assert result.data is not None
        field = result.data.records[4].fields[0]
        self.assertEqual(field.value, " 09 ")
        self.assertEqual(field.properties, (("mus-bre", "+0.0100"), ("tex", "..\\missing.surf")))
        self.assertEqual(self.codes(result), ["property_unknown"])

    def test_groups_and_separate_identity_spaces(self):
        body = style().replace("<nr>0042</nr>", "<nr>0042</nr> <grp>0042</grp>")
        result = self.load(body + "<grp><nr>0042</nr><wname> G </wname></grp>\n")
        assert result.data is not None
        self.assertEqual(result.state, Availability.AVAILABLE)
        self.assertEqual(result.data.records[-1].fields[1].value, " G ")
        result = self.load(body + "<grp><nr>42</nr><wname>G</wname></grp>\n")
        self.assertIn("group_unresolved", self.codes(result))

    def test_repeated_ids_groups_fields_rules_and_properties(self):
        rule = ' <dt>1<fil="0"><fil="-1"></dt>\n' * 2
        result = self.load(style(rules=rule) + style().replace("</nr>", "</nr>\n <nr>7</nr>") +
                           "<grp><nr>1</nr><wname>G</wname></grp>\n" * 2)
        assert result.data is not None
        for code in ("id_repeated", "field_repeated", "rule_repeated", "property_repeated"):
            self.assertIn(code, self.codes(result))
        self.assertEqual(sum(f.tag == "dt" for r in result.data.records for f in r.fields), 2)

    def test_unknown_data_and_entities_preserved(self):
        body = style(name=" A &amp; B ", rules="<unknown> x </unknown>\n")
        result = self.load(body)
        assert result.data is not None
        self.assertEqual(result.data.records[2].fields[0].value, " A &amp; B ")
        self.assertIn("record_unknown", self.codes(result))
        self.assertIn("<unknown> x </unknown>", result.data.records[4].raw)

    def test_unclosed_rule_does_not_consume_next_block(self):
        result = self.load(style(rules=' <dt>1<fil="0">\n') + style("7"))
        assert result.data is not None
        self.assertIn("record_unknown", self.codes(result))
        self.assertEqual(sum(r.kind == "open" for r in result.data.records), 2)
        self.assertEqual(sum(r.kind == "close" for r in result.data.records), 2)

    def test_block_errors_and_empty_ids(self):
        for body, expected in [
            ("<fs>\n", "block_unclosed"), ("<fs>\n<fs>\n</fs>\n", "nested_block"),
            ("</fs>\n" + style(), "close_orphan"), ("<fs>\n</fs>\n", "id_missing"),
            ("<nr>7</nr>\n" + style(), "field_orphan"), (style(""), "id_empty"),
            ("<fs>\n<grp><nr>1</nr><wname>G</wname></grp>\n</fs>\n", "group_in_block"),
        ]:
            with self.subTest(expected=expected):
                self.assertIn(expected, self.codes(self.load(body)))

    def test_unicode_encodings_and_physical_lines(self):
        for encoding in ("utf-16", "utf-8-sig", "utf-32"):
            result = self.load(style(name="\u00e9\u4e2d\u2028x"), encoding)
            assert result.data is not None
            self.assertEqual(result.data.records[2].fields[0].value, "\u00e9\u4e2d\u2028x")
            self.assertEqual(result.data.records[2].provenance.position, 3)

    def test_incompatible_source_preserves_text_not_success(self):
        for text in ("", "random\n", HEADER, HEADER.replace("FaceStyle", "Other") + style()):
            self.path.write_bytes(text.encode("utf-8"))
            result = read_surface_styles_file(self.path, "std")
            assert result.data is not None
            self.assertEqual(result.state, Availability.UNAVAILABLE)
            self.assertEqual(result.data.text, text)

    def test_raw_reconstruction_and_provenance(self):
        result = self.load("// comment\r\n\n" + style())
        assert result.data is not None
        self.assertEqual("".join(r.raw for r in result.data.records), result.data.text)
        self.assertEqual(result.data.records[-1].end_position, 8)
        self.assertTrue(all(r.provenance.path == self.path and r.provenance.source == "std"
                            for r in result.data.records))

    def test_missing_access_and_decode_errors(self):
        self.assertEqual(read_surface_styles_file(self.path, "std").state, Availability.UNAVAILABLE)
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            self.assertIn("file_access", [d.code for d in read_surface_styles_file(self.path, "std").diagnostics])
        self.path.write_bytes(codecs.BOM_UTF16_LE + b"\x00")
        self.assertIn("decode_failed", [d.code for d in read_surface_styles_file(self.path, "std").diagnostics])

    def test_independent_sources_and_integrity(self):
        result = self.load(style())
        before = hashlib.sha256(self.path.read_bytes()).digest()
        other = self.path.with_name("facestyle_fra.fra")
        other.write_bytes((HEADER + style(name="Autre")).encode("utf-16"))
        etc = read_surface_styles_file(other, "etc")
        assert result.data is not None and etc.data is not None
        read_surface_styles_file(self.path, "std")
        self.assertNotEqual(result.data.records[2].fields, etc.data.records[2].fields)
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)


if __name__ == "__main__":
    unittest.main()
