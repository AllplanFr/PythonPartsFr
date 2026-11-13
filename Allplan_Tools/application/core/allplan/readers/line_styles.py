"""Read the observed pseudo-tag line style syntax, not XML or resolved graphics."""
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Literal

from ..models import Availability, Diagnostic, Provenance, ReadResult, diagnostic
from ..text import read_text


@dataclass(frozen=True)
class StyleField:
    tag: str
    value: str
    properties: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class StyleLine:
    raw: str
    provenance: Provenance
    block: int | None
    kind: Literal["comment", "blank", "open", "close", "fields", "group", "unknown"]
    fields: tuple[StyleField, ...]
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True)
class LineStyleFile:
    provenance: Provenance
    text: str
    lines: tuple[StyleLine, ...]


def read_line_styles_file(path: Path, source: str, *,
                          encoding_hint: str | None = None) -> ReadResult[LineStyleFile | None]:
    decoded = read_text(path, "line_styles", source=source, encoding_hint=encoding_hint)
    if decoded.data is None:
        return ReadResult(None, decoded.diagnostics, Availability.UNAVAILABLE)
    text = decoded.data
    raws = tuple(x for x in re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", text) if x)
    supported = sum(bool(re.fullmatch(r"//MODULE[ \t]*=[ \t]*LAYER, LINESTYLE",
                                      x.rstrip("\r\n"))) for x in raws) == 1
    issues = list(decoded.diagnostics)
    lines = []
    block = None
    found = False
    singletons: dict[str, Provenance] = {}
    rule_keys: dict[tuple[str, str], Provenance] = {}
    identifiers: dict[tuple[str, str], Provenance] = {}
    groups: dict[str, Provenance] = {}
    references: list[tuple[str, Provenance]] = []

    for position, raw in enumerate(raws, 1):
        body = raw.rstrip("\r\n")
        origin = Provenance(path, source, position)
        local = []
        fields: tuple[StyleField, ...] = ()
        kind: Literal["comment", "blank", "open", "close", "fields", "group", "unknown"] = "unknown"

        def report(code: str, message: str, related: Provenance | None = None) -> None:
            local.append(diagnostic(code, "line_styles", message,
                                    provenance=origin, related=related))

        if body.startswith("//"):
            kind = "comment"
        elif not body.strip(" \t"):
            kind = "blank"
        elif supported and body == "<ls>":
            if block is not None:
                report("line_styles_nested_block", "Bloc precedent non ferme ; occurrences conservees.")
            block = position
            singletons = {}
            rule_keys = {}
            kind = "open"
            found = True
        elif supported and body == "</ls>":
            kind = "close"
            if block is None:
                report("line_styles_close_orphan", "Fermeture sans bloc.")
            elif "nr" not in singletons:
                report("line_styles_id_missing", "Bloc sans numero explicite.")
        elif supported:
            group = re.fullmatch(r"<grp><nr>([^<]*)</nr><wname>([^<]*)</wname></grp>", body)
            simple = re.fullmatch(r'[ \t]*<(wname|nr)>([^<]*)</\1>'
                                  r'(?:[ \t]*<grp>([^<]*)</grp>)?[ \t]*', body)
            rule = re.fullmatch(r'[ \t]*<(sc|dt)>([^<]*)'
                                r'((?:<[A-Za-z_][A-Za-z_0-9]*="[^"]*">)*)</\1>[ \t]*', body)
            if group is not None:
                kind = "group"
                fields = (StyleField("nr", group[1]), StyleField("wname", group[2]))
                if block is not None:
                    report("line_styles_group_in_block", "Declaration de groupe dans un bloc.")
                groups.setdefault(group[1], origin)
            elif simple is not None:
                kind = "fields"
                fields = (StyleField(simple[1], simple[2]),)
                if simple[3] is not None:
                    fields += (StyleField("grp", simple[3]),)
                    references.append((simple[3], origin))
            elif rule is not None:
                kind = "fields"
                properties = tuple(re.findall(r'<([A-Za-z_][A-Za-z_0-9]*)="([^"]*)">', rule[3]))
                fields = (StyleField(rule[1], rule[2], properties),)
                names = [name for name, _ in properties]
                if any(name not in ("sti", "str99", "f256") for name in names):
                    report("line_styles_property_unknown", "Propriete inconnue conservee.")
                if any(names.count(name) != 1 for name in ("sti", "str99", "f256")):
                    report("line_styles_properties_incomplete",
                           "Propriete attendue absente ou repetee ; aucune valeur par defaut.")
                key = (rule[1], rule[2])
                previous = rule_keys.get(key)
                if previous is not None:
                    report("line_styles_rule_repeated",
                           "Cle de regle repetee dans le bloc ; occurrences conservees.",
                           previous)
                else:
                    rule_keys[key] = origin
            if kind == "unknown":
                report("line_styles_line_unknown", "Ligne non reconnue conservee sans interpretation.")
            elif kind == "fields" and block is None:
                report("line_styles_field_orphan", "Champs sans bloc ls resolu.")
            for field in fields:
                if field.tag == "nr":
                    if field.value == "":
                        report("line_styles_id_empty", "Identifiant explicitement vide conserve.")
                    key = ("group" if kind == "group" else "style", field.value)
                    previous = identifiers.get(key)
                    if previous is not None:
                        report("line_styles_id_repeated", "Identifiant repete ; occurrences conservees.",
                               previous)
                    else:
                        identifiers[key] = origin
                if kind == "fields" and field.tag in ("nr", "wname", "grp"):
                    previous = singletons.get(field.tag)
                    if previous is not None:
                        report("line_styles_field_repeated", "Champ de bloc repete conserve.", previous)
                    singletons.setdefault(field.tag, origin)
        else:
            report("line_styles_format_unresolved", "Ligne sans signature reconnue conservee.")
        lines.append(StyleLine(raw, origin, block, kind, fields, tuple(local)))
        issues.extend(local)
        if kind == "close":
            block = None
            singletons = {}
    origin = Provenance(path, source)
    if block is not None:
        issues.append(diagnostic("line_styles_block_unclosed", "line_styles",
                                 "Bloc non ferme conserve.", provenance=Provenance(path, source, block)))
    for value, reference in references:
        if value not in groups:
            issues.append(diagnostic("line_styles_group_unresolved", "line_styles",
                                     "Reference de groupe sans declaration textuellement identique.",
                                     provenance=reference))
    data = LineStyleFile(origin, text, tuple(lines))
    if not supported or not found:
        issues.append(diagnostic("line_styles_unavailable", "line_styles",
                                 "Signature ou bloc ls absent ; aucun modele de remplacement.",
                                 severity="error", provenance=origin))
        return ReadResult(data, tuple(issues), Availability.UNAVAILABLE)
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
