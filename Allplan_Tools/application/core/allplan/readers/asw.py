"""ASW reading and pure proposition composition, without document edits."""
from pathlib import Path
from dataclasses import dataclass
import re
from typing import Literal

from ..models import Availability, Proposition, Provenance, ReadResult, diagnostic
from ..sources import SourceSelection
from ..text import read_text


EXCLUDED = frozenset({618, 645})


@dataclass(frozen=True)
class AswDirectory:
    path: Path
    source: str


def resolve_asw_directory(selection: SourceSelection,
                          std: Path | None) -> ReadResult[AswDirectory | None]:
    issues = list(selection.diagnostics)
    candidates = [(selection.directory, selection.kind)]
    if selection.kind == "project" and std is not None:
        candidates.append((std, "std"))
    for root, kind in candidates:
        if root is None:
            continue
        directory = root / "asw"
        try:
            entries = tuple(directory.iterdir())
        except OSError:
            issues.append(diagnostic("asw_directory_access", "asw",
                                     "Repertoire ASW inutilisable.",
                                     provenance=Provenance(directory, kind)))
            continue
        if not entries:
            issues.append(diagnostic("asw_empty_directory_unresolved", "asw",
                                     "Dossier ASW vide : repli non valide.",
                                     provenance=Provenance(directory, kind)))
            return ReadResult(None, tuple(issues), Availability.UNAVAILABLE)
        return ReadResult(AswDirectory(directory, kind), tuple(issues),
                          Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
    issues.append(diagnostic("asw_source_unavailable", "asw",
                             "Aucune source ASW utilisable.", severity="error"))
    return ReadResult(None, tuple(issues), Availability.UNAVAILABLE)


def read_asw_file(path: Path, source: str, *,
                  encoding_hint: str | None = None) -> ReadResult[tuple[Proposition, ...]]:
    match = re.fullmatch(r"attrib_([0-9]+)\.asw", path.name, re.IGNORECASE)
    if match is None:
        issue = diagnostic("asw_name_invalid", "asw", "Nom ASW non reconnu.",
                           provenance=Provenance(path, source))
        return ReadResult((), (issue,), Availability.UNAVAILABLE)
    number = int(match[1])
    if number in EXCLUDED:
        issue = diagnostic("asw_excluded", "asw", "Attribut exclu, fichier non lu.",
                           severity="info", attribute_number=str(number))
        return ReadResult((), (issue,), Availability.WITH_DIAGNOSTICS)
    result = read_text(path, "asw", source=source, encoding_hint=encoding_hint)
    issues = list(result.diagnostics)
    if result.data is None:
        return ReadResult((), tuple(issues), Availability.UNAVAILABLE)
    data = []
    for position, raw in enumerate(result.data.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, text = line.partition("|")
        origin = Provenance(path, source, position)
        index = None
        if separator:
            if not re.fullmatch(r"-?[0-9]+", key.strip()):
                issues.append(diagnostic("asw_index_invalid", "asw",
                                         "Index invalide ignore.", provenance=origin,
                                         attribute_number=str(number)))
                continue
            index = int(key.strip())
            if index < 0:
                issues.append(diagnostic(
                    "asw_negative_one_unresolved" if index == -1 else "asw_index_invalid",
                    "asw", "Index negatif non interprete.", provenance=origin,
                    attribute_number=str(number),
                ))
                continue
            text = text.strip()
        else:
            text = key
        data.append(Proposition(index, text, origin))
    return ReadResult(tuple(data), tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)


def read_asw_attribute(directory: ReadResult[AswDirectory | None], number: str,
                       *, encoding_hint: str | None = None
                       ) -> ReadResult[tuple[Proposition, ...]]:
    if not re.fullmatch(r"[0-9]+", number):
        raise ValueError("Numero d'attribut invalide.")
    if int(number) in EXCLUDED:
        issue = diagnostic("asw_excluded", "asw", "Attribut exclu, fichier non lu.",
                           severity="info", attribute_number=number)
        return ReadResult((), (issue,), Availability.WITH_DIAGNOSTICS)
    if directory.data is None:
        return ReadResult((), directory.diagnostics, Availability.UNAVAILABLE)
    result = read_asw_file(directory.data.path / f"attrib_{int(number)}.asw",
                           directory.data.source,
                           encoding_hint=encoding_hint)
    return ReadResult(result.data, directory.diagnostics + result.diagnostics,
                      result.state if not directory.diagnostics else (
                          Availability.UNAVAILABLE if result.state == Availability.UNAVAILABLE
                          else Availability.WITH_DIAGNOSTICS))


def compose_propositions(xml: tuple[Proposition, ...],
                         asw: ReadResult[tuple[Proposition, ...]], *,
                         kind: Literal["combobox", "enumeration"],
                         attribute_number: str) -> ReadResult[tuple[Proposition, ...]]:
    if kind not in ("combobox", "enumeration"):
        raise ValueError("Controle a propositions attendu.")
    issues = list(asw.diagnostics)
    output = []
    seen = set()
    if kind == "combobox":
        for entry in (*xml, *asw.data):
            if entry.text not in seen:
                seen.add(entry.text)
                output.append(entry)
    else:
        for entry in xml:
            if entry.index is None or entry.index < 0:
                raise ValueError("Index XML d'enumeration invalide.")
            if entry.index not in seen:
                seen.add(entry.index)
                output.append(entry)
        # Do not let a synthetic empty option replace an explicit valid index 0.
        if not output and not any(entry.index == 0 for entry in asw.data):
            output.append(Proposition(0, "", Provenance(Path(), "synthetic"), True))
            seen.add(0)
        maximum = max(seen, default=-1)
        for entry in asw.data:
            index = entry.index
            if index is None:
                if entry.text == "" and any(item.text == "" for item in output):
                    continue
                index = maximum + 1
            if index in seen:
                issues.append(diagnostic("duplicate_proposition", "asw",
                                         "Premiere proposition d'index conservee.",
                                         provenance=entry.provenance,
                                         attribute_number=attribute_number))
                continue
            seen.add(index)
            maximum = max(maximum, index)
            output.append(Proposition(index, entry.text, entry.provenance, entry.index is None))
        output.sort(key=(lambda item: (item.text.casefold(), item.index))
                    if int(attribute_number) == 209 else lambda item: item.index)
    state = Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE
    if asw.state == Availability.UNAVAILABLE and not xml:
        state = Availability.UNAVAILABLE
    return ReadResult(tuple(output), tuple(issues), state)
