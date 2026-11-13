import codecs
from decimal import Decimal, localcontext
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability
from application.core.allplan.readers.line_types import read_line_types_file


HEADER = "//MODULE = LINETYPES\r\n//VERSION = 3.0\r\n"


def pairs(code="0042", values="20 7 0 0 0 0 0 0 0 0 1"):
    return f"{code} {values}\r\n"


class LineTypeReaderTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "linetype.dat"

    def load(self, body, encoding="utf-16", header=HEADER):
        self.path.write_bytes((header + body).encode(encoding))
        result = read_line_types_file(self.path, "std")
        assert result.data is not None
        return result

    def test_ids_order_and_complete_pairs(self):
        result = self.load(".L 2\n" + pairs() + pairs("7"))
        assert result.data is not None
        records = [x.record for x in result.data.lines if x.record is not None]
        self.assertEqual([x.code for x in records], ["0042", "7"])
        self.assertEqual(records[0].values, ("20", "7") + ("0",) * 8 + ("1",))
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_precision_signs_zero_and_exponent(self):
        token = "-0.123456789012345678901234567890"
        with localcontext() as context:
            context.prec = 3
            result = self.load(".L 1\n" + pairs(values=token + " -0.00 +2e-3 0 0 0 0 0 0 0 1"))
            assert result.data is not None
            record = result.data.lines[-1].record
            assert record is not None
            self.assertEqual(record.numeric_values[0], Decimal(token))
            self.assertEqual(record.values[1], "-0.00")
            self.assertEqual(record.numeric_values[2], Decimal(".002"))

    def test_extended_name_comma_empty_tokens_and_markers(self):
        tail = '1,-18(45),[symbol.xml;R=59;H=60],,0,-10'
        result = self.load('.L 0\n0097," Nom, exact ",' + tail + "\n")
        assert result.data is not None
        record = result.data.lines[-1].record
        assert record is not None
        self.assertEqual(record.code, "0097")
        self.assertEqual(record.name, " Nom, exact ")
        self.assertEqual(record.remainder, tail)
        self.assertEqual(record.values, tuple(tail.split(",")))
        self.assertIsNone(record.numeric_values[1])
        self.assertIn("line_types_extended_uninterpreted", [d.code for d in result.diagnostics])

    def test_empty_name_distinct_from_absent(self):
        result = self.load('.L 1\n' + pairs() + '97,"",\n')
        assert result.data is not None
        basic = result.data.lines[-2].record
        extended = result.data.lines[-1].record
        assert basic is not None and extended is not None
        self.assertIsNone(basic.name)
        self.assertEqual(extended.name, "")
        self.assertEqual(extended.values, ("",))

    def test_duplicates_not_merged(self):
        result = self.load(".L 2\n" + pairs("7") * 2 + '7,"Alias",1,2\n')
        assert result.data is not None
        self.assertEqual(sum(x.record is not None for x in result.data.lines), 3)
        self.assertEqual(sum(d.code == "line_types_code_repeated" for d in result.diagnostics), 2)

    def test_count_excludes_extended_and_checks_each_section(self):
        result = self.load(".L 2\n" + pairs() + '97,"x",1,2\n.L 0\n' + pairs("9"))
        self.assertEqual(sum(d.code == "line_types_count_mismatch" for d in result.diagnostics), 2)

    def test_unknown_section_breaks_scope(self):
        result = self.load(".L 1\n" + pairs() + ".X 1\n" + pairs("9"))
        assert result.data is not None
        self.assertIsNone(result.data.lines[-1].record)
        self.assertIsNone(result.data.lines[-1].section)

    def test_missing_and_additional_fields_preserved(self):
        result = self.load(".L 2\n42\n" + pairs("7", "1 2 3 4 5 6 7 8 9 10 1 extra tail"))
        assert result.data is not None
        first = result.data.lines[-2].record
        last = result.data.lines[-1].record
        assert first is not None and last is not None
        self.assertEqual(first.values, ())
        self.assertEqual(last.remainder, " extra tail")
        self.assertEqual(sum(d.code == "line_types_fields_invalid" for d in result.diagnostics), 2)

    def test_non_numeric_and_nonfinite_tokens_preserved(self):
        result = self.load(".L 1\n" + pairs(values="NaN Infinity 1,25"))
        self.assertIn("line_types_line_invalid", [d.code for d in result.diagnostics])
        result = self.load(".L 1\n" + pairs(values="NaN Infinity text 0 0 0 0 0 0 0 1"))
        self.assertIn("line_types_numeric_unresolved", [d.code for d in result.diagnostics])

    def test_versions_history_not_one_active_version_invented(self):
        header = HEADER + "//VERSION = 3.1 changes: test\n//VERSION = 3.2 changes: next\n"
        result = self.load(".L 1\n" + pairs(), header=header)
        assert result.data is not None
        self.assertEqual(result.data.versions, ("3.0", "3.1 changes: test", "3.2 changes: next"))

    def test_incompatible_empty_and_malformed_extended(self):
        for text in ("", "unknown\n", HEADER + ".L 0\n", HEADER.replace("3.0", "4.0") + ".L 1\n" + pairs()):
            self.path.write_bytes(text.encode("utf-8"))
            result = read_line_types_file(self.path, "std")
            self.assertEqual(result.state, Availability.UNAVAILABLE)
            assert result.data is not None
            self.assertEqual(result.data.text, text)
        self.assertIn("line_types_line_invalid", [d.code for d in
                      self.load('.L 0\n97,"unterminated,1,2\n').diagnostics])

    def test_unicode_encodings(self):
        for encoding in ("utf-16", "utf-8-sig", "utf-32"):
            result = self.load('.L 0\n97,"\u00e9\u4e2d\u2028x",1,2\n', encoding)
            assert result.data is not None
            record = result.data.lines[-1].record
            assert record is not None
            self.assertEqual(record.name, "\u00e9\u4e2d\u2028x")

    def test_explicit_legacy_encoding(self):
        self.path.write_bytes((HEADER + '.L 0\n97,"\u00e9",1\n').encode("cp1252"))
        self.assertEqual(read_line_types_file(self.path, "std").state, Availability.UNAVAILABLE)
        self.assertEqual(read_line_types_file(self.path, "std", encoding_hint="cp1252").state,
                         Availability.WITH_DIAGNOSTICS)

    def test_reconstruct_and_provenance(self):
        result = self.load("// comment\r.L 1\n\n" + pairs())
        assert result.data is not None
        self.assertEqual("".join(x.raw for x in result.data.lines), result.data.text)
        self.assertEqual(result.data.lines[-1].provenance.position, 6)
        self.assertEqual(result.data.lines[-1].section, 4)

    def test_access_and_decode_errors(self):
        self.assertEqual(read_line_types_file(self.path, "std").state, Availability.UNAVAILABLE)
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            self.assertIn("file_access", [d.code for d in read_line_types_file(self.path, "std").diagnostics])
        self.path.write_bytes(codecs.BOM_UTF16_LE + b"\x00")
        self.assertIn("decode_failed", [d.code for d in read_line_types_file(self.path, "std").diagnostics])

    def test_sources_independent_and_integrity(self):
        result = self.load(".L 1\n" + pairs())
        before = hashlib.sha256(self.path.read_bytes()).digest()
        other = self.path.with_name("linetype.def")
        other.write_bytes((HEADER + ".L 1\n" + pairs("9")).encode("utf-16"))
        etc = read_line_types_file(other, "etc")
        read_line_types_file(self.path, "std")
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)
        assert result.data is not None and etc.data is not None
        self.assertNotEqual(result.data.lines[-1].record, etc.data.lines[-1].record)
        self.assertEqual(etc.data.provenance.source, "etc")


if __name__ == "__main__":
    unittest.main()
