"""Faithful LINETHICKNESSES 1.0 reading; source thickness units stay unresolved."""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
from typing import Literal

from ..models import Availability, Diagnostic, Provenance, ReadResult, diagnostic
from ..text import read_text


@dataclass(frozen=True)
class PenRecord:
    code: str
    value: str | None
    remainder: str

    @property
    def numeric_value(self) -> Decimal | None:
        """Exact lexical decimal interpretation, without unit conversion or rounding."""
        if self.value is None or not re.fullmatch(
                r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?",
                self.value):
            return None
        try:
            value = Decimal(self.value)
        except InvalidOperation:
            return None
        return value if value.is_finite() else None


@dataclass(frozen=True)
class PenLine:
    raw: str
    kind: Literal["comment", "blank", "section", "record", "unknown"]
    provenance: Provenance
    section: int | None
    declared_count: str | None
    record: PenRecord | None
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True)
class PenFile:
    provenance: Provenance
    text: str
    lines: tuple[PenLine, ...]


def read_pens_file(path: Path, source: str, *,
                   encoding_hint: str | None = None) -> ReadResult[PenFile | None]:
    decoded = read_text(path, "pens", source=source, encoding_hint=encoding_hint)
    if decoded.data is None:
        return ReadResult(None, decoded.diagnostics, Availability.UNAVAILABLE)
    text = decoded.data
    raw_lines = tuple(line for line in
                      re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", text) if line)
    bodies = tuple(line.rstrip("\r\n") for line in raw_lines)
    modules = []
    versions = []
    for body in bodies:
        module_match = re.fullmatch(r"//MODULE[ \t]*=[ \t]*(.*)", body)
        version_match = re.fullmatch(r"//VERSION[ \t]*=[ \t]*(.*)", body)
        if module_match is not None:
            modules.append(module_match[1])
        if version_match is not None:
            versions.append(version_match[1])
    supported = modules == ["LINETHICKNESSES"] and versions == ["1.0"]
    issues = list(decoded.diagnostics)
    lines = []
    section = None
    declared = None
    section_count = 0
    section_found = False
    seen: dict[str, Provenance] = {}

    def finish_section() -> None:
        if (section is not None and declared is not None
                and (declared.lstrip("0") or "0") != str(section_count)):
            issues.append(diagnostic(
                "pens_count_mismatch", "pens",
                "Nombre d'occurrences different du compte declare ; aucune correction.",
                provenance=Provenance(path, source, section),
            ))

    for position, (raw, body) in enumerate(zip(raw_lines, bodies), 1):
        origin = Provenance(path, source, position)
        local = []
        kind: Literal["comment", "blank", "section", "record", "unknown"] = "unknown"
        count = None
        record = None
        if body.startswith("//"):
            kind = "comment"
        elif not body.strip(" \t"):
            kind = "blank"
        elif supported and (match := re.fullmatch(r"\.L[ \t]+([0-9]+)[ \t]*", body)):
            finish_section()
            section = position
            declared = count = match[1]
            section_count = 0
            section_found = True
            kind = "section"
        elif body.startswith("."):
            finish_section()
            section = declared = None
            local.append(diagnostic(
                "pens_section_unknown", "pens",
                "Section non reconnue ; lignes conservees sans repli.",
                provenance=origin,
            ))
        elif supported and section is not None:
            match = re.fullmatch(r"[ \t]*([^ \t]+)(?:[ \t]+([^ \t]+))?(.*)", body)
            assert match is not None
            record = PenRecord(match[1], match[2], match[3])
            kind = "record"
            section_count += 1
            if not re.fullmatch(r"[0-9]+", record.code):
                local.append(diagnostic(
                    "pens_code_unresolved", "pens", "Code atypique conserve sans conversion.",
                    provenance=origin,
                ))
            if record.numeric_value is None:
                local.append(diagnostic(
                    "pens_value_unresolved", "pens",
                    "Valeur absente ou non decimale conservee sans remplacement.",
                    provenance=origin,
                ))
            if record.code in seen:
                local.append(diagnostic(
                    "pens_code_repeated", "pens", "Code repete ; occurrences conservees.",
                    provenance=origin, related=seen[record.code],
                ))
            else:
                seen[record.code] = origin
            if record.remainder.strip(" \t") and not re.fullmatch(
                    r'[ \t]+"[^"]*"[ \t]*', record.remainder):
                local.append(diagnostic(
                    "pens_remainder_unresolved", "pens",
                    "Champs complementaires non reconnus conserves sans interpretation.",
                    provenance=origin,
                ))
        else:
            local.append(diagnostic(
                "pens_line_unresolved", "pens",
                "Ligne hors section reconnue ; texte conserve.",
                provenance=origin,
            ))
        lines.append(PenLine(raw, kind, origin, section, count, record, tuple(local)))
        issues.extend(local)
    finish_section()
    origin = Provenance(path, source)
    data = PenFile(origin, text, tuple(lines))
    if not supported or not section_found:
        issues.append(diagnostic(
            "pens_format_unsupported", "pens",
            "Signature LINETHICKNESSES 1.0 ou section .L non reconnue.",
            severity="error", provenance=origin,
        ))
        return ReadResult(data, tuple(issues), Availability.UNAVAILABLE)
    if not any(line.record is not None for line in lines):
        issues.append(diagnostic(
            "pens_no_records", "pens", "Aucun enregistrement ; pas de modele de remplacement.",
            severity="error", provenance=origin,
        ))
        return ReadResult(data, tuple(issues), Availability.UNAVAILABLE)
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
