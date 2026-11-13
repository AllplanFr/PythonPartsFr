from dataclasses import replace
import hashlib
import logging
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.context import LaunchContext
from application.core.allplan.models import Availability
from application.core.allplan.sources import SourceSelection
from application.plugins.smartcatalog.attribute_references import load_attribute_references


def definition(number="83", uid="uid", datatype="C", group="8", extra="", label="Label"):
    return (
        f"<AttributeDefinition><Ifnr>{number}</Ifnr><Uid>{uid}</Uid>"
        f"<Text>{label}</Text><Datatype>{datatype}</Datatype><Group>{group}</Group>"
        f"{extra}</AttributeDefinition>"
    )


class AttributeReferenceTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.etc, self.std, self.project = (self.root / p for p in ("Etc", "Std", "Project"))
        for directory in (self.etc, self.std, self.project):
            (directory / "Xml").mkdir(parents=True)
        self.context = LaunchContext(allplan_version="2026", allplan_language="eng",
                                     paths={"ETC": self.etc, "STD": self.std})
        self.selection = SourceSelection("attributes", "std", self.std)

    @staticmethod
    def xml(directory, name, entries, root="AttributeDefinitionCollection"):
        path = directory / "Xml" / name
        path.write_text(f"<{root}>{entries}</{root}>", encoding="utf-8")
        return path

    def system(self, entries=None, language="fr"):
        return self.xml(self.etc, f"AttributeDefinitionCollectionAllplan_{language}.xml",
                        definition() if entries is None else entries)

    def load(self, language="fr", context=None, selection=None):
        return load_attribute_references(context or self.context,
                                         selection or self.selection, language)

    def test_explicit_std_context_and_no_project_selection(self):
        path = self.system()
        result = self.load()
        assert result.data is not None
        self.assertEqual(result.state, Availability.AVAILABLE)
        self.assertEqual(result.data.allplan_version, "2026")
        self.assertEqual(result.data.directory, self.std)
        self.assertEqual(result.data.files.language, "fr")
        self.assertEqual(result.data.selected["83"].source.provenance.path, path)
        self.assertIsNone(self.context.project_path)

    def test_context_mismatch_or_missing_installation_refused(self):
        for context, selection in (
            (replace(self.context, allplan_version=None), self.selection),
            (self.context, SourceSelection("attributes", "std", self.project)),
            (self.context, SourceSelection("layers", "std", self.std)),
            (self.context, SourceSelection("attributes", "project", self.project)),
        ):
            with self.subTest(selection=selection):
                result = self.load(context=context, selection=selection)
                self.assertIsNone(result.data)
                self.assertEqual(result.diagnostics[-1].code, "reference_context_invalid")

    def test_project_source_requires_explicit_project_and_attr_prj(self):
        self.system()
        self.xml(self.project, "AttributeDefinitionCollectionLocal.xml",
                 definition("2000", uid="project"))
        context = replace(self.context, project_path=self.project)
        selection = SourceSelection("attributes", "project", self.project)
        config = self.project / "project.cfg"
        for text in ("", "ATTR=STD", "ATTR=PRJ\nATTR=STD"):
            config.write_text(text, encoding="utf-8")
            self.assertIsNone(self.load(context=context, selection=selection).data)
        config.write_text("ATTR=PRJ", encoding="utf-8")
        result = self.load(context=context, selection=selection)
        assert result.data is not None
        self.assertEqual(result.data.selected["2000"].source.provenance.source, "project")
        self.assertEqual(result.data.directory, self.project)

    def test_languages_application_then_allplan_then_english(self):
        self.system(language="en")
        self.system(definition(label="Deutsch"), language="de")
        self.system(definition(label="Francais"), language="fr")
        for app, allplan, expected in (("fra", "deu", "fr"),
                                       ("ita", "deu", "de"), ("ita", "spa", "en")):
            result = self.load(app, replace(self.context, allplan_language=allplan))
            assert result.data is not None
            self.assertEqual(result.data.files.language, expected)

    def test_no_admissible_language_is_unavailable(self):
        self.system(language="de")
        self.assertIsNone(self.load().data)

    def test_first_valid_priority_collision_and_no_aim_filter(self):
        self.system(definition("83", uid="system", group="8") +
                    definition("2000", uid="", group="8"))
        self.xml(self.etc, "AttributeDefinitionCollectionExtra_fr.xml",
                 definition("02000", uid="valid-extra", group="8"))
        self.xml(self.std, "AttributeDefinitionCollectionLocal.xml",
                 definition("83", uid="custom", group="65536") +
                 definition("2001", uid="custom-only", group="8"))
        result = self.load()
        assert result.data is not None
        self.assertEqual(set(result.data.selected), {"83", "2000", "2001"})
        self.assertEqual(result.data.selected["83"].interpreted.uid, "system")
        self.assertEqual(result.data.selected["2000"].source.xml.value("Ifnr"), "02000")
        self.assertEqual(sum(len(c.definitions) for c in result.data.collections), 5)
        self.assertTrue({"uid_conflict", "invalid_definition"} <=
                        {d.code for d in result.diagnostics})

    def test_unsuffixed_custom_file_wins_and_other_language_excluded(self):
        self.system()
        for suffix, num in (("", "2000"), ("_fr", "2001"), ("_de", "2002")):
            self.xml(self.std, f"AttributeDefinitionCollectionLocal{suffix}.xml",
                     definition(num))
        result = self.load()
        assert result.data is not None
        self.assertEqual(set(result.data.selected), {"83", "2000"})

    def test_source_types_units_constraints_and_properties_are_exact(self):
        self.system(definition(
            datatype="R", label=" Label ", extra=(
                '<Unit> EUR </Unit><MinValue> 0.000 </MinValue><MaxValue>12.500</MaxValue>'
                '<Modify>false</Modify><Visible>true</Visible>'
                '<TextBox custom="keep"/><Formula> @83@ </Formula>'
            ),
        ))
        result = self.load()
        assert result.data is not None
        selected = result.data.selected["83"]
        self.assertEqual(selected.source.xml.value("Text"), " Label ")
        self.assertEqual(selected.source.xml.value("Unit"), " EUR ")
        self.assertEqual(selected.source.xml.value("MinValue"), " 0.000 ")
        self.assertEqual(selected.source.xml.fields("TextBox")[0].attributes, (("custom", "keep"),))
        self.assertEqual(selected.interpreted.datatype, "R")
        self.assertFalse(selected.interpreted.modify)
        self.assertEqual(selected.interpreted.formulas, (" @83@ ",))

    def test_absent_and_empty_properties_remain_distinct(self):
        self.system(definition(extra="<Unit/><Comment/>"))
        result = self.load()
        assert result.data is not None
        raw = result.data.selected["83"].source.xml
        self.assertEqual(raw.value("Unit"), "")
        self.assertEqual(raw.value("Comment"), "")
        self.assertIsNone(raw.value("MaxValue"))
        self.assertEqual(raw.fields("Unit")[0].children, ())

    def test_options_codes_labels_empty_values_and_order_preserved(self):
        self.system(definition(datatype="E", extra=(
            '<Enumeration><Item><Key>7</Key><Value> A </Value></Item>'
            '<Item><Key>0</Key><Value/></Item>'
            '<Item><Key>42</Key><Value> A </Value></Item>'
            '<Item><Key>42</Key><Value>duplicate</Value></Item>'
            '<Item><Key>8</Key></Item></Enumeration>'
        )))
        result = self.load()
        assert result.data is not None
        options = result.data.selected["83"].source.options
        self.assertEqual([o.code for o in options], ["7", "0", "42", "42", "8"])
        self.assertEqual([o.label for o in options], [" A ", "", " A ", "duplicate", None])
        self.assertEqual([o.position for o in options], [1, 2, 3, 4, 5])
        self.assertTrue({"invalid_proposition", "duplicate_proposition"} <=
                        {d.code for d in result.diagnostics})

    def test_combo_keys_not_replaced_by_positions(self):
        self.system(definition(extra=(
            '<ComboBox><Item><Key>CODE</Key><Value>label</Value></Item>'
            '<Item><Value/></Item><Item><Key/><Value>x</Value></Item></ComboBox>'
        )))
        result = self.load()
        assert result.data is not None
        self.assertEqual([o.code for o in result.data.selected["83"].source.options],
                         ["CODE", None, ""])

    def test_group_masks_not_frontend_indices_unknown_bits_retained(self):
        self.system(definition(group=str((1 << 3) | (1 << 60))))
        result = self.load()
        assert result.data is not None
        self.assertEqual([g.bit for g in result.data.groups], [3, 60])
        self.assertEqual(result.data.groups[0].technical_id, "ATTR_PRG_BEREICH_ARCHALLG")
        self.assertIsNone(result.data.groups[1].technical_id)
        self.assertIn("group_bits_unknown", [d.code for d in result.diagnostics])

    def test_unsupported_source_type_kept_but_not_coerced(self):
        self.system(definition("50", datatype="P") + definition())
        result = self.load()
        assert result.data is not None
        self.assertEqual(set(result.data.selected), {"83"})
        self.assertEqual(result.data.collections[0].definitions[0].xml.value("Datatype"), "P")
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)

    def test_interpreted_types_are_not_frontend_type_coercions(self):
        for datatype in ("C", "R", "I", "D", "E"):
            with self.subTest(datatype=datatype):
                self.system(definition(datatype=datatype))
                result = self.load()
                assert result.data is not None
                entry = result.data.selected["83"]
                self.assertEqual(entry.source.xml.value("Datatype"), datatype)
                self.assertEqual(entry.interpreted.datatype, datatype)

    def test_partial_custom_invalid_and_invalid_entries(self):
        self.system(definition() + definition("203", datatype="invalid"))
        self.xml(self.std, "AttributeDefinitionCollectionLocal.xml", "unclosed<")
        result = self.load()
        assert result.data is not None
        self.assertIn("83", result.data.selected)
        self.assertNotIn("203", result.data.selected)
        self.assertIn("reference_xml_invalid", [d.code for d in result.diagnostics])

    def test_missing_invalid_or_incompatible_mandatory_file(self):
        self.assertIsNone(self.load().data)
        path = self.system()
        for content in ("<broken", "<Wrong/>", '<!DOCTYPE x><AttributeDefinitionCollection/>'):
            path.write_text(content, encoding="utf-8")
            self.assertIsNone(self.load().data)

    def test_repeated_properties_and_unknown_collection_children_preserved(self):
        self.system(definition(extra="<Unit>a</Unit><Unit>b</Unit>") + "<Other value='x'/>")
        result = self.load()
        assert result.data is not None
        self.assertEqual([p.text for p in result.data.selected["83"].source.xml.fields("Unit")],
                         ["a", "b"])
        self.assertEqual(result.data.collections[0].xml.children[-1].tag, "Other")
        self.assertTrue({"reference_property_repeated", "reference_collection_child_unsupported"} <=
                        {d.code for d in result.diagnostics})

    def test_inaccessible_custom_file(self):
        self.system()
        path = self.xml(self.std, "AttributeDefinitionCollectionLocal.xml", definition("2000"))
        original = Path.read_bytes

        def read_bytes(p):
            if p == path:
                raise PermissionError
            return original(p)

        with patch.object(Path, "read_bytes", read_bytes):
            result = self.load()
        assert result.data is not None
        self.assertNotIn("2000", result.data.selected)
        self.assertIn("reference_file_unavailable", [d.code for d in result.diagnostics])

    def test_source_changed_during_read_is_unavailable(self):
        self.system()
        with patch("application.plugins.smartcatalog.attribute_references.hashlib.sha256") as digest:
            digest.return_value.hexdigest.side_effect = ["before", "after"]
            result = self.load()
        self.assertIsNone(result.data)
        self.assertIn("reference_source_changed", [d.code for d in result.diagnostics])

    def test_unchanged_files_and_safe_diagnostics(self):
        path = self.system(definition(datatype="P", label="PRIVATE_LABEL") + definition("207"))
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        with self.assertLogs("application.core.allplan.models", level=logging.WARNING) as logs:
            result = self.load()
        assert result.data is not None
        self.assertEqual(result.data.collections[0].sha256, before)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
        self.assertNotIn("PRIVATE_LABEL", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main()
