"""Coordinated references, preserving rule values and source occurrences."""
from collections import defaultdict
from typing import Literal

from application.core.allplan.models import Availability
from application.core.allplan.sources import SourceSelection
from application.core.context import LaunchContext
from application.plugins.smartcatalog.attribute_references import load_attribute_references
from application.plugins.smartcatalog.trades import build_trade_references
from .references import (
    FileReferenceSource, ReferenceCategory, ReferenceDiagnostic, UserReferenceSource, VobReferences,
    load_references, normalize_reference_code, unavailable,
)


def _user_category(*, methods: bool) -> ReferenceCategory:
    source: UserReferenceSource = {
        "scope": "USER",
        "label": "Correspondances d’affichage fournies par l’utilisateur",
        "language": "fr", "coverage": "specified_codes_only",
    }
    diagnostics: list[ReferenceDiagnostic] = [{
        "code": "reference_coverage_limited", "severity": "warning",
        "message": "Correspondances utilisateur limitees aux codes specifies ; "
                   "catalogue Allplan exhaustif non etabli.",
        "id": None, "locations": [],
    }]
    if methods:
        diagnostics.append({
            "code": "method_code_unresolved", "severity": "warning",
            "message": "La signification de la methode 13 n'est pas etablie ; "
                       "'?' n'est pas une definition.",
            "id": "13", "locations": [],
        })
    return {
        "status": "available_with_diagnostics",
        "sources": [source], "diagnostics": diagnostics,
    }


def normalize_trade_code(code: str) -> str:
    return normalize_reference_code(code)


def load_coordinated_references(context: LaunchContext, language: str) -> VobReferences:
    result = load_references(context.paths.get("STD"))
    result["units"] = [
        {"index": code, "name": name}
        for code, name in (("00", "m³"), ("01", "m²"), ("02", "m"), ("05", "geo"))
    ]
    result["methods"] = [
        {"value": code, "name": name}
        for code, name in (
            ("01", "Volume"), ("02", "Surface"), ("03", "Sol"),
            ("04", "Plafond"), ("05", "Surface latérale"),
            ("06", "Surface médiane"), ("13", "?"),
        )
    ]
    result["metadata"]["units"] = _user_category(methods=False)
    result["metadata"]["methods"] = _user_category(methods=True)
    std = context.paths.get("STD")
    if std is None:
        result["metadata"]["trades"] = unavailable(
            "trade_source_unresolved", "Le contexte ne fournit pas de dossier STD.",
        )
        return result
    trades = build_trade_references(load_attribute_references(
        context, SourceSelection("attributes", "std", std), language,
    ))
    diagnostics: list[ReferenceDiagnostic] = []
    for issue in trades.diagnostics:
        diagnostics.append({
            "code": issue.code, "severity": issue.severity, "message": issue.message,
            "id": None,
            # XML provenance.position is an element index, not a physical line.
            "locations": [
                {"path": str(origin.path), "line": None}
                for origin in (issue.provenance, issue.related) if origin is not None
            ],
        })
    selected = trades.data.selected
    sources: list[FileReferenceSource] = []
    if selected is not None:
        scope = selected.provenance.source.upper()
        if scope not in ("STD", "ETC", "PRJ"):
            result["metadata"]["trades"] = unavailable(
                "trade_source_scope_invalid", "Provenance d'attribut 209 non prise en charge.",
            )
            return result
        # Narrow explicitly instead of coercing an unverified source into the contract.
        checked_scope: Literal["STD", "ETC", "PRJ"]
        if scope == "STD":
            checked_scope = "STD"
        elif scope == "ETC":
            checked_scope = "ETC"
        else:
            checked_scope = "PRJ"
        sources.append({
            "scope": checked_scope, "path": str(selected.provenance.path),
            "attributeNumber": "209",
            "language": trades.data.source.data.files.language
            if trades.data.source.data is not None else None,
        })
    occurrences = defaultdict(list)
    if trades.state != Availability.UNAVAILABLE and selected is not None:
        for option in trades.data.options:
            if option.code is None or option.label is None or option.code == "-1":
                continue
            code = normalize_trade_code(option.code)
            result["trades"].append({"index": code, "name": option.label})
            occurrences[code].append(option.label)
            if code != option.code:
                diagnostics.append({
                    "code": "trade_code_normalized", "severity": "info",
                    "message": f"Identifiant source {option.code!r} ; "
                               f"correspondance metier {code!r}.",
                    "id": code, "locations": [
                        {"path": str(option.provenance.path), "line": None},
                    ],
                })
    for code, labels in occurrences.items():
        if len(set(labels)) > 1:
            diagnostics.append({
                "code": "reference_id_ambiguous", "severity": "warning",
                "message": "Plusieurs libelles source ; aucun alias selectionne.",
                "id": code, "locations": [
                    {"path": str(selected.provenance.path), "line": None}
                ] if selected is not None else [],
            })
    if not result["trades"] and not diagnostics:
        diagnostics = unavailable(
            "trades_no_records", "Aucune option 209 exploitable.",
        )["diagnostics"]
    result["metadata"]["trades"] = {
        "status": (
            "unavailable" if not result["trades"] else
            "available_with_diagnostics" if diagnostics else "available"
        ),
        "sources": sources, "diagnostics": diagnostics,
    }
    return result
