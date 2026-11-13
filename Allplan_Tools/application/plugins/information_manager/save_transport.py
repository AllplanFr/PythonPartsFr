"""Opt-in WorkV2 save transport and durable, non-replaying operation journal."""
from copy import deepcopy
from hashlib import sha256
import json
import logging
import os
from pathlib import Path
import subprocess
from threading import RLock
from uuid import uuid4

from application.core.allplan.project_attribute_writer import (
    SaveError, current_bytes, ensure_writable, render, safe_path,
)
from application.core.allplan.project_tools import execute_tool, installation_tool_plan
from .project_save import ProjectValueSave, save_installation


LOGGER = logging.getLogger(__name__)
COMMANDS = ("project.values.save", "project.values.save.status")
_LIVE = set()
_LIVE_LOCK = RLock()


def valid_request(payload):
    return (type(payload) is dict
            and set(payload) == {"sessionId", "revision", "projectRevision"}
            and type(payload["sessionId"]) is str and 0 < len(payload["sessionId"]) <= 128
            and all(type(payload[k]) is int and 0 <= payload[k] <= 9007199254740991
                    for k in ("revision", "projectRevision")))


def request_key(request):
    return sha256(json.dumps(request, sort_keys=True).encode("utf-8")).hexdigest()


def failure(code, message):
    return {"ok": False, "error": {"code": code, "message": message}}


class SaveTransport:
    def __init__(self, app):
        self.app = app
        self.root = app._data_dir / "project-save-journal"
        safe_path(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self.records = {}
        self.active = set()
        self.session = None
        self.session_id = None
        self.runner = execute_tool
        self.futures = {}
        for path in self.root.glob("*.json"):
            safe_path(path)
            record = json.loads(path.read_text("utf-8"))
            if (record.get("version") != 1 or not valid_request(record.get("request"))
                    or path.stem != request_key(record["request"])
                    or type(record.get("file")) is not dict
                    or type(record.get("tool")) is not dict):
                raise ValueError("Invalid AIM save journal.")
            if record["result"] is None:
                with _LIVE_LOCK:
                    live = record["operationId"] in _LIVE
                if not live:
                    record["result"] = self._result(
                        record, "interrupted", "Operation interrompue ; examen explicite requis.")
                    record["result"]["recoveryRequired"] = True
                    self._write(record)
            self.records[path.stem] = record

    def _write(self, record):
        path = self.root / (request_key(record["request"]) + ".json")
        temporary = self.root / (uuid4().hex + ".tmp")
        safe_path(self.root)
        safe_path(path)
        try:
            with temporary.open("x", encoding="utf-8", newline="\n") as stream:
                json.dump(record, stream, ensure_ascii=True)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)

    def identity(self):
        with self.app._commit_lock:
            if self.session != self.app._session or self.session_id is None:
                self.session = self.app._session
                self.session_id = uuid4().hex
            return self.session_id

    def _project(self):
        state = self.app._state
        return state["project"]["path"] if state and state.get("project") else None

    def _refresh(self):
        # Another app in this process may share the same local journal directory.
        for path in self.root.glob("*.json"):
            if path.stem not in self.records:
                safe_path(path)
                record = json.loads(path.read_text("utf-8"))
                if path.stem != request_key(record["request"]):
                    raise ValueError("Invalid AIM save journal key.")
                self.records[path.stem] = record
        for key, record in list(self.records.items()):
            if record["result"] is None and key not in self.active:
                path = self.root / (key + ".json")
                safe_path(path)
                self.records[key] = json.loads(path.read_text("utf-8"))

    def _operation_state(self):
        with self.lock:
            self._refresh()
            session = self.identity()
            project = self._project()
            relevant = [r for r in self.records.values() if r["project"] == project]
            unresolved = next((r for r in reversed(relevant)
                               if r["result"] is None or r["result"]["recoveryRequired"]), None)
            latest = next((r for r in reversed(relevant)
                           if r["request"]["sessionId"] == session), None)
            record = unresolved or latest
            running = any(r["result"] is None for r in relevant)
            recovery = bool(unresolved and not running)
            reasons = []
            if running:
                reasons.append("save_busy")
            if recovery:
                reasons.append("recovery_required")
            return {
                "state": "running" if running else "recovery_required" if recovery else "idle",
                "operationId": record["operationId"] if record else None,
                "request": deepcopy(record["request"]) if record else None,
                "blockedReasons": reasons,
            }

    def state(self):
        """Caller holds app._lock; never returns another project's work."""
        with self.lock:
            operation = self._operation_state()
            session = self.identity()
            project = self._project()
            reasons = operation["blockedReasons"]
            if not self.app._session_open:
                reasons.append("session_obsolete")
            if not self.app._state or self.app._state["selection"] != "accepted":
                reasons.append("project_required")
            if not self.app._work.values:
                reasons.append("no_changes")
            if self.app._selection_pending is not None:
                reasons.append("selection_pending")
            if self.app._presentation._pending is not None:
                reasons.append("pending_import")
            document = self.app._document
            tool_available = False
            membership = {"status": "unknown"}
            if document is None or document.status not in ("read", "missing"):
                reasons.append("invalid_source")
            elif self.app._work.values:
                try:
                    names = {r["number"]: r["definition"]["label"]
                             for r in self.app._state["data"]["attributes"]}
                    render(document.source_bytes, self.app._work.values, names)
                except SaveError as exc:
                    reasons.append(exc.code)
            if project and document is not None and document.status in ("read", "missing"):
                try:
                    directory = Path(project)
                    safe_path(directory)
                    info = directory.stat()
                    if ((info.st_dev, info.st_ino) != document.project_identity
                            or current_bytes(directory / "project.cfg") != document.project_config):
                        raise SaveError("project_changed", "Identite projet obsolete.")
                    installation = save_installation(self.app, directory, self.app._launch_context)
                    membership["status"] = "associated" if installation is not None else "unassociated"
                    plan = installation_tool_plan(directory, installation)
                    tool_available = bool(plan and plan.command and plan.executable.is_file())
                    ensure_writable(directory / "prjatt.dat")
                    if current_bytes(directory / "prjatt.dat") != document.source_bytes:
                        raise SaveError("external_conflict", "Source modifiee.")
                except SaveError as exc:
                    reasons.append(exc.code)
                except (OSError, ValueError, subprocess.SubprocessError):
                    LOGGER.warning("AIM save availability inspection failed", exc_info=True)
                    reasons.append("availability_unavailable")
            return {
                "sessionId": session, "projectRevision": self.app._project_revision,
                "fileSaveAvailable": not reasons,
                "prjtoolsAvailable": tool_available,
                "projectInstallation": membership,
                "save": operation,
            }

    def busy(self):
        return self._operation_state()["state"] == "running"

    def call(self, command, payload):
        if not valid_request(payload):
            return failure("invalid_payload", "Session et revisions entieres requises.")
        request = deepcopy(payload)
        key = request_key(request)
        with self.app._lock, self.lock:
            self._refresh()
            record = self.records.get(key)
            if command == COMMANDS[1]:
                if record is None:
                    return {"ok": True, "status": "not_found", "request": request}
                return self._reply(record)
            # A known key is a read of acceptance, never another operation.
            if record is not None:
                return self._accepted(record)
            with self.app._commit_lock:
                if request["sessionId"] != self.identity() or not self.app._session_open:
                    return failure("session_obsolete", "Session fermee ou remplacee.")
                if request["projectRevision"] != self.app._project_revision:
                    return failure("project_changed", "Revision projet obsolete.")
                if request["revision"] != self.app._work.revision:
                    return failure("stale_work", "Revision de travail obsolete.")
                state = self._operation_state()
                if state["state"] != "idle":
                    return failure(state["blockedReasons"][0],
                                   "Operation active ou reprise explicite requise.")
                if not self.app._state or self.app._state["selection"] != "accepted":
                    return failure("project_required", "Projet accepte requis.")
                if self.app._selection_pending is not None or self.app._presentation._pending is not None:
                    return failure("selection_pending", "Selection ou import en attente.")
                operation_id = uuid4().hex
                record = {
                    "version": 1, "request": request, "operationId": operation_id,
                    "project": self._project(), "phase": "validation", "result": None,
                    "file": {"written": False, "verified": None,
                             "finalVerification": "not_attempted", "sourceSHA256": None,
                             "backupId": None},
                    "tool": {"required": None, "launched": False, "finished": False,
                             "returnCode": None, "updateStatus": "unconfirmed",
                             "diagnosticId": None},
                }
                try:
                    self._write(record)
                except OSError:
                    LOGGER.exception("AIM save journal acceptance failed")
                    return failure("journal_unavailable", "Journal indisponible ; aucune ecriture.")
                self.records[key] = record
                self.active.add(key)
                with _LIVE_LOCK:
                    _LIVE.add(operation_id)
                service = ProjectValueSave(
                    self.app, runner=self.runner,
                    checkpoint=lambda event, facts: self._checkpoint(key, event, facts),
                )
                snapshot = deepcopy(self.app._work.values)
                try:
                    future = service.submit({k: request[k] for k in ("revision", "projectRevision")})
                except RuntimeError:
                    LOGGER.exception("AIM save worker start failed")
                    record["result"] = self._result(record, "worker_unavailable",
                                                    "Worker indisponible.")
                    self._write(record)
                    self.active.discard(key)
                    with _LIVE_LOCK:
                        _LIVE.discard(operation_id)
                    return self._accepted(record)
                self.futures[key] = future
                future.add_done_callback(lambda task: self._complete(key, snapshot, task))
                return self._accepted(record)

    @staticmethod
    def _accepted(record):
        return {"ok": True, "status": "accepted", "operationId": record["operationId"],
                "request": deepcopy(record["request"])}

    def _checkpoint(self, key, event, facts):
        with self.lock:
            record = self.records[key]
            file, tool = record["file"], record["tool"]
            if event == "plan":
                tool["required"] = facts["required"]
                tool["updateStatus"] = "unconfirmed" if facts["required"] else "not_required"
            elif event == "publication":
                record["phase"] = "publication"
                file["written"] = None
            elif event == "published":
                file.update(written=True, verified=True, **facts)
            elif event == "tool":
                record["phase"] = "tool"
                tool.update(launched=None, finished=None)
            elif event == "tool_check":
                record["phase"] = "tool"
            elif event == "tool_launched":
                tool.update(launched=True, **facts)
            elif event == "tool_finished":
                tool.update(finished=True, **facts)
            elif event == "acknowledgement":
                record["phase"] = event
                file["finalVerification"] = "confirmed"
            elif event == "acknowledged":
                record["result"] = self._result(record, "", "", saved=True)
            else:
                record["phase"] = event
            try:
                self._write(record)
            except OSError as exc:
                if event == "acknowledged":
                    record["result"] = None
                raise SaveError("journal_unavailable", "Journal interrompu ; effets a examiner.") from exc

    @staticmethod
    def _result(record, code, message, *, saved=False):
        file, tool = deepcopy(record["file"]), deepcopy(record["tool"])
        partial = file["written"] is not False
        return {
            "ok": saved, "status": "saved" if saved else "partial" if partial else "failed",
            "stage": "complete" if saved else record["phase"],
            "file": file, "tool": tool, "acknowledged": saved,
            "recoveryRequired": partial and not saved,
            "error": None if saved else {"code": code, "message": message},
            "message": "Attributs du projet enregistr\u00e9s." if saved else message,
        }

    def _complete(self, key, snapshot, future):
        with self.app._lock, self.lock:
            record = self.records[key]
            try:
                outcome = future.result()
            except Exception as exc:
                LOGGER.error("AIM save worker exception: %s", type(exc).__name__)
                outcome = {"status": "partial", "error": {
                    "code": "worker_failed", "message": "Worker interrompu ; effets a examiner."}}
            saved = outcome["status"] == "saved"
            if saved and record["result"] is not None:
                self.active.discard(key)
                with _LIVE_LOCK:
                    _LIVE.discard(record["operationId"])
                return
            if outcome.get("written") is True:
                record["file"]["written"] = True
            elif outcome.get("written") is False:
                record["file"]["written"] = False
            if outcome.get("backup"):
                record["file"]["backupId"] = Path(outcome["backup"]).name
            if outcome.get("error", {}).get("code") == "verification_failed":
                if record["phase"] == "publication":
                    record["file"]["verified"] = False
                else:
                    record["file"]["finalVerification"] = "failed"
            error = outcome.get("error") or {}
            record["result"] = self._result(record, error.get("code", "save_failed"),
                                             error.get("message", "Enregistrement non confirme."),
                                             saved=saved)
            try:
                self._write(record)
            except OSError:
                LOGGER.exception("AIM save terminal journal failed")
                if saved:
                    # Preserve the captured drafts if durable acknowledgement failed.
                    self.app._work.values = {**snapshot, **self.app._work.values}
                    self.app._work.changed()
                record["result"] = self._result(record, "journal_unavailable",
                                                 "Resultat durable non confirme.")
            finally:
                self.active.discard(key)
                with _LIVE_LOCK:
                    _LIVE.discard(record["operationId"])

    def _reply(self, record):
        base = {"ok": True, "operationId": record["operationId"],
                "request": deepcopy(record["request"])}
        if record["result"] is None:
            return {**base, "status": "running", "phase": record["phase"],
                    "file": deepcopy(record["file"]), "tool": deepcopy(record["tool"])}
        expected_revision = record["request"]["projectRevision"] + (
            1 if record["result"]["acknowledged"] else 0)
        same = (self.app._session_open and self.identity() == record["request"]["sessionId"]
                and self._project() == record["project"]
                and self.app._project_revision == expected_revision)
        work = self.app._work.response()["work"] if same else None
        return {**base, "status": "completed", "result": deepcopy(record["result"]),
                "work": work}
