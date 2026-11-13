"""Neutral reading of the observed g/b/@/e layer file, without source merging."""
from dataclasses import dataclass
from pathlib import Path
import re

from ..models import Availability, Diagnostic, Provenance, ReadResult, diagnostic
from ..text import read_text


@dataclass(frozen=True)
class LayerLine:
    raw: str
    marker: str
    fields: tuple[str, ...]
    terminated: bool
    provenance: Provenance
    section_g: int | None
    section_b: int | None
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True)
class LayerFile:
    provenance: Provenance
    text: str
    lines: tuple[LayerLine, ...]


def read_layers_file(path: Path, source: str, *,
                     encoding_hint: str | None = None) -> ReadResult[LayerFile | None]:
    """Keep lexical fields and section occurrence positions, not inferred Allplan IDs."""
    decoded = read_text(path, "layers", source=source, encoding_hint=encoding_hint)
    if decoded.data is None:
        return ReadResult(None, decoded.diagnostics, Availability.UNAVAILABLE)
    text = decoded.data
    raw_lines = tuple(line for line in
                      re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", text) if line)
    issues = list(decoded.diagnostics)
    lines = []
    section_g = section_b = None
    ended = False
    recognized = False
    seen: dict[tuple[int, str], Provenance] = {}
    for position, raw in enumerate(raw_lines, 1):
        body = raw.rstrip("\r\n")
        pieces = body.split("@")
        marker = pieces[0]
        terminated = len(pieces) > 1 and pieces[-1] == ""
        fields = tuple(pieces[1:-1] if terminated else pieces[1:])
        origin = Provenance(path, source, position)
        local = []

        def report(code: str, message: str, related: Provenance | None = None) -> None:
            local.append(diagnostic(code, "layers", message,
                                    provenance=origin, related=related))

        if ended:
            report("layers_after_end", "Occurrence apres le marqueur de fin conservee.")
        expected = {"g": 1, "b": 1, " ": 7}.get(marker)
        valid = expected is not None and terminated and len(fields) == expected
        if marker == "e" and len(pieces) == 1:
            if section_g is None:
                report("layers_end_without_section", "Fin sans section g reconnue.")
            ended = True
            section_g = section_b = None
        elif expected is None:
            report("layers_marker_unknown",
                   "Marqueur inconnu conserve ; portee suivante non resolue.")
            section_g = section_b = None
        else:
            if not valid:
                report("layers_line_invalid",
                       "Separateur final ou nombre de champs inattendu ; champs conserves.")
            if marker == "g":
                section_g = position if valid and not ended else None
                section_b = None
                recognized |= valid and not ended
            elif marker == "b":
                section_b = position if valid and not ended else None
                if section_g is None:
                    report("layers_section_orphan", "Section b sans section g resolue.")
            else:
                if section_g is None or section_b is None:
                    report("layers_record_orphan", "Enregistrement sans portee g/b resolue.")
                # Positional candidates only; semantic roles are not assigned here.
                for index in range(2, min(len(fields), 7)):
                    token = fields[index].strip(" ")
                    if not re.fullmatch(r"[+-]?[0-9]+", token):
                        report("layers_numeric_field_unresolved",
                               "Champ numerique candidat vide ou non reconnu ; texte conserve.")
                for index in (1, 2):
                    if index < len(fields):
                        key = (index, fields[index])
                        previous = seen.get(key)
                        if previous is not None:
                            report("layers_candidate_repeated",
                                   "Champ candidat repete ; aucune occurrence supprimee.",
                                   previous)
                        else:
                            seen[key] = origin
        lines.append(LayerLine(raw, marker, fields, terminated, origin,
                               section_g, section_b, tuple(local)))
        issues.extend(local)
    origin = Provenance(path, source)
    if not ended:
        issues.append(diagnostic("layers_end_missing", "layers",
                                 "Marqueur de fin absent.", provenance=origin))
    data = LayerFile(origin, text, tuple(lines))
    if not recognized:
        issues.append(diagnostic(
            "layers_format_unsupported", "layers",
            "Aucune section g reconnue ; texte conserve sans modele metier.",
            severity="error", provenance=origin,
        ))
        return ReadResult(data, tuple(issues), Availability.UNAVAILABLE)
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
