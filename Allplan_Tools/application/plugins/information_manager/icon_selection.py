"""Native category icon selection; only the last directory is persisted."""
import base64
import logging
import os
from pathlib import Path

from application.core.configuration import SettingsStoreError
from application.core.windows_ui import create_file_dialog


LOGGER = logging.getLogger(__name__)
COMMAND = "aim.icon.select"
MIME_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".svg": "image/svg+xml",
}


def accessible_directory(value, *, icon=False):
    if not isinstance(value, str) or not value:
        return None
    try:
        path = Path(value)
        if not path.is_absolute():
            return None
        if icon:
            if not path.is_file():
                return None
            path = path.parent
        path = path.resolve(strict=True)
        with os.scandir(path):
            return str(path)
    except (OSError, ValueError, RuntimeError) as exc:
        LOGGER.info("AIM icon initial directory unavailable: %s", exc)
        return None


def select_icon(app, payload):
    if (type(payload) is not dict or set(payload) - {"currentIconPath"}
            or payload.get("currentIconPath") is not None
            and not isinstance(payload["currentIconPath"], str)):
        return app._work.error("invalid_payload", "aim.icon.select attend {currentIconPath?}.")
    try:
        settings = app._settings_store.load(app.app_id, strict=True)
    except (OSError, ValueError, SettingsStoreError):
        LOGGER.exception("AIM icon preferences unavailable")
        return app._work.error("icon_preferences_unavailable", "Reglages des icones indisponibles.")
    section = settings.get("aimIcons", {})
    directory = accessible_directory(payload.get("currentIconPath"), icon=True)
    if directory is None and type(section) is dict:
        directory = accessible_directory(section.get("lastDirectory"))
    try:
        if app._window is None:
            raise RuntimeError("Aucune fenetre native attachee.")
        from webview import FileDialog
        selected = create_file_dialog(
            app._window, FileDialog.OPEN, title="Choisir une icone de categorie",
            directory=directory or "", allow_multiple=False,
            file_types=("Images (*.png;*.jpg;*.jpeg;*.webp;*.svg)",),
        )
        if not selected:
            return {"ok": True, "status": "cancelled"}
        if isinstance(selected, (tuple, list)):
            if len(selected) != 1:
                raise ValueError("Une seule icone attendue.")
            selected = selected[0]
        if not isinstance(selected, str):
            raise ValueError("Selection native invalide.")
        path = Path(selected).resolve(strict=True)
        mime = MIME_TYPES.get(path.suffix.lower())
        if mime is None or not path.is_file():
            raise ValueError("Format d'image non pris en charge.")
        body = path.read_bytes()
        if not body:
            raise ValueError("Image vide.")
        icon = "data:" + mime + ";base64," + base64.b64encode(body).decode("ascii")
    except (OSError, ValueError, RuntimeError):
        LOGGER.exception("AIM icon selection failed")
        return app._work.error(
            "icon_selection_failed", "Impossible de lire cette image locale ; icone conservee.",
        )
    try:
        # Re-read before saving so unrelated preferences are preserved.
        app._settings_store.load(app.app_id, strict=True)
        app._settings_store.save(app.app_id, {
            "version": 1, "aimIcons": {"lastDirectory": str(path.parent)},
        })
        confirmed = app._settings_store.load(app.app_id, strict=True).get("aimIcons")
        if type(confirmed) is not dict or confirmed.get("lastDirectory") != str(path.parent):
            raise SettingsStoreError("Dossier d'icones non confirme dans les reglages.")
    except (OSError, ValueError, SettingsStoreError):
        LOGGER.exception("AIM icon directory persistence failed")
        return app._work.error(
            "icon_preferences_unavailable",
            "Dossier d'icones non memorise ; selection non appliquee.",
        )
    return {"ok": True, "status": "selected", "icon": icon, "path": str(path)}
