"""Neutral, read-only AllplanCatalog XML reading; no frontend mapping."""
from dataclasses import dataclass
from pathlib import Path
import re
from xml.etree.ElementTree import Element, ParseError

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from ..models import Availability, Provenance, ReadResult, diagnostic


@dataclass(frozen=True)
class CatalogXmlAttribute:
    name: str
    value: str


@dataclass(frozen=True)
class CatalogXmlElement:
    tag: str
    attributes: tuple[CatalogXmlAttribute, ...]
    children: tuple["CatalogXmlElement", ...]
    text: str | None
    tail: str | None
    namespaces: tuple[tuple[str, str], ...]
    provenance: Provenance
    element_path: tuple[int, ...]

    def attribute(self, name: str) -> str | None:
        """None means absent; an explicitly empty attribute returns ''."""
        return next((item.value for item in self.attributes if item.name == name), None)


@dataclass(frozen=True)
class CatalogXmlDocument:
    root: CatalogXmlElement


_CHILDREN = {
    "AllplanCatalog": {"Node", "Group"},
    "Node": {"Node", "Group"},
    "Group": {"GroupDef"},
    "GroupDef": {"Attribute"},
    "Attribute": set(),
}
_ATTRIBUTES = {
    "AllplanCatalog": {"Region", "version",
                      "{http://www.w3.org/2001/XMLSchema-instance}noNamespaceSchemaLocation"},
    "Node": {"name"},
    "Group": {"name"},
    "GroupDef": set(),
    "Attribute": {"id", "value"},
}


def read_smartcatalog(path: Path) -> ReadResult[CatalogXmlDocument | None]:
    """Preserve XML elements, occurrences and decoded strings, including anomalies.

    element_path uses one-based element-child indices from the root (()).
    Provenance.position is a one-based preorder element number, not a line.
    XML attribute/line-ending normalization is performed by the XML parser.
    Comments and processing instructions are not part of this element model.
    """
    path = Path(path)
    origin = Provenance(path, "smartcatalog")
    try:
        root: Element | None = None
        namespaces = {}
        pending = []
        with path.open("rb") as stream:
            parser = ElementTree.iterparse(
                stream, events=("start-ns", "start", "end"),
                forbid_dtd=True, forbid_entities=True, forbid_external=True,
            )
            for event, item in parser:
                if event == "start-ns":
                    pending.append(item)
                elif event == "start":
                    if root is None:
                        root = item
                    namespaces[id(item)] = tuple(pending)
                    pending.clear()
    except OSError:
        issue = diagnostic("catalog_access", "smartcatalog",
                           "Fichier catalogue absent ou inaccessible.",
                           severity="error", provenance=origin)
        return ReadResult(None, (issue,), Availability.UNAVAILABLE)
    except (ParseError, DefusedXmlException, LookupError):
        issue = diagnostic("catalog_xml_invalid", "smartcatalog",
                           "XML catalogue invalide ou construction XML interdite.",
                           severity="error", provenance=origin)
        return ReadResult(None, (issue,), Availability.UNAVAILABLE)
    assert root is not None  # A completed XML parse always has a root.
    if root.tag != "AllplanCatalog":
        issue = diagnostic("catalog_format_incompatible", "smartcatalog",
                           "Racine AllplanCatalog sans espace de noms attendue.",
                           severity="error", provenance=origin)
        return ReadResult(None, (issue,), Availability.UNAVAILABLE)

    issues = []

    def report(code, message, provenance, related=None):
        issues.append(diagnostic(code, "smartcatalog", message,
                                 provenance=provenance, related=related))

    # Iterative traversal avoids a Python recursion limit on deeply nested XML.
    ordered: list[tuple[Element, tuple[int, ...], Provenance]] = []
    stack = [(root, ())]
    while stack:
        element, location = stack.pop()
        provenance = Provenance(path, "smartcatalog", len(ordered) + 1)
        ordered.append((element, location, provenance))
        stack.extend((child, (*location, index))
                     for index, child in reversed(tuple(enumerate(element, 1))))
        if element.tag not in _CHILDREN:
            report("catalog_element_unknown", "Element XML inconnu conserve.", provenance)
            continue
        if any(child.tag not in _CHILDREN[element.tag] for child in element):
            report("catalog_structure_unsupported",
                   "Structure enfant non prise en charge, conservee.", provenance)
        if any(key not in _ATTRIBUTES[element.tag] for key in element.attrib):
            report("catalog_property_unknown", "Propriete XML inconnue conservee.", provenance)
        required = ("name",) if element.tag in ("Node", "Group") else (
            ("id", "value") if element.tag == "Attribute" else ()
        )
        if any(key not in element.attrib for key in required):
            report("catalog_property_missing",
                   "Propriete XML attendue absente, sans remplacement.", provenance)
        if element.tag == "Attribute" and element.get("id") is not None and not re.fullmatch(
                r"[0-9]+", element.get("id")):
            report("catalog_attribute_number_invalid",
                   "Numero d'attribut non decimal conserve sans conversion.", provenance)
        if (element.text and not element.text.isspace()) or any(
                child.tail and not child.tail.isspace() for child in element):
            report("catalog_text_unsupported", "Texte XML non structure conserve.", provenance)
        if element.tag == "Group" and len(element.findall("GroupDef")) != 1:
            report("catalog_group_definition_count",
                   "Nombre de GroupDef different de un, occurrences conservees.", provenance)
        if element.tag == "Node" and {child.tag for child in element} >= {"Node", "Group"}:
            report("catalog_mixed_children",
                   "Enfants Node et Group melanges, ordre conserve.", provenance)

    if root.get("version") not in (None, "1.0"):
        report("catalog_version_unsupported",
               "Version XML non verifiee, contenu conserve.", ordered[0][2])
    origins = {id(element): provenance for element, _, provenance in ordered}
    for element, _, provenance in ordered:
        if element.tag == "GroupDef":
            seen = {}
            for child in element:
                number = child.get("id")
                if child.tag != "Attribute" or number is None:
                    continue
                if number in seen:
                    report("catalog_attribute_duplicate",
                           "Numero repete dans GroupDef, toutes les occurrences conservees.",
                           origins[id(child)], seen[number])
                else:
                    seen[number] = origins[id(child)]
    converted = {}
    for element, location, provenance in reversed(ordered):
        converted[id(element)] = CatalogXmlElement(
            tag=element.tag,
            attributes=tuple(CatalogXmlAttribute(key, value)
                             for key, value in element.attrib.items()),
            children=tuple(converted[id(child)] for child in element),
            text=element.text, tail=element.tail,
            namespaces=namespaces[id(element)],
            provenance=provenance, element_path=location,
        )
    return ReadResult(CatalogXmlDocument(converted[id(root)]), tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
