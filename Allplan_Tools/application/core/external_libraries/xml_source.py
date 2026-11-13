"""Protected XML acquisition and occurrence construction shared by both dialects."""
from collections.abc import Callable
from enum import Enum
from io import BytesIO
from pathlib import Path
from xml.etree.ElementTree import Element, ParseError

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from ..allplan.models import Availability, Provenance, ReadResult, diagnostic
from .models import (
    ConsultationDocument, Detection, DetectionState, SourceOccurrence, SourceProperty,
)


class XmlDialect(str, Enum):
    MODERN = "modern"
    LEGACY = "legacy"
    AMBIGUOUS = "ambiguous"
    INCOMPATIBLE = "incompatible"


def detect_xml_dialect(root: SourceOccurrence) -> XmlDialect:
    """Conservative structural probe; never chooses between mixed vocabularies."""
    business_tags = {"Folder", "Component", "Material", "Link", "Dossier", "Composant"}
    if "{" in root.tag or root.tag in business_tags | {"AllplanCatalog", "SmartCatalog"}:
        return XmlDialect.INCOMPATIBLE
    direct = {child.tag for child in root.children}
    if not direct & {"Folder", "Dossier"}:
        return XmlDialect.INCOMPATIBLE
    modern = legacy = False
    stack = list(root.children)
    while stack:
        node = stack.pop()
        modern |= node.tag in {"Folder", "Component", "Material", "Link"}
        legacy |= node.tag in {"Dossier", "Composant"}
        stack.extend(node.children)
    if modern and legacy:
        return XmlDialect.AMBIGUOUS
    if "Folder" in direct:
        return XmlDialect.MODERN
    return XmlDialect.LEGACY


def read_xml_source(
    path: Path, adapter_id: str, detector: Callable[[SourceOccurrence], Detection],
) -> ReadResult[ConsultationDocument | None]:
    """Read once, without resolving resources or normalizing business values.

    The element model contains XML-decoded values; source_bytes also retains
    lexical spelling, comments and processing instructions. Position is a
    one-based preorder rank, not a physical line; paths are child positions.
    """
    path = Path(path)
    origin = Provenance(path, adapter_id)

    def failure(code, message):
        issue = diagnostic(code, adapter_id, message, severity="error", provenance=origin)
        return ReadResult(None, (issue,), Availability.UNAVAILABLE)

    try:
        content = path.read_bytes()
    except OSError:
        return failure("external_source_access", "Source locale absente ou inaccessible.")
    try:
        root: Element | None = None
        namespaces = {}
        pending = []
        parser = ElementTree.iterparse(
            BytesIO(content), events=("start-ns", "start", "end"),
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
    except (ParseError, DefusedXmlException):
        return failure("external_xml_invalid", "XML invalide ou construction XML interdite.")
    except (LookupError, ValueError):
        return failure("external_xml_encoding_unsupported",
                       "Encodage XML inconnu ou non pris en charge par le parseur.")
    assert root is not None
    ordered = []
    stack = [(root, ())]
    while stack:
        element, location = stack.pop()
        ordered.append((element, location, Provenance(path, adapter_id, len(ordered) + 1)))
        stack.extend((child, (*location, index))
                     for index, child in reversed(tuple(enumerate(element, 1))))
    converted = {}
    for element, location, provenance in reversed(ordered):
        converted[id(element)] = SourceOccurrence(
            element.tag,
            tuple(SourceProperty(key, value) for key, value in element.attrib.items()),
            tuple(converted[id(child)] for child in element),
            element.text, element.tail, namespaces[id(element)], location, provenance,
        )
    source_root = converted[id(root)]
    detection = detector(source_root)
    if detection.state in (DetectionState.INCOMPATIBLE, DetectionState.AMBIGUOUS):
        return ReadResult(None, detection.diagnostics, Availability.UNAVAILABLE)
    document = ConsultationDocument(source_root, content, detection)
    return ReadResult(document, detection.diagnostics,
                      Availability.WITH_DIAGNOSTICS if detection.diagnostics
                      else Availability.AVAILABLE)
