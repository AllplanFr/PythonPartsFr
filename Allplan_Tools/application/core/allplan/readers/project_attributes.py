"""Lossless read-only representation of a project's prjatt.dat."""
from dataclasses import dataclass
from pathlib import Path
import re

from ..models import Availability, Provenance, ReadResult, diagnostic
from ..text import decode_text


@dataclass(frozen=True)
class ProjectAttribute:
    number: str
    name: str
    value: str
    line: int


@dataclass(frozen=True)
class ProjectAttributes:
    status: str
    header: str | None
    text: str | None
    records: tuple[ProjectAttribute, ...] = ()
    source_bytes: bytes | None = None
    project_identity: tuple[int, int] | None = None
    project_config: bytes | None = None

    def values(self):
        if self.status == "error":
            return None
        return {(record.number.lstrip("0") or "0"): record.value for record in self.records}


def read_project_attributes(project: Path) -> ReadResult[ProjectAttributes]:
    path = project / "prjatt.dat"
    try:
        if path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
            issue = diagnostic("linked_file", "project_attributes",
                               "Lien prjatt.dat refuse.", severity="error",
                               provenance=Provenance(path, "project"))
            return ReadResult(ProjectAttributes("error", None, None), (issue,),
                              Availability.UNAVAILABLE)
    except FileNotFoundError:
        issue = diagnostic("file_missing", "project_attributes",
                           "prjatt.dat absent ; projet sans valeurs enregistrees.",
                           severity="info", provenance=Provenance(path, "project"))
        return ReadResult(ProjectAttributes("missing", None, None), (issue,))
    except OSError:
        issue = diagnostic("file_access", "project_attributes",
                           "Fichier inaccessible.", severity="error",
                           provenance=Provenance(path, "project"))
        return ReadResult(ProjectAttributes("error", None, None), (issue,),
                          Availability.UNAVAILABLE)
    try:
        raw = path.read_bytes()
    except OSError as exc:
        missing = isinstance(exc, FileNotFoundError)
        issue = diagnostic("file_missing" if missing else "file_access",
                           "project_attributes", "Fichier absent ou inaccessible.",
                           severity="error", provenance=Provenance(path, "project"))
        return ReadResult(ProjectAttributes("missing" if missing else "error", None, None),
                          (issue,), Availability.AVAILABLE if missing else Availability.UNAVAILABLE)
    result = decode_text(raw, "project_attributes", Provenance(path, "project"),
                         encoding_hint="cp1252")
    if result.data is None:
        missing = any(issue.code == "file_missing" for issue in result.diagnostics)
        return ReadResult(
            ProjectAttributes("missing" if missing else "error", None, None),
            result.diagnostics,
            Availability.AVAILABLE if missing else Availability.UNAVAILABLE,
        )
    text = result.data
    lines = re.split(r"\r\n|\n|\r", text)
    issues = list(result.diagnostics)

    def issue(code, line_number):
        issues.append(diagnostic(
            code, "project_attributes", "Fichier prjatt.dat invalide.",
            severity="error", provenance=Provenance(path, "project", line_number),
        ))

    header = lines[0] if lines else ""
    if header != "Version 3":
        issue("invalid_header", 1)
    records, seen = [], set()
    for position, line in enumerate(lines[1:], 2):
        if position == len(lines) and not line:
            continue
        parts = line.split("|", 2)
        if (len(parts) != 3 or not re.fullmatch(r"[0-9]+", parts[0])
                or "\x00" in line or "\r" in line):
            issue("invalid_line", position)
            continue
        number, name, value = parts
        # Numeric identity only; preserve the original spelling in records/text.
        identity = number.lstrip("0") or "0"
        if identity in seen:
            issue("duplicate_number", position)
        seen.add(identity)
        records.append(ProjectAttribute(number, name, value, position))
    failed = bool(issues)
    return ReadResult(
        ProjectAttributes("error" if failed else "read", header, text, tuple(records), raw),
        tuple(issues), Availability.UNAVAILABLE if failed else Availability.AVAILABLE,
    )
