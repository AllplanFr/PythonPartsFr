"""Lexical LINETYPES 3.x reading, without rendering patterns or merging sources."""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
import re
from typing import Literal

from ..models import Availability, Diagnostic, Provenance, ReadResult, diagnostic
from ..text import read_text


@dataclass(frozen=True)
class LineTypeRecord:
    syntax: Literal["pairs", "extended"]
    code: str
    values: tuple[str, ...]
    name: str | None
    remainder: str

    @property
    def numeric_values(self) -> tuple[Decimal | None, ...]:
        output = []
        for token in self.values:
            value = None
            if re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?",
                            token):
                try:
                    value = Decimal(token)
                except InvalidOperation:
                    pass
            output.append(value if value is not None and value.is_finite() else None)
        return tuple(output)


@dataclass(frozen=True)
class LineTypeLine:
    raw: str
    provenance: Provenance
    section: int | None
    declared_count: str | None
    record: LineTypeRecord | None
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True)
class LineTypeFile:
    provenance: Provenance
    text: str
    versions: tuple[str, ...]
    lines: tuple[LineTypeLine, ...]


def read_line_types_file(path: Path, source: str, *,
                         encoding_hint: str | None = None) -> ReadResult[LineTypeFile | None]:
    decoded = read_text(path, "line_types", source=source, encoding_hint=encoding_hint)
    if decoded.data is None:
        return ReadResult(None, decoded.diagnostics, Availability.UNAVAILABLE)
    text = decoded.data
    raws = tuple(x for x in re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", text) if x)
    modules = []
    versions = []
    for raw in raws:
        body = raw.rstrip("\r\n")
        for key, values in (("MODULE", modules), ("VERSION", versions)):
            match = re.fullmatch(r"//" + key + r"[ \t]*=[ \t]*(.*)", body)
            if match is not None:
                values.append(match[1])
    supported = modules == ["LINETYPES"] and bool(versions) and all(
        re.fullmatch(r"3\.[012](?: changes:.*)?", v) for v in versions)
    issues = list(decoded.diagnostics)
    lines = []
    section = None
    declared = None
    count = 0
    seen: dict[str, Provenance] = {}
    section_found = False

    def finish_section() -> None:
        if (section is not None and declared is not None
                and (declared.lstrip("0") or "0") != str(count)):
            issues.append(diagnostic("line_types_count_mismatch", "line_types",
                                     "Compte declare different des occurrences a paires.",
                                     provenance=Provenance(path, source, section)))

    for position, raw in enumerate(raws, 1):
        body = raw.rstrip("\r\n")
        origin = Provenance(path, source, position)
        local = []
        record = None
        declared_count = None

        def report(code: str, message: str, related: Provenance | None = None) -> None:
            local.append(diagnostic(code, "line_types", message,
                                    provenance=origin, related=related))

        if body.startswith("//") or not body.strip(" \t"):
            pass
        elif supported and (match := re.fullmatch(r"\.L[ \t]+([0-9]+)[ \t]*", body)):
            finish_section()
            section = position
            declared = declared_count = match[1]
            count = 0
            section_found = True
        elif body.startswith("."):
            finish_section()
            section = declared = None
            report("line_types_section_unknown", "Section inconnue conservee sans repli.")
        elif supported and section is not None:
            extended = re.fullmatch(r'([^,\r\n]+),"([^"]*)",(.*)', body)
            if extended is not None:
                record = LineTypeRecord("extended", extended[1],
                                        tuple(extended[3].split(",")),
                                        extended[2], extended[3])
                report("line_types_extended_uninterpreted",
                       "Sequence et marqueurs etendus conserves sans interpretation.")
            elif "," in body:
                report("line_types_line_invalid",
                       "Syntaxe etendue non reconnue ; ligne brute conservee.")
            else:
                matches = tuple(re.finditer(r"[^ \t]+", body))
                fields = tuple(match[0] for match in matches)
                record = LineTypeRecord("pairs", fields[0], fields[1:12], None,
                                        body[matches[min(len(matches), 12) - 1].end():])
                count += 1
                if len(fields) != 12:
                    report("line_types_fields_invalid",
                           "Onze valeurs attendues apres ID ; champs bruts conserves.")
                if any(value is None for value in record.numeric_values):
                    report("line_types_numeric_unresolved",
                           "Valeur non decimale conservee sans remplacement.")
            if record is not None:
                if not re.fullmatch(r"[0-9]+", record.code):
                    report("line_types_code_unresolved", "ID atypique conserve sans conversion.")
                if record.code in seen:
                    report("line_types_code_repeated", "ID repete ; occurrences conservees.",
                           seen[record.code])
                else:
                    seen[record.code] = origin
        else:
            report("line_types_line_unresolved", "Ligne hors section reconnue conservee.")
        lines.append(LineTypeLine(raw, origin, section, declared_count, record, tuple(local)))
        issues.extend(local)
    finish_section()
    origin = Provenance(path, source)
    data = LineTypeFile(origin, text, tuple(versions), tuple(lines))
    if not supported or not section_found or not any(x.record is not None for x in lines):
        issues.append(diagnostic("line_types_format_unavailable", "line_types",
                                 "Signature, section ou enregistrements exploitables absents.",
                                 severity="error", provenance=origin))
        return ReadResult(data, tuple(issues), Availability.UNAVAILABLE)
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
