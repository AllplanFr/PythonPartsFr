"""Bounded process-local logs; logging failure must not prevent application use."""
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import subprocess
import sys
from threading import RLock
import time
from uuid import uuid4


_LOCK = RLock()
_SESSION = f"{os.getpid()}-{time.time_ns()}-{uuid4().hex[:8]}"
_DIAGNOSTIC = False
_MAX_BYTES = 2 * 1024 * 1024
_BACKUPS = 3
_KEEP_SESSIONS = 20


def log_directory() -> Path:
    return Path(os.environ["LOCALAPPDATA"]) / "AllplanWebLauncher" / "logs"


def _report_failure() -> None:
    if sys.stderr is not None:
        try:
            print("Journal indisponible ; l'application reste utilisable.", file=sys.stderr)
        except (OSError, ValueError):
            pass


class _SafeRotatingHandler(RotatingFileHandler):
    _reported = False

    def handleError(self, record):
        if not self._reported:
            self._reported = True
            _report_failure()


def set_diagnostic(enabled: bool) -> None:
    if type(enabled) is not bool:
        raise ValueError("Diagnostic mode must be boolean.")
    global _DIAGNOSTIC
    with _LOCK:
        _DIAGNOSTIC = enabled
        logging.getLogger().setLevel(logging.DEBUG if enabled else logging.INFO)
        root = logging.getLogger()
        for handler in root.handlers[:]:
            if handler.get_name() == "allplan.console" and not enabled:
                root.removeHandler(handler)
                handler.close()
        if enabled and sys.stderr is not None and not any(
            handler.get_name() == "allplan.console" for handler in root.handlers
        ):
            console = logging.StreamHandler(sys.stderr)
            console.set_name("allplan.console")
            console.setFormatter(logging.Formatter(
                "%(asctime)s %(levelname)s %(process)d %(name)s: %(message)s"
            ))
            root.addHandler(console)


def diagnostic_enabled() -> bool:
    return _DIAGNOSTIC


def session_log_path() -> Path | None:
    for handler in logging.getLogger().handlers:
        if handler.get_name() == "allplan.file" and isinstance(handler, logging.FileHandler):
            return Path(handler.baseFilename)
    return None


def configure_logging() -> None:
    root = logging.getLogger()
    with _LOCK:
        if any(handler.get_name() == "allplan.file" for handler in root.handlers):
            return
        formatter = logging.Formatter(
            "%(asctime)s %(levelname)s %(process)d %(name)s: %(message)s"
        )
        try:
            directory = log_directory()
            directory.mkdir(parents=True, exist_ok=True)
            handler = _SafeRotatingHandler(
                directory / f"session-{_SESSION}.log", maxBytes=_MAX_BYTES,
                backupCount=_BACKUPS, encoding="utf-8",
            )
        except (OSError, KeyError):
            _report_failure()
        else:
            handler.set_name("allplan.file")
            handler.setFormatter(formatter)
            root.addHandler(handler)
            # Never remove active-session files; Windows sharing violations leave them intact.
            try:
                sessions = sorted(directory.glob("session-*.log"),
                                  key=lambda path: path.stat().st_mtime, reverse=True)
                for old in sessions[_KEEP_SESSIONS:]:
                    if old == Path(handler.baseFilename):
                        continue
                    for candidate in (old, *(old.with_name(old.name + f".{i}")
                                             for i in range(1, _BACKUPS + 1))):
                        try:
                            candidate.unlink(missing_ok=True)
                        except OSError:
                            logging.getLogger(__name__).warning("Ancien journal non supprimable.")
            except OSError:
                logging.getLogger(__name__).warning("Retention des journaux incomplete.")
        set_diagnostic(_DIAGNOSTIC)


def open_log_directory() -> None:
    directory = log_directory()
    directory.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(["explorer.exe", str(directory)], shell=False)
