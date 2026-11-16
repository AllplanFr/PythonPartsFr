"""Read the observed objekt.000 35.0 layout without selecting object aliases."""
from dataclasses import dataclass
from pathlib import Path
import re

from ..models import Availability, Diagnostic, Provenance, ReadResult, diagnostic
from ..text import read_text


@dataclass(frozen=True)
class ObjectFields:
    pfad: str
    steu: str
    code: str
    label: str
    raw_fields: tuple[str, str, str]


@dataclass(frozen=True)
class ObjectLine:
    raw: str
    provenance: Provenance
    fields: ObjectFields | None
    diagnostics: tuple[Diagnostic, ...] = ()


@dataclass(frozen=True)
class ObjectFile:
    provenance: Provenance
    text: str
    header: tuple[str, ...]
    lines: tuple[ObjectLine, ...]


def read_objects_file(path: Path, source: str, *,
                      encoding_hint: str | None = None) -> ReadResult[ObjectFile | None]:
    """Keep raw text, padding and line endings alongside the named source fields."""
    decoded = read_text(path, "objects", source=source, encoding_hint=encoding_hint)
    if decoded.data is None:
        return ReadResult(None, decoded.diagnostics, Availability.UNAVAILABLE)
    text = decoded.data
    raw_lines = tuple(line for line in
                      re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", text) if line)
    origin = Provenance(path, source)
    issues = list(decoded.diagnostics)
    supported = (
        len(raw_lines) >= 2
        and raw_lines[0].rstrip("\r\n") == "35.0 PFAD STEU OBJNR OBJEKT-NAME"
        and raw_lines[1].rstrip("\r\n") == "95 -----------------------------------------"
    )
    if not supported:
        issues.append(diagnostic(
            "objects_format_unsupported", "objects",
            "En-tetes objekt.000 35.0 non reconnus ; texte conserve sans interpretation.",
            severity="error", provenance=origin,
        ))
        data = ObjectFile(origin, text, raw_lines[:2], tuple(
            ObjectLine(raw, Provenance(path, source, position), None)
            for position, raw in enumerate(raw_lines[2:], 3)
        ))
        return ReadResult(data, tuple(issues), Availability.UNAVAILABLE)
    lines = []
    seen: dict[str, Provenance] = {}
    numeric_seen: dict[str, tuple[str, Provenance]] = {}
    for position, raw in enumerate(raw_lines[2:], 3):
        body = raw.rstrip("\r\n")
        provenance = Provenance(path, source, position)
        local = []

        def report(issue_code: str, message: str, related: Provenance | None = None) -> None:
            local.append(diagnostic(issue_code, "objects", message,
                                    provenance=provenance, related=related))

        fields = None
        if (len(body) < 18 or any(body[i] != " " for i in (5, 11, 17))
                or any(not re.fullmatch(r" *[0-9]*", body[a:b])
                       for a, b in ((0, 5), (6, 11), (12, 17)))):
            report("objects_line_invalid",
                   "Ligne hors du format observe ; occurrence brute conservee.")
        else:
            raw_fields = (body[:5], body[6:11], body[12:17])
            # Only the specified left padding is removed; the raw fields remain available.
            pfad, steu, code = (value.lstrip(" ") for value in raw_fields)
            fields = ObjectFields(pfad, steu, code, body[18:], raw_fields)
            if not pfad or not steu or not code:
                report("objects_field_empty", "Champ numerique source explicitement vide.")
            if code:
                if code in seen:
                    report("objects_code_repeated",
                           "Code objet repete ; aucune occurrence supprimee.", seen[code])
                else:
                    seen[code] = provenance
                identity = code.lstrip("0") or "0"
                previous = numeric_seen.get(identity)
                if previous is not None and previous[0] != code:
                    report("objects_numeric_collision",
                           "Codes textuels distincts de meme identite numerique.",
                           previous[1])
                else:
                    numeric_seen.setdefault(identity, (code, provenance))
        lines.append(ObjectLine(raw, provenance, fields, tuple(local)))
        issues.extend(local)
    data = ObjectFile(origin, text, raw_lines[:2], tuple(lines))
    if not any(line.fields is not None for line in lines):
        issues.append(diagnostic(
            "objects_no_records", "objects",
            "Aucune ligne interpretable ; source brute conservee.",
            severity="error", provenance=origin,
        ))
        return ReadResult(data, tuple(issues), Availability.UNAVAILABLE)
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
