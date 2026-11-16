import codecs
import os
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.context import LaunchContext, context_from_arguments, context_to_arguments
from application.launcher.main import create_parser
from application.core.allplan.models import (
    Availability, Proposition, Provenance, ReadResult, group_ids,
)
from application.core.allplan.sources import read_project_config, resolve_sources
from application.core.allplan.readers.attributes import (
    discover_attributes, read_attribute_file, read_attributes,
)
from application.core.allplan.readers.asw import (
    AswDirectory, compose_propositions, read_asw_attribute, read_asw_file,
    resolve_asw_directory,
)
from application.core.allplan.text import read_text


def attribute(number="2000", uid="first", label="Label", extra=""):
    return (
        f"<AttributeDefinition><Ifnr>{number}</Ifnr><Uid>{uid}</Uid>"
        f"<Text>{label}</Text><Datatype>C</Datatype><Group>5</Group>"
        f"{extra}</AttributeDefinition>"
    )


class ReaderTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory(prefix="donnees espaces ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "Données été"
        self.root.mkdir()
        self.etc, self.std, self.project = (
            self.root / name for name in ("Etc", "Std", "Projet.prj")
        )
        for directory in (self.etc, self.std, self.project):
            (directory / "Xml").mkdir(parents=True)
        self.context = LaunchContext(
            allplan_version="2026", paths={"ETC": self.etc, "STD": self.std,
                                          "PRJ": self.root / "Prj"},
            project_path=self.project, allplan_language="deu",
        )

    def xml(self, directory, name, entries, encoding="utf-8"):
        path = directory / "Xml" / name
        content = f'<?xml version="1.0" encoding="{encoding}"?><Attributes>{entries}</Attributes>'
        path.write_bytes(content.encode(encoding))
        return path

    def system(self, entries=None, language="fr"):
        return self.xml(self.etc, f"AttributeDefinitionCollectionAllplan_{language}.xml",
                        attribute() if entries is None else entries)

    def load(self, language="fr"):
        sources = resolve_sources(self.context)
        return read_attributes(discover_attributes(self.context, sources["attributes"], language))

    def test_unsupported_type_is_not_reported_as_invalid_definition(self):
        for datatype in ("B", "P", "S", "Y"):
            path = self.system(attribute().replace("<Datatype>C</Datatype>",
                                                  f"<Datatype>{datatype}</Datatype>"))
            before = path.read_bytes()
            result = read_attribute_file(path, "etc")
            self.assertEqual(result.data, ())
            self.assertEqual([d.code for d in result.diagnostics],
                             ["unsupported_definition_type"])
            self.assertEqual(result.diagnostics[0].attribute_number, "2000")
            self.assertEqual(path.read_bytes(), before)
        path = self.system(attribute(uid="").replace("<Datatype>C</Datatype>",
                                                    "<Datatype>B</Datatype>"))
        self.assertEqual(read_attribute_file(path, "etc").diagnostics[0].code,
                         "invalid_definition")

    def test_category_keys_are_independent(self):
        (self.project / "project.cfg").write_text(
            "ATTR=PRJ\nASW=STD\nLAYER=PRJ\nMUSTER=STD\nSTIFT=PRJ\nPEN=STD\n"
        )
        sources = resolve_sources(self.context)
        self.assertEqual(sources["attributes"].directory, self.project)
        self.assertEqual(sources["asw"].directory, self.std)
        self.assertEqual(sources["layers"].kind, "project")
        self.assertEqual(sources["patterns"].kind, "std")
        self.assertEqual(sources["hatching"].kind, "std")
        self.assertEqual(sources["surface_styles"].kind, "std")
        self.assertEqual(sources["pens"].kind, "project")
        self.assertEqual(sources["line_types"].kind, "std")

    def test_missing_empty_invalid_and_conflicting_config_use_std(self):
        path = self.project / "project.cfg"
        for content in (None, "", "ATTR=unknown", "ATTR=PRJ\nATTR=STD", "ATTR"):
            if content is not None:
                path.write_text(content)
            with self.subTest(content=content):
                source = resolve_sources(self.context)["attributes"]
                self.assertEqual(source.kind, "std")
                self.assertTrue(source.diagnostics)
        with patch.object(Path, "read_bytes", side_effect=PermissionError):
            self.assertEqual(resolve_sources(self.context)["asw"].kind, "std")

    def test_no_project_never_uses_prj_root_or_catalog_path(self):
        context = replace(self.context, project_path=None, catalog_user_path=self.project)
        self.assertEqual(resolve_sources(context)["attributes"].directory, self.std)

    def test_duplicate_identical_config_and_unknown_keys(self):
        (self.project / "project.cfg").write_text(
            "[Settings]\n# comment\nATTR = PRJ\nATTR=PRJ\nX=PRJ\n"
        )
        self.assertEqual(read_project_config(self.project).data, {"ATTR": "PRJ"})

    def test_xml_etc_then_only_selected_customization(self):
        self.system()
        self.xml(self.std, "AttributeDefinitionCustom.xml", attribute("3000"))
        self.xml(self.project, "AttributeDefinitionCustom.xml", attribute("4000"))
        (self.project / "project.cfg").write_text("ATTR=PRJ\nASW=STD")
        self.assertEqual(set(self.load().data), {"2000", "4000"})
        (self.project / "project.cfg").write_text("ATTR=STD\nASW=PRJ")
        self.assertEqual(set(self.load().data), {"2000", "3000"})

    def test_first_valid_and_uid_conflict_always_logged(self):
        self.system(attribute("2000", "one") + attribute("2000", "one"))
        self.xml(self.std, "AttributeDefinitionZ.xml", attribute("02000", "two"))
        with self.assertLogs("application.core.allplan.models", level="WARNING") as logs:
            result = self.load()
        self.assertEqual(result.data["2000"].uid, "one")
        conflicts = [d for d in result.diagnostics if d.code == "uid_conflict"]
        self.assertEqual(len(conflicts), 1)
        self.assertIsNotNone(conflicts[0].suppression_key)
        self.assertIsNotNone(conflicts[0].related)
        self.assertEqual(conflicts[0].uids, ("one", "two"))
        self.assertTrue(any("uid_conflict" in line for line in logs.output))
        self.assertTrue(all(d.suppression_key is None for d in result.diagnostics
                            if d.code != "uid_conflict"))

    def test_deterministic_lexical_custom_order_and_plain_variant(self):
        self.system()
        self.xml(self.std, "AttributeDefinitionB.xml", attribute("3000", "b"))
        self.xml(self.std, "AttributeDefinitionA_fr.xml", attribute("3000", "localized"))
        self.xml(self.std, "AttributeDefinitionA.xml", attribute("3000", "a"))
        self.xml(self.std, "AttributeDefinitionA_de.xml", attribute("3500", "other-language"))
        self.assertEqual(self.load().data["3000"].uid, "a")
        self.assertNotIn("3500", self.load().data)

    def test_language_app_allplan_english_and_no_arbitrary_custom_language(self):
        self.system(language="de")
        self.system(language="en")
        self.xml(self.std, "AttributeDefinitionCustom_fr.xml", attribute("3000"))
        files = discover_attributes(self.context, resolve_sources(self.context)["attributes"], "it")
        self.assertEqual(files.data.language, "de")
        self.assertEqual(files.data.custom, ())
        context = replace(self.context, allplan_language=None)
        files = discover_attributes(context, resolve_sources(context)["attributes"], "it")
        self.assertEqual(files.data.language, "en")

    def test_required_system_file_absent_or_corrupt_is_unavailable(self):
        self.xml(self.std, "AttributeDefinitionCustom.xml", attribute("3000"))
        self.assertEqual(self.load().state, Availability.UNAVAILABLE)
        path = self.system()
        path.write_bytes(b"<broken")
        result = self.load()
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(result.data, {})
        self.assertTrue(any(d.code == "xml_invalid" for d in result.diagnostics))

    def test_invalid_entry_does_not_claim_identity_or_stop_siblings(self):
        self.system(attribute("2000", "") + attribute("2000", "valid")
                    + attribute("2001", extra="<Visible>invalid</Visible>")
                    + attribute("2002"))
        result = self.load()
        self.assertEqual(set(result.data), {"2000", "2002"})
        self.assertEqual(result.data["2000"].uid, "valid")
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)

    def test_properties_booleans_groups_bounds_formula_and_number_ranges(self):
        path = self.system(attribute(extra=(
            "<Modify>false</Modify><Visible>true</Visible><Unit>m</Unit>"
            "<MinValue>-2.5</MinValue><MaxValue>4</MaxValue><Formula>@83@</Formula>"
        )))
        entry = read_attribute_file(path, "etc").data[0]
        self.assertFalse(entry.modify)
        self.assertTrue(entry.visible)
        self.assertEqual(entry.minimum, Decimal("-2.5"))
        self.assertEqual(entry.formulas, ("@83@",))
        self.assertEqual(group_ids(entry.group_mask),
                         ("ATTR_PRG_BEREICH_BENUTZER", "ATTR_PRG_BEREICH_ALLGEMEIN"))
        self.assertEqual(group_ids(1 << 53), ("ATTR_PRG_BEREICH_IMPORT",))
        for number, user, imported in (
            ("1999", False, False), ("2000", True, False), ("11999", True, False),
            ("12000", False, False), ("54999", False, False),
            ("55000", False, True), ("98999", False, True), ("99000", False, False),
        ):
            self.assertEqual((replace(entry, number=number).is_user,
                              replace(entry, number=number).is_imported), (user, imported))

    def test_xml_declared_encoding_and_entities(self):
        path = self.xml(self.etc, "AttributeDefinitionTest.xml",
                        attribute(label="Été"), encoding="windows-1252")
        self.assertEqual(read_attribute_file(path, "etc").data[0].label, "Été")
        path.write_bytes(b'<!DOCTYPE r [<!ENTITY x "bad">]><r>&x;</r>')
        self.assertEqual(read_attribute_file(path, "etc").state, Availability.UNAVAILABLE)

    def test_xml_options_preserve_same_labels_different_keys(self):
        options = "<Enumeration>" + "".join(
            f"<Item><Key>{key}</Key><Value>{text}</Value></Item>"
            for key, text in ((2, "same"), (7, "same"), (2, "ignored"))
        ) + "</Enumeration>"
        entry = read_attribute_file(self.system(attribute(extra=options)), "etc").data[0]
        self.assertEqual([(p.index, p.text) for p in entry.propositions],
                         [(2, "same"), (7, "same")])

    def test_custom_failure_keeps_system_definitions_and_unknown_group_bits(self):
        self.system(attribute().replace("<Group>5</Group>", f"<Group>{1 << 60}</Group>"))
        path = self.xml(self.std, "AttributeDefinitionCustom.xml", attribute("3000"))
        path.write_bytes(b"<broken")
        result = self.load()
        self.assertEqual(set(result.data), {"2000"})
        self.assertEqual(result.data["2000"].group_mask, 1 << 60)
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)
        self.assertTrue(any(d.code == "group_bits_unknown" for d in result.diagnostics))

    def test_valid_empty_system_collection_remains_available(self):
        self.system("")
        (self.project / "project.cfg").write_text("ATTR=STD")
        result = self.load()
        self.assertEqual(result.data, {})
        self.assertEqual(result.state, Availability.AVAILABLE)

    def asw(self, text, number=209):
        path = self.root / f"attrib_{number}.asw"
        path.write_text(text, encoding="utf-8")
        return read_asw_file(path, "project")

    def test_asw_order_cleanup_comments_first_pipe_invalid_and_negative(self):
        result = self.asw("  # comment\n 5 | Two  words | suffix \nplain\nbad|x\n-1|x\n")
        self.assertEqual([(p.index, p.text) for p in result.data],
                         [(5, "Two  words | suffix"), (None, "plain")])
        self.assertEqual({d.code for d in result.diagnostics},
                         {"asw_index_invalid", "asw_negative_one_unresolved"})

    def test_exclusions_before_any_open_in_direct_and_selected_read(self):
        with patch.object(Path, "read_bytes", side_effect=AssertionError("Must not read")):
            for number in (618, 645):
                self.assertEqual(read_asw_file(
                    self.root / f"attrib_{number}.asw", "std").data, ())
                self.assertEqual(read_asw_attribute(ReadResult(AswDirectory(self.root, "std")),
                                                   str(number)).data, ())

    def test_combobox_order_no_sort_and_first_text(self):
        result = compose_propositions(
            (), self.asw("9|Z\n2|A\n7|Z\nB"), kind="combobox", attribute_number="2000"
        )
        self.assertEqual([p.text for p in result.data], ["Z", "A", "B"])

    def test_enum_etc_priority_same_labels_max_index_and_sort(self):
        xml = (Proposition(2, "same", Provenance(self.root, "etc")),
               Proposition(12, "same", Provenance(self.root, "etc")))
        result = compose_propositions(
            xml, self.asw("2|changed\n8|eight\nunindexed\n8|ignored\nnext"),
            kind="enumeration", attribute_number="2000",
        )
        self.assertEqual([(p.index, p.text) for p in result.data],
                         [(2, "same"), (8, "eight"), (12, "same"),
                          (13, "unindexed"), (14, "next")])

    def test_empty_enum_seed_blank_once_and_explicit_zero_preserved(self):
        result = compose_propositions(
            (), self.asw("one\n2|\n|invalid"), kind="enumeration", attribute_number="2000"
        )
        self.assertEqual([(p.index, p.text) for p in result.data],
                         [(0, ""), (1, "one"), (2, "")])
        result = compose_propositions(
            (), self.asw("0|real\nnext"), kind="enumeration", attribute_number="2000"
        )
        self.assertEqual([(p.index, p.text) for p in result.data], [(0, "real"), (1, "next")])

    def test_209_alphabetical_labels_without_reindexing(self):
        result = compose_propositions(
            (), self.asw("3|Z\n7|A"), kind="enumeration", attribute_number="209"
        )
        self.assertEqual([(p.index, p.text) for p in result.data],
                         [(0, ""), (7, "A"), (3, "Z")])

    def test_valid_empty_asw_and_failed_read_are_distinct(self):
        empty = self.asw("")
        self.assertEqual(empty.state, Availability.AVAILABLE)
        missing = read_asw_file(self.root / "attrib_999.asw", "std")
        self.assertEqual(missing.state, Availability.UNAVAILABLE)

    def test_project_unusable_falls_back_but_empty_and_missing_file_do_not(self):
        (self.project / "project.cfg").write_text("ASW=PRJ")
        (self.std / "asw").mkdir()
        (self.std / "asw" / "attrib_209.asw").write_text("std")
        selection = resolve_sources(self.context)["asw"]
        directory = resolve_asw_directory(selection, self.std)
        self.assertEqual(directory.data, AswDirectory(self.std / "asw", "std"))
        self.assertEqual(read_asw_attribute(directory, "209").data[0].provenance.source, "std")
        (self.project / "asw").mkdir()
        self.assertIsNone(resolve_asw_directory(selection, self.std).data)
        (self.project / "asw" / "attrib_2000.asw").write_text("project")
        directory = resolve_asw_directory(selection, self.std)
        result = read_asw_attribute(directory, "209")
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(result.data, ())

    def test_decoding_bom_unicode_empty_and_explicit_windows_hint(self):
        path = self.root / "data.txt"
        for raw in ("Été".encode("utf-8"), codecs.BOM_UTF8 + "Été".encode(),
                    "Été".encode("utf-16"), "".encode()):
            path.write_bytes(raw)
            self.assertEqual(read_text(path, "test").data, "Été" if raw else "")
        path.write_bytes("Été".encode("cp1252"))
        self.assertEqual(read_text(path, "test").state, Availability.UNAVAILABLE)
        self.assertEqual(read_text(path, "test", encoding_hint="cp1252").data, "Été")
        path.write_bytes("Test".encode("utf-16-le"))
        self.assertEqual(read_text(path, "test").diagnostics[0].code, "encoding_ambiguous")
        self.assertEqual(read_text(path, "test", encoding_hint="utf-16-le").data, "Test")

    def test_cwd_does_not_affect_readers(self):
        self.system()
        previous = Path.cwd()
        try:
            os.chdir(self.root)
            self.assertEqual(self.load().data["2000"].uid, "first")
        finally:
            os.chdir(previous)

    def test_xml_empty_missing_access_and_malformed_are_distinct(self):
        path = self.system()
        path.write_bytes(b"")
        self.assertEqual(read_attribute_file(path, "etc").diagnostics[0].code, "xml_empty")
        path.write_bytes(b"<invalid")
        self.assertEqual(read_attribute_file(path, "etc").diagnostics[0].code, "xml_invalid")
        path.unlink()
        self.assertEqual(read_attribute_file(path, "etc").diagnostics[0].code, "file_missing")
        with patch.object(Path, "open", side_effect=PermissionError):
            self.assertEqual(read_attribute_file(path, "etc").diagnostics[0].code, "file_access")

    def test_enum_generated_indices_keep_identity_of_assignment(self):
        result = compose_propositions(
            (), self.asw("9|explicit\nimplicit"), kind="enumeration", attribute_number="2000"
        )
        self.assertEqual([(p.index, p.generated_index) for p in result.data],
                         [(0, True), (9, False), (10, True)])

    def test_context_language_and_diagnostic_roundtrip(self):
        context = replace(self.context, diagnostic=True)
        args = create_parser().parse_args(context_to_arguments(context))
        self.assertEqual(context_from_arguments(args), context)
        self.assertFalse(context_from_arguments(create_parser().parse_args([])).diagnostic)


if __name__ == "__main__":
    unittest.main()
