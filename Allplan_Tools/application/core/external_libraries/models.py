"""Immutable source occurrences, not SmartCatalog destination nodes."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import hashlib
from typing import Iterator

from ..allplan.models import Diagnostic, Provenance


class DetectionState(str, Enum):
    RECOGNIZED = "recognized"
    INCOMPATIBLE = "incompatible"
    AMBIGUOUS = "ambiguous"
    UNSUPPORTED = "recognized_unsupported"


@dataclass(frozen=True)
class SourceProperty:
    name: str
    value: str


@dataclass(frozen=True)
class SourceOccurrence:
    tag: str
    properties: tuple[SourceProperty, ...]
    children: tuple[SourceOccurrence, ...]
    text: str | None
    tail: str | None
    namespaces: tuple[tuple[str, str], ...]
    element_path: tuple[int, ...]
    provenance: Provenance

    @property
    def occurrence_id(self) -> str:
        """Structural identity scoped to this document snapshot, never a business code."""
        return "xml:" + (".".join(map(str, self.element_path)) or "root")

    def property(self, name: str) -> str | None:
        """An absent property is None; an explicitly empty one is ''."""
        return next((item.value for item in self.properties if item.name == name), None)


@dataclass(frozen=True)
class Detection:
    adapter_id: str
    adapter_version: str
    state: DetectionState
    diagnostics: tuple[Diagnostic, ...]


@dataclass(frozen=True)
class ConsultationDocument:
    root: SourceOccurrence
    source_bytes: bytes
    detection: Detection

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.source_bytes).hexdigest()

    def occurrences(self) -> Iterator[SourceOccurrence]:
        """Preorder includes the envelope and unknown elements without filtering."""
        stack = [self.root]
        while stack:
            current = stack.pop()
            yield current
            stack.extend(reversed(current.children))
