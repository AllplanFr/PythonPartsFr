import codecs
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability
from application.core.allplan.readers.objects import read_objects_file


HEADER = "35.0 PFAD STEU OBJNR OBJEKT-NAME\r\n95 -----------------------------------------\r\n"


def row(code, label, pfad="0", steu="11100", ending="\r\n"):
    return f"{pfad:>5} {steu:>5} {code:>5} {label}{ending}"


class ObjectReaderTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "objekt.000"

    def load(self, body, encoding="utf-16"):
        self.path.write_bytes((HEADER + body).encode(encoding))
        return read_objects_file(self.path, "std")

    def test_order_and_noncontiguous_codes_not_line_numbers(self):
        result = self.load(row("42", "B") + row("7", "A"))
        self.assertEqual(result.state, Availability.AVAILABLE)
        assert result.data is not None
        codes = []
        for line in result.data.lines:
            assert line.fields is not None
            codes.append(line.fields.code)
        self.assertEqual(codes, ["42", "7"])
        self.assertEqual([x.provenance.position for x in result.data.lines], [3, 4])

    def test_unicode_and_bom_decodings(self):
        for encoding in ("utf-16", "utf-16-be", "utf-8-sig", "utf-32"):
            with self.subTest(encoding=encoding):
                raw = (HEADER + row("1", "\u00c9tage \u4e2d\u2028suite")).encode(encoding)
                if encoding == "utf-16-be":
                    raw = codecs.BOM_UTF16_BE + raw
                self.path.write_bytes(raw)
                result = read_objects_file(self.path, "std")
                assert result.data is not None
                fields = result.data.lines[0].fields
                assert fields is not None
                self.assertEqual(fields.label, "\u00c9tage \u4e2d\u2028suite")

    def test_explicit_legacy_encoding_hint(self):
        self.path.write_bytes((HEADER + row("1", "\u00c9tage")).encode("cp1252"))
        self.assertEqual(read_objects_file(self.path, "std").state, Availability.UNAVAILABLE)
        result = read_objects_file(self.path, "std", encoding_hint="cp1252")
        assert result.data is not None
        fields = result.data.lines[0].fields
        assert fields is not None
        self.assertEqual(fields.label, "\u00c9tage")

    def test_no_bom_utf16_is_not_guessed(self):
        self.path.write_bytes((HEADER + row("1", "x")).encode("utf-16-le"))
        result = read_objects_file(self.path, "std")
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertIn("encoding_ambiguous", [d.code for d in result.diagnostics])

    def test_leading_zeros_and_all_extra_fields_retained(self):
        result = self.load(row("00007", " A  ", pfad="00008", steu="00101"))
        assert result.data is not None
        fields = result.data.lines[0].fields
        assert fields is not None
        self.assertEqual((fields.pfad, fields.steu, fields.code, fields.label),
                         ("00008", "00101", "00007", " A  "))
        self.assertEqual(fields.raw_fields, ("00008", "00101", "00007"))

    def test_duplicates_and_numeric_collisions_not_merged(self):
        result = self.load(row("00007", "A") + row("7", "B") + row("7", "B"))
        assert result.data is not None
        self.assertEqual(len(result.data.lines), 3)
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertIn("objects_numeric_collision", [d.code for d in result.diagnostics])
        self.assertIn("objects_code_repeated", [d.code for d in result.diagnostics])
        repeated = next(d for d in result.diagnostics if d.code == "objects_code_repeated")
        assert repeated.related is not None
        self.assertEqual(repeated.related.position, 4)

    def test_empty_label_distinct_from_missing_layout(self):
        result = self.load(row("0", "") + "    0 11100     1\r\n")
        assert result.data is not None
        fields = result.data.lines[0].fields
        assert fields is not None
        self.assertEqual(fields.label, "")
        self.assertIsNone(result.data.lines[1].fields)
        self.assertEqual(len(result.data.lines), 2)

    def test_empty_numeric_fields_not_assigned_codes(self):
        result = self.load(row("", "", pfad="", steu=""))
        assert result.data is not None
        fields = result.data.lines[0].fields
        assert fields is not None
        self.assertEqual(fields.code, "")
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertIn("objects_field_empty", [d.code for d in result.diagnostics])

    def test_invalid_lines_preserved_among_valid_ones(self):
        body = row("42", "x") + "\r\nwrong\r\n" + row("7", "y")
        result = self.load(body)
        assert result.data is not None
        self.assertEqual(len(result.data.lines), 4)
        self.assertEqual([x.raw for x in result.data.lines],
                         body.splitlines(keepends=True))
        self.assertEqual(sum(d.code == "objects_line_invalid"
                             for d in result.diagnostics), 2)

    def test_bad_numeric_field_or_separator_not_guessed(self):
        result = self.load(row("ABC", "x") + row("1", "y").replace(" ", "\t", 1))
        assert result.data is not None
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertTrue(all(x.fields is None for x in result.data.lines))

    def test_incompatible_header_empty_or_no_valid_records(self):
        for text in ("", "other format\r\nx\r\n", HEADER, HEADER + "invalid\r\n",
                     HEADER.replace("35.0", "36.0") + row("1", "x")):
            with self.subTest(text=text):
                self.path.write_bytes(text.encode("utf-16"))
                result = read_objects_file(self.path, "std")
                assert result.data is not None
                self.assertEqual(result.state, Availability.UNAVAILABLE)
                self.assertEqual(result.data.text, text)

    def test_raw_text_headers_endings_and_provenance(self):
        body = row("7", " A ", ending="\n") + row("42", "B", ending="")
        result = self.load(body)
        data = result.data
        assert data is not None
        self.assertEqual(data.text, HEADER + body)
        self.assertEqual("".join(data.header) + "".join(x.raw for x in data.lines), data.text)
        self.assertEqual(data.provenance.path, self.path)
        self.assertEqual(data.lines[1].provenance.source, "std")
        self.assertEqual(data.lines[1].provenance.position, 4)

    def test_missing_and_inaccessible_files(self):
        self.assertEqual(read_objects_file(self.path, "std").state, Availability.UNAVAILABLE)
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            result = read_objects_file(self.path, "std")
        self.assertIn("file_access", [d.code for d in result.diagnostics])
        self.assertIsNone(result.data)

    def test_invalid_encoding_is_explicit(self):
        self.path.write_bytes(codecs.BOM_UTF16_LE + b"\x00")
        result = read_objects_file(self.path, "std")
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertIn("decode_failed", [d.code for d in result.diagnostics])

    def test_read_only_file_integrity(self):
        self.load(row("7", " exact "))
        before = self.path.read_bytes()
        result = read_objects_file(self.path, "std")
        assert result.data is not None
        fields = result.data.lines[0].fields
        assert fields is not None
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(),
                         hashlib.sha256(before).digest())
        self.assertEqual(fields.label, " exact ")


if __name__ == "__main__":
    unittest.main()
