"""Experimental read projection for the provisional frontend archive, not a writer."""
from dataclasses import dataclass
import re
from typing import Literal

from application.core.allplan.models import (
    Availability, Diagnostic, Provenance, ReadResult, diagnostic,
)
from application.core.allplan.readers.smartcatalog import CatalogXmlDocument, CatalogXmlElement
from .application import CatalogDocument, CatalogNode


@dataclass(frozen=True)
class CatalogAdaptation:
    source: ReadResult[CatalogXmlDocument | None]
    document: CatalogDocument | None
    diagnostics: tuple[Diagnostic, ...]
    state: Availability


def adapt_smartcatalog(source: ReadResult[CatalogXmlDocument | None]) -> CatalogAdaptation:
    """Project the observed Node/Group/GroupDef format, retaining its neutral source.

    IDs are one-based source-element paths, not durable Allplan identities.
    Numeric frontend attribute keys are canonicalized only after collision checks.
    Missing UI descriptions use '', without inserting any missing XML attribute.
    """
    issues = list(source.diagnostics)

    def refuse(code: str, message: str, source_element: CatalogXmlElement | None = None,
               related: Provenance | None = None) -> CatalogAdaptation:
        issues.append(diagnostic(
            code, "smartcatalog_adapter", message, severity="error",
            provenance=source_element.provenance if source_element is not None else None,
            related=related,
        ))
        return CatalogAdaptation(source, None, tuple(issues), Availability.UNAVAILABLE)

    if source.data is None or source.state == Availability.UNAVAILABLE:
        return refuse("catalog_adaptation_source_unavailable",
                      "Lecture neutre indisponible, aucune adaptation produite.")
    if source.diagnostics:
        return refuse("catalog_adaptation_source_diagnostics",
                      "Anomalies de lecture non prises en charge par cet adaptateur.",
                      source.data.root)
    root = source.data.root
    if root.tag != "AllplanCatalog":
        return refuse("catalog_adaptation_format",
                      "Format neutre non pris en charge.", root)

    nodes: dict[str, CatalogNode] = {}
    roots: list[str] = []
    groups: dict[str, Provenance] = {}
    stack: list[tuple[CatalogXmlElement, str | None, list[str], int]] = [
        (child, None, roots, 0) for child in reversed(root.children)
    ]
    while stack:
        element, parent, siblings, depth = stack.pop()
        if element.tag not in ("Node", "Group"):
            return refuse("catalog_adaptation_structure",
                          "Element non representable dans cet arbre frontend.", element)
        if depth > 100:
            return refuse("catalog_adaptation_depth",
                          "Profondeur superieure a la limite du validateur frontend.", element)
        name = element.attribute("name")
        if name is None or not name.strip():
            return refuse("catalog_adaptation_name",
                          "Nom absent ou blanc non representable par le frontend.", element)
        node_type: Literal["folder", "group"] = "folder" if element.tag == "Node" else "group"
        if siblings and nodes[siblings[0]]["type"] != node_type:
            return refuse("catalog_adaptation_mixed_children",
                          "Fratrie mixte incompatible avec le frontend.", element)
        identifier = "xml:" + ".".join(str(part) for part in element.element_path)
        if identifier in nodes:
            return refuse("catalog_adaptation_identity",
                          "Identite structurelle repetee.", element)
        attrs: dict[str, str] = {}
        order: list[int] = []
        if element.tag == "Group":
            group_key = name.strip().lower()
            if group_key in groups:
                return refuse("catalog_adaptation_group_name",
                              "Code ouvrage non unique pour le frontend.", element,
                              groups[group_key])
            groups[group_key] = element.provenance
            if len(element.children) != 1 or element.children[0].tag != "GroupDef":
                return refuse("catalog_adaptation_structure",
                              "Un GroupDef unique est requis par ouvrage.", element)
            origins: dict[str, Provenance] = {}
            for attribute in element.children[0].children:
                if attribute.tag != "Attribute":
                    return refuse("catalog_adaptation_structure",
                                  "Element non representable dans les attributs.", attribute)
                raw_number = attribute.attribute("id")
                if raw_number is None or not re.fullmatch(r"[0-9]+", raw_number):
                    return refuse("catalog_adaptation_attribute_number",
                                  "Numero non representable par le frontend.", attribute)
                number = raw_number.lstrip("0") or "0"
                if len(number) > 5 or not 1 <= int(number) <= 99999:
                    return refuse("catalog_adaptation_attribute_number",
                                  "Numero hors plage frontend 1 a 99999.", attribute)
                if number in attrs:
                    return refuse("catalog_adaptation_attribute_collision",
                                  "Occurrences aboutissant au meme numero frontend.",
                                  attribute, origins[number])
                value = attribute.attribute("value")
                if value is None:
                    return refuse("catalog_adaptation_value_missing",
                                  "Valeur absente non representable dans attrs.", attribute)
                attrs[number] = value
                origins[number] = attribute.provenance
                order.append(int(number))
        children: list[str] = []
        node: CatalogNode = {
            "id": identifier, "type": node_type, "name": name,
            "description": attrs.get("207", ""), "parentId": parent,
            "children": children, "attrs": attrs,
        }
        if element.tag == "Group":
            node["attrOrder"] = order
        nodes[identifier] = node
        siblings.append(identifier)
        if element.tag == "Node":
            stack.extend((child, identifier, children, depth + 1)
                         for child in reversed(element.children))
    return CatalogAdaptation(source, {"nodes": nodes, "rootIds": roots},
                             tuple(issues), Availability.AVAILABLE)
