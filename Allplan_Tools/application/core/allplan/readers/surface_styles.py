"""Lexical reading of observed FaceStyle pseudo-tags, without graphics resolution."""
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Literal

from ..models import Availability, Diagnostic, Provenance, ReadResult, diagnostic
from ..text import read_text


@dataclass(frozen=True)
class SurfaceField:
    tag: str
    value: str
    properties: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class SurfaceRecord:
    raw: str
    provenance: Provenance
    end_position: int
    block: int | None
    kind: Literal["comment", "blank", "open", "close", "fields", "group", "unknown"]
    fields: tuple[SurfaceField, ...]
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True)
class SurfaceStyleFile:
    provenance: Provenance
    text: str
    records: tuple[SurfaceRecord, ...]


def read_surface_styles_file(path: Path, source: str, *,
                             encoding_hint: str | None = None) -> ReadResult[SurfaceStyleFile | None]:
    decoded = read_text(path, "surface_styles", source=source, encoding_hint=encoding_hint)
    if decoded.data is None:
        return ReadResult(None, decoded.diagnostics, Availability.UNAVAILABLE)
    text = decoded.data
    raws = tuple(x for x in re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", text) if x)
    supported = sum(bool(re.fullmatch(r"//MODULE[ \t]*=[ \t]*DEFINITION, FaceStyle",
                                      x.rstrip("\r\n"))) for x in raws) == 1
    issues = list(decoded.diagnostics)
    records = []
    block = None
    found = False
    singletons: dict[str, Provenance] = {}
    rules: dict[tuple[str, str], Provenance] = {}
    identifiers: dict[tuple[str, str], Provenance] = {}
    groups: set[str] = set()
    references: list[tuple[str, Provenance]] = []
    index = 0
    while index < len(raws):
        start = index + 1
        raw = raws[index]
        index += 1
        # A rule may continue on physical lines containing pseudo-properties.
        opening = re.match(r"[ \t]*<(sc|dt)>", raw) if supported else None
        if opening is not None:
            while f"</{opening[1]}>" not in raw and index < len(raws):
                if not re.match(r'[ \t]*<[A-Za-z_][A-Za-z_0-9-]*="', raws[index]):
                    break
                raw += raws[index]
                index += 1
        body = raw.rstrip("\r\n")
        origin = Provenance(path, source, start)
        local = []
        fields: tuple[SurfaceField, ...] = ()
        kind: Literal["comment", "blank", "open", "close", "fields", "group", "unknown"] = "unknown"

        def report(code: str, message: str, related: Provenance | None = None) -> None:
            local.append(diagnostic("surface_styles_" + code, "surface_styles", message,
                                    provenance=origin, related=related))

        if body.startswith("//"):
            kind = "comment"
        elif not body.strip(" \t"):
            kind = "blank"
        elif supported and body == "<fs>":
            if block is not None:
                report("nested_block", "Bloc precedent non ferme ; occurrences conservees.")
            block = start
            found = True
            singletons = {}
            rules = {}
            kind = "open"
        elif supported and body == "</fs>":
            kind = "close"
            if block is None:
                report("close_orphan", "Fermeture sans bloc.")
            elif "nr" not in singletons:
                report("id_missing", "Bloc sans numero explicite.")
        elif supported:
            group = re.fullmatch(r"<grp><nr>([^<]*)</nr><wname>([^<]*)</wname></grp>", body)
            simple = re.fullmatch(r"[ \t]*<(wname|nr)>([^<\r\n]*)</\1>"
                                  r"(?:[ \t]*<grp>([^<\r\n]*)</grp>)?[ \t]*", body)
            rule = re.fullmatch(r'[ \t]*<(sc|dt)>([^<\r\n]*)'
                                r'((?:[ \t\r\n]*<[A-Za-z_][A-Za-z_0-9-]*="[^"]*">)*)'
                                r'[ \t\r\n]*</\1>[ \t]*', body)
            if group is not None:
                kind = "group"
                fields = (SurfaceField("nr", group[1]), SurfaceField("wname", group[2]))
                groups.add(group[1])
                if block is not None:
                    report("group_in_block", "Declaration de groupe dans un bloc.")
            elif simple is not None:
                kind = "fields"
                fields = (SurfaceField(simple[1], simple[2]),)
                if simple[3] is not None:
                    fields += (SurfaceField("grp", simple[3]),)
                    references.append((simple[3], origin))
            elif rule is not None:
                kind = "fields"
                properties = tuple(re.findall(r'<([A-Za-z_][A-Za-z_0-9-]*)="([^"]*)">', rule[3]))
                fields = (SurfaceField(rule[1], rule[2], properties),)
                names = [name for name, _ in properties]
                if any(name not in ("sch", "sch-bzm", "mus", "mus-bzm", "mus-bre",
                                    "mus-hoe", "mus-art", "fil") for name in names):
                    report("property_unknown", "Propriete non etablie conservee sans resolution.")
                if len(names) != len(set(names)):
                    report("property_repeated", "Proprietes repetees conservees.")
                key = (rule[1], rule[2])
                if block is not None:
                    if key in rules:
                        report("rule_repeated", "Cle de regle repetee conservee.", rules[key])
                    rules.setdefault(key, origin)
            if kind == "unknown":
                report("record_unknown", "Texte non reconnu conserve sans interpretation.")
            elif kind == "fields" and block is None:
                report("field_orphan", "Champs sans bloc fs resolu.")
            for field in fields:
                if field.tag == "nr":
                    if field.value == "":
                        report("id_empty", "Identifiant explicitement vide conserve.")
                    key = ("group" if kind == "group" else "style", field.value)
                    if key in identifiers:
                        report("id_repeated", "Identifiant repete ; occurrences conservees.",
                               identifiers[key])
                    identifiers.setdefault(key, origin)
                if kind == "fields" and block is not None and field.tag in ("nr", "wname", "grp"):
                    if field.tag in singletons:
                        report("field_repeated", "Champ de bloc repete conserve.", singletons[field.tag])
                    singletons.setdefault(field.tag, origin)
        else:
            report("format_unresolved", "Texte sans signature reconnue conserve.")
        records.append(SurfaceRecord(raw, origin, index, block, kind, fields, tuple(local)))
        issues.extend(local)
        if kind == "close":
            block = None
    origin = Provenance(path, source)
    if block is not None:
        issues.append(diagnostic("surface_styles_block_unclosed", "surface_styles",
                                 "Bloc non ferme conserve.", provenance=Provenance(path, source, block)))
    for value, reference in references:
        if value not in groups:
            issues.append(diagnostic("surface_styles_group_unresolved", "surface_styles",
                                     "Reference sans declaration textuellement identique.",
                                     provenance=reference))
    data = SurfaceStyleFile(origin, text, tuple(records))
    if not supported or not found:
        issues.append(diagnostic("surface_styles_unavailable", "surface_styles",
                                 "Signature ou bloc fs absent ; aucun modele de remplacement.",
                                 severity="error", provenance=origin))
        return ReadResult(data, tuple(issues), Availability.UNAVAILABLE)
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
