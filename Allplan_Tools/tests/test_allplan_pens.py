import codecs
from decimal import Decimal, localcontext
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability
from application.core.allplan.readers.pens import PenRecord, read_pens_file


HEADER = "//MODULE = LINETHICKNESSES\r\n//VERSION = 1.0\r\n"


class PenReaderTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "linethick.dat"

    def load(self, body, encoding="utf-8"):
        self.path.write_bytes((HEADER + body).encode(encoding))
        return read_pens_file(self.path, "std")

    def test_noncontiguous_codes_order_and_provenance(self):
        result = self.load(".L 2\r\n0042 25\r\n7 35\r\n")
        assert result.data is not None
        records = [line for line in result.data.lines if line.record is not None]
        codes = []
        for line in records:
            record = line.record
            assert record is not None
            codes.append(record.code)
        self.assertEqual(codes, ["0042", "7"])
        self.assertEqual([line.provenance.position for line in records], [4, 5])
        self.assertEqual([line.section for line in records], [3, 3])
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_exact_precision_without_context_rounding(self):
        value = "000.123456789012345678901234567890"
        with localcontext() as context:
            context.prec = 3
            result = self.load(f".L 1\n42 {value}\n")
            assert result.data is not None
            record = result.data.lines[-1].record
            assert record is not None
            self.assertEqual(record.value, value)
            self.assertEqual(str(record.numeric_value), "0.123456789012345678901234567890")

    def test_signed_zero_exponent_and_special_values_preserved(self):
        result = self.load(".L 4\n0 -0.00\n42 -1\n7 1.250e-2\n9 BYLAYER\n")
        assert result.data is not None
        records: list[PenRecord] = []
        for line in result.data.lines:
            record = line.record
            if record is not None:
                records.append(record)
        self.assertEqual([r.value for r in records], ["-0.00", "-1", "1.250e-2", "BYLAYER"])
        numeric = records[0].numeric_value
        assert numeric is not None
        self.assertEqual(numeric.as_tuple(), Decimal("-0.00").as_tuple())
        self.assertEqual(records[2].numeric_value, Decimal("0.01250"))
        self.assertIsNone(records[3].numeric_value)
        self.assertIn("pens_value_unresolved", [d.code for d in result.diagnostics])

    def test_absent_value_and_explicit_empty_token_not_defaulted(self):
        result = self.load('.L 2\n42   \n7 ""\n')
        assert result.data is not None
        first = result.data.lines[-2].record
        second = result.data.lines[-1].record
        assert first is not None and second is not None
        self.assertIsNone(first.value)
        self.assertEqual(second.value, '""')
        self.assertIsNone(second.numeric_value)

    def test_duplicate_ids_and_duplicate_thickness_not_deduplicated(self):
        result = self.load(".L 3\n7 25\n7 35\n42 25\n")
        assert result.data is not None
        self.assertEqual(sum(line.record is not None for line in result.data.lines), 3)
        self.assertEqual(sum(d.code == "pens_code_repeated" for d in result.diagnostics), 1)

    def test_quoted_empty_description_and_additional_fields_exact(self):
        result = self.load('.L 3\n1 25 ""  \n2 35 " \u00c9tage " \n3 50 other tail \n')
        assert result.data is not None
        records: list[PenRecord] = []
        for line in result.data.lines:
            record = line.record
            if record is not None:
                records.append(record)
        self.assertEqual([r.remainder for r in records], [' ""  ', ' " \u00c9tage " ', " other tail "])
        self.assertEqual(sum(d.code == "pens_remainder_unresolved"
                             for d in result.diagnostics), 1)

    def test_unicode_encodings(self):
        for encoding in ("utf-8-sig", "utf-16", "utf-32"):
            result = self.load('.L 1\n1 25 "\u00e9\u4e2d\u2028x"\n', encoding)
            assert result.data is not None
            record = result.data.lines[-1].record
            assert record is not None
            self.assertEqual(record.remainder, ' "\u00e9\u4e2d\u2028x"')

    def test_explicit_legacy_encoding(self):
        self.path.write_bytes((HEADER + '.L 1\n1 25 "\u00e9"\n').encode("cp1252"))
        self.assertEqual(read_pens_file(self.path, "std").state, Availability.UNAVAILABLE)
        result = read_pens_file(self.path, "std", encoding_hint="cp1252")
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_invalid_lines_and_unknown_sections_not_reassigned(self):
        result = self.load(".L 2\nnonsense\n7 25\n.X 1\n42 35\n.L 1\n9 50\n")
        assert result.data is not None
        self.assertEqual(result.data.lines[6].kind, "unknown")
        self.assertIsNone(result.data.lines[6].record)
        self.assertIn("pens_code_unresolved", [d.code for d in result.diagnostics])
        self.assertIn("pens_section_unknown", [d.code for d in result.diagnostics])
        self.assertEqual(result.data.lines[-1].section, 8)

    def test_declared_count_mismatch_each_section(self):
        result = self.load(".L 2\n1 25\n.L 0\n2 35\n")
        self.assertEqual(sum(d.code == "pens_count_mismatch" for d in result.diagnostics), 2)

    def test_incompatible_signature_or_missing_section_is_unavailable(self):
        for text in ("", "random\n1 25\n", HEADER + "1 25\n",
                     HEADER.replace("1.0", "2.0") + ".L 1\n1 25\n",
                     HEADER + "//MODULE = LINETHICKNESSES\n.L 1\n1 25\n"):
            self.path.write_bytes(text.encode("utf-8"))
            result = read_pens_file(self.path, "std")
            self.assertEqual(result.state, Availability.UNAVAILABLE)
            assert result.data is not None
            self.assertEqual(result.data.text, text)

    def test_empty_section_not_success_substitute(self):
        self.assertEqual(self.load(".L 0\n").state, Availability.UNAVAILABLE)

    def test_raw_comments_blank_lines_and_endings_reconstruct(self):
        text = HEADER + '//ID value "description"\r.L 1\n\n 7\t 25  \r'
        self.path.write_bytes(text.encode("utf-8"))
        result = read_pens_file(self.path, "std")
        assert result.data is not None
        self.assertEqual("".join(line.raw for line in result.data.lines), text)
        self.assertEqual(result.data.text, text)
        self.assertEqual(result.data.provenance.path, self.path)

    def test_missing_inaccessible_and_decode_failure(self):
        self.assertEqual(read_pens_file(self.path, "std").state, Availability.UNAVAILABLE)
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            self.assertIn("file_access", [d.code for d in read_pens_file(self.path, "std").diagnostics])
        self.path.write_bytes(codecs.BOM_UTF16_LE + b"\x00")
        self.assertIn("decode_failed", [d.code for d in read_pens_file(self.path, "std").diagnostics])

    def test_independent_sources_and_integrity(self):
        result = self.load(".L 1\n7 25\n")
        before = hashlib.sha256(self.path.read_bytes()).digest()
        other = self.path.with_name("linethick.def")
        other.write_text(HEADER + ".L 1\n42 35\n", encoding="utf-8")
        etc = read_pens_file(other, "etc")
        read_pens_file(self.path, "std")
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)
        assert result.data is not None and etc.data is not None
        self.assertNotEqual(result.data.lines[-1].record, etc.data.lines[-1].record)
        self.assertEqual(etc.data.provenance.source, "etc")

    def test_numeric_interpretation_rejects_nonfinite_and_locale_without_replacement(self):
        for value in ("NaN", "Infinity", "", '""', "1,25", "0x10", "1e999999999999999999999999"):
            self.assertIsNone(PenRecord("7", value, "").numeric_value)
        self.assertEqual(PenRecord("0007", "+.1250", "").numeric_value, Decimal(".1250"))


if __name__ == "__main__":
    unittest.main()
