"""Per-category source selection; PRJ root is never a selected project."""
from dataclasses import dataclass
from pathlib import Path
import logging
import re
from typing import Literal

from application.core.context import LaunchContext
from .models import Availability, Diagnostic, Provenance, ReadResult, diagnostic
from .text import read_text


CATEGORY_KEYS = {
    "asw": "ASW", "attributes": "ATTR", "layers": "LAYER",
    "patterns": "MUSTER", "hatching": "MUSTER", "surface_styles": "MUSTER",
    "pens": "STIFT", "line_types": "PEN",
}


@dataclass(frozen=True)
class SourceSelection:
    category: str
    kind: Literal["project", "std"]
    directory: Path | None
    diagnostics: tuple[Diagnostic, ...] = ()


def read_project_config(project: Path | None, *,
                        encoding_hint: str | None = None,
                        require_attributes: bool = False) -> ReadResult[dict[str, str]]:
    if project is None:
        return ReadResult({})
    path = project / "project.cfg"
    result = read_text(path, "sources", encoding_hint=encoding_hint)
    if result.data is None:
        return ReadResult({}, result.diagnostics, result.state)
    values: dict[str, str] = {}
    ambiguous: set[str] = set()
    issues = list(result.diagnostics)
    for number, raw in enumerate(result.data.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith(("#", ";", "[")):
            continue
        key, separator, value = line.partition("=")
        key, value = key.strip().upper(), value.strip().upper()
        if key not in CATEGORY_KEYS.values():
            continue
        if not separator or value not in ("PRJ", "STD"):
            ambiguous.add(key)
        elif key in values and values[key] != value:
            ambiguous.add(key)
        else:
            values[key] = value
        if key in ambiguous:
            issues.append(diagnostic(
                "config_ambiguous", "sources",
                "Cle projet inexploitable sans repli." if require_attributes
                else "Cle projet inexploitable : STD retenu.",
                provenance=Provenance(path, "project", number),
            ))
    for key in ambiguous:
        values.pop(key, None)
    if not result.data.strip():
        issues.append(diagnostic("config_empty", "sources",
                                 "Configuration vide sans repli." if require_attributes
                                 else "Configuration vide : STD retenu.",
                                 provenance=Provenance(path, "project")))
    if require_attributes and "ATTR" not in values:
        issues.append(diagnostic("project_config_invalid", "sources",
                                 "ATTR absent, inconnu ou ambigu ; aucune source retenue.",
                                 severity="error", provenance=Provenance(path, "project")))
        return ReadResult(values, tuple(issues), Availability.UNAVAILABLE)
    return ReadResult(values, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)


def resolve_sources(context: LaunchContext, *,
                    encoding_hint: str | None = None) -> dict[str, SourceSelection]:
    config = read_project_config(context.project_path, encoding_hint=encoding_hint)
    selections = {
        category: SourceSelection(
            category,
            "project" if config.data.get(key) == "PRJ" else "std",
            context.project_path if config.data.get(key) == "PRJ" else context.paths.get("STD"),
            config.diagnostics,
        )
        for category, key in CATEGORY_KEYS.items()
    }
    for category, selection in selections.items():
        logging.getLogger(__name__).debug("Source category=%s kind=%s resolved=%s",
                                          category, selection.kind,
                                          selection.directory is not None)
    return selections


LANGUAGES = {
    "fra": "fr", "eng": "en", "deu": "de", "ita": "it", "spa": "es",
    "hrv": "hr", "rum": "ro", "rus": "ru", "tch": "cs", "svn": "sl",
    "slk": "sk",
    "swi": "ch", "aus": "au", "can": "ca",
}


def language_suffix(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().lower()
    if re.fullmatch("[a-z]{2}", value):
        return value
    return LANGUAGES.get(value)
