"""Lossless CP1252 / UTF-16LE edits of a validated Version 3 document."""
from dataclasses import dataclass
import codecs
import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile
from uuid import uuid4

from .readers.project_attributes import read_project_attributes


class SaveError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def fingerprint(body):
    return hashlib.sha256(body).hexdigest() if body is not None else None


def safe_path(path):
    for item in (path, *path.parents):
        try:
            info = item.lstat()
        except FileNotFoundError:
            if item == path:
                continue
            raise
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise SaveError("linked_path", "Lien ou point de reanalyse refuse.")


def current_bytes(path):
    safe_path(path)
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def ensure_writable(path):
    safe_path(path)
    parent = path.parent.stat()
    if not parent.st_mode & stat.S_IWRITE or not os.access(path.parent, os.W_OK):
        raise SaveError("read_only", "Dossier projet non accessible en ecriture.")
    if path.exists():
        info = path.stat()
        if (not stat.S_ISREG(info.st_mode) or not info.st_mode & stat.S_IWRITE
                or getattr(info, "st_file_attributes", 0) & 1
                or not os.access(path, os.W_OK)):
            raise SaveError("read_only", "prjatt.dat en lecture seule ou non modifiable.")


def render(source, changes, names):
    encoding, bom = "cp1252", b""
    if source is not None:
        if source.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE,
                              codecs.BOM_UTF16_BE, codecs.BOM_UTF8)):
            raise SaveError("unsupported_encoding", "Formats acceptes : CP1252 sans BOM ou UTF-16LE avec BOM.")
        if source.startswith(codecs.BOM_UTF16_LE):
            encoding, bom = "utf-16-le", codecs.BOM_UTF16_LE
    try:
        text = source[len(bom):].decode(encoding, errors="strict") if source is not None else "Version 3\r\n"
        lines = re.findall(r"[^\r\n]*(?:\r\n|\r|\n|$)", text)
        if lines and lines[-1] == "":
            lines.pop()
        if not lines or lines[0].rstrip("\r\n") != "Version 3":
            raise SaveError("invalid_source", "En-tete Version 3 requis.")
        newline = next(iter(re.findall(r"\r\n|\r|\n", text)), "\r\n")
        pending = dict(changes)
        for number, value in pending.items():
            if value is None:
                raise SaveError("null_unspecified", "Persistance de null non definie ; aucun fichier ecrit.")
            if (not isinstance(number, str) or not re.fullmatch(r"0|[1-9][0-9]*", number)
                    or not isinstance(value, str) or any(c in value for c in "\r\n\x00")):
                raise SaveError("invalid_value", "Numero canonique et valeur sur une seule ligne requis.")
            value.encode(encoding, errors="strict")
        seen = set()
        for index, line in enumerate(lines[1:], 1):
            ending = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else "\r" if line.endswith("\r") else ""
            body = line[:-len(ending)] if ending else line
            parts = body.split("|", 2)
            if len(parts) != 3 or not re.fullmatch(r"[0-9]+", parts[0]) or "\x00" in body:
                raise SaveError("invalid_source", "Ligne source invalide.")
            number = parts[0].lstrip("0") or "0"
            if number in seen:
                raise SaveError("invalid_source", "Numero duplique.")
            seen.add(number)
            if number in pending:
                lines[index] = parts[0] + "|" + parts[1] + "|" + pending.pop(number) + ending
        for number, value in pending.items():
            name = names.get(number)
            if not isinstance(name, str) or not name or any(c in name for c in "|\r\n\x00"):
                raise SaveError("definition_required", "Nom Allplan issu des definitions requis pour un ajout.")
            if not lines[-1].endswith(("\r", "\n")):
                lines[-1] += newline
            lines.append(number + "|" + name + "|" + value + newline)
        return bom + "".join(lines).encode(encoding, errors="strict")
    except UnicodeError as exc:
        raise SaveError("encoding_failed", "Document, valeur ou nom incompatible avec l'encodage " + encoding + ".") from exc


@dataclass
class PreparedWrite:
    path: Path
    expected: bytes | None
    body: bytes
    temporary: Path
    backup: Path | None = None
    replaced: bool = False
    publication_attempted: bool = False
    backup_verified: bool = False

    def cleanup(self):
        self.temporary.unlink(missing_ok=True)

    def commit(self):
        ensure_writable(self.path)
        if current_bytes(self.path) != self.expected:
            raise SaveError("external_conflict", "prjatt.dat a change depuis le chargement.")
        if self.expected is not None:
            self.backup = self.path.with_name(f"prjatt.dat.{uuid4().hex}.bak")
            with self.backup.open("xb") as stream:
                stream.write(self.expected)
                stream.flush()
                os.fsync(stream.fileno())
            if self.backup.read_bytes() != self.expected:
                raise SaveError("backup_failed", "Sauvegarde non conforme ; remplacement interdit.")
            self.backup_verified = True
        # A concurrent external writer is not locked by this optimistic check.
        if current_bytes(self.path) != self.expected:
            raise SaveError("external_conflict", "Modification externe avant engagement.")
        ensure_writable(self.path)
        self.publication_attempted = True
        if self.expected is None:
            # Atomic no-overwrite publication: a concurrent creator must not be overwritten.
            os.link(self.temporary, self.path)
            self.replaced = True
            self.temporary.unlink()
        else:
            os.replace(self.temporary, self.path)
            self.replaced = True
        self.verify()

    def verify(self):
        if current_bytes(self.path) != self.body:
            raise SaveError("verification_failed", "Relecture des octets non conforme.")
        result = read_project_attributes(self.path.parent)
        if result.data.status != "read" or result.data.source_bytes != self.body:
            raise SaveError("verification_failed", "Relecture du document non conforme.")
        return result.data


def prepare(path, expected, changes, names):
    ensure_writable(path)
    if current_bytes(path) != expected:
        raise SaveError("external_conflict", "prjatt.dat a change depuis le chargement.")
    body = render(expected, changes, names)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, prefix=".allplan-prjatt-",
                                         suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        if temporary.read_bytes() != body or render(body, {}, {}) != body:
            raise SaveError("temporary_invalid", "Temporaire non conforme.")
        return PreparedWrite(path, expected, body, temporary)
    except (OSError, ValueError):
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        raise
