"""Pure presentation-type switching, independent of acquisition and import."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ..allplan.models import Diagnostic, diagnostic
from .models import SourceOccurrence


class PresentedType(str, Enum):
    FOLDER = "folder"
    MATERIAL = "material"
    COMPONENT = "component"
    LINK = "link"
    DATA = "data"
    UNKNOWN = "unknown"


class ContentType(str, Enum):
    MATERIAL = "material"
    COMPONENT = "component"
    MIXED = "mixed"
    UNDETERMINED = "undetermined"


class SwitchRefusal(str, Enum):
    """STRUCTURAL_CHILDREN concerns item descendants, never organizing folders."""
    LINKS = "links_present"
    MIXED = "mixed_material_component"
    STRUCTURAL_CHILDREN = "structural_children"
    UNKNOWN_STRUCTURE = "unknown_structure"
    NO_ITEMS = "no_material_or_component"
    OVERLAPPING_SCOPE = "overlapping_scope"


@dataclass(frozen=True)
class SwitchMetadata:
    current_type: ContentType
    available: bool
    target_type: ContentType | None
    refusal: SwitchRefusal | None


@dataclass(frozen=True)
class PresentedOccurrence:
    source: SourceOccurrence
    presented_type: PresentedType
    children: tuple[PresentedOccurrence, ...]

    @property
    def occurrence_id(self) -> str:
        return self.source.occurrence_id


@dataclass(frozen=True)
class TypeScope:
    """Explicit roots supplied by a caller, not an application selection policy."""
    roots: tuple[PresentedOccurrence, ...]

    @property
    def metadata(self) -> SwitchMetadata:
        return _metadata(self.roots)

    @property
    def import_compatibility(self) -> str:
        """No destination is supplied, so compatibility is never asserted/cached."""
        return "not_evaluated"


@dataclass(frozen=True)
class TypeSwitchResult:
    accepted: bool
    scope: TypeScope
    diagnostics: tuple[Diagnostic, ...] = ()


_TAGS = {
    "Folder": PresentedType.FOLDER, "Dossier": PresentedType.FOLDER,
    "Material": PresentedType.MATERIAL,
    "Component": PresentedType.COMPONENT, "Composant": PresentedType.COMPONENT,
    "Link": PresentedType.LINK,
    "Attribute": PresentedType.DATA,
    "description": PresentedType.DATA, "Unité": PresentedType.DATA,
    "code_externe": PresentedType.DATA,
}
_ITEM_TYPES = {PresentedType.MATERIAL, PresentedType.COMPONENT}


def prepare_type_scope(roots: tuple[SourceOccurrence, ...]) -> TypeScope:
    """Keep immutable source objects intact; do not infer or strip an envelope.

    The caller must pass the intended content roots explicitly. An unrecognized
    wrapper is refused rather than silently flattened. Only Attribute subtrees
    allow opaque nonstructural data; structural tags inside them remain visible.
    """
    ordered = []
    stack = [(root, False) for root in reversed(roots)]
    while stack:
        node, in_attribute = stack.pop()
        kind = _TAGS.get(node.tag, PresentedType.DATA if in_attribute else PresentedType.UNKNOWN)
        ordered.append((node, kind))
        stack.extend((child, in_attribute or node.tag == "Attribute")
                     for child in reversed(node.children))
    converted = {}
    for node, kind in reversed(ordered):
        converted[id(node)] = PresentedOccurrence(
            node, kind, tuple(converted[id(child)] for child in node.children))
    return TypeScope(tuple(converted[id(root)] for root in roots))


def _metadata(roots: tuple[PresentedOccurrence, ...]) -> SwitchMetadata:
    kinds = set()
    links = structural = unknown = overlapping = False
    seen = set()
    stack = [(root, None, False) for root in reversed(roots)]
    while stack:
        node, parent, inside_item = stack.pop()
        kind = node.presented_type
        identity = (node.source.provenance.path, node.source.provenance.source,
                    node.source.element_path)
        if identity in seen:
            overlapping = True
        seen.add(identity)
        if kind in _ITEM_TYPES:
            kinds.add(kind)
        links |= kind == PresentedType.LINK
        unknown |= kind == PresentedType.UNKNOWN or (
            parent is None and kind == PresentedType.DATA
        )
        if parent is not None:
            if parent in _ITEM_TYPES and kind != PresentedType.DATA:
                structural = True
            if parent == PresentedType.DATA and kind != PresentedType.DATA:
                if inside_item:
                    structural = True
                else:
                    unknown = True
        stack.extend((child, kind, inside_item or kind in _ITEM_TYPES)
                     for child in reversed(node.children))
    current = (ContentType.MIXED if len(kinds) > 1 else
               ContentType(next(iter(kinds)).value) if kinds else ContentType.UNDETERMINED)
    reason = (
        SwitchRefusal.OVERLAPPING_SCOPE if overlapping else
        SwitchRefusal.LINKS if links else
        SwitchRefusal.MIXED if current == ContentType.MIXED else
        SwitchRefusal.STRUCTURAL_CHILDREN if structural else
        SwitchRefusal.UNKNOWN_STRUCTURE if unknown else
        SwitchRefusal.NO_ITEMS if not kinds else None
    )
    target = None
    if reason is None:
        target = ContentType.COMPONENT if current == ContentType.MATERIAL else ContentType.MATERIAL
    return SwitchMetadata(current, reason is None, target, reason)


def switch_types(scope: TypeScope) -> TypeSwitchResult:
    """Atomically return a new view or the exact old scope on refusal.

    Unexpected programming errors propagate; the immutable input cannot become
    partially converted. No persistence or destination validation is performed.
    """
    metadata = scope.metadata
    if not metadata.available:
        assert metadata.refusal is not None
        issue = diagnostic(
            "type_switch_" + metadata.refusal.value, "external_type_switch",
            "Bascule refusee : " + metadata.refusal.value,
            provenance=scope.roots[0].source.provenance if scope.roots else None,
        )
        return TypeSwitchResult(False, scope, (issue,))
    ordered = []
    stack = list(reversed(scope.roots))
    while stack:
        node = stack.pop()
        ordered.append(node)
        stack.extend(reversed(node.children))
    converted = {}
    for node in reversed(ordered):
        kind = node.presented_type
        if kind in _ITEM_TYPES:
            kind = (PresentedType.COMPONENT if kind == PresentedType.MATERIAL
                    else PresentedType.MATERIAL)
        converted[id(node)] = PresentedOccurrence(
            node.source, kind, tuple(converted[id(child)] for child in node.children))
    return TypeSwitchResult(True, TypeScope(tuple(converted[id(root)] for root in scope.roots)))
