"""AIM session/snapshot orchestration over shared Allplan Datas operations."""
from concurrent.futures import Future
from copy import deepcopy
from dataclasses import replace
import logging
import os
from pathlib import Path
import subprocess
from threading import Lock, Thread

from application.core.allplan.project_attribute_writer import (
    SaveError, current_bytes, fingerprint, prepare, safe_path,
)
from application.core.allplan.project_tools import (
    ToolPlan, associated_installation, execute_tool, installation_tool_plan,
    tool_command, tool_plan,
)


LOGGER = logging.getLogger(__name__)


def save_installation(app, project, active):
    try:
        discovered, diagnostics = app._discover_installations()
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise SaveError("discovery_failed", "Decouverte des installations non exploitable.") from exc
    if diagnostics:
        LOGGER.info("AIM save discovery diagnostics: count=%s", len(diagnostics))
    contexts = list(discovered)
    # Keep resolved overrides for the active installation, without filtering other versions.
    if active.allplan_version is not None and active.paths.get("PRJ") is not None:
        contexts = [c for c in contexts if (
            c.allplan_version, c.verification_version
        ) != (active.allplan_version, active.verification_version)]
        contexts.insert(0, active)
    return associated_installation(project, contexts)


class ProjectValueSave:
    _registry_lock = Lock()
    _active_projects = set()
    _uncertain_projects = set()

    def __init__(self, app, *, runner=execute_tool, checkpoint=lambda *args: None):
        self.app = app
        self.runner = runner
        self.checkpoint = checkpoint
        self._busy = Lock()
        self._recovery_required = False

    def submit(self, payload):
        """Return immediately; validation, filesystem work and process wait run off UI."""
        future = Future()
        if not self._busy.acquire(blocking=False):
            future.set_result(self._error("save_busy", "Un enregistrement est deja en cours."))
            return future
        request = dict(payload) if type(payload) is dict else payload
        with self.app._commit_lock:
            session = self.app._session

        def worker():
            try:
                # Cancellation before execution has no side effects.
                if future.set_running_or_notify_cancel():
                    future.set_result(self._save(request, session))
            except BaseException as exc:
                future.set_exception(exc)
            finally:
                self._busy.release()

        Thread(target=worker, name="aim-project-save", daemon=False).start()
        return future

    @staticmethod
    def _error(code, message, *, stage="validation", written=False, backup=None, tool=None):
        LOGGER.warning("AIM project save: stage=%s code=%s written=%s", stage, code, written)
        return {
            "ok": False, "status": "failed" if written is False else "partial",
            "stage": stage, "written": written, "verified": False,
            "backup": str(backup) if backup else None, "tool": tool,
            "error": {"code": code, "message": message},
        }

    def _guard(self, session, revision, project_revision, project):
        app = self.app
        if not app._session_open or app._session != session:
            raise SaveError("session_obsolete", "Session fermee ou remplacee.")
        if (app._project_revision != project_revision or not app._state
                or app._state["selection"] != "accepted"
                or Path(app._state["project"]["path"]) != project):
            raise SaveError("project_changed", "Le projet actif a change.")
        if app._work.revision != revision or app._selection_pending is not None:
            raise SaveError("stale_work", "Revision de travail obsolete ou selection en attente.")

    def _save(self, payload, session):
        app = self.app
        prepared = None
        registered = None
        stage = "validation"
        tool = None
        try:
            with app._lock:
                with app._commit_lock:
                    if (type(payload) is not dict or set(payload) != {"revision", "projectRevision"}
                            or any(type(v) is not int for v in payload.values())):
                        raise SaveError("invalid_payload", "Revisions de travail et projet requises.")
                    if not app._state or app._state["selection"] != "accepted":
                        raise SaveError("project_required", "Projet accepte requis.")
                    if not app._working_state:
                        raise SaveError("working_state_required", "Etat de travail Python requis.")
                    project = Path(app._state["project"]["path"])
                    revision, project_revision = payload["revision"], payload["projectRevision"]
                    self._guard(session, revision, project_revision, project)
                    if self._recovery_required:
                        raise SaveError("recovery_required", "Resultat precedent partiel ; reprise explicite requise.")
                    document = app._document
                    if document is None or document.status not in ("read", "missing"):
                        raise SaveError("invalid_source", "Document source non exploitable.")
                    changes = deepcopy(app._work.values)
                    if not changes:
                        raise SaveError("no_changes", "Aucune valeur modifiee a enregistrer.")
                    if any(value is None for value in changes.values()):
                        raise SaveError("null_unspecified", "Persistance de null non definie.")
                    definitions = {
                        row["number"]: row["definition"]
                        for row in app._state["data"]["attributes"]
                    }
                    existing = document.values()
                    if any(n not in definitions and n not in existing for n in changes):
                        raise SaveError("unknown_attribute", "Attribut absent du projet et des definitions.")
                    names = {n: d["label"] for n, d in definitions.items()}
                    expected = document.source_bytes
                    if document.status == "read" and expected is None:
                        raise SaveError("snapshot_required", "Empreinte du fichier au chargement requise.")
                    active = deepcopy(app._launch_context)
            safe_path(project)
            directory_identity = (project.stat().st_dev, project.stat().st_ino)
            config = current_bytes(project / "project.cfg")
            if (document.project_identity != directory_identity
                    or document.project_config != config or config is None):
                raise SaveError("project_changed", "Identite projet differente du chargement.")
            registered = os.path.normcase(str(project.resolve(strict=True)))
            with self._registry_lock:
                if registered in self._active_projects or registered in self._uncertain_projects:
                    registered = None
                    raise SaveError("save_busy", "Projet deja en cours ou outil de resultat incertain.")
                self._active_projects.add(registered)
            installation = save_installation(app, project, active)
            self.checkpoint("plan", {"required": installation is not None})
            plan = installation_tool_plan(project, installation)
            stage = "prepare"
            self.checkpoint("preparation", {})
            prepared = prepare(project / "prjatt.dat", expected, changes, names)
            stage = "commit"
            with app._lock:
                with app._commit_lock:
                    self._guard(session, revision, project_revision, project)
                    safe_path(project)
                    if ((project.stat().st_dev, project.stat().st_ino) != directory_identity
                            or current_bytes(project / "project.cfg") != config):
                        raise SaveError("project_changed", "Identite du projet modifiee pendant la preparation.")
                    self.checkpoint("publication", {})
                    prepared.commit()
                    self.checkpoint("published", {
                        "sourceSHA256": fingerprint(prepared.body),
                        "backupId": prepared.backup.name if prepared.backup else None,
                    })
            # The commit is irreversible here. Closing can now invalidate the session,
            # but cannot retroactively undo persistence or an already-started tool.
            stage = "tool"
            if plan is not None:
                self.checkpoint("tool_check", {})
                if not plan.command or not plan.executable.is_file():
                    raise SaveError("tool_missing", "Attributs ecrits ; prjtool.exe associe indisponible.")
                safe_path(plan.executable)
                self.checkpoint("tool", {})
                if self.runner is execute_tool:
                    tool = self.runner(plan, app._data_dir / "project-save-diagnostics",
                                       checkpoint=self.checkpoint)
                else:
                    tool = self.runner(plan, app._data_dir / "project-save-diagnostics")
                    # Injected runners implement this same completion contract in tests.
                    if type(tool) is dict and type(tool.get("returncode")) is int:
                        self.checkpoint("tool_launched", {})
                        self.checkpoint("tool_finished", {"returnCode": tool["returncode"]})
                if (type(tool) is not dict or type(tool.get("returncode")) is not int):
                    with self._registry_lock:
                        self._uncertain_projects.add(registered)
                    raise SaveError("tool_uncertain", "Resultat de prjtool non etabli.")
                if tool["returncode"] != 0:
                    raise SaveError("tool_failed", "Attributs ecrits ; prjtool termine en echec.")
            stage = "verify"
            self.checkpoint("verification", {})
            document = prepared.verify()
            values = document.values()
            if any(values.get(number) != value or number not in values
                   for number, value in changes.items()):
                raise SaveError("verification_failed", "Valeurs relues non conformes.")
            with app._lock:
                with app._commit_lock:
                    self._guard(session, revision, project_revision, project)
                    if current_bytes(project / "project.cfg") != config:
                        raise SaveError("project_changed", "Configuration projet modifiee.")
                    identity_stat = project.stat()
                    if (identity_stat.st_dev, identity_stat.st_ino) != directory_identity:
                        raise SaveError("project_changed", "Dossier projet remplace.")
                    # Check again immediately before acknowledging the source snapshot.
                    prepared.verify()
                    self.checkpoint("acknowledgement", {})
                    previous = (
                        app._document, deepcopy(app._state), deepcopy(app._work.values),
                        app._work.revision, app._work.close_permitted, app._project_revision,
                    )
                    try:
                        app._document = replace(document, project_identity=directory_identity,
                                                project_config=config)
                        for row in app._state["data"]["attributes"]:
                            row["value"] = values.get(row["number"])
                            row["valueState"] = "set" if row["number"] in values else "unset"
                        app._state["prjatt"]["status"] = "read"
                        app._state["prjatt"]["header"] = document.header
                        app._work.values.clear()
                        app._work.changed()
                        app._project_revision += 1
                        self.checkpoint("acknowledged", {})
                    except BaseException:
                        (app._document, app._state, app._work.values, app._work.revision,
                         app._work.close_permitted, app._project_revision) = previous
                        raise
            return {
                "ok": True, "status": "saved", "stage": "complete", "written": True,
                "verified": True, "backup": str(prepared.backup) if prepared.backup else None,
                "sourceSHA256": fingerprint(prepared.body), "tool": tool,
                "message": "Attributs du projet enregistr\u00e9s.",
            }
        except (SaveError, OSError, subprocess.SubprocessError) as exc:
            written = bool(prepared and prepared.replaced)
            if prepared and prepared.publication_attempted and not written:
                try:
                    observed = current_bytes(prepared.path)
                    written = False if observed == prepared.expected else (
                        True if observed == prepared.body else None)
                except (OSError, SaveError):
                    written = None
            if written is not False:
                self._recovery_required = True
            if written and stage == "tool" and not isinstance(exc, SaveError):
                with self._registry_lock:
                    self._uncertain_projects.add(registered)
            code = exc.code if isinstance(exc, SaveError) else (
                "tool_uncertain" if written and stage == "tool" else "io_failed")
            # Do not log exception text from tools: it may contain project values.
            return self._error(code, str(exc) if isinstance(exc, SaveError) else
                               "Operation interrompue ; diagnostic systeme " + type(exc).__name__ + ".",
                               stage=stage, written=written,
                               backup=prepared.backup if prepared and prepared.backup_verified else None,
                               tool=tool)
        finally:
            if prepared is not None:
                try:
                    prepared.cleanup()
                except OSError:
                    LOGGER.exception("AIM save temporary cleanup failed")
            if registered is not None:
                with self._registry_lock:
                    self._active_projects.discard(registered)
