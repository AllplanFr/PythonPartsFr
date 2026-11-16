"""UI-independent reader contracts. No reader mutates an Allplan source."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
import hashlib
import logging
from pathlib import Path
from typing import Generic, Literal, TypeVar


class Availability(str, Enum):
    NOT_LOADED = "not_loaded"
    LOADING = "loading"
    AVAILABLE = "available"
    WITH_DIAGNOSTICS = "available_with_diagnostics"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class Provenance:
    path: Path
    source: str
    position: int | None = None


@dataclass(frozen=True)
class Diagnostic:
    code: str
    category: str
    message: str
    severity: Literal["info", "warning", "error"] = "warning"
    provenance: Provenance | None = None
    attribute_number: str | None = None
    related: Provenance | None = None
    suppression_key: str | None = None
    uids: tuple[str, str] | None = None


def diagnostic(code: str, category: str, message: str, *,
               severity: Literal["info", "warning", "error"] = "warning",
               provenance: Provenance | None = None,
               attribute_number: str | None = None,
               related: Provenance | None = None,
               conflict_identity: str | None = None,
               uids: tuple[str, str] | None = None) -> Diagnostic:
    """Presentation suppression never suppresses detection or this log record."""
    key = None
    if code == "uid_conflict" and conflict_identity is not None:
        key = hashlib.sha256(conflict_identity.encode("utf-8")).hexdigest()
    logging.getLogger(__name__).log(
        {"info": logging.INFO, "warning": logging.WARNING, "error": logging.ERROR}[severity],
        "Allplan reader: category=%s code=%s attribute=%s conflict=%s",
        category, code, attribute_number, key,
    )
    return Diagnostic(code, category, message, severity, provenance,
                      attribute_number, related, key, uids)


T = TypeVar("T")


@dataclass(frozen=True)
class ReadResult(Generic[T]):
    data: T
    diagnostics: tuple[Diagnostic, ...] = ()
    state: Availability = Availability.AVAILABLE


@dataclass(frozen=True)
class Proposition:
    index: int | None
    text: str
    provenance: Provenance
    generated_index: bool = False


@dataclass(frozen=True)
class XmlProperty:
    name: str
    text: str | None
    children: tuple[XmlProperty, ...] = ()


@dataclass(frozen=True)
class AttributeDefinition:
    number: str
    uid: str
    label: str
    datatype: str
    group_mask: int
    unit: str | None
    minimum: Decimal | None
    maximum: Decimal | None
    modify: bool | None
    visible: bool | None
    control: str | None
    propositions: tuple[Proposition, ...]
    formulas: tuple[str, ...]
    properties: tuple[XmlProperty, ...]
    provenance: Provenance

    @property
    def is_user(self) -> bool:
        return 2000 <= int(self.number) < 12000

    @property
    def is_imported(self) -> bool:
        return 55000 <= int(self.number) < 99000


# Explicit historical bit identities, not translated labels or favorites.
GROUP_BITS = {
    0: "BENUTZER", 1: "MENGEN", 2: "ALLGEMEIN", 3: "ARCHALLG",
    4: "PLANHISTORY", 5: "RAUMTECH", 6: "DIN277", 7: "TEILBILD",
    8: "ING", 9: "ALLFA", 10: "ARCHINT", 11: "LANDBAU", 12: "STADT",
    13: "WAERME", 14: "PLAN", 15: "ARCHSPEZ", 16: "PROJEKT", 17: "DGM",
    18: "DACHHAUT", 19: "INTVERL", 20: "EINBAUTEIL", 21: "FERTIGTEIL_D",
    22: "TGA_HEIZUNG", 23: "TGA_LUEFTUNG", 24: "TGA_ELEKTRO",
    25: "TGA_SANITAER", 26: "TGA_EXTRAS", 27: "INT_OBJMAN",
    28: "INT_KATASTER", 29: "ADDIN_MODULE", 30: "MATERIAL", 31: "IFC",
    32: "IBD", 33: "WETO", 34: "FIDES", 35: "INTERNATIONAL",
    36: "AUSTRIA", 37: "VORLAGE", 38: "NAMINGSYSTEM", 39: "SENDPACKAGE",
    40: "USER_LAYOUT", 41: "WIDO", 42: "STEEL", 43: "NEVARIS",
    44: "KLASSIFIZIERUNG", 45: "PROFILE", 46: "FERTIGTEIL_STANDARD",
    47: "FERTIGTEIL_USER", 48: "IBDING", 49: "BRIDGE", 50: "?",
    51: "BAUGRUB", 52: "CLASH_DETECTION", 53: "IMPORT",
}


def group_ids(mask: int) -> tuple[str, ...]:
    if mask < 0:
        raise ValueError("Group mask must be nonnegative.")
    return tuple("ATTR_PRG_BEREICH_" + name
                 for bit, name in sorted(GROUP_BITS.items()) if mask & (1 << bit))
