"""Lecture/écriture des fichiers VOB Allplan (adaptée de VobWidget.vob_table_load, Qt)."""

import os
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from .messages import MessageError

ENCODINGS = ("utf-8", "cp1252")
UTF8_BOM = b"\xef\xbb\xbf"
SEPARATOR = "#"
FIELD_COUNT = 5
RULE_FIELDS = ("trade", "object", "unit", "method", "formula", "comment")


@dataclass
class VobLayout:
    """Mise en page d'origine, pour réécrire le fichier sans perte."""

    encoding: str = "utf-8"
    newline: str = "\r\n"
    comment_style: str = "//"
    # Chaque entrée : (ligne brute avec fin de ligne, règle ou None)
    entries: list = field(default_factory=list)
    header: list[str] = field(default_factory=list)
    header_entry_indices: list[int] = field(default_factory=list)
    original_header: list[str] = field(default_factory=list)


def read_vob(path):
    """Retourne (rules, layout) ; rules respecte l'ordre du fichier."""
    raw = Path(path).read_bytes()
    return read_vob_data(raw)


def read_vob_data(raw, *, log_ignored=True):
    """Parse les octets deja lus et controles par le contexte Allplan."""
    text, encoding = _decode(raw)
    layout = VobLayout(encoding=encoding)
    newline_counts = {}
    style_counts = {"//": 0, ";": 0}
    rules = []
    seen_rule = False

    for number, raw_line in enumerate(text.splitlines(keepends=True), start=1):
        content = raw_line.rstrip("\r\n")
        ending = raw_line[len(content):]
        if ending:
            newline_counts[ending] = newline_counts.get(ending, 0) + 1
        rule, enabled = _parse_rule_line(content)
        if isinstance(rule, dict):
            rule["enabled"] = enabled
            seen_rule = True
        elif rule is None and not seen_rule and content.lstrip().startswith("//"):
            header_line = content.lstrip()[2:]
            if header_line.startswith(" "):
                header_line = header_line[1:]
            layout.header.append(header_line)
            layout.header_entry_indices.append(len(layout.entries))
        if isinstance(rule, str):
            if log_ignored:
                print(f"[vob_format] ligne {number} ignoree : {rule}")
            rule = None
        if rule is not None:
            rules.append(rule)
            style = _comment_style(content)
            if style:
                style_counts[style] += 1
        layout.entries.append((raw_line, dict(rule) if rule is not None else None))
    layout.original_header = list(layout.header)

    if newline_counts:
        layout.newline = max(newline_counts, key=newline_counts.get)
    if style_counts[";"] > style_counts["//"]:
        layout.comment_style = ";"
    return rules, layout


def write_vob(path, rules, layout=None, header=None):
    """Écrit les règles en conservant les lignes inchangées ; retourne la nouvelle mise en page."""
    data, new_layout = serialize_vob(rules, layout, header)
    _atomic_write(Path(path), data)
    return new_layout


def serialize_vob(rules, layout=None, header=None):
    """Sérialise les règles et retourne les octets et la mise en page résultante."""
    layout = layout or VobLayout()
    new_layout = VobLayout(
        encoding=layout.encoding,
        newline=layout.newline,
        comment_style=layout.comment_style,
    )
    selected_header = layout.header if header is None else _normalize_header(header)
    entries = list(layout.entries)
    header_indices = set(layout.header_entry_indices)
    header_indices_after = list(layout.header_entry_indices)
    if selected_header != layout.header:
        insertion = min(header_indices) if header_indices else 0
        entries = [
            entry for index, entry in enumerate(entries)
            if index not in header_indices
        ]
        entries[insertion:insertion] = [
            (f"//{line}{layout.newline}", None) for line in selected_header
        ]
        header_indices_after = list(range(insertion, insertion + len(selected_header)))
    new_layout.header = list(selected_header)
    new_layout.original_header = list(selected_header)
    new_layout.header_entry_indices = header_indices_after
    pending = list(rules)
    rule_slots = [index for index, (_line, rule) in enumerate(entries) if rule is not None]
    last_slot = rule_slots[-1] if rule_slots else None

    def append_new(rule):
        generated_line = format_vob_rule(rule, layout.comment_style) + layout.newline
        new_layout.entries.append((generated_line, _normalized_rule(rule)))

    for index, (raw_line, original) in enumerate(entries):
        if original is None:
            new_layout.entries.append((raw_line, None))
        elif pending:
            rule = pending.pop(0)
            if _same_rule(rule, original):
                new_layout.entries.append((raw_line, _normalized_rule(rule)))
            else:
                ending = raw_line[len(raw_line.rstrip("\r\n")):] or layout.newline
                line = format_vob_rule(rule, layout.comment_style) + ending
                new_layout.entries.append((line, _normalized_rule(rule)))
        if index == last_slot and pending:
            _ensure_line_end(new_layout)
            while pending:
                append_new(pending.pop(0))

    if pending:
        _ensure_line_end(new_layout)
        while pending:
            append_new(pending.pop(0))

    text = "".join(line for line, _rule in new_layout.entries)
    try:
        data = text.encode(layout.encoding)
    except UnicodeEncodeError as exc:
        raise MessageError(
            "encoding-error", character=repr(text[exc.start]), encoding=layout.encoding,
        ) from None
    return data, new_layout


def format_vob_rule(rule, comment_style="//"):
    """Formate une règle et vérifie qu'elle sera relue à l'identique."""
    for name in RULE_FIELDS:
        if not isinstance(rule.get(name), str):
            raise ValueError(f"Le champ {name} doit être une chaîne.")
        if "\n" in rule[name] or "\r" in rule[name]:
            raise ValueError(f"Le champ {name} ne doit pas contenir de retour à la ligne.")
    line = SEPARATOR + SEPARATOR.join(
        rule[name] for name in ("trade", "object", "unit", "method", "formula")
    )
    if rule["comment"]:
        line += f" {comment_style} {rule['comment']}"
    if parse_vob_line(line) != {name: rule[name] for name in RULE_FIELDS}:
        raise MessageError("rule-format", rule=line)
    enabled = rule.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError("Le champ enabled doit être un booléen.")
    return line if enabled else "//" + line


def parse_vob_lines(lines):
    rules = []
    for number, line in enumerate(lines, start=1):
        rule = parse_vob_line(line)
        if rule is None:
            continue
        if isinstance(rule, str):
            print(f"[vob_format] ligne {number} ignoree : {rule}")
            continue
        rules.append(rule)
    return rules


def parse_vob_line(line):
    """Retourne une règle, None (ligne vide/commentaire) ou un motif de rejet."""
    if not isinstance(line, str):
        return "ligne non texte"
    line = line.strip()
    if not line or not line.startswith(SEPARATOR):
        return None
    if line.count(SEPARATOR) != FIELD_COUNT:
        return f"{line.count(SEPARATOR)} separateurs au lieu de {FIELD_COUNT}"

    fields = line.replace(SEPARATOR, "", 1).split(SEPARATOR, FIELD_COUNT - 1)
    if len(fields) != FIELD_COUNT:
        return "nombre de champs invalide"

    trade, obj, unit, method, formula = (value.strip() for value in fields)
    formula, comment = _split_comment(formula)
    return {
        "trade": trade,
        "object": obj,
        "unit": unit,
        "method": method,
        "formula": formula,
        "comment": comment,
    }


def _parse_rule_line(line):
    rule = parse_vob_line(line)
    if isinstance(rule, dict):
        return rule, True
    if not isinstance(line, str):
        return rule, True
    stripped = line.lstrip()
    if not stripped.startswith("//"):
        return rule, True
    candidate = stripped[2:]
    if candidate.startswith(" "):
        candidate = candidate[1:]
    disabled_rule = parse_vob_line(candidate)
    if isinstance(disabled_rule, dict):
        return disabled_rule, False
    return rule, True


def _normalize_header(header):
    if not isinstance(header, list) or any(not isinstance(line, str) for line in header):
        raise MessageError("invalid-header")
    normalized = []
    for line in header:
        if "\n" in line or "\r" in line:
            raise MessageError("invalid-header")
        stripped = line.lstrip()
        if stripped.startswith("//"):
            stripped = stripped[2:]
            if stripped.startswith(" "):
                stripped = stripped[1:]
            normalized.append(stripped)
        else:
            normalized.append(line)
    return normalized


def _normalized_rule(rule):
    normalized = dict(rule)
    normalized["enabled"] = rule.get("enabled", True)
    return normalized


def _decode(raw):
    if raw.startswith(UTF8_BOM):
        return raw.decode("utf-8-sig"), "utf-8-sig"
    for encoding in ENCODINGS:
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("Encodage du fichier VOB non reconnu.")


def _split_comment(formula):
    comment = ""
    if ";" in formula:
        formula, comment = formula.split(";", 1)
        formula = formula.strip()
        comment = comment.replace("//", "").strip()
    if "//" in formula:
        formula, comment = formula.split("//", 1)
        formula = formula.strip()
        comment = comment.strip()
    return formula, comment


def _comment_style(line):
    formula = line.split(SEPARATOR, FIELD_COUNT)[-1]
    if ";" in formula:
        return ";"
    if "//" in formula:
        return "//"
    return None


def _same_rule(left, right):
    return (
        all(left.get(name) == right.get(name) for name in RULE_FIELDS)
        and left.get("enabled", True) == right.get("enabled", True)
    )


def _ensure_line_end(layout):
    if layout.entries:
        line, rule = layout.entries[-1]
        if not line.endswith(("\r", "\n")):
            layout.entries[-1] = (line + layout.newline, rule)


def _atomic_write(path, data):
    if path.exists():
        if not os.access(path, os.W_OK):
            raise PermissionError(f"Fichier en lecture seule : {path}")
        shutil.copy2(path, path.with_name(path.name + ".bak"))
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise
