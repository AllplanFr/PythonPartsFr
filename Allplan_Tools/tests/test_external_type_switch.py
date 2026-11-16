from dataclasses import FrozenInstanceError
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from xml.etree import ElementTree

from application.core.allplan.models import Provenance
from application.core.external_libraries.models import SourceOccurrence, SourceProperty
from application.core.external_libraries.type_switch import (
    ContentType, PresentedOccurrence, PresentedType, SwitchRefusal, prepare_type_scope,
    switch_types,
)


class ExternalTypeSwitchTests(unittest.TestCase):
    @staticmethod
    def roots(xml):
        root = ElementTree.fromstring("<Envelope>" + xml + "</Envelope>")
        ordered = []
        stack = [(root, ())]
        while stack:
            element, location = stack.pop()
            ordered.append((element, location))
            stack.extend((child, (*location, index))
                         for index, child in reversed(tuple(enumerate(element, 1))))
        converted = {}
        for rank, (element, location) in reversed(tuple(enumerate(ordered, 1))):
            converted[id(element)] = SourceOccurrence(
                element.tag, tuple(SourceProperty(k, v) for k, v in element.attrib.items()),
                tuple(converted[id(child)] for child in element), element.text, element.tail,
                (), location, Provenance(Path("synthetic.xml"), "synthetic", rank),
            )
        return converted[id(root)].children

    def view(self, xml):
        return prepare_type_scope(self.roots(xml))

    @staticmethod
    def nodes(scope):
        stack = list(reversed(scope.roots))
        while stack:
            node = stack.pop()
            yield node
            stack.extend(reversed(node.children))

    def test_four_eligible_structures(self):
        for xml, source_type, target in (
            ('<Material name="m"/>', ContentType.MATERIAL, ContentType.COMPONENT),
            ('<Folder><Material name="m"/><Material name="n"/></Folder>',
             ContentType.MATERIAL, ContentType.COMPONENT),
            ('<Component name="c"/>', ContentType.COMPONENT, ContentType.MATERIAL),
            ('<Folder><Component name="c"/><Component name="d"/></Folder>',
             ContentType.COMPONENT, ContentType.MATERIAL),
        ):
            with self.subTest(xml=xml):
                scope = self.view(xml)
                self.assertEqual(scope.metadata.current_type, source_type)
                self.assertTrue(scope.metadata.available)
                self.assertEqual(scope.metadata.target_type, target)
                self.assertIsNone(scope.metadata.refusal)
                result = switch_types(scope)
                self.assertTrue(result.accepted)
                self.assertEqual(result.diagnostics, ())
                self.assertEqual(result.scope.metadata.current_type, target)
                self.assertEqual(result.scope.metadata.target_type, source_type)
                self.assertTrue(result.scope.metadata.available)

    def test_nested_and_empty_folders_preserve_order_without_new_parents(self):
        scope = self.view(
            '<Folder name="outer"><Folder name="empty"/>'
            '<Folder name="nested"><Component name="second"/>'
            '<Component name="first"/></Folder></Folder><Folder name="last"/>'
        )
        result = switch_types(scope)
        self.assertTrue(result.accepted)
        self.assertEqual([n.source.property("name") for n in self.nodes(result.scope)],
                         ["outer", "empty", "nested", "second", "first", "last"])
        self.assertEqual(len(result.scope.roots), 2)
        self.assertEqual(result.scope.roots[0].children[0].children, ())
        self.assertEqual(len(tuple(self.nodes(scope))), len(tuple(self.nodes(result.scope))))
        for before, after in zip(self.nodes(scope), self.nodes(result.scope)):
            self.assertIs(after.source, before.source)
            self.assertEqual(after.occurrence_id, before.occurrence_id)

    def test_attributes_do_not_disqualify_items_or_folders(self):
        for tag in ("Material", "Component"):
            scope = self.view(
                f'<Folder name="f" extra=""><Attribute id="207" value=" folder "/>'
                f'<{tag} name="001" description="exact" unit="m²">'
                '<Attribute id="207" value=" a "/><Attribute id="207" value=""/>'
                '<Attribute id="unknown"><Raw x="v"> a\nb </Raw></Attribute>'
                f'</{tag}></Folder>'
            )
            result = switch_types(scope)
            self.assertTrue(result.accepted)
            for old, new in zip(self.nodes(scope), self.nodes(result.scope)):
                self.assertIs(old.source, new.source)
                if old.presented_type not in (PresentedType.MATERIAL, PresentedType.COMPONENT):
                    self.assertEqual(old.presented_type, new.presented_type)

    def test_legacy_fields_are_preserved_not_converted_to_attributes(self):
        scope = self.view(
            '<Dossier name=" 01 - name "><Composant name="c">'
            '<description> a\nb </description><Unité/><code_externe>0002</code_externe>'
            '<description>repeated</description></Composant></Dossier>'
        )
        result = switch_types(scope)
        self.assertTrue(result.accepted)
        item = result.scope.roots[0].children[0]
        self.assertEqual(item.presented_type, PresentedType.MATERIAL)
        self.assertEqual(item.source.tag, "Composant")
        self.assertEqual([n.source.text for n in item.children], [" a\nb ", None, "0002", "repeated"])
        self.assertEqual([n.source.tag for n in item.children],
                         ["description", "Unité", "code_externe", "description"])

    def test_mixed_content_refused_even_across_different_folders(self):
        scope = self.view('<Folder><Material/></Folder><Folder><Component/></Folder>')
        self.assertEqual(scope.metadata.current_type, ContentType.MIXED)
        self.assertEqual(scope.metadata.refusal, SwitchRefusal.MIXED)
        result = switch_types(scope)
        self.assertFalse(result.accepted)
        self.assertIs(result.scope, scope)
        self.assertIsNone(result.scope.metadata.target_type)
        self.assertEqual(result.diagnostics[0].code, "type_switch_mixed_material_component")

    def test_links_refused_including_links_under_attributes(self):
        for xml in (
            '<Link/>', '<Folder><Material/><Link/></Folder>',
            '<Component><Attribute><Link/></Attribute></Component>',
        ):
            with self.subTest(xml=xml):
                scope = self.view(xml)
                result = switch_types(scope)
                self.assertFalse(result.accepted)
                self.assertIs(result.scope, scope)
                self.assertEqual(scope.metadata.refusal, SwitchRefusal.LINKS)

    def test_structural_children_refused_in_both_directions(self):
        for xml in (
            '<Material><Material/></Material>',
            '<Material><Folder/></Material>',
            '<Material><Component/></Material>',
            '<Component><Component/></Component>',
            '<Component><Folder/></Component>',
            '<Material><Attribute><Folder/></Attribute></Material>',
        ):
            with self.subTest(xml=xml):
                scope = self.view(xml)
                result = switch_types(scope)
                self.assertFalse(result.accepted)
                self.assertIs(result.scope, scope)
                self.assertIn(scope.metadata.refusal,
                              (SwitchRefusal.MIXED, SwitchRefusal.STRUCTURAL_CHILDREN))

    def test_organizing_folders_are_not_incompatible_item_children(self):
        for item_tag in ("Material", "Component"):
            with self.subTest(item_tag=item_tag):
                scope = self.view(
                    '<Folder extra="kept"><Attribute id="1" value="folder"/>'
                    '<Folder name="nested"><Folder name="empty"/>'
                    f'<{item_tag} name="item"><Attribute id="2" value="item"/>'
                    f'</{item_tag}></Folder></Folder>'
                )
                self.assertIsNone(scope.metadata.refusal)
                self.assertTrue(switch_types(scope).accepted)
                incompatible = self.view(
                    f'<Folder><{item_tag}><Folder name="inside-item"/>'
                    f'</{item_tag}></Folder>'
                )
                self.assertEqual(incompatible.metadata.refusal,
                                 SwitchRefusal.STRUCTURAL_CHILDREN)
                self.assertIs(switch_types(incompatible).scope, incompatible)
        misplaced = self.view('<Folder><Attribute><Folder/></Attribute><Material/></Folder>')
        self.assertEqual(misplaced.metadata.refusal, SwitchRefusal.UNKNOWN_STRUCTURE)
        self.assertIs(switch_types(misplaced).scope, misplaced)

    def test_unknown_structure_is_preserved_and_refused(self):
        for xml in (
            '<Wrapper><Material/></Wrapper>',
            '<Folder><Material/><Something/></Folder>',
            '<Component><Unqualified/></Component>',
            '<x:Material xmlns:x="urn:other"/>',
            '<Attribute/>',
            '<Attribute/><Material/>',
        ):
            with self.subTest(xml=xml):
                scope = self.view(xml)
                result = switch_types(scope)
                self.assertFalse(result.accepted)
                self.assertIs(result.scope, scope)
                self.assertIsNotNone(scope.metadata.refusal)

    def test_no_items_empty_scope_empty_folders_or_data_only_are_undetermined(self):
        for xml in ("", "<Folder/>", "<Folder><Folder/></Folder>"):
            with self.subTest(xml=xml):
                scope = self.view(xml)
                self.assertEqual(scope.metadata.current_type, ContentType.UNDETERMINED)
                self.assertEqual(scope.metadata.refusal, SwitchRefusal.NO_ITEMS)
                self.assertFalse(scope.metadata.available)
                self.assertIsNone(scope.metadata.target_type)
                result = switch_types(scope)
                self.assertFalse(result.accepted)
                self.assertIs(result.scope, scope)

    def test_roundtrip_material_component_material_keeps_source_objects(self):
        scope = self.view(
            '<Folder name="f"><Material name="same" code="001" empty="">'
            '<Attribute id="1" value="a"/><Attribute id="1" value="b"/>'
            '</Material><Material name="same" code="001"/></Folder>'
        )
        first = switch_types(scope)
        second = switch_types(first.scope)
        self.assertTrue(first.accepted)
        self.assertTrue(second.accepted)
        self.assertEqual(second.scope, scope)
        self.assertIsNot(first.scope, scope)
        for a, b, c in zip(self.nodes(scope), self.nodes(first.scope), self.nodes(second.scope)):
            self.assertIs(a.source, b.source)
            self.assertIs(a.source, c.source)
            self.assertEqual(a.occurrence_id, b.occurrence_id)
        self.assertEqual(scope.roots[0].children[0].source.property("empty"), "")
        self.assertIsNone(scope.roots[0].children[1].source.property("empty"))

    def test_refused_reverse_after_success_does_not_change_previous_views(self):
        scope = self.view('<Material><Attribute id="1" value="kept"/></Material>')
        converted = switch_types(scope).scope
        constructed = []

        def fail_after_partial_construction(*args):
            if constructed:
                raise RuntimeError("construction failure")
            node = PresentedOccurrence(*args)
            constructed.append(node)
            return node

        with patch("application.core.external_libraries.type_switch.PresentedOccurrence",
                   side_effect=fail_after_partial_construction):
            with self.assertRaisesRegex(RuntimeError, "construction failure"):
                switch_types(converted)
        self.assertEqual(len(constructed), 1)
        self.assertEqual(scope.metadata.current_type, ContentType.MATERIAL)
        self.assertEqual(converted.metadata.current_type, ContentType.COMPONENT)
        self.assertEqual(converted.roots[0].source.tag, "Material")
        self.assertTrue(switch_types(converted).accepted)

    def test_immutable_state(self):
        scope = self.view("<Component/>")
        with self.assertRaises(FrozenInstanceError):
            setattr(scope, "roots", ())
        with self.assertRaises(FrozenInstanceError):
            setattr(scope.roots[0], "presented_type", PresentedType.MATERIAL)
        with self.assertRaises(FrozenInstanceError):
            setattr(scope.roots[0].source, "tag", "Material")

    def test_no_import_compatibility_claim_before_or_after_switch(self):
        scope = self.view('<Folder><Component name="c"/></Folder>')
        result = switch_types(scope)
        self.assertEqual(scope.import_compatibility, "not_evaluated")
        self.assertEqual(result.scope.import_compatibility, "not_evaluated")
        self.assertTrue(result.accepted)
        self.assertNotEqual(scope.metadata.current_type, result.scope.metadata.current_type)

    def test_overlapping_scope_refused_without_selecting_an_implicit_policy(self):
        roots = self.roots('<Folder><Component/></Folder>')
        for selected in ((roots[0], roots[0].children[0]), (roots[0], roots[0])):
            scope = prepare_type_scope(selected)
            self.assertEqual(scope.metadata.refusal, SwitchRefusal.OVERLAPPING_SCOPE)
            self.assertIs(switch_types(scope).scope, scope)

    def test_deep_folders_are_iterative(self):
        # Build bottom-up: this is a model test, not another XML parser test.
        node = SourceOccurrence("Component", (), (), None, None, (), (1,) * 1101,
                                Provenance(Path("deep.xml"), "synthetic"))
        for depth in reversed(range(1, 1101)):
            node = SourceOccurrence("Folder", (), (node,), None, None, (), (1,) * depth,
                                    Provenance(Path("deep.xml"), "synthetic"))
        scope = prepare_type_scope((node,))
        result = switch_types(scope)
        self.assertTrue(result.accepted)
        self.assertEqual(len(tuple(self.nodes(result.scope))), 1101)
        self.assertEqual(result.scope.metadata.current_type, ContentType.MATERIAL)

    def test_reader_source_bytes_and_diagnostics_are_untouched(self):
        from application.core.external_libraries.modern_xml import read_modern_xml

        with TemporaryDirectory() as directory:
            path = Path(directory) / "library.xml"
            content = b'<Export><Folder name="f"><Component name="c"/></Folder></Export>'
            path.write_bytes(content)
            read = read_modern_xml(path)
            assert read.data is not None
            doc = read.data
            scope = prepare_type_scope(doc.root.children)
            with patch.object(Path, "open", side_effect=AssertionError("unexpected IO")):
                result = switch_types(scope)
            self.assertTrue(result.accepted)
            self.assertEqual(doc.source_bytes, content)
            self.assertEqual(path.read_bytes(), content)
            self.assertEqual(doc.detection, read.data.detection)
            self.assertEqual(read.diagnostics, ())
            self.assertIs(result.scope.roots[0].source, doc.root.children[0])


if __name__ == "__main__":
    unittest.main()
