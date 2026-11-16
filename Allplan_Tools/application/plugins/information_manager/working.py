"""Window-local working values; never a project writer."""
from copy import deepcopy
import logging

from application.core.context import LaunchContext
from .project import AimProjectApp


LOGGER = logging.getLogger(__name__)
WORK_COMMANDS = ("work.get", "work.value.set", "work.discard", "work.transition", "work.close")


class WorkingState:
    def __init__(self, app):
        self.app = app
        self.revision = 0
        self.values = {}
        self.baseline = deepcopy(app._presentation._current)
        self.authorized = False
        self.close_permitted = False

    @staticmethod
    def error(code, message):
        LOGGER.warning("AIM working command refused: %s", code)
        return {"ok": False, "error": {"code": code, "message": message}}

    def source_values(self):
        if not self.app._state or self.app._state["selection"] != "accepted":
            return {}
        values = self.app._document.values() if self.app._document else None
        if values is None:
            raise RuntimeError("Projet accepte sans valeurs source exploitables.")
        return values

    def effective_values(self):
        result = dict(self.source_values())
        for number, value in self.values.items():
            if value is None:
                result.pop(number, None)
            else:
                result[number] = value
        return result

    def dirty(self):
        current = self.app._presentation._current
        configuration = current["configuration"] if current else None
        baseline = self.baseline["configuration"] if self.baseline else None
        return {"values": bool(self.values), "presentation": configuration != baseline}

    def changed(self):
        self.revision += 1
        self.close_permitted = False

    def reset_project(self):
        self.values.clear()
        self.app._presentation._pending = None
        self.app._presentation._pending_file = None
        if getattr(self.app, "_presentation_save", False):
            self.app._presentation._current = deepcopy(self.baseline)
        else:
            self.app._presentation._current = None
            self.app._presentation._working_file = None
            self.app._presentation._working_bytes = None
            self.baseline = None
        self.changed()

    def response(self, status="current"):
        if getattr(self.app, "_presentation_restore_error", None) is not None:
            return deepcopy(self.app._presentation_restore_error)
        if self.app._state is None:
            return self.error("project_required", "Initialisez le projet avant de demander le travail.")
        source = self.app._snapshot()
        effective = deepcopy(source["data"])
        values = self.effective_values()
        for row in effective["attributes"]:
            if row["number"] in self.values:
                row["value"] = values.get(row["number"])
                row["valueState"] = "set" if row["number"] in values else "unset"
        presentation = self.app._presentation.call("presentation.get", {})
        if not presentation["ok"]:
            return presentation
        dirty = self.dirty()
        response = {"ok": True, "status": status, "work": {
            "revision": self.revision, "source": source, "data": effective,
            "draftValues": deepcopy(self.values),
            "pendingImport": self.app._presentation._pending is not None,
            "presentation": presentation["presentation"],
            "dirty": {**dirty, "any": any(dirty.values())},
            "fileSaveAvailable": False, "prjtoolsAvailable": False,
        }}
        transport = getattr(self.app, "_save_transport", None)
        if transport is not None:
            response["work"].update(transport.state())
        return response

    def call(self, command, payload):
        fields = {
            "work.get": set(), "work.value.set": {"revision", "number", "value"},
            "work.discard": {"revision"}, "work.close": {"revision", "discard"},
            "work.transition": {"revision", "command", "payload", "discard"},
        }
        if type(payload) is not dict or set(payload) != fields[command]:
            return self.error("invalid_payload", "Payload de travail invalide.")
        if command != "work.get" and (
            type(payload["revision"]) is not int or payload["revision"] != self.revision
        ):
            return self.error("stale_work", "Etat de travail modifie ; relisez work.get.")
        if command in ("work.close", "work.transition") and type(payload["discard"]) is not bool:
            return self.error("invalid_payload", "Confirmation booleenne requise.")
        if command == "work.get":
            return self.response()
        if command == "work.value.set":
            number, value = payload["number"], payload["value"]
            if (type(number) is not str or not number.isascii() or not number.isdecimal()
                    or len(number) > 1 and number.startswith("0")
                    or value is not None and type(value) is not str):
                return self.error("invalid_payload", "Numero canonique et valeur texte ou null requis.")
            if not self.app._state or self.app._state["selection"] != "accepted":
                return self.error("project_required", "Chargez un projet avant de modifier une valeur.")
            known = {r["number"] for r in self.app._state["data"]["attributes"]} | set(self.source_values())
            if number not in known:
                return self.error("unknown_attribute", "Attribut absent du projet charge.")
            previous = deepcopy(self.values)
            revision = self.revision
            close_permitted = self.close_permitted
            source = self.source_values()
            if value == source.get(number) and (value is None or number in source):
                self.values.pop(number, None)
            else:
                self.values[number] = value
            self.changed()
            response = self.response("updated")
            if not response["ok"]:
                self.values, self.revision = previous, revision
                self.close_permitted = close_permitted
            return response
        if command == "work.discard":
            self.values.clear()
            self.app._presentation._current = deepcopy(self.baseline)
            self.app._presentation._pending = None
            self.changed()
            return self.response("discarded")
        if command == "work.close":
            if (any(self.dirty().values()) or self.app._presentation._pending is not None) and not payload["discard"]:
                return self.error("work_confirmation_required", "Annulez ou abandonnez les modifications avant de fermer.")
            if self.app._window is None:
                return self.error("window_unavailable", "Aucune fenetre native attachee.")
            self.close_permitted = True
            return {"ok": True, "status": "close_requested"}
        target, body = payload["command"], payload["payload"]
        if (type(target) is not str or target not in (
            "project.select", "project.manager.open", "presentation.import.apply",
        ) or type(body) is not dict):
            return self.error("invalid_payload", "Transition de travail non autorisee.")
        lost = self.dirty() if target != "presentation.import.apply" else {
            "presentation": self.dirty()["presentation"],
        }
        if target != "presentation.import.apply" and self.app._presentation._pending is not None:
            lost["pendingImport"] = True
        if any(lost.values()) and not payload["discard"]:
            return self.error("work_confirmation_required", "Annulez ou abandonnez les modifications concernees.")
        self.authorized = True
        try:
            if target == "project.manager.open":
                if set(body) != {"path", "discardPresentation"} or type(body["discardPresentation"]) is not bool:
                    return self.error("invalid_payload", "Payload du gestionnaire invalide.")
                body = {**body, "discardPresentation": payload["discard"]}
            reply = self.app.call(target, body)
        finally:
            self.authorized = False
        if not reply["ok"] or reply.get("status") == "cancelled":
            return reply
        result = self.response("transitioned")
        if result["ok"]:
            result["result"] = reply
        return result

    def select(self, payload):
        return self.select_transition(payload)

    def select_transition(self, payload, *, transition=None, manager=False):
        with self.app._lock:
            transport = getattr(self.app, "_save_transport", None)
            if transport is not None and transport.busy():
                return self.error("save_busy", "Enregistrement en cours ; selection refusee.")
            if transition is not None:
                if (type(transition) is not dict
                        or set(transition) != {"revision", "command", "payload", "discard"}
                        or transition["command"] != (
                            "project.manager.open" if manager else "project.select"
                        )
                        or type(transition["discard"]) is not bool):
                    return self.error("invalid_payload", "Transition de selection invalide.")
                revision = transition["revision"]
                if type(revision) is not int or revision != self.revision:
                    return self.error("stale_work", "Etat de travail modifie ; relisez work.get.")
                discard = transition["discard"]
            else:
                revision, discard = self.revision, False
            pending = deepcopy(self.app._presentation._pending)
            if manager:
                if (type(payload) is not dict or set(payload) != {"path", "discardPresentation"}
                        or type(payload["path"]) is not str
                        or type(payload["discardPresentation"]) is not bool):
                    return self.error("invalid_payload", "Payload du gestionnaire invalide.")
                payload = {**payload, "discardPresentation": discard if transition else payload["discardPresentation"]}
                selection_payload = {"path": payload["path"]}
                if getattr(self.app, "_presentation_save", False):
                    try:
                        if self.app._manager.is_active(payload["path"]):
                            if transition is not None:
                                return self.response("transitioned")
                            return {"ok": True, "data": self.app._snapshot()}
                    except (OSError, ValueError):
                        return self.error("invalid_project_path", "Identite du projet inaccessible.")
            else:
                selection_payload = payload

        def guard():
            if revision != self.revision or pending != self.app._presentation._pending:
                return self.error("stale_work", "Le travail a change pendant la selection.")
            if not discard and (
                any(self.dirty().values()) or self.app._presentation._pending is not None
            ):
                return self.error("work_confirmation_required", "Utilisez work.transition pour confirmer les pertes.")
            if manager:
                return self.app._manager._open_check(payload)
            return None

        def adopted(previous, reply):
            old = previous["project"]["path"] if previous and previous["project"] else None
            new = self.app._state["project"]["path"]
            different = old is None or self.app._path_key(LaunchContext._path(old)) != self.app._path_key(LaunchContext._path(new))
            if different:
                self.reset_project()
            else:
                self.values.clear()
                self.changed()
            if transition is not None:
                result = self.response("transitioned")
                if result["ok"]:
                    result["result"] = reply
                return result
            return reply

        return self.app._select_project(selection_payload, guard=guard, adopted=adopted)
