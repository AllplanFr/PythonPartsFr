"""Read-only attribute references, without native activation or frontend coercion."""
from dataclasses import dataclass
import hashlib
from pathlib import Path
from xml.etree.ElementTree import Element, ParseError

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from application.core.context import LaunchContext
from application.core.allplan.models import (
    AttributeDefinition, Availability, GROUP_BITS, Provenance, ReadResult, diagnostic,
)
from application.core.allplan.readers.attributes import (
    AttributeFiles, discover_attributes, read_attributes,
)
from application.core.allplan.sources import SourceSelection, read_project_config


@dataclass(frozen=True)
class ReferenceProperty:
    tag: str
    attributes: tuple[tuple[str, str], ...]
    text: str | None
    tail: str | None
    children: tuple["ReferenceProperty", ...]

    def fields(self, name: str) -> tuple["ReferenceProperty", ...]:
        return tuple(child for child in self.children
                     if child.tag.rsplit("}", 1)[-1] == name)

    def value(self, name: str) -> str | None:
        """None is absent, '' is an existing empty property; no whitespace stripping."""
        fields = self.fields(name)
        return None if not fields else fields[0].text or ""


@dataclass(frozen=True)
class ReferenceOption:
    control: str
    code: str | None
    label: str | None
    position: int
    xml: ReferenceProperty


@dataclass(frozen=True)
class SourceDefinition:
    xml: ReferenceProperty
    provenance: Provenance

    @property
    def options(self) -> tuple[ReferenceOption, ...]:
        return tuple(
            ReferenceOption(control.tag.rsplit("}", 1)[-1], item.value("Key"),
                            item.value("Value"), position, item)
            for control in self.xml.children
            if control.tag.rsplit("}", 1)[-1] in ("Enumeration", "ComboBox")
            for position, item in enumerate(control.children, 1)
            if item.tag.rsplit("}", 1)[-1] == "Item"
        )


@dataclass(frozen=True)
class ReferenceCollection:
    provenance: Provenance
    sha256: str
    xml: ReferenceProperty
    definitions: tuple[SourceDefinition, ...]


@dataclass(frozen=True)
class SelectedDefinition:
    source: SourceDefinition
    interpreted: AttributeDefinition


@dataclass(frozen=True)
class ReferenceGroup:
    bit: int
    technical_id: str | None


@dataclass(frozen=True)
class AttributeReferences:
    allplan_version: str
    verification_version: bool
    country: str | None
    allplan_language: str | None
    files: AttributeFiles
    directory: Path
    collections: tuple[ReferenceCollection, ...]
    selected: dict[str, SelectedDefinition]
    groups: tuple[ReferenceGroup, ...]


def _property(element: Element) -> ReferenceProperty:
    converted = {}
    stack = [(element, False)]
    while stack:
        node, visited = stack.pop()
        if not visited:
            stack.append((node, True))
            stack.extend((child, False) for child in reversed(node))
        else:
            converted[id(node)] = ReferenceProperty(
                node.tag, tuple(node.attrib.items()), node.text, node.tail,
                tuple(converted[id(child)] for child in node),
            )
    return converted[id(element)]


def load_attribute_references(
    context: LaunchContext, selection: SourceSelection, application_language: str,
) -> ReadResult[AttributeReferences | None]:
    """Use shared first-valid resolution, retaining all source occurrences separately.

    The source is explicit: STD from this installation, or its explicitly selected
    project with ATTR=PRJ. No implicit project selection, ASW merge or defaults.
    """
    issues = []

    def issue(code: str, message: str, origin: Provenance | None = None):
        issues.append(diagnostic(code, "smartcatalog_references", message,
                                 severity="error", provenance=origin))

    expected = context.paths.get("STD") if selection.kind == "std" else context.project_path
    if (context.allplan_version is None or selection.category != "attributes"
            or selection.kind not in ("std", "project") or expected is None
            or selection.directory != expected):
        issue("reference_context_invalid",
              "Installation et source d'attributs explicites coherentes requises.")
        return ReadResult(None, tuple(issues), Availability.UNAVAILABLE)
    if selection.kind == "project":
        config = read_project_config(context.project_path)
        issues.extend(config.diagnostics)
        if config.state == Availability.UNAVAILABLE or config.data.get("ATTR") != "PRJ":
            issue("reference_project_source_invalid",
                  "ATTR=PRJ explicite requis pour la source projet.")
            return ReadResult(None, tuple(issues), Availability.UNAVAILABLE)
    files = discover_attributes(context, selection, application_language)
    if files.data is None:
        return ReadResult(None, tuple(issues) + files.diagnostics, Availability.UNAVAILABLE)

    collections = []
    failed_paths = set()
    for kind, paths in (("etc", files.data.system),
                        (files.data.custom_source, files.data.custom)):
        for path in paths:
            provenance = Provenance(path, kind)
            try:
                content = path.read_bytes()
                root = ElementTree.fromstring(content, forbid_dtd=True)
            except OSError:
                issue("reference_file_unavailable", "Collection inaccessible.", provenance)
                failed_paths.add(path)
                continue
            except (ParseError, DefusedXmlException, LookupError, UnicodeError):
                issue("reference_xml_invalid", "Collection XML invalide ou interdite.", provenance)
                failed_paths.add(path)
                continue
            if root.tag != "AttributeDefinitionCollection":
                issue("reference_collection_incompatible",
                      "Structure de collection non prise en charge.", provenance)
                failed_paths.add(path)
                continue
            xml = _property(root)
            definitions = []
            for position, child in enumerate(xml.children, 1):
                origin = Provenance(path, kind, position)
                if child.tag != "AttributeDefinition":
                    issue("reference_collection_child_unsupported",
                          "Element de collection inconnu conserve.", origin)
                    continue
                definitions.append(SourceDefinition(child, origin))
                names = [prop.tag for prop in child.children]
                if len(names) != len(set(names)):
                    issue("reference_property_repeated",
                          "Proprietes repetees conservees, interpretation partielle.", origin)
            collections.append(ReferenceCollection(
                provenance, hashlib.sha256(content).hexdigest(), xml, tuple(definitions),
            ))

    interpreted = read_attributes(files)
    issues.extend(interpreted.diagnostics)
    by_origin = {definition.provenance: definition
                 for collection in collections for definition in collection.definitions}
    selected = {}
    for number, definition in interpreted.data.items():
        raw = by_origin.get(definition.provenance)
        if raw is not None:
            selected[number] = SelectedDefinition(raw, definition)
    changed = False
    for collection in collections:
        try:
            same = hashlib.sha256(collection.provenance.path.read_bytes()).hexdigest() == collection.sha256
        except OSError:
            same = False
        if not same:
            changed = True
            issue("reference_source_changed",
                  "Source modifiee ou devenue inaccessible pendant la lecture.",
                  collection.provenance)
    mandatory = files.data.system[0]
    if interpreted.state == Availability.UNAVAILABLE or mandatory in failed_paths or changed:
        return ReadResult(None, tuple(issues), Availability.UNAVAILABLE)
    # Mask identities remain technical bits, never frontend array indices.
    bits = {bit for entry in selected.values()
            for bit in range(entry.interpreted.group_mask.bit_length())
            if entry.interpreted.group_mask & (1 << bit)}
    data = AttributeReferences(
        context.allplan_version, context.verification_version, context.country,
        context.allplan_language, files.data, expected, tuple(collections), selected,
        tuple(ReferenceGroup(bit, "ATTR_PRG_BEREICH_" + GROUP_BITS[bit]
                             if bit in GROUP_BITS else None) for bit in sorted(bits)),
    )
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
