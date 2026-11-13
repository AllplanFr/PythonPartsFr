"""Explicit presentation working-file persistence, independent of JSON export."""
from copy import deepcopy
import json
import logging
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from uuid import uuid4

from application.core.configuration import SettingsStoreError
from application.core.allplan.project_attribute_writer import (
    SaveError, current_bytes, safe_path,
)
from .presentation_import import display_model, validation_report


LOGGER = logging.getLogger(__name__)


def create_presentation_backup(path, expected):
    """Confirm a backup before allowing the working file to be replaced."""
    directory = path.parent / "backup"
    backup = directory / (path.name + "." + uuid4().hex + ".bak")
    try:
        safe_path(directory)
        directory.mkdir(exist_ok=True)
        safe_path(backup)
        with backup.open("xb") as stream:
            stream.write(expected)
            stream.flush()
            os.fsync(stream.fileno())
        if backup.read_bytes() != expected:
            raise SaveError("backup_failed", "Sauvegarde de presentation non conforme.")
    except (OSError, ValueError) as exc:
        LOGGER.warning("AIM presentation backup failed: destination=%r", backup, exc_info=True)
        raise SaveError(
            "backup_failed",
            "Impossible de creer ou verifier la copie dans le sous-dossier backup ; "
            "fichier de presentation existant conserve.",
        ) from exc
    return backup


class PresentationSave:
    def __init__(self, app):
        self.app = app

    @staticmethod
    def ensure_destination(path):
        safe_path(path)
        if not path.parent.is_dir():
            raise SaveError("destination_directory_unavailable",
                            "Le dossier de destination n'est pas accessible.")
        if path.exists():
            info = path.stat()
            if (not stat.S_ISREG(info.st_mode) or not stat.S_IWRITE & info.st_mode
                    or getattr(info, "st_file_attributes", 0) & 1):
                raise SaveError("read_only", "Le fichier de presentation est en lecture seule ou non modifiable.")

    def remember(self, path):
        app = self.app
        value = str(path.resolve()) if path is not None else None
        app._settings_store.load(app.app_id, strict=True)
        app._settings_store.save(app.app_id, {
            "version": 1, "aimPresentation": {"workingFile": value},
        })
        section = app._settings_store.load(app.app_id, strict=True).get("aimPresentation")
        if type(section) is not dict or section.get("workingFile") != value:
            raise SettingsStoreError("Association de presentation non confirmee dans les preferences.")

    def restore(self):
        app = self.app
        if app._presentation_restore_attempted:
            return
        app._presentation_restore_attempted = True
        try:
            section = app._settings_store.load(app.app_id, strict=True).get("aimPresentation", {})
            if type(section) is not dict:
                raise ValueError("Preferences de presentation invalides.")
            value = section.get("workingFile")
            if value is None:
                return
            if type(value) is not str:
                raise ValueError("Chemin de presentation invalide.")
            path = Path(value)
            if not path.is_absolute() or path.suffix.lower() != ".json":
                raise ValueError("Chemin JSON absolu requis.")
            body = current_bytes(path)
            if body is None:
                raise FileNotFoundError("Presentation memorisee absente.")
            configuration = json.loads(body.decode("utf-8"))
            validation_report(configuration)
            if configuration["version"] == 2 and not app._presentation.mixed:
                raise ValueError("Presentation V2 non prise en charge par cette interface.")
            candidate = {
                "configuration": configuration, "report": None,
                "model": display_model(configuration, None, app._presentation_snapshot()),
            }
            app._presentation._current = candidate
            app._presentation._working_file = path
            app._presentation._working_bytes = body
            app._work.baseline = deepcopy(candidate)
            app._work.changed()
        except (OSError, ValueError, KeyError, TypeError, RecursionError,
                RuntimeError, SettingsStoreError) as exc:
            code = ("presentation_file_missing" if isinstance(exc, FileNotFoundError)
                    else "presentation_preferences_unavailable" if isinstance(exc, SettingsStoreError)
                    else "presentation_file_unavailable" if isinstance(exc, OSError)
                    else "presentation_file_invalid")
            message = (
                "La presentation memorisee ne peut pas etre rouverte "
                f"({code}). Son choix est conserve ; importez une presentation valide."
            )
            LOGGER.warning("AIM presentation restore failed: %s", code, exc_info=True)
            app._presentation_restore_error = {
                "ok": False, "error": {"code": code, "message": message},
            }
            app._state["diagnostics"].append(app._issue(code, message))

    def protected(self, path):
        resolved = path.resolve()
        if any(parent.suffix.lower() == ".prj" for parent in (resolved, *resolved.parents)):
            return True
        # Source trees, installed modules and delivered resources are never working files.
        roots = [Path(__file__).resolve().parents[3]]
        roots.extend(self.app._launch_context.paths.values())
        installation = (self.app._state or {}).get("installation") or {}
        roots.extend(Path(root) for root in installation.get("paths", {}).values() if root)
        discovered, diagnostics = self.app._discover_installations()
        if diagnostics:
            LOGGER.info("AIM presentation save discovery diagnostics: count=%s", len(diagnostics))
        for context in discovered:
            roots.extend(context.paths.values())
        return any(resolved.is_relative_to(Path(root).resolve()) for root in roots)

    def call(self, payload):
        app = self.app
        if (type(payload) is not dict
                or set(payload) != {"sessionId", "revision", "projectRevision"}
                or type(payload["sessionId"]) is not str
                or any(type(payload[key]) is not int for key in ("revision", "projectRevision"))):
            return app._work.error("invalid_payload", "Session et revisions confirmees requises.")
        if app._presentation_saving:
            return app._work.error("save_busy", "Enregistrement de presentation en cours.")
        with app._lock:
            if app._presentation_saving or app._save_transport.busy():
                return app._work.error("save_busy", "Enregistrement en cours.")
            if (not app._session_open or payload["sessionId"] != app._save_transport.identity()
                    or payload["revision"] != app._work.revision
                    or payload["projectRevision"] != app._project_revision):
                return app._work.error("stale_work", "Session ou revisions obsoletes ; relisez le travail.")
            if app._selection_pending is not None or app._presentation._pending is not None:
                return app._work.error("selection_pending", "Selection ou import en attente.")
            current = app._presentation._current
            if current is None:
                return app._work.error("presentation_required", "Aucune presentation active.")
            snapshot = deepcopy(current)
            session = app._session
            app._presentation_saving = True
            temporary = None
            path = None
            selected = None
            expected = None
            body = None
            publication_attempted = False
            written = False
            try:
                configuration = snapshot["configuration"]
                validation_report(configuration)
                path = app._presentation._working_file
                expected = app._presentation._working_bytes
                if path is None or self.protected(path):
                    selected = app._choose_presentation_save()
                    if selected is None:
                        return {"ok": True, "status": "cancelled"}
                    path = Path(selected)
                    if not path.is_absolute() or path.suffix.lower() != ".json" or self.protected(path):
                        raise SaveError("protected_destination", "Choisissez un fichier JSON utilisateur hors des projets et ressources Allplan.")
                    expected = current_bytes(path)
                self.ensure_destination(path)
                if current_bytes(path) != expected:
                    raise SaveError("external_conflict", "La presentation a change sur disque depuis son chargement.")
                body = (json.dumps(configuration, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent,
                                                 prefix=".aim-presentation-", suffix=".tmp",
                                                 delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(body)
                    stream.flush()
                    os.fsync(stream.fileno())
                if temporary.read_bytes() != body or json.loads(temporary.read_bytes()) != configuration:
                    raise SaveError("verification_failed", "Temporaire de presentation non conforme.")
                with app._commit_lock:
                    if not app._session_open or app._session != session:
                        raise SaveError("session_obsolete", "Session fermee ; enregistrement refuse.")
                    if current_bytes(path) != expected:
                        raise SaveError("external_conflict", "Presentation modifiee avant remplacement.")
                    if expected is not None:
                        create_presentation_backup(path, expected)
                    if current_bytes(path) != expected:
                        raise SaveError("external_conflict", "Presentation modifiee pendant la sauvegarde.")
                    self.ensure_destination(path)
                    publication_attempted = True
                    if expected is None:
                        os.link(temporary, path)
                        written = True
                        temporary.unlink()
                    else:
                        os.replace(temporary, path)
                        written = True
                    observed = current_bytes(path)
                    if observed != body or json.loads(observed) != configuration:
                        raise SaveError("verification_failed", "Relecture de presentation non conforme.")
                    validation_report(json.loads(observed))
                    app._presentation._working_file = path
                    app._presentation._working_bytes = body
                    self.remember(path)
                    app._work.baseline = snapshot
                    app._work.changed()
                response = app._work.response("current")
                if not response["ok"]:
                    raise SaveError("work_unavailable", "Presentation ecrite ; etat de travail indisponible.")
                return {"ok": True, "status": "saved", "fileName": path.name, "work": response["work"]}
            except (OSError, ValueError, KeyError, TypeError, RuntimeError,
                    subprocess.SubprocessError, SettingsStoreError) as exc:
                if publication_attempted and not written:
                    try:
                        observed = current_bytes(path)
                        written = False if observed == expected else True if observed == body else None
                    except (OSError, ValueError):
                        written = None
                code = exc.code if isinstance(exc, SaveError) else "presentation_save_failed"
                if isinstance(exc, RuntimeError):
                    code = "dialog_or_work_unavailable"
                message = str(exc) if isinstance(exc, SaveError) else (
                    "Enregistrement de presentation interrompu ; verifier le fichier."
                )
                if code == "read_only":
                    message = "Fichier de presentation ou dossier non accessible en ecriture."
                if isinstance(exc, SettingsStoreError):
                    code = "presentation_preferences_unavailable"
                    message = (
                        "JSON ecrit et relu, mais son association durable n'est pas confirmee. "
                        "Les modifications restent en attente ; aucun nouvel essai automatique."
                    )
                LOGGER.warning(
                    "AIM presentation save failed: selected=%r destination=%r "
                    "code=%s written=%s exceptionType=%s errno=%r winerror=%r",
                    selected, path, code, written,
                    type(exc).__name__, getattr(exc, "errno", None),
                    getattr(exc, "winerror", None),
                    exc_info=not isinstance(exc, SaveError),
                )
                return {"ok": False, "status": "failed" if written is False else "partial",
                        "written": written, "error": {"code": code, "message": message}}
            finally:
                app._presentation_saving = False
                if temporary is not None:
                    try:
                        temporary.unlink(missing_ok=True)
                    except OSError:
                        LOGGER.exception("AIM presentation temporary cleanup failed")
