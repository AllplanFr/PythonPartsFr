from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from application.core.context import LaunchContext
from application.core.allplan.models import Availability, ReadResult
from application.core.allplan.sources import SourceSelection
from application.plugins.smartcatalog.attribute_references import load_attribute_references
from application.plugins.smartcatalog.trades import build_trade_references


class TradeReferenceTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.etc = self.root / "Etc"
        self.std = self.root / "Std"
        for directory in (self.etc, self.std):
            (directory / "Xml").mkdir(parents=True)
        self.context = LaunchContext(allplan_version="2026",
                                     paths={"ETC": self.etc, "STD": self.std})

    def load(self, items="", number="209", datatype="E", control="Enumeration"):
        path = self.etc / "Xml" / "AttributeDefinitionCollectionAllplan_fr.xml"
        path.write_text(
            '<AttributeDefinitionCollection><AttributeDefinition>'
            f'<Ifnr>{number}</Ifnr><Uid>uid</Uid><Text>Trade</Text>'
            f'<Datatype>{datatype}</Datatype><Group>8</Group>'
            f'<{control}>{items}</{control}>'
            '</AttributeDefinition></AttributeDefinitionCollection>', encoding="utf-8",
        )
        return load_attribute_references(
            self.context, SourceSelection("attributes", "std", self.std), "fr",
        )

    def test_noncontiguous_codes_not_positions_and_exact_order(self):
        source = self.load(
            '<Item><Key>42</Key><Value>B</Value></Item>'
            '<Item><Key>7</Key><Value>A</Value></Item>'
        )
        result = build_trade_references(source)
        self.assertEqual([o.code for o in result.data.options], ["42", "7"])
        self.assertEqual([o.position for o in result.data.options], [1, 2])
        self.assertEqual([o.label for o in result.data.options], ["B", "A"])

    def test_zero_empty_and_spaces_preserved(self):
        result = build_trade_references(self.load(
            '<Item><Key>0</Key><Value/></Item>'
            '<Item><Key>0007</Key><Value> A </Value></Item>'
        ))
        self.assertEqual(result.data.options[0].code, "0")
        self.assertEqual(result.data.options[0].label, "")
        self.assertEqual(result.data.options[1].code, "0007")
        self.assertEqual(result.data.options[1].label, " A ")

    def test_duplicate_codes_and_labels_preserved_with_diagnostics(self):
        result = build_trade_references(self.load(
            '<Item><Key>7</Key><Value>A</Value></Item>' * 2 +
            '<Item><Key>42</Key><Value>A</Value></Item>'
        ))
        self.assertEqual(len(result.data.options), 3)
        self.assertIn("trades_code_repeated",
                      [d.code for d in result.data.options[1].diagnostics])
        self.assertIn("trades_label_repeated",
                      [d.code for d in result.data.options[2].diagnostics])
        self.assertEqual(result.state, Availability.WITH_DIAGNOSTICS)

    def test_missing_code_not_replaced_by_position(self):
        result = build_trade_references(self.load('<Item><Value>Label</Value></Item>'))
        self.assertIsNone(result.data.options[0].code)
        self.assertEqual(result.data.options[0].position, 1)
        self.assertIn("trades_code_missing", [d.code for d in result.diagnostics])

    def test_empty_and_atypical_codes_remain_exact(self):
        result = build_trade_references(self.load(
            '<Item><Key/><Value>x</Value></Item>'
            '<Item><Key> CODE </Key><Value>y</Value></Item>'
        ))
        self.assertEqual([o.code for o in result.data.options], ["", " CODE "])
        self.assertEqual(sum(d.code == "trades_code_atypical"
                             for d in result.diagnostics), 2)

    def test_missing_label_distinct_from_empty(self):
        result = build_trade_references(self.load(
            '<Item><Key>1</Key></Item><Item><Key>0</Key><Value/></Item>'
        ))
        self.assertEqual([o.label for o in result.data.options], [None, ""])
        self.assertIn("trades_label_missing", [d.code for d in result.diagnostics])

    def test_definition_absent(self):
        source = self.load(number="83")
        result = build_trade_references(source)
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(result.data.options, ())
        self.assertEqual(result.data.definitions, ())
        self.assertIs(result.data.source, source)

    def test_definition_uninterpretable_retains_raw_occurrences(self):
        source = self.load(datatype="P")
        result = build_trade_references(source)
        self.assertEqual(result.state, Availability.UNAVAILABLE)
        self.assertEqual(len(result.data.definitions), 1)
        self.assertIsNone(result.data.selected)
        self.assertEqual(result.data.definitions[0].xml.value("Datatype"), "P")

    def test_wrong_control_and_datatype_refused(self):
        for datatype, control in (("C", "ComboBox"), ("E", "TextBox")):
            with self.subTest(control=control):
                result = build_trade_references(self.load(datatype=datatype, control=control))
                self.assertEqual(result.state, Availability.UNAVAILABLE)
                self.assertIsNotNone(result.data.selected)

    def test_provenance_exact_item_path_and_source_unchanged(self):
        source = self.load('<Item><Key>7</Key><Value> x </Value></Item>')
        before = deepcopy(source)
        with patch.object(Path, "open", side_effect=AssertionError("No file reads allowed")):
            result = build_trade_references(source)
        self.assertEqual(source, before)
        self.assertIs(result.data.source, source)
        assert result.data.selected is not None
        self.assertEqual(result.data.options[0].provenance, result.data.selected.provenance)
        self.assertEqual(result.data.options[0].element_path, (6, 1))

    def test_unavailable_source_and_empty_enumeration_distinct(self):
        failed = build_trade_references(ReadResult(None, state=Availability.UNAVAILABLE))
        self.assertEqual(failed.state, Availability.UNAVAILABLE)
        source = self.load()
        empty = build_trade_references(source)
        self.assertEqual(empty.state, Availability.AVAILABLE)
        self.assertEqual(empty.data.options, ())
        self.assertEqual(build_trade_references(
            replace(source, state=Availability.UNAVAILABLE)).state, Availability.UNAVAILABLE)

    def test_repeated_properties_and_unknown_control_children_retained(self):
        source = self.load(
            '<Other/><Item><Key>7</Key><Key>8</Key>'
            '<Value>a</Value><Value>b</Value></Item>'
        )
        result = build_trade_references(source)
        self.assertEqual(len(result.data.options), 1)
        option = result.data.options[0]
        self.assertEqual(option.position, 2)
        self.assertEqual(len(option.source.xml.fields("Key")), 2)
        self.assertEqual(len(option.source.xml.fields("Value")), 2)
        self.assertIn("trades_property_repeated", [d.code for d in option.diagnostics])
        self.assertIn("trades_item_unsupported", [d.code for d in result.diagnostics])


if __name__ == "__main__":
    unittest.main()
