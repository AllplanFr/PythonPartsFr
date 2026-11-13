"""Strict text decoding; XML readers instead parse the original bytes."""
from pathlib import Path
import codecs
import logging

from .models import Availability, Provenance, ReadResult, diagnostic


def read_text(path: Path, category: str, *, source: str = "selected",
              encoding_hint: str | None = None) -> ReadResult[str | None]:
    origin = Provenance(path, source)
    try:
        raw = path.read_bytes()
    except OSError as exc:
        issue = diagnostic("file_missing" if isinstance(exc, FileNotFoundError) else "file_access",
                           category, "Fichier absent ou inaccessible.",
                           severity="error", provenance=origin)
        return ReadResult(None, (issue,), Availability.UNAVAILABLE)
    return decode_text(raw, category, origin, encoding_hint=encoding_hint)


def decode_text(raw: bytes, category: str, origin: Provenance, *,
                encoding_hint: str | None = None) -> ReadResult[str | None]:
    if not raw:
        return ReadResult("")
    if raw.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)):
        encoding = "utf-32"
    elif raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        encoding = "utf-16"
    elif raw.startswith(codecs.BOM_UTF8):
        encoding = "utf-8-sig"
    else:
        encoding = encoding_hint or "utf-8"
        if b"\x00" in raw and encoding_hint is None:
            issue = diagnostic("encoding_ambiguous", category,
                               "Texte sans BOM contenant des octets nuls : encodage a confirmer.",
                               severity="error", provenance=origin)
            return ReadResult(None, (issue,), Availability.UNAVAILABLE)
    try:
        text = raw.decode(encoding, errors="strict")
        logging.getLogger(__name__).debug("Text category=%s source=%s encoding=%s bytes=%d",
                                          category, origin.source, encoding, len(raw))
        return ReadResult(text)
    except (UnicodeError, LookupError):
        issue = diagnostic("decode_failed", category, "Decodage impossible sans perte.",
                           severity="error", provenance=origin)
        return ReadResult(None, (issue,), Availability.UNAVAILABLE)
