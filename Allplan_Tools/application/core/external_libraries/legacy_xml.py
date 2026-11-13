"""Faithful consultation of the qualified Dossier/Composant XML family."""
from pathlib import Path

from ..allplan.models import ReadResult, diagnostic
from .models import ConsultationDocument, Detection, DetectionState, SourceOccurrence
from .xml_source import XmlDialect, detect_xml_dialect, read_xml_source


ADAPTER_ID = "external_legacy_xml"
ADAPTER_VERSION = "1"
QUALIFIED_TYPES = ("Dossier", "Composant")
QUALIFIED_FIELDS = ("description", "Unité", "code_externe")


def detect_legacy_xml(root: SourceOccurrence) -> Detection:
    """Recognize structure, preserving brand/envelope and optional field profiles."""
    issues = []

    def report(code, message, occurrence, *, severity="warning"):
        issues.append(diagnostic(code, ADAPTER_ID, message, severity=severity,
                                 provenance=occurrence.provenance))

    dialect = detect_xml_dialect(root)
    if dialect == XmlDialect.AMBIGUOUS:
        report("external_format_ambiguous",
               "Vocabulaires moderne et ancien melanges ; aucun adaptateur choisi.",
               root, severity="error")
        return Detection(ADAPTER_ID, ADAPTER_VERSION, DetectionState.AMBIGUOUS, tuple(issues))
    if dialect != XmlDialect.LEGACY:
        report("external_format_incompatible",
               "Enveloppe XML avec Dossier direct attendue ; dialecte ancien non reconnu.",
               root, severity="error")
        return Detection(ADAPTER_ID, ADAPTER_VERSION, DetectionState.INCOMPATIBLE, tuple(issues))

    unsupported = False
    stack: list[tuple[SourceOccurrence, SourceOccurrence | None]] = [(root, None)]
    while stack:
        node, parent = stack.pop()
        parent_tag = parent.tag if parent is not None else None
        if node is root:
            allowed = True
            known_properties = set()
        elif node.tag in QUALIFIED_TYPES:
            allowed = (parent is root and node.tag == "Dossier") or parent_tag == "Dossier"
            known_properties = {"name"}
            name = node.property("name")
            if name is None:
                report("external_name_missing", "Propriete name absente, sans remplacement.", node)
            elif not name.strip():
                report("external_name_blank", "Propriete name vide ou blanche conservee.", node)
        elif node.tag in QUALIFIED_FIELDS:
            allowed = parent_tag == "Composant"
            known_properties = set()
            if node.children:
                unsupported = True
                report("external_field_structure_unsupported",
                       "Contenu complexe de champ non qualifie, conserve sans aplatissement.", node)
        else:
            allowed = True
            known_properties = set()
            unsupported = True
            report("external_element_unsupported",
                   "Element non qualifie conserve, sans conversion de type.", node)
        if not allowed:
            unsupported = True
            report("external_relation_unsupported",
                   "Relation non qualifiee conservee sans deplacement.", node)
        if any(prop.name not in known_properties for prop in node.properties):
            report("external_property_unknown", "Propriete inconnue conservee.", node)
        if node.tag not in QUALIFIED_FIELDS and node.text and not node.text.isspace():
            report("external_text_unqualified", "Texte conserve sans interpretation.", node)
        if node.tail and not node.tail.isspace():
            report("external_text_unqualified", "Texte apres element conserve.", node)
        if node.tag == "Composant":
            seen = set()
            for child in node.children:
                if child.tag in QUALIFIED_FIELDS:
                    if child.tag in seen:
                        report("external_field_repeated",
                               "Champ repete, toutes les occurrences conservees.", child)
                    seen.add(child.tag)
            for required in ("description", "Unité"):
                if required not in seen:
                    report("external_field_missing",
                           f"Champ {required} attendu dans les exemples absent, sans ajout.", node)
        stack.extend((child, node) for child in reversed(node.children))
    return Detection(ADAPTER_ID, ADAPTER_VERSION,
                     DetectionState.UNSUPPORTED if unsupported else DetectionState.RECOGNIZED,
                     tuple(issues))


def read_legacy_xml(path: Path) -> ReadResult[ConsultationDocument | None]:
    """No splitting names, trimming fields, unit conversion, defaults or import."""
    return read_xml_source(path, ADAPTER_ID, detect_legacy_xml)
