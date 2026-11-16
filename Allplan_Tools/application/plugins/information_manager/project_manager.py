"""Explicit project inventory and isolated read-only previews in the existing AIM host."""
from copy import deepcopy
import logging
import os

from application.core.configuration import SettingsStoreError
from application.core.context import LaunchContext
from .presentation_import import display_model
from .presentation_structure import category_children, is_group


LOGGER = logging.getLogger(__name__)
PROJECT_INSTALLATION_UNKNOWN = {
    "legacy_entry", "ambiguous", "association_unavailable", "no_installations",
}
MANAGER_COMMANDS = (
    "project.source", "project.manager.list", "project.manager.add",
    "project.manager.preview", "project.manager.open",
)
MANAGER_MENU_COMMANDS = (
    "project.manager.favorites.list", "project.manager.favorite.set",
    "project.manager.folder.open", "project.manager.remove",
)
ACTIVE_COMMAND = "project.manager.isActive"


def definition_source(state):
    installation = state.get("installation")
    if (installation and state["definitions"]["status"] in (
        "available", "available_with_diagnostics",
    ) and installation.get("version")):
        return {
            "status": "resolved", "version": installation["version"],
            "verificationVersion": installation["verificationVersion"], "reason": None,
        }
    return {
        "status": "unresolved", "version": None, "verificationVersion": None,
        "reason": "definitions_not_loaded",
    }


class ProjectManager:
    def __init__(self, app):
        self.app = app

    @staticmethod
    def error(code, message):
        LOGGER.warning("AIM project manager refused: %s", code)
        return {"ok": False, "error": {"code": code, "message": message}}

    def entries(self):
        section = self.app._settings_store.load(self.app.app_id, strict=True).get("aimProjectManager", {})
        if type(section) is not dict or type(section.get("projects", [])) is not list:
            raise ValueError("Inventaire de projets invalide.")
        result, seen = [], set()
        for item in section.get("projects", []):
            if (type(item) is not dict or set(item) not in (
                {"path", "source"}, {"path", "source", "projectInstallation"},
            )):
                raise ValueError("Entree de projet invalide.")
            path = LaunchContext._path(item["path"])
            source = item["source"]
            if (path.suffix.lower() != ".prj" or type(source) is not dict
                    or set(source) != {"status", "version", "verificationVersion", "reason"}
                    or source["status"] not in ("resolved", "unresolved")):
                raise ValueError("Source de projet invalide.")
            if source["status"] == "resolved":
                if type(source["version"]) is not str:
                    raise ValueError("Annee textuelle requise.")
                normalized = LaunchContext(allplan_version=source["version"]).allplan_version
                if (normalized != source["version"] or type(source["verificationVersion"]) is not bool
                        or source["reason"] is not None):
                    raise ValueError("Version de source invalide.")
            elif (source["version"] is not None or source["verificationVersion"] is not None
                  or source["reason"] != "definitions_not_loaded"):
                raise ValueError("Source non resolue incoherente.")
            affiliation = item.get("projectInstallation", {
                "status": "unknown", "reason": "legacy_entry",
            })
            if type(affiliation) is not dict:
                raise ValueError("Appartenance PRJ invalide.")
            if affiliation.get("status") == "associated":
                if (set(affiliation) != {
                    "status", "version", "verificationVersion", "prjPath",
                } or type(affiliation["version"]) is not str
                        or LaunchContext(allplan_version=affiliation["version"]).allplan_version
                        != affiliation["version"]
                        or type(affiliation["verificationVersion"]) is not bool
                        or type(affiliation["prjPath"]) is not str
                        or not affiliation["prjPath"]):
                    raise ValueError("Appartenance PRJ associee invalide.")
            elif affiliation.get("status") == "unassociated":
                if set(affiliation) != {"status"}:
                    raise ValueError("Appartenance PRJ externe invalide.")
            elif affiliation.get("status") == "unknown":
                if (set(affiliation) != {"status", "reason"}
                        or affiliation["reason"] not in PROJECT_INSTALLATION_UNKNOWN):
                    raise ValueError("Appartenance PRJ inconnue invalide.")
            else:
                raise ValueError("Statut d'appartenance PRJ inconnu.")
            key = self.app._path_key(path)
            if key not in seen:
                result.append({
                    "path": str(path), "source": deepcopy(source),
                    "projectInstallation": deepcopy(affiliation),
                })
                seen.add(key)
        if self.app._presentation_save and section.get("openedHistoryImported") is not True:
            for path in self.app._recent_paths():
                key = self.app._path_key(path)
                if key not in seen:
                    result.append({
                        "path": str(path),
                        "source": {"status": "unresolved", "version": None,
                                   "verificationVersion": None, "reason": "definitions_not_loaded"},
                        "projectInstallation": {"status": "unknown", "reason": "legacy_entry"},
                    })
                    seen.add(key)
        return result

    def paths(self):
        return [LaunchContext._path(item["path"]) for item in self.entries()]

    def is_active(self, path):
        state = self.app._state
        if not state or state["selection"] != "accepted" or not state["project"]:
            return False
        requested = LaunchContext._path(path)
        current = LaunchContext._path(state["project"]["path"])
        return requested.resolve() == current.resolve() or os.path.samefile(requested, current)

    def remember(self, state):
        entries = self.entries()
        key = self.app._path_key(LaunchContext._path(state["project"]["path"]))
        item = next((entry for entry in entries if self.app._path_key(
            LaunchContext._path(entry["path"]),
        ) == key), None)
        fields = {
            "path": state["project"]["path"], "source": definition_source(state),
            "projectInstallation": deepcopy(self.app._project_installation),
        }
        if item is None:
            entries.append(fields)
        else:
            item.update(fields)
        self._save(entries)

    def favorites(self, entries):
        section = self.app._settings_store.load(self.app.app_id).get("aimProjectManager", {})
        paths = section.get("favorites", [])
        if type(paths) is not list or any(type(path) is not str for path in paths):
            raise ValueError("Favoris de projets invalides.")
        known = {self.app._path_key(LaunchContext._path(item["path"])): item["path"]
                 for item in entries}
        result = []
        for raw in paths:
            key = self.app._path_key(LaunchContext._path(raw))
            if key not in known:
                raise ValueError("Projet favori absent du gestionnaire.")
            if known[key] not in result:
                result.append(known[key])
        return result

    def _save(self, entries, *, favorites=None):
        projects = []
        for item in entries:
            stored = {"path": item["path"], "source": item["source"]}
            if item.get("projectInstallation", {}).get("reason") != "legacy_entry":
                stored["projectInstallation"] = item["projectInstallation"]
            projects.append(stored)
        section = {"projects": projects}
        if self.app._presentation_save:
            section["openedHistoryImported"] = True
        if favorites is not None:
            section["favorites"] = favorites
        self.app._settings_store.save(self.app.app_id, {
            "version": 1, "aimProjectManager": section,
        })

    def _isolated_reader(self):
        return self.app._isolated_reader()

    def _open_check(self, payload):
        if (type(payload) is not dict or set(payload) != {"path", "discardPresentation"}
                or type(payload["path"]) is not str
                or type(payload["discardPresentation"]) is not bool):
            return self.error("invalid_payload", "Requete de gestionnaire invalide.")
        try:
            requested = LaunchContext._path(payload["path"])
            if self.app._path_key(requested) not in {
                self.app._path_key(LaunchContext._path(item["path"])) for item in self.entries()
            }:
                return self.error("project_not_added", "Ajoutez ce projet au gestionnaire.")
        except (OSError, ValueError, SettingsStoreError):
            LOGGER.exception("AIM manager selection validation failed")
            return self.error("manager_unavailable", "Inventaire inaccessible.")
        different = self.app._state is None or self.app._state["project"] is None or (
            self.app._path_key(requested) != self.app._path_key(
                LaunchContext._path(self.app._state["project"]["path"]),
            )
        )
        if different and (
            self.app._presentation._current is not None or self.app._presentation._pending is not None
        ) and not payload["discardPresentation"]:
            return self.error("presentation_confirmation_required", "Confirmez l'abandon de la presentation.")
        return None

    def open(self, payload):
        with self.app._lock:
            error = self._open_check(payload)
            if error is not None:
                return error
            previous = deepcopy((self.app._presentation._current, self.app._presentation._pending))

        def guard():
            if previous != (self.app._presentation._current, self.app._presentation._pending):
                return self.error("project_changed", "Presentation modifiee pendant la selection.")
            return self._open_check(payload)

        def adopted(old, reply):
            if old is None or old["project"] is None or (
                self.app._path_key(LaunchContext._path(old["project"]["path"]))
                != self.app._path_key(LaunchContext._path(payload["path"]))
            ):
                self.app._presentation._current = None
                self.app._presentation._pending = None
            return reply

        return self.app._select_project({"path": payload["path"]}, guard=guard, adopted=adopted)

    def call(self, command, payload):
        if command == "project.manager.open":
            return self.open(payload)
        fields = {
            ACTIVE_COMMAND: {"path"},
            "project.source": set(), "project.manager.list": set(),
            "project.manager.add": set(), "project.manager.preview": {"path"},
            "project.manager.open": {"path", "discardPresentation"},
            "project.manager.favorites.list": set(),
            "project.manager.favorite.set": {"path", "favorite"},
            "project.manager.folder.open": {"path"},
            "project.manager.remove": {"path"},
        }
        if (type(payload) is not dict or set(payload) != fields[command]
                or "path" in payload and type(payload["path"]) is not str
                or "discardPresentation" in payload
                and type(payload["discardPresentation"]) is not bool
                or "favorite" in payload and type(payload["favorite"]) is not bool):
            return self.error("invalid_payload", "Requete de gestionnaire invalide.")
        try:
            return self._call(command, payload)
        except (OSError, ValueError, SettingsStoreError):
            LOGGER.exception("AIM project manager access failed: command=%s", command)
            return self.error("manager_unavailable",
                              "Inventaire ou source inaccessible ; reessayez ou consultez le journal.")

    def _call(self, command, payload):
        app = self.app
        if command == ACTIVE_COMMAND:
            return {"ok": True, "active": self.is_active(payload["path"])}
        if command == "project.source":
            state = app._state if app._state is not None else app._empty("required", [])
            return {"ok": True, "source": definition_source(state)}
        if command == "project.manager.remove":
            state = app._state
            if (state and state["selection"] == "accepted" and state["project"]
                    and app._path_key(LaunchContext._path(payload["path"]))
                    == app._path_key(LaunchContext._path(state["project"]["path"]))):
                return self.error(
                    "active_project_removal_forbidden",
                    "Le projet ouvert dans l'editeur ne peut pas etre retire de la liste AIM.",
                )
        entries = self.entries()
        if command in MANAGER_MENU_COMMANDS:
            return self._menu(command, payload, entries)
        if command == "project.manager.list":
            if (self.app._presentation_save and self.app._settings_store.load(
                self.app.app_id, strict=True,
            ).get("aimProjectManager", {}).get("openedHistoryImported") is not True):
                self._save(entries)
            return {"ok": True, "projects": [
                {
                    "path": item["path"], "name": LaunchContext._path(item["path"]).name,
                    "source": item["source"], "sourceFreshness": "last_read",
                    **({"projectInstallation": item["projectInstallation"]}
                       if app._project_manager_assignment else {}),
                }
                for item in entries
            ]}
        requested = LaunchContext._path(payload["path"]) if "path" in payload else None
        if requested is not None and app._path_key(requested) not in {
            app._path_key(LaunchContext._path(item["path"])) for item in entries
        }:
            return self.error("project_not_added", "Ajoutez ce projet au gestionnaire avant de l'utiliser.")
        reader = self._isolated_reader()
        state = reader._select([], requested=requested, remember=False)
        if state["selection"] == "cancelled":
            return {"ok": True, "status": "cancelled"}
        if state["selection"] != "accepted":
            return self.error("project_read_error", app._failure_message(state))
        path = state["project"]["path"]
        source = definition_source(state)
        project_installation = deepcopy(reader._project_installation)
        key = app._path_key(LaunchContext._path(path))
        existing = next((item for item in entries if app._path_key(
            LaunchContext._path(item["path"]),
        ) == key), None)
        if existing is None:
            entries.append({
                "path": path, "source": source,
                "projectInstallation": project_installation,
            })
        else:
            existing.update(
                path=path, source=source,
                projectInstallation=project_installation,
            )
        if command == "project.manager.add":
            self._save(entries)
            return {"ok": True, "status": "added", "project": {
                **state["project"], "source": source, "sourceFreshness": "last_read",
                **({"projectInstallation": project_installation}
                   if app._project_manager_assignment else {}),
            }}
        try:
            preview = self._preview(state, reader)
        except RuntimeError:
            LOGGER.exception("AIM preview model unavailable")
            return self.error("preview_unavailable", "Apercu indisponible ; le projet actif est conserve.")
        self._save(entries)
        if app._project_manager_assignment:
            preview["projectInstallation"] = project_installation
        return {"ok": True, "status": "preview", "preview": preview}

    def _menu(self, command, payload, entries):
        app = self.app
        if command == "project.manager.favorites.list":
            return {"ok": True, "paths": self.favorites(entries)}
        requested = LaunchContext._path(payload["path"])
        key = app._path_key(requested)
        entry = next((item for item in entries
                      if app._path_key(LaunchContext._path(item["path"])) == key), None)
        if entry is None:
            return self.error("project_not_added", "Projet absent du gestionnaire.")
        path = entry["path"]
        if command == "project.manager.folder.open":
            if os.name != "nt":
                return self.error("unsupported_platform",
                                  "L'ouverture de dossier est disponible uniquement sous Windows.")
            if not LaunchContext._path(path).is_dir():
                return self.error("project_folder_unavailable", "Dossier de projet introuvable.")
            try:
                os.startfile(path, "explore")
            except OSError:
                LOGGER.exception("AIM project folder opening failed")
                return self.error("project_folder_unavailable",
                                  "Impossible d'ouvrir le dossier du projet.")
            return {"ok": True, "status": "opened", "path": path}
        favorites = self.favorites(entries)
        if command == "project.manager.favorite.set" and payload["favorite"]:
            if path not in favorites:
                favorites.append(path)
            self._save(entries, favorites=favorites)
            return {"ok": True, "status": "updated", "path": path, "favorite": True}
        favorites = [item for item in favorites
                     if app._path_key(LaunchContext._path(item)) != key]
        if command == "project.manager.favorite.set":
            self._save(entries, favorites=favorites)
            return {"ok": True, "status": "updated", "path": path,
                    "favorite": payload["favorite"]}
        remaining = [item for item in entries
                     if app._path_key(LaunchContext._path(item["path"])) != key]
        self._save(remaining, favorites=favorites)
        return {"ok": True, "status": "removed", "path": path}

    def _preview(self, state, reader):
        app = self.app
        current = app._presentation._current
        same = app._state and app._state["project"] and app._path_key(
            LaunchContext._path(app._state["project"]["path"]),
        ) == app._path_key(LaunchContext._path(state["project"]["path"]))
        values = reader._document.values() if reader._document else None
        items = []
        if same and current is not None:
            model = display_model(current["configuration"], current["report"], {
                **state, "_presentationValues": values,
            })
            for category in model["categories"]:
                for child in category_children(model, category):
                    grouped = is_group(model, child)
                    visible = [
                        {"kind": "row", "id": row["id"], "number": row["number"],
                         "title": row["title"], "value": row["value"]}
                        for row in (child["rows"] if grouped else [child])
                        if row["valueState"] == "set" and row["value"] not in (None, "")
                    ]
                    if visible:
                        if grouped:
                            group = {"kind": "group", "id": child["id"],
                                     "title": child["title"], "rows": visible}
                            if app._project_manager_preview_color:
                                group["backgroundColor"] = child["backgroundColor"]
                            items.append(group)
                        else:
                            items.extend(visible)
            mode = "current_presentation"
        else:
            attributes = {item["number"]: item for item in state["data"]["attributes"]}
            items = [
                {"kind": "row", "id": number, "number": number,
                 "title": attributes[number]["label"] if number in attributes else None, "value": value}
                for number, value in (values or {}).items() if value not in (None, "")
            ]
            mode = "attributes_without_presentation"
        return {
            "project": deepcopy(state["project"]), "source": definition_source(state),
            "readOnly": True, "valuesStatus": state["prjatt"]["status"],
            "mode": mode, "items": items,
        }
