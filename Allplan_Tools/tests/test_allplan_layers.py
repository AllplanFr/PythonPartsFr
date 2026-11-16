import codecs
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.allplan.models import Availability
from application.core.allplan.readers.layers import read_layers_file


def record(token="00042", name=" Nom ", short=" C ", extra="          0"):
    return f" @{name}@{short}@{token}@-1@99@255@{extra}@\r\n"


class LayerReaderTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root / "layerdef.dat"

    def load(self, text, encoding="utf-16"):
        self.path.write_bytes(text.encode(encoding))
        result = read_layers_file(self.path, "std")
        assert result.data is not None
        return result

    def test_order_scopes_and_noncontiguous_textual_candidates(self):
        text = "g@ G @\r\nb@ B @\r\n" + record() + record("7") + "b@ B2 @\r\n" + record("9") + "e\r\n"
        result = self.load(text)
        assert result.data is not None
        lines = result.data.lines
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)  # repeated short token
        self.assertEqual([x.marker for x in lines], ["g", "b", " ", " ", "b", " ", "e"])
        self.assertEqual([lines[i].fields[2] for i in (2, 3, 5)], ["00042", "7", "9"])
        self.assertEqual([(lines[i].section_g, lines[i].section_b) for i in (2, 3, 5)],
                         [(1, 2), (1, 2), (1, 5)])

    def test_new_g_resets_b_and_preserves_empty_sections(self):
        result = self.load("g@A@\nb@B@\ng@A@\nb@@\ne")
        assert result.data is not None
        self.assertEqual(result.data.lines[2].section_b, None)
        self.assertEqual(result.data.lines[3].fields, ("",))
        self.assertEqual(len(result.data.lines), 5)

    def test_unicode_encodings_and_unicode_line_separator_in_field(self):
        for encoding in ("utf-16", "utf-8-sig", "utf-32"):
            result = self.load("g@\u00c9\u4e2d@\nb@B@\n" + record(name="\u00e9\u2028x") + "e", encoding)
            assert result.data is not None
            self.assertEqual(result.data.lines[2].fields[0], "\u00e9\u2028x")

    def test_big_endian_bom(self):
        self.path.write_bytes(codecs.BOM_UTF16_BE + "g@A@\ne".encode("utf-16-be"))
        self.assertEqual(read_layers_file(self.path, "std").state, Availability.AVAILABLE)

    def test_no_bom_requires_explicit_hint(self):
        self.path.write_bytes("g@A@\ne".encode("utf-16-le"))
        self.assertEqual(read_layers_file(self.path, "std").state, Availability.UNAVAILABLE)
        self.assertEqual(read_layers_file(self.path, "std", encoding_hint="utf-16-le").state,
                         Availability.AVAILABLE)

    def test_special_values_extra_field_and_exact_spaces(self):
        result = self.load("g@ A @\nb@ B @\n" + record(extra=" -999 ") + "e")
        assert result.data is not None
        self.assertEqual(result.data.lines[2].fields,
                         (" Nom ", " C ", "00042", "-1", "99", "255", " -999 "))
        self.assertEqual(result.state, Availability.AVAILABLE)

    def test_duplicates_are_occurrences_not_overwrites(self):
        result = self.load("g@A@\nb@B@\n" + record() * 2 + "e")
        assert result.data is not None
        self.assertEqual(len(result.data.lines), 5)
        self.assertEqual(sum(d.code == "layers_candidate_repeated" for d in result.diagnostics), 2)
        self.assertEqual(result.data.lines[3].provenance.position, 4)

    def test_empty_fields_distinct_from_absent(self):
        result = self.load("g@A@\nb@B@\n @@@@@@@@\n @a@b@\ne")
        assert result.data is not None
        self.assertEqual(result.data.lines[2].fields, ("",) * 7)
        self.assertEqual(result.data.lines[3].fields, ("a", "b"))
        self.assertIn("layers_numeric_field_unresolved", [d.code for d in result.diagnostics])
        self.assertIn("layers_line_invalid", [d.code for d in result.diagnostics])

    def test_unknown_section_breaks_scope_without_erasing_fields(self):
        result = self.load("g@A@\nb@B@\nx@unknown@@\n" + record() + "e")
        assert result.data is not None
        self.assertEqual(result.data.lines[2].fields, ("unknown", ""))
        self.assertIsNone(result.data.lines[3].section_g)
        self.assertIn("layers_record_orphan", [d.code for d in result.diagnostics])

    def test_invalid_separator_and_extra_fields_retained(self):
        result = self.load("g@A@\nb@B@\n @a@b@7@1@1@1@0@extra@\n @a@b\n\ne")
        assert result.data is not None
        self.assertEqual(result.data.lines[2].fields[-1], "extra")
        self.assertFalse(result.data.lines[3].terminated)
        self.assertEqual(result.data.lines[4].raw, "\n")

    def test_orphans_and_end_rules(self):
        for text, code in [
            ("g@A@\n" + record() + "e", "layers_record_orphan"),
            ("b@B@\ng@A@\ne", "layers_section_orphan"),
            ("g@A@\n", "layers_end_missing"),
            ("g@A@\ne\n" + record(), "layers_after_end"),
        ]:
            result = self.load(text)
            self.assertIn(code, [d.code for d in result.diagnostics])

    def test_unknown_empty_or_incompatible_is_not_empty_success(self):
        for text in ("", "other format\n", "g@unterminated\ne"):
            result = self.load(text)
            self.assertEqual(result.state, Availability.UNAVAILABLE)

    def test_raw_reconstruction_and_provenance(self):
        text = "g@ A @\rb@ B @\r\n" + record() + "e"
        result = self.load(text)
        assert result.data is not None
        self.assertEqual(result.data.text, text)
        self.assertEqual("".join(x.raw for x in result.data.lines), text)
        self.assertEqual(result.data.lines[2].provenance.path, self.path)
        self.assertEqual(result.data.lines[2].provenance.source, "std")

    def test_sources_independent_no_implicit_merge_or_priority(self):
        etc = self.root / "layerbas.dat"
        etc.write_text("g@ETC@\ne", encoding="utf-16")
        self.path.write_text("g@STD@\ne", encoding="utf-16")
        left = read_layers_file(etc, "etc")
        right = read_layers_file(self.path, "std")
        assert left.data is not None and right.data is not None
        self.assertEqual(left.data.lines[0].fields, ("ETC",))
        self.assertEqual(right.data.lines[0].fields, ("STD",))

    def test_missing_inaccessible_and_invalid_encoding(self):
        self.assertEqual(read_layers_file(self.path, "std").state, Availability.UNAVAILABLE)
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            result = read_layers_file(self.path, "std")
        self.assertIn("file_access", [d.code for d in result.diagnostics])
        self.path.write_bytes(codecs.BOM_UTF16_LE + b"\x00")
        self.assertIn("decode_failed", [d.code for d in read_layers_file(self.path, "std").diagnostics])

    def test_integrity(self):
        self.load("g@A@\nb@B@\n" + record() + "e")
        before = hashlib.sha256(self.path.read_bytes()).digest()
        read_layers_file(self.path, "std")
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).digest(), before)


if __name__ == "__main__":
    unittest.main()
