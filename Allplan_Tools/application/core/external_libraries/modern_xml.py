"""Local modern external XML: only Folder/Component are qualified for consultation."""
from pathlib import Path

from ..allplan.models import ReadResult, diagnostic
from .models import ConsultationDocument, Detection, DetectionState, SourceOccurrence
from .xml_source import XmlDialect, detect_xml_dialect, read_xml_source


ADAPTER_ID = "external_modern_xml"
ADAPTER_VERSION = "1"
QUALIFIED_TYPES = ("Folder", "Component")


def detect_modern_xml(root: SourceOccurrence) -> Detection:
    """Inspect parsed structure, not the extension or the envelope's brand name.

    This single-adapter probe is not a global format registry. Unsupported
    structures retain their raw occurrences but are never reported as qualified.
    """
    issues = []

    def report(code, message, occurrence, *, severity="warning"):
        issues.append(diagnostic(code, ADAPTER_ID, message, severity=severity,
                                 provenance=occurrence.provenance))

    dialect = detect_xml_dialect(root)
    if dialect == XmlDialect.AMBIGUOUS:
        report("external_format_ambiguous",
               "Vocabulaires moderne et ancien melanges ; aucun adaptateur choisi.",
               root, severity="error")
        return Detection(ADAPTER_ID, ADAPTER_VERSION, DetectionState.AMBIGUOUS,
                         tuple(issues))
    if dialect != XmlDialect.MODERN:
        report("external_format_incompatible",
               "Enveloppe XML avec Folder direct attendue ; dialecte non reconnu.",
               root, severity="error")
        return Detection(ADAPTER_ID, ADAPTER_VERSION, DetectionState.INCOMPATIBLE,
                         tuple(issues))

    unsupported = False
    if root.properties:
        report("external_property_unknown", "Proprietes d'enveloppe conservees.", root)
    if root.text and not root.text.isspace():
        report("external_text_unqualified", "Texte d'enveloppe conserve sans interpretation.", root)
    stack = [(child, root) for child in reversed(root.children)]
    while stack:
        current, parent = stack.pop()
        if current.tag not in QUALIFIED_TYPES:
            unsupported = True
            report("external_element_unsupported",
                   "Element non qualifie conserve, sans conversion de type.", current)
        else:
            allowed = (parent is root and current.tag == "Folder") or parent.tag == "Folder"
            if not allowed:
                unsupported = True
                report("external_relation_unsupported",
                       "Relation non qualifiee conservee sans deplacement.", current)
            known = {"name", "description"}
            if current.tag == "Component":
                known.add("unit")
            if any(item.name not in known for item in current.properties):
                report("external_property_unknown", "Propriete inconnue conservee.", current)
            name = current.property("name")
            if name is None:
                report("external_name_missing", "Propriete name absente, sans remplacement.", current)
            elif not name.strip():
                report("external_name_blank", "Propriete name vide ou blanche conservee.", current)
            if current.text and not current.text.isspace():
                report("external_text_unqualified", "Texte conserve sans interpretation.", current)
        if current.tail and not current.tail.isspace():
            report("external_text_unqualified", "Texte apres element conserve.", current)
        if current.tag == "Component" and current.children:
            unsupported = True
            report("external_relation_unsupported",
                   "Enfants de Component non qualifies, occurrences conservees.", current)
        stack.extend((child, current) for child in reversed(current.children))
    return Detection(ADAPTER_ID, ADAPTER_VERSION,
                     DetectionState.UNSUPPORTED if unsupported else DetectionState.RECOGNIZED,
                     tuple(issues))


def read_modern_xml(path: Path) -> ReadResult[ConsultationDocument | None]:
    """Consult the modern dialect only; acquisition is shared, not interpretation."""
    return read_xml_source(path, ADAPTER_ID, detect_modern_xml)
