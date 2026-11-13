"""Pure view of selected attribute 209 XML options, not a universal trade dictionary."""
from dataclasses import dataclass

from application.core.allplan.models import (
    Availability, Diagnostic, Provenance, ReadResult, diagnostic,
)
from .attribute_references import (
    AttributeReferences, ReferenceOption, SourceDefinition,
)


@dataclass(frozen=True)
class TradeOption:
    source: ReferenceOption
    provenance: Provenance
    element_path: tuple[int, int]
    diagnostics: tuple[Diagnostic, ...]

    @property
    def code(self) -> str | None:
        return self.source.code

    @property
    def label(self) -> str | None:
        return self.source.label

    @property
    def position(self) -> int:
        return self.source.position


@dataclass(frozen=True)
class TradeReferences:
    source: ReadResult[AttributeReferences | None]
    definitions: tuple[SourceDefinition, ...]
    selected: SourceDefinition | None
    options: tuple[TradeOption, ...]


def build_trade_references(
    source: ReadResult[AttributeReferences | None],
) -> ReadResult[TradeReferences]:
    """Keep exact codes/labels and occurrences; no XML access, sorting or deduplication."""
    issues = list(source.diagnostics)
    definitions = tuple(
        definition for collection in source.data.collections
        for definition in collection.definitions
        if (definition.xml.value("Ifnr") or "").strip().lstrip("0") == "209"
    ) if source.data is not None else ()
    entry = source.data.selected.get("209") if source.data is not None else None
    selected = entry.source if entry is not None else None

    def unavailable(code, message):
        issues.append(diagnostic(
            code, "smartcatalog_trades", message, severity="error",
            provenance=selected.provenance if selected is not None else None,
        ))
        return ReadResult(TradeReferences(source, definitions, selected, ()),
                          tuple(issues), Availability.UNAVAILABLE)

    if source.data is None or source.state == Availability.UNAVAILABLE:
        return unavailable("trades_source_unavailable", "Definitions indisponibles.")
    if selected is None:
        return unavailable("trades_definition_unavailable",
                           "Definition 209 absente ou non interpretable ; sources conservees.")
    assert entry is not None
    origin = selected.provenance
    controls = tuple(
        (index, prop) for index, prop in enumerate(selected.xml.children, 1)
        if prop.tag in ("Enumeration", "ComboBox", "CheckBox", "TextBox", "Formula", "Value")
    )
    if (entry.interpreted.datatype != "E" or len(controls) != 1
            or controls[0][1].tag != "Enumeration"):
        return unavailable("trades_control_unsupported",
                           "Definition 209 non exploitable comme Enumeration unique.")
    control_index, control = controls[0]
    options = []
    seen_codes = {}
    seen_labels = {}
    for position, item in enumerate(control.children, 1):
        if item.tag != "Item":
            issues.append(diagnostic(
                "trades_item_unsupported", "smartcatalog_trades",
                "Element hors Item conserve dans la definition source.",
                provenance=selected.provenance,
            ))
            continue
        option = ReferenceOption("Enumeration", item.value("Key"), item.value("Value"),
                                 position, item)
        option_issues = []

        def warn(code, message):
            option_issues.append(diagnostic(
                code, "smartcatalog_trades", message, provenance=origin,
            ))

        if option.code is None:
            warn("trades_code_missing", "Code absent, aucune position de remplacement.")
        elif not option.code.isascii() or not option.code.isdecimal():
            warn("trades_code_atypical", "Code atypique conserve sans conversion.")
        if option.label is None:
            warn("trades_label_missing", "Libelle absent, distinct du libelle vide.")
        if len(item.fields("Key")) > 1 or len(item.fields("Value")) > 1:
            warn("trades_property_repeated", "Proprietes repetees conservees dans la source.")
        if option.code is not None:
            if option.code in seen_codes:
                warn("trades_code_repeated", "Code repete, occurrence conservee.")
            seen_codes[option.code] = position
        if option.label is not None:
            if option.label in seen_labels:
                warn("trades_label_repeated", "Libelle repete, occurrence conservee.")
            seen_labels[option.label] = position
        options.append(TradeOption(option, selected.provenance,
                                   (control_index, position), tuple(option_issues)))
        issues.extend(option_issues)
    data = TradeReferences(source, definitions, selected, tuple(options))
    return ReadResult(data, tuple(issues),
                      Availability.WITH_DIAGNOSTICS if issues else Availability.AVAILABLE)
