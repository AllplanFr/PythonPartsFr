"""Deterministic XML discovery and first-valid attribute definitions."""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import logging
from pathlib import Path
import re
from xml.etree.ElementTree import Element, ParseError

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from application.core.context import LaunchContext
from ..models import (
    AttributeDefinition, Availability, Diagnostic, Proposition, Provenance,
    ReadResult, XmlProperty, diagnostic, GROUP_BITS,
)
from ..sources import SourceSelection, language_suffix


@dataclass(frozen=True)
class AttributeFiles:
    language: str
    system: tuple[Path, ...]
    custom: tuple[Path, ...]
    custom_source: str


def _inventory(directory: Path, source: str) -> ReadResult[tuple[Path, ...]]:
    try:
        files = tuple(sorted(
            (p for p in directory.iterdir()
             if "attributedefinition" in p.name.lower()
             and p.suffix.lower() == ".xml" and p.is_file()),
            key=lambda p: (p.name.casefold(), p.name),
        ))
        return ReadResult(files)
    except OSError:
        issue = diagnostic("directory_access", "attributes", "Repertoire XML inaccessible.",
                           severity="error", provenance=Provenance(directory, source))
        return ReadResult((), (issue,), Availability.UNAVAILABLE)


def _select(files: tuple[Path, ...], language: str, *,
            prefer_unsuffixed: bool) -> tuple[Path, ...]:
    families: dict[str, list[tuple[str | None, Path]]] = {}
    for path in files:
        match = re.fullmatch(r"(.+?)_([a-z]{2})", path.stem, re.IGNORECASE)
        base, suffix = (match[1], match[2].lower()) if match else (path.stem, None)
        families.setdefault(base.casefold(), []).append((suffix, path))
    selected = []
    for family in sorted(families):
        variants = families[family]
        plain = [path for suffix, path in variants if suffix is None]
        localized = [path for suffix, path in variants if suffix == language]
        selected.extend(plain if prefer_unsuffixed and plain else localized or plain)
    return tuple(selected)


def discover_attributes(context: LaunchContext, selection: SourceSelection,
                        application_language: str, *,
                        project_only: bool = False) -> ReadResult[AttributeFiles | None]:
    issues = list(selection.diagnostics)
    etc = context.paths.get("ETC")
    if etc is None:
        issues.append(diagnostic("system_source_missing", "attributes",
                                 "Chemin ETC non resolu.", severity="error"))
        return ReadResult(None, tuple(issues), Availability.UNAVAILABLE)
    inventory = _inventory(etc / "Xml", "etc")
    issues.extend(inventory.diagnostics)
    if project_only:
        families = {
            "attributedefinitioncollectionallplan",
            "attributedefinitioncollectionallplan2",
            "attributedefinitioncollection_prjpassivehouse",
        }
        inventory = ReadResult(tuple(
            path for path in inventory.data
            if re.sub(r"_[a-z]{2}$", "", path.stem, flags=re.IGNORECASE).casefold()
            in families
        ), inventory.diagnostics, inventory.state)
    candidates = dict.fromkeys(filter(None, (
        language_suffix(application_language),
        language_suffix(context.allplan_language), "en",
    )))
    language = next((lang for lang in candidates if any(
        path.stem.casefold() == f"attributedefinitioncollectionallplan_{lang}"
        for path in inventory.data
    )), None)
    if language is None:
        issues.append(diagnostic("system_definition_missing", "attributes",
                                 "Aucun fichier systeme obligatoire dans les langues admissibles.",
                                 severity="error", provenance=Provenance(etc / "Xml", "etc")))
        return ReadResult(None, tuple(issues), Availability.UNAVAILABLE)
    system = _select(inventory.data, language, prefer_unsuffixed=False)
    mandatory = f"attributedefinitioncollectionallplan_{language}"
    system = tuple(sorted(system, key=lambda p: (
        p.stem.casefold() != mandatory, p.name.casefold(), p.name,
    )))
    custom: tuple[Path, ...] = ()
    if selection.directory is None:
        issues.append(diagnostic("custom_source_missing", "attributes",
                                 "Chemin de personnalisation non resolu."))
    else:
        custom_inventory = _inventory(selection.directory / "Xml", selection.kind)
        issues.extend(custom_inventory.diagnostics)
        if project_only:
            custom_inventory = ReadResult(tuple(
                path for path in custom_inventory.data
                if re.sub(r"_[a-z]{2}$", "", path.stem, flags=re.IGNORECASE).casefold()
                == "attributedefinitioncollectionlocal"
            ), custom_inventory.diagnostics, custom_inventory.state)
        custom = _select(custom_inventory.data, language, prefer_unsuffixed=True)
        if project_only and not custom:
            issues.append(diagnostic(
                "custom_definition_missing", "attributes",
                "Collection Local absente pour la source et la langue retenues.",
                severity="error", provenance=Provenance(selection.directory / "Xml",
                                                       selection.kind),
            ))
        if custom_inventory.data and not custom:
            issues.append(diagnostic("custom_language_missing", "attributes",
                                     "Aucune personnalisation dans la langue retenue.",
                                     provenance=Provenance(selection.directory / "Xml",
                                                           selection.kind)))
    data = AttributeFiles(language, system, custom, selection.kind)
    logging.getLogger(__name__).debug("XML language=%s system_files=%d custom_files=%d",
                                      language, len(system), len(custom))
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)


def read_project_definitions(files: ReadResult[AttributeFiles | None]):
    """Reuse first-valid resolution, then filter the real Group bitmask."""
    result = read_attributes(files)
    return ReadResult(
        {number: entry for number, entry in result.data.items()
         if entry.group_mask & 65536},
        result.diagnostics, result.state,
    )


def _tag(element: Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _property(element: Element) -> XmlProperty:
    return XmlProperty(_tag(element), element.text,
                       tuple(_property(child) for child in element))


def _entry(element: Element, origin: Provenance,
           issues: list[Diagnostic]) -> AttributeDefinition | None:
    fields = {_tag(child): child for child in element}

    def text(name: str) -> str | None:
        child = fields.get(name)
        return None if child is None else (child.text or "").strip()

    number = text("Ifnr")
    try:
        if number is None or not re.fullmatch(r"[0-9]+", number):
            raise ValueError("Ifnr")
        uid, label, datatype = text("Uid"), text("Text"), text("Datatype")
        if not uid or not label or not datatype:
            raise ValueError("Identite ou datatype")
        group = int(text("Group") or "")
        if group < 0:
            raise ValueError("Group")

        def bound(name: str) -> Decimal | None:
            value = text(name)
            if value in (None, ""):
                return None
            parsed = Decimal(value)
            if not parsed.is_finite():
                raise ValueError(name)
            return parsed

        def boolean(name: str) -> bool | None:
            value = text(name)
            if value is None:
                return None
            if value not in ("true", "false"):
                raise ValueError(name)
            return value == "true"

        minimum, maximum = bound("MinValue"), bound("MaxValue")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise ValueError("Bornes")
        modify, visible = boolean("Modify"), boolean("Visible")
    except (ValueError, InvalidOperation):
        issues.append(diagnostic("invalid_definition", "attributes",
                                 "Definition invalide ignoree.", provenance=origin,
                                 attribute_number=number))
        return None
    if datatype not in ("C", "R", "I", "D", "E"):
        issues.append(diagnostic("unsupported_definition_type", "attributes",
                                 "Type de definition non pris en charge ; definition ignoree.",
                                 provenance=origin, attribute_number=number))
        return None
    if group >> (max(GROUP_BITS) + 1):
        issues.append(diagnostic("group_bits_unknown", "attributes",
                                 "Bits de groupe inconnus conserves dans le masque.",
                                 provenance=origin, attribute_number=number))
    control = next((name for name in ("Enumeration", "ComboBox", "CheckBox", "Formula", "Value")
                    if name in fields), None)
    options = []
    seen = set()
    if control in ("Enumeration", "ComboBox"):
        for position, item in enumerate(fields[control], 1):
            if _tag(item) != "Item":
                continue
            values = {_tag(child): (child.text or "").strip() for child in item}
            try:
                if "Value" not in values:
                    raise ValueError("Value")
                index = int(values["Key"]) if "Key" in values else None
                if control == "Enumeration" and (index is None or index < 0):
                    raise ValueError("Key")
            except ValueError:
                issues.append(diagnostic("invalid_proposition", "attributes",
                                         "Proposition XML invalide ignoree.",
                                         provenance=origin, attribute_number=number))
                continue
            identity = index if control == "Enumeration" else values["Value"]
            if identity in seen:
                issues.append(diagnostic("duplicate_proposition", "attributes",
                                         "Premiere proposition XML conservee.",
                                         provenance=origin, attribute_number=number))
                continue
            seen.add(identity)
            options.append(Proposition(index, values["Value"],
                                       Provenance(origin.path, origin.source, position)))
    formulas = tuple((child.text or "") for child in element.iter()
                     if _tag(child) == "Formula")
    return AttributeDefinition(
        number, uid, label, datatype, group, text("Unit"), minimum, maximum,
        modify, visible, control, tuple(options), formulas,
        tuple(_property(child) for child in element), origin,
    )


def read_attribute_file(path: Path, source: str) -> ReadResult[tuple[AttributeDefinition, ...]]:
    origin = Provenance(path, source)
    try:
        with path.open("rb") as stream:
            if not stream.read(1):
                issue = diagnostic("xml_empty", "attributes", "Fichier XML vide.",
                                   severity="error", provenance=origin)
                return ReadResult((), (issue,), Availability.UNAVAILABLE)
            stream.seek(0)
            # Byte parsing respects XML declarations and rejects entities/DTDs.
            root = ElementTree.parse(stream, forbid_dtd=True).getroot()
    except OSError as exc:
        issue = diagnostic("file_missing" if isinstance(exc, FileNotFoundError) else "file_access",
                           "attributes", "Fichier XML absent ou inaccessible.",
                           severity="error", provenance=origin)
        return ReadResult((), (issue,), Availability.UNAVAILABLE)
    except (ParseError, DefusedXmlException, LookupError, UnicodeError):
        issue = diagnostic("xml_invalid", "attributes", "XML globalement invalide.",
                           severity="error", provenance=origin)
        return ReadResult((), (issue,), Availability.UNAVAILABLE)
    issues: list[Diagnostic] = []
    data = []
    for position, child in enumerate(root, 1):
        if _tag(child) != "AttributeDefinition":
            continue
        entry = _entry(child, Provenance(path, source, position), issues)
        if entry is not None:
            data.append(entry)
    return ReadResult(tuple(data), tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)


def read_attributes(files: ReadResult[AttributeFiles | None]) -> ReadResult[dict[str, AttributeDefinition]]:
    issues = list(files.diagnostics)
    if files.data is None:
        return ReadResult({}, tuple(issues), Availability.UNAVAILABLE)
    data: dict[str, AttributeDefinition] = {}
    mandatory_ok = False
    for source, paths in (("etc", files.data.system),
                          (files.data.custom_source, files.data.custom)):
        for path in paths:
            result = read_attribute_file(path, source)
            issues.extend(result.diagnostics)
            if source == "etc" and path.stem.casefold() == (
                f"attributedefinitioncollectionallplan_{files.data.language}"
            ):
                mandatory_ok = result.state != Availability.UNAVAILABLE
            for entry in result.data:
                identity = str(int(entry.number))
                first = data.get(identity)
                if first is None:
                    data[identity] = entry
                    continue
                conflict = first.uid.casefold() != entry.uid.casefold()
                issues.append(diagnostic(
                    "uid_conflict" if conflict else "duplicate_definition", "attributes",
                    "Premiere definition valide conservee.", provenance=entry.provenance,
                    related=first.provenance, attribute_number=entry.number,
                    conflict_identity=repr((
                        identity, first.uid.casefold(), entry.uid.casefold(),
                        str(first.provenance.path).casefold(), str(entry.provenance.path).casefold(),
                    )) if conflict else None,
                    uids=(first.uid, entry.uid) if conflict else None,
                ))
    if not mandatory_ok:
        return ReadResult({}, tuple(issues), Availability.UNAVAILABLE)
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
