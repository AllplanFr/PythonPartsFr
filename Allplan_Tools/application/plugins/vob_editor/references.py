"""Partial VOB references from read-only Allplan sources; never edit rule values."""
from collections import defaultdict
from pathlib import Path
from typing import Literal, TypedDict

from application.core.allplan.models import Availability
from application.core.allplan.readers.objects import read_objects_file


class ReferenceLocation(TypedDict):
    path: str
    line: int | None


class FileReferenceSource(TypedDict):
    scope: Literal["STD", "ETC", "PRJ"]
    path: str
    attributeNumber: str | None
    language: str | None


class UserReferenceSource(TypedDict):
    scope: Literal["USER"]
    label: str
    language: str
    coverage: Literal["specified_codes_only"]


ReferenceSource = FileReferenceSource | UserReferenceSource


class ReferenceDiagnostic(TypedDict):
    code: str
    severity: Literal["info", "warning", "error"]
    message: str
    id: str | None
    locations: list[ReferenceLocation]


class ReferenceCategory(TypedDict):
    status: Literal["available", "available_with_diagnostics", "unavailable"]
    sources: list[ReferenceSource]
    diagnostics: list[ReferenceDiagnostic]


class ReferenceMetadata(TypedDict):
    trades: ReferenceCategory
    objects: ReferenceCategory
    methods: ReferenceCategory
    units: ReferenceCategory


class IndexedReference(TypedDict):
    index: str
    name: str


class ObjectReference(TypedDict):
    num: str
    name: str


class MethodReference(TypedDict):
    value: str
    name: str


class VobReferences(TypedDict):
    referenceContract: Literal["vob-references/2"]
    trades: list[IndexedReference]
    objects: list[ObjectReference]
    methods: list[MethodReference]
    units: list[IndexedReference]
    metadata: ReferenceMetadata


def unavailable(code: str, message: str) -> ReferenceCategory:
    return {
        "status": "unavailable", "sources": [],
        "diagnostics": [{
            "code": code, "severity": "error", "message": message,
            "id": None, "locations": [],
        }],
    }


def normalize_reference_code(code: str) -> str:
    if code and all("0" <= character <= "9" for character in code):
        return code.lstrip("0") or "0"
    return code


def load_references(std: Path | None) -> VobReferences:
    objects: list[ObjectReference] = []
    category = unavailable(
        "object_source_unresolved", "Le contexte Allplan ne fournit pas de dossier STD.",
    )
    if std is not None:
        path = std / "objekt.000"
        result = read_objects_file(path, "STD")
        diagnostics: list[ReferenceDiagnostic] = []
        codes_by_line = {
            line.provenance.position: line.fields.code
            for line in result.data.lines
            if line.fields is not None and line.fields.code
        } if result.data is not None else {}
        for issue in result.diagnostics:
            diagnostics.append({
                "code": issue.code, "severity": issue.severity,
                "message": issue.message,
                "id": codes_by_line.get(issue.provenance.position)
                if issue.provenance is not None else None,
                "locations": [
                    {"path": str(origin.path), "line": origin.position}
                    for origin in (issue.provenance, issue.related) if origin is not None
                ],
            })
        if result.state != Availability.UNAVAILABLE and result.data is not None:
            occurrences = defaultdict(list)
            for line in result.data.lines:
                fields = line.fields
                if fields is None or not fields.code or fields.code == "-1":
                    continue
                # OBJNR is column 2 after PFAD (physical column 3), not STEU.
                objects.append({"num": fields.code, "name": fields.label})
                occurrences[normalize_reference_code(fields.code)].append(
                    (fields.label, line.provenance),
                )
            for code, entries in occurrences.items():
                if len({label for label, _origin in entries}) > 1:
                    diagnostics.append({
                        "code": "reference_id_ambiguous", "severity": "warning",
                        "message": "Plusieurs libelles pour le code normalise ; "
                                   "aucun alias ni traduction selectionne.",
                        "id": code,
                        "locations": [
                            {"path": str(origin.path), "line": origin.position}
                            for _label, origin in entries
                        ],
                    })
        if not objects and not any(issue["severity"] == "error" for issue in diagnostics):
            diagnostics.append({
                "code": "objects_no_records", "severity": "error",
                "message": "Aucun identifiant objet exploitable dans le fichier source.",
                "id": None, "locations": [{"path": str(path), "line": None}],
            })
        category = {
            "status": (
                "unavailable" if not objects else
                "available_with_diagnostics" if diagnostics else "available"
            ),
            "sources": [{
                "scope": "STD", "path": str(path),
                "attributeNumber": None, "language": None,
            }],
            "diagnostics": diagnostics,
        }
    return {
        "referenceContract": "vob-references/2",
        "trades": [], "objects": objects, "methods": [], "units": [],
        "metadata": {
            "objects": category,
            "trades": unavailable(
                "attribute_reference_not_validated",
                "Raccordement et cles de l'attribut 209 non valides.",
            ),
            "units": unavailable(
                "attribute_reference_not_validated",
                "Raccordement et cles de l'attribut 120 non valides.",
            ),
            "methods": unavailable(
                "method_source_unresolved",
                "Source faisant autorite et couverture des methodes VOB non etablies.",
            ),
        },
    }
