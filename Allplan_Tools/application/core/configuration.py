import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from application.core.messages import LANGUAGE_PATHS, settings_language
from .catalog import PLUGINS, resolve_plugin


CURRENT_VERSION = 1


def sanitize_settings(settings):
    cleaned = deepcopy(settings)
    for plugin in PLUGINS.values():
        for dotted_key, rule in plugin.settings_rules.items():
            *parents, key = dotted_key.split(".")
            section = cleaned
            for parent in parents:
                section = section.get(parent) if isinstance(section, dict) else None
            if isinstance(section, dict) and key in section:
                value = section[key]
                if type(value) is not int or not rule["min"] <= value <= rule["max"]:
                    section.pop(key)
    return cleaned


class SettingsStoreError(Exception):
    """Base exception for settings persistence errors."""


class FutureSettingsVersionError(SettingsStoreError):
    """Raised when saving would overwrite settings from a newer version."""


def default_settings_path():
    override = os.environ.get("ALLPLAN_SMARTCATALOG_SETTINGS_DIR")
    if override:
        return Path(override) / "settings.json"

    app_data = os.environ.get("APPDATA")
    if app_data:
        root = Path(app_data)
    else:
        config_home = os.environ.get("XDG_CONFIG_HOME")
        root = Path(config_home) if config_home else Path.home() / ".config"

    return root / "Allplan" / "SmartCatalog" / "settings.json"


def migrate(settings):
    if not isinstance(settings, dict):
        raise ValueError("Le document de réglages doit être un objet JSON.")

    version = settings.get("version", 1)
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError("La version du document de réglages est invalide.")
    if version > CURRENT_VERSION:
        raise FutureSettingsVersionError(
            "Le fichier de réglages provient d'une version plus récente."
        )

    migrated = dict(settings)
    migrated["version"] = CURRENT_VERSION
    return sanitize_settings(migrated)


class SettingsStore:
    def __init__(self, path=None):
        self._path = Path(path) if path is not None else default_settings_path()

    def load(self, app_id, *, strict=False):
        self._validate_app_id(app_id)
        self._path.parent.mkdir(parents=True, exist_ok=True)

        with self._file_lock():
            if not strict and not self._path.exists():
                return {}
            if strict:
                try:
                    self._path.stat()
                except FileNotFoundError:
                    return {}

            try:
                raw = self._path.read_text(encoding="utf-8")
                settings = migrate(json.loads(raw))
                return settings
            except FutureSettingsVersionError:
                raise
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
                if strict:
                    raise SettingsStoreError(
                        "Les reglages existants sont illisibles ; fichier conserve."
                    ) from exc
                self._preserve_corrupt_file()
                return {}

    def save(self, app_id, data):
        self._validate_app_id(app_id)
        self._validate_document(data)
        self._path.parent.mkdir(parents=True, exist_ok=True)

        with self._file_lock():
            current = {}
            if self._path.exists():
                try:
                    current = migrate(
                        json.loads(self._path.read_text(encoding="utf-8"))
                    )
                except FutureSettingsVersionError:
                    raise
                except (
                    OSError,
                    UnicodeError,
                    json.JSONDecodeError,
                    ValueError,
                ) as exc:
                    self._preserve_corrupt_file()
                    raise SettingsStoreError(
                        "Les réglages existants sont illisibles ; "
                        "aucune sauvegarde n'a été effectuée."
                    ) from exc

            merged = dict(current)
            for key, value in sanitize_settings(data).items():
                if key == "version":
                    continue
                if isinstance(value, dict) and isinstance(merged.get(key), dict):
                    merged[key] = {**merged[key], **value}
                else:
                    merged[key] = value
            merged["version"] = CURRENT_VERSION
            language = settings_language(data)
            if language is not None:
                for path in LANGUAGE_PATHS:
                    section = merged
                    for key in path[:-1]:
                        section = section.get(key) if isinstance(section, dict) else None
                    if isinstance(section, dict) and path[-1] in section:
                        section[path[-1]] = language
            self._write_atomically(merged)

    @staticmethod
    def _validate_app_id(app_id):
        resolve_plugin(app_id)

    @staticmethod
    def _validate_document(data):
        if not isinstance(data, dict):
            raise ValueError("Le document de réglages doit être un objet JSON.")
        version = data.get("version")
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise ValueError("Le document doit contenir une version valide.")
        if version > CURRENT_VERSION:
            raise FutureSettingsVersionError(
                "Le document reçu provient d'une version plus récente."
            )
        try:
            json.dumps(data, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError("Le document contient une valeur JSON invalide.") from exc

    def _write_atomically(self, settings):
        encoded = json.dumps(
            settings,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        ) + "\n"

        if self._path.exists():
            shutil.copy2(self._path, self._path.with_name("settings.bak"))

        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="\n",
                dir=str(self._path.parent),
                prefix=".settings-",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                temporary_file.write(encoded)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())

            os.replace(str(temporary_path), str(self._path))
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()

    def _preserve_corrupt_file(self):
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        preserved_path = self._path.with_name(
            f"settings.corrupt-{timestamp}.json"
        )
        try:
            os.replace(str(self._path), str(preserved_path))
        except OSError:
            raise SettingsStoreError(
                "Le fichier de réglages est illisible et n'a pas pu être "
                "déplacé vers un fichier de diagnostic."
            )
        return preserved_path

    @contextmanager
    def _file_lock(self):
        lock_path = self._path.with_name(self._path.name + ".lock")
        with open(lock_path, "a+b") as lock_file:
            if os.name == "nt":
                import msvcrt

                lock_file.seek(0, os.SEEK_END)
                if lock_file.tell() == 0:
                    lock_file.write(b"\0")
                    lock_file.flush()
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_LOCK, 1)
                try:
                    yield
                finally:
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
