import json
import logging
import os
import re
import tempfile
import subprocess
from threading import RLock
from pathlib import Path

from application.core.base import BaseApp
from application.core.configuration import FutureSettingsVersionError, SettingsStore, SettingsStoreError
from application.core.messages import MessageError, settings_language, tr


class UnavailableError(NotImplementedError):
    """A known command intentionally disabled for this integration."""


class UnsupportedVersionError(ValueError):
    """An operation targets an Allplan version below the supported minimum."""


def push(window, event_type, payload):
    def encode(value):
        return (
            json.dumps(value, ensure_ascii=False, allow_nan=False)
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029")
        )

    window.evaluate_js(
        f"window.allplanHost.receive({encode(event_type)}, {encode(payload)})"
    )


class BridgeApp(BaseApp):
    _EVENTS = frozenset({"error"})
    _UNAVAILABLE_CAPABILITIES = {}

    def __init__(self, data_dir, settings_store=None, allplan_version=None):
        super().__init__(data_dir)
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._settings_store = settings_store if settings_store is not None else SettingsStore()
        self._allplan_version = allplan_version
        self._window = None
        self._lock = RLock()
        self._language = "fr"
        self._language_initialized = False
        self._reported_unavailable = set()
        self._logger = logging.getLogger(f"{__name__}.{self.app_id}.{id(self)}")
        self._handlers = {
            "settings.load": self._handle_settings_load,
            "settings.save": self._handle_settings_save,
            "menu.export": self._handle_menu_export,
            "menu.import": self._handle_menu_import,
        }

    def _attach_window(self, window):
        self._window = window
        self._update_native_language()

    def _close(self):
        for handler in self._logger.handlers[:]:
            handler.close()
            self._logger.removeHandler(handler)

    def _trace(self, signal, payload=None):
        keys = sorted(str(key) for key in payload) if isinstance(payload, dict) else []
        print(f"[{self.app_id}] signal recu : {signal!r}, cles={keys}", flush=True)

    def get_app_info(self):
        self._trace("get_app_info")
        return {
            "app_id": self.app_id,
            "title": self.title,
            "version": "unknown",
            "allplan_version": self._allplan_version,
            "bridge_version": 1,
            **self._capability_data(),
        }

    def _capabilities(self):
        return [
            command for command in self._handlers
            if command not in self._UNAVAILABLE_CAPABILITIES
        ]

    def _capability_data(self):
        return {
            "capabilities": self._capabilities(),
            "unavailable_capabilities": {
                command: {
                    "code": "not-implemented",
                    "message": self._tr(message_key, command=command),
                }
                for command, message_key in self._UNAVAILABLE_CAPABILITIES.items()
            },
        }

    def call(self, command, payload):
        with self._lock:
            return self._call_locked(command, payload)

    def _call_locked(self, command, payload):
        self._trace(command, payload)
        try:
            if not self._language_initialized:
                self._set_language(self._settings_store.load(self.app_id))
            if not isinstance(command, str) or not command.strip():
                raise ValueError("La commande doit etre une chaine non vide.")
            if not isinstance(payload, dict):
                raise ValueError("Le payload doit etre un objet JSON.")
            command = command.strip()
            handler = self._handlers.get(command)
            if handler is None:
                self._logger.warning("Commande inconnue: %s", command)
                return self._error("unknown_command", command=command)
            self._require_supported_allplan_version()
            self._validate_payload(command, payload)
            result = handler(payload)
            self._logger.info("Commande executee: %s", command)
            return {"ok": True, "data": result}
        except UnsupportedVersionError as exc:
            self._logger.warning("Version Allplan non prise en charge: %s", exc)
            return self._error("unsupported-version")
        except MessageError as exc:
            self._logger.warning("Commande invalide %s: %s", command, exc)
            return self._error("invalid", message_key=exc.key, **exc.params)
        except (ValueError, FutureSettingsVersionError) as exc:
            self._logger.warning("Commande invalide %s: %s", command, exc)
            return self._error(
                "invalid", message_key=self._error_message_key(command, "invalid"),
            )
        except FileNotFoundError:
            self._logger.exception("Fichier introuvable: %s", command)
            return self._error("not_found")
        except UnavailableError as exc:
            self._logger.warning("Commande desactivee %s: %s", command, exc)
            return self._error("not-implemented", command=command)
        except NotImplementedError as exc:
            if command not in self._reported_unavailable:
                self._logger.warning("Commande non implementee %s: %s", command, exc)
                self._reported_unavailable.add(command)
            return self._error(
                "not-implemented",
                message_key=self._UNAVAILABLE_CAPABILITIES.get(command),
                command=command,
            )
        except (TimeoutError, subprocess.TimeoutExpired):
            self._logger.exception("Delai depasse: %s", command)
            return self._error("timeout")
        except (OSError, SettingsStoreError) as exc:
            self._logger.exception("Erreur d'acces: %s", command)
            return self._io_error_response(command, exc)
        except Exception as exc:
            self._logger.exception("Echec de la commande %s", command)
            return self._error("internal-error", detail=f"{type(exc).__name__}: {exc}")

    def _validate_payload(self, command, payload):
        if command == "settings.load":
            self._require_fields(payload, {"app_id"})
            if payload["app_id"] != self.app_id:
                raise ValueError("app_id ne correspond pas a cette application.")
        elif command == "settings.save":
            if "version" not in payload:
                raise ValueError("settings.save attend un document versionne.")
        elif command == "menu.export":
            self._require_fields(payload, {"toolbar", "content"})
            self._validate_toolbar(payload["toolbar"])
            if not isinstance(payload["content"], str):
                raise ValueError("content doit être une chaîne.")
        elif command == "menu.import":
            self._require_fields(payload, {"toolbar"})
            self._validate_toolbar(payload["toolbar"])

    def _error_message_key(self, _command, default):
        return default

    def _io_error_code(self, _command, _exc):
        return "io"

    def _io_error_message_key(self, command, exc):
        return self._error_message_key(command, self._io_error_code(command, exc))

    def _io_error_response(self, command, exc):
        return self._error(
            self._io_error_code(command, exc),
            message_key=self._io_error_message_key(command, exc),
        )

    def _handle_settings_load(self, payload):
        settings = self._settings_store.load(payload["app_id"])
        self._set_language(settings)
        return settings

    def _handle_settings_save(self, payload):
        self._settings_store.save(self.app_id, payload)
        self._set_language(payload)
        return None

    def _tr(self, code, **params):
        return tr(code, self._language, **params)

    def _exception_message(self, exc):
        self._logger.warning("Operation ignoree: %s", exc)
        if isinstance(exc, MessageError):
            return self._tr(exc.key, **exc.params)
        if isinstance(exc, UnsupportedVersionError):
            return self._tr("unsupported-version")
        if isinstance(exc, FileNotFoundError):
            return self._tr("not_found")
        return self._tr("io" if isinstance(exc, OSError) else "invalid")

    def _set_language(self, settings):
        language = settings_language(settings)
        if language is not None:
            self._language = language
        self._language_initialized = True
        self._update_native_language()

    def _update_native_language(self):
        localization = getattr(self._window, "localization", None)
        if isinstance(localization, dict):
            localization.update({
                "global.cancel": self._tr("cancel"),
                "global.quit": self._tr("quit"),
                "global.quitConfirmation": self._tr("quit-confirmation"),
                "global.saveFile": self._tr("save-file"),
                "linux.openFile": self._tr("open-file"),
                "linux.openFiles": self._tr("open-file"),
                "linux.openFolder": self._tr("open-folder"),
                "windows.fileFilter.allFiles": self._tr("all-files"),
            })

    def _file_dialog(self, dialog_type, **kwargs):
        from application.core.windows_ui import create_file_dialog
        from webview import FileDialog

        title_key = (
            "save-file" if dialog_type == FileDialog.SAVE
            else "open-folder" if dialog_type == FileDialog.FOLDER else "open-file"
        )
        return create_file_dialog(
            self._require_window(), dialog_type, title=self._tr(title_key), **kwargs,
        )

    def _require_supported_allplan_version(self):
        if (
            self._allplan_version is not None
            and str(self._allplan_version).isdigit()
            and int(self._allplan_version) != 99
            and int(self._allplan_version) < 2022
        ):
            raise UnsupportedVersionError(
                "Allplan 2022 ou une version plus récente est requis (exception : 99)."
            )

    @staticmethod
    def _validate_toolbar(toolbar):
        if not isinstance(toolbar, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", toolbar):
            raise ValueError("toolbar doit être un identifiant de barre d'outils valide.")

    def _handle_menu_export(self, payload):
        from webview import FileDialog

        result = self._file_dialog(
            FileDialog.SAVE,
            save_filename=f"menu-{payload['toolbar']}.menu",
            file_types=(f"{self._tr('menu-files')} (*.menu)",),
        )
        if not result:
            return None
        selected = result[0] if isinstance(result, (list, tuple)) else result
        path = Path(selected).expanduser()
        if not path.is_absolute() or ".." in path.parts:
            raise ValueError("Le chemin de destination du menu est invalide.")
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                newline="\n",
                dir=str(path.parent),
                prefix=f".{path.name}-",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temporary = Path(handle.name)
                handle.write(payload["content"])
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(str(temporary), str(path))
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
        return {"path": str(path.resolve())}

    def _handle_menu_import(self, _payload):
        from webview import FileDialog

        result = self._file_dialog(
            FileDialog.OPEN,
            allow_multiple=False,
            file_types=(f"{self._tr('menu-files')} (*.menu)",),
        )
        if not result:
            return None
        selected = result[0] if isinstance(result, (list, tuple)) else result
        path = Path(selected).expanduser()
        if not path.is_absolute() or ".." in path.parts:
            raise ValueError("Le chemin du menu est invalide.")
        return {"content": path.read_text(encoding="utf-8")}

    def _initial_preferences(self):
        settings = self._settings_store.load(self.app_id)
        self._set_language(settings)
        general = settings.get("general", {})
        if not isinstance(general, dict):
            raise ValueError("La section general des reglages doit etre un objet.")
        lang, dark = general.get("lang", "fr"), general.get("dark", False)
        if not isinstance(lang, str) or not lang.strip() or not isinstance(dark, bool):
            raise ValueError("Les reglages de langue ou de theme sont invalides.")
        return {"lang": self._language, "dark": dark}

    def _push_event(self, event_type, payload):
        if event_type not in self._EVENTS:
            raise ValueError("Type d'evenement non autorise pour cette application.")
        if self._window is None:
            self._logger.warning("Evenement sans fenetre: %s", event_type)
            return
        try:
            push(self._window, event_type, payload)
        except Exception:
            self._logger.exception("Impossible d'envoyer l'evenement %s", event_type)

    def _require_window(self):
        if self._window is None:
            raise OSError("La boite de dialogue native est indisponible.")
        return self._window

    @staticmethod
    def _require_fields(payload, fields):
        if set(payload) != set(fields):
            raise MessageError("expected-fields", fields=", ".join(sorted(fields)))

    @staticmethod
    def _require_text(value, name):
        if not isinstance(value, str) or not value.strip():
            raise MessageError("text-required", field=name)

    def _error(self, code, *, message_key=None, **params):
        return {"ok": False, "error": {
            "code": code, "message": self._tr(message_key or code, **params),
        }}
