"""Read-only project service. No Allplan process or project writer."""
from dataclasses import asdict, replace
from decimal import Decimal
from stat import S_ISDIR
from threading import RLock
from typing import Literal, TypedDict
import logging
import os
import subprocess

from application.core.base import BaseApp
from application.core.configuration import SettingsStore, SettingsStoreError
from application.core.context import LaunchContext
from application.core.allplan.readers.project_attributes import read_project_attributes
from application.core.allplan.readers.attributes import discover_attributes, read_project_definitions
from application.core.allplan.models import Availability
from application.core.allplan.project_installation import discover_project_installations
from application.core.allplan.sources import read_project_config, SourceSelection
from .application import InformationManagerApp


LOGGER = logging.getLogger(__name__)
PROJECT_COMMANDS = ("project.select", "project.recent")


class StaleProjectPath(ValueError):
    """An existing history path no longer designates a project directory."""


class ProjectDiagnostic(TypedDict):
    code: str
    severity: str
    message: str
    path: str | None
    line: int | None
    attributeNumber: str | None
    relatedPath: str | None


class ProjectAttribute(TypedDict):
    number: str
    label: str
    definition: dict
    valueState: Literal["set", "unset", "unavailable"]
    value: str | None


class ProjectData(TypedDict):
    attributes: list[ProjectAttribute]


class ProjectFileState(TypedDict):
    status: str
    path: str | None
    encodingHint: str | None
    header: str | None


Selection = Literal["accepted", "cancelled", "required", "error", "installation_required"]


class ProjectState(TypedDict):
    app: str
    project_contract: int
    capabilities: list[str]
    read_only: bool
    selection: Selection
    project: dict[str, str] | None
    prjatt: ProjectFileState
    definitions: dict
    installation: dict | None
    installationCandidates: list[dict]
    data: ProjectData
    diagnostics: list[ProjectDiagnostic]


def _diagnostics(issues) -> list[ProjectDiagnostic]:
    return [
        {"code": issue.code, "severity": issue.severity, "message": issue.message,
         "path": str(issue.provenance.path) if issue.provenance else None,
         "line": issue.provenance.position if issue.provenance else None,
         "attributeNumber": issue.attribute_number,
         "relatedPath": str(issue.related.path) if issue.related else None}
        for issue in issues
    ]


class AimProjectApp(BaseApp):
    app_id = InformationManagerApp.app_id
    title = InformationManagerApp.title
    _requires_protected_host = True

    def __init__(self, data_dir, context, *, settings_store=None, choose_directory=None,
                 discover_installations=None, timeout=15, definition_language=""):
        super().__init__(data_dir)
        self._set_launch_context(context)
        self._settings_store = settings_store or SettingsStore(
            self._data_dir / "aim-settings.json"
        )
        self._choose_directory = choose_directory
        self._discover_installations = discover_installations or (
            lambda: discover_project_installations(timeout)
        )
        self._window = None
        self._lock = RLock()
        self._state: ProjectState | None = None
        self._document = None
        self._project_installation = {
            "status": "unknown", "reason": "no_installations",
        }
        self._definition_language = definition_language
        self._commit_lock = RLock()
        self._session = 0
        self._session_open = True
        self._session_closed = False
        self._selection_pending = None
        self._project_revision = 0

    def _invalidate_session(self, *, permanent=False):
        # Never acquire the active-state lock before invalidating a pending read.
        with self._commit_lock:
            self._session += 1
            self._session_open = False
            self._session_closed |= permanent
            return self._session

    def _rearm_session(self, session):
        with self._commit_lock:
            if self._session == session and not self._session_closed:
                self._session += 1
                self._session_open = True

    def _close_session(self):
        self._invalidate_session(permanent=True)

    def _isolated_reader(self):
        reader = AimProjectApp(
            self._data_dir, self._launch_context, settings_store=self._settings_store,
            choose_directory=self._choose_directory,
            discover_installations=self._discover_installations,
            definition_language=self._definition_language,
        )
        reader._attach_window(self._window)
        return reader

    def _attach_window(self, window):
        self._window = window

    def get_app_info(self):
        return {
            **super().get_app_info(),
            "capabilities": ["project.select"],
            "read_only": True,
            "project_contract": 2,
            "project_history_contract": 1,
        }

    def get_initial_data(self):
        with self._lock:
            if self._state is not None:
                return self._snapshot()
            with self._commit_lock:
                session = self._session
                if not self._session_open:
                    return self._empty("error", [self._issue("selection_obsolete", "Fenetre fermee.")])
            revision = self._project_revision
            reader = self._isolated_reader()
        issues = []
        candidate = self._launch_context.project_path
        from_history = candidate is None
        if from_history:
            try:
                recent = self._recent_paths()
                if recent:
                    candidate = recent[0]
            except (OSError, ValueError, SettingsStoreError) as exc:
                issues.append(self._issue("history_error", str(exc)))
        state = None
        if candidate is not None:
            try:
                self._validate_project_path(candidate)
            except (FileNotFoundError, NotADirectoryError, StaleProjectPath) as exc:
                issues.append(self._issue(
                    "history_project_stale" if from_history else "project_unavailable",
                    str(exc), "warning" if from_history else "error",
                ))
            except (OSError, ValueError) as exc:
                issues.append(self._issue("project_unavailable", str(exc)))
            else:
                try:
                    state = reader._load(candidate, issues, remember=False)
                except (OSError, ValueError) as exc:
                    issues.append(self._issue("project_unavailable", str(exc)))
        if state is None:
            selection = "error" if any(i["severity"] == "error" for i in issues) else "required"
            state = self._empty(selection, issues)
        if state["selection"] != "accepted":
            state["project"] = None
            state["data"] = {"attributes": []}
            reader._document = None
        with self._lock:
            with self._commit_lock:
                if not self._session_open or session != self._session:
                    return self._empty("error", [self._issue("selection_obsolete", "Initialisation obsolete.")])
                if self._state is not None or revision != self._project_revision:
                    return self._snapshot()
                if state["selection"] == "accepted":
                    self._project_installation = reader._project_installation
                    self._remember_project(state)
                self._state = state
                self._document = reader._document
                self._project_installation = reader._project_installation
                self._project_revision += 1
                return self._snapshot()

    def call(self, command, payload):
        if command == "project.select":
            return self._select_project(payload)
        with self._lock:
            if command != "project.recent":
                LOGGER.warning("AIM command refused before delegation: %r", command)
                return {"ok": False, "error": {
                    "code": "unknown_command", "message": "Commande AIM non exposee.",
                }}
            if type(payload) is not dict or payload:
                LOGGER.warning("AIM project command refused: invalid_payload")
                return {"ok": False, "error": {
                    "code": "invalid",
                    "message": "Payload de selection ou d'historique invalide.",
                }}
            try:
                recent = self._recent_paths()
            except (OSError, ValueError, SettingsStoreError) as exc:
                self._issue("history_error", str(exc))
                return self._selection_error(
                    "history_unavailable",
                    "Historique des projets inaccessible ; utilisez le selecteur de projet.",
                )
            return {"ok": True, "projects": [
                {"path": str(path), "name": path.name} for path in recent
            ]}

    @staticmethod
    def _selection_error(code, message):
        LOGGER.warning("AIM selection refused: %s", code)
        return {"ok": False, "error": {"code": code, "message": message}}

    def _selection_request(self, payload):
        if (type(payload) is not dict or set(payload) not in (set(), {"path"})
                or "path" in payload and type(payload["path"]) is not str):
            return None, self._selection_error("invalid", "Payload de selection ou d'historique invalide.")
        if "path" not in payload:
            return None, None
        try:
            requested = LaunchContext._path(payload["path"])
        except ValueError:
            return None, self._selection_error("invalid", "Chemin de projet recent invalide.")
        try:
            selectable = self._selectable_paths()
        except (OSError, ValueError, SettingsStoreError) as exc:
            self._issue("history_error", str(exc))
            return None, self._selection_error(
                "history_unavailable",
                "Historique des projets inaccessible ; utilisez le selecteur de projet.",
            )
        if self._path_key(requested) not in {self._path_key(p) for p in selectable}:
            return None, self._selection_error(
                "project_not_recent", "Projet absent de l'historique ; utilisez le selecteur de projet.",
            )
        return requested, None

    def _select_project(self, payload, *, guard=None, adopted=None):
        with self._lock:
            requested, error = self._selection_request(payload)
            if error is not None:
                return error
            if guard is not None:
                error = guard()
                if error is not None:
                    return error
            with self._commit_lock:
                if not self._session_open:
                    return self._selection_error("selection_obsolete", "Fenetre en cours de fermeture.")
                session = self._session
                if self._selection_pending is not None and self._selection_pending[0] == session:
                    return self._selection_error("selection_busy", "Une selection est deja en cours.")
                ticket = (session, object())
                self._selection_pending = ticket
            revision = self._project_revision
            reader = self._isolated_reader()
        try:
            state = reader._select([], requested=requested, remember=False)
            with self._lock:
                with self._commit_lock:
                    if not self._session_open or session != self._session:
                        return self._selection_error("selection_obsolete", "Resultat de selection obsolete.")
                if revision != self._project_revision:
                    return self._selection_error("stale_work", "Le projet a change pendant la selection.")
                if guard is not None:
                    error = guard()
                    if error is not None:
                        return error
                _, error = self._selection_request(payload)
                if error is not None:
                    return error
                with self._commit_lock:
                    if not self._session_open or session != self._session:
                        return self._selection_error("selection_obsolete", "Resultat de selection obsolete.")
                    return self._adopt_selection(reader, state, adopted)
        finally:
            with self._lock:
                if self._selection_pending is ticket:
                    self._selection_pending = None

    def _adopt_selection(self, reader, state, adopted):
        previous_state = self._state
        if state["selection"] != "accepted" and previous_state is not None:
            if state["selection"] == "cancelled":
                return {"ok": True, "status": "cancelled", "data": self._snapshot()}
            return self._selection_error(
                "project_read_error" if state["selection"] == "error" else "project_selection_required",
                self._failure_message(state),
            )
        if state["selection"] == "accepted":
            # Commit gate is held: closing either invalidated us already, or waits.
            self._project_installation = reader._project_installation
            self._remember_project(state)
            self._document = reader._document
            self._project_installation = reader._project_installation
        else:
            self._document = None
            state["project"] = None
            state["data"] = {"attributes": []}
        self._state = state
        self._project_revision += 1
        if state["selection"] in ("error", "required", "installation_required"):
            return {"ok": False, "data": self._snapshot(), "error": {
                "code": "project_read_error" if state["selection"] == "error"
                else "project_selection_required",
                "message": self._failure_message(state),
            }}
        reply = {"ok": True, "data": self._snapshot()}
        if adopted is not None and state["selection"] == "accepted":
            return adopted(previous_state, reply)
        return reply

    @staticmethod
    def _path_key(path):
        return os.path.normcase(str(path))

    def _recent_paths(self):
        settings = self._settings_store.load(self.app_id, strict=True)
        history = settings.get("aimProject", {})
        if not isinstance(history, dict):
            raise ValueError("Historique AIM invalide.")
        raw = history.get("recentProjects", [])
        if type(raw) is not list:
            raise ValueError("Liste des projets recents invalide.")
        last = history.get("lastProject")
        paths = []
        seen = set()
        for value in ([last] if last is not None else []) + raw:
            path = LaunchContext._path(value)
            key = self._path_key(path)
            if key not in seen:
                paths.append(path)
                seen.add(key)
        return paths

    def _selectable_paths(self):
        return self._recent_paths()

    def _snapshot(self) -> ProjectState:
        from copy import deepcopy
        if self._state is None:
            raise RuntimeError("Etat AIM non initialise.")
        return deepcopy(self._state)

    @staticmethod
    def _issue(code, message, severity="error") -> ProjectDiagnostic:
        LOGGER.log(logging.INFO if severity == "info" else logging.WARNING,
                   "AIM %s: %s", code, message)
        return {"code": code, "severity": severity, "message": message,
                "path": None, "line": None, "attributeNumber": None, "relatedPath": None}

    @staticmethod
    def _failure_message(state):
        codes = {issue["code"] for issue in state["diagnostics"]}
        if "installation_discovery_error" in codes:
            return "Decouverte des installations Allplan impossible ; reessayez."
        if "installation_unavailable" in codes:
            return "Aucune installation Allplan avec des ressources exploitables."
        if "project_config_invalid" in codes:
            return "Configuration project.cfg illisible ou incompatible ; aucune valeur chargee."
        if state["prjatt"]["status"] == "error":
            return "Lecture de prjatt.dat impossible ou format incompatible ; valeurs indisponibles."
        if "definitions_unavailable" in codes:
            return "Definitions Allplan illisibles ou incompatibles ; aucune valeur chargee."
        return "Selection ou acces au projet impossible ; consultez les details techniques et reessayez."

    def _installation_options(self, discovered, issues):
        options = []
        active = self._launch_context
        for candidate in discovered:
            if candidate.allplan_version is None:
                issues.append(self._issue(
                    "installation_context_incomplete", "Installation sans version ignoree.",
                    "warning",
                ))
                continue
            if (candidate.allplan_version == active.allplan_version
                    and candidate.verification_version == active.verification_version):
                candidate = replace(
                    candidate, paths={**candidate.paths, **active.paths},
                    allplan_language=active.allplan_language or candidate.allplan_language,
                )
            try:
                complete = all(candidate.paths.get(key) is not None
                               and candidate.paths[key].is_dir()
                               for key in ("PRJ", "STD", "ETC"))
            except OSError:
                complete = False
            if not complete:
                issues.append(self._issue(
                    "installation_context_incomplete",
                    f"Installation Allplan {candidate.allplan_version} ignoree : "
                    "PRJ, STD et ETC accessibles de la meme installation requis.", "warning",
                ))
                continue
            if candidate not in options:
                options.append(candidate)
        return sorted(options, key=lambda item: (
            -int(item.allplan_version),
            item.allplan_version != active.allplan_version
            or item.verification_version != active.verification_version,
            item.verification_version,
            tuple(sorted((key, str(value).casefold()) for key, value in item.paths.items())),
        ))

    def _associated(self, project, context, issues):
        root = context.paths["PRJ"]
        try:
            if project.parent == root.resolve(strict=False):
                return True
            return project.parent.samefile(root)
        except OSError:
            issues.append(self._issue(
                "installation_association_unavailable",
                f"Association au PRJ Allplan {context.allplan_version} non verifiable.",
                "warning",
            ))
            return False

    @staticmethod
    def _empty(selection: Selection, issues: list[ProjectDiagnostic]) -> ProjectState:
        return {
            "app": "information_manager", "project_contract": 2,
            "capabilities": ["project.select"], "read_only": True,
            "selection": selection, "project": None,
            "installation": None, "installationCandidates": [],
            "prjatt": {"status": "not_loaded", "path": None, "encodingHint": None,
                       "header": None},
            "definitions": {"status": "not_loaded"},
            "data": {"attributes": []},
            "diagnostics": issues,
        }

    def _select(self, issues: list[ProjectDiagnostic], *, requested=None,
                remember=True) -> ProjectState:
        try:
            if requested is not None:
                selected = requested
            elif self._choose_directory is not None:
                selected = self._choose_directory()
            elif self._window is not None:
                import webview
                selected = self._window.create_file_dialog(webview.FileDialog.FOLDER)
            else:
                self._document = None
                return self._empty("error", [
                    *issues, self._issue("selection_unavailable", "Selecteur natif indisponible."),
                ])
        except (OSError, RuntimeError) as exc:
            self._document = None
            return self._empty("error", [
                *issues, self._issue("selection_error", str(exc)),
            ])
        if isinstance(selected, (list, tuple)):
            if len(selected) > 1:
                self._document = None
                return self._empty("error", [
                    *issues, self._issue("selection_error", "Un seul dossier projet est requis."),
                ])
            selected = selected[0] if selected else None
        if not selected:
            self._document = None
            return self._empty("cancelled", issues)
        try:
            if remember:
                return self._load(LaunchContext._path(selected), issues)
            return self._load(LaunchContext._path(selected), issues, remember=False)
        except (OSError, ValueError) as exc:
            self._document = None
            return self._empty("error", [
                *issues, self._issue("project_unavailable", str(exc)),
            ])

    @staticmethod
    def _validate_project_path(requested):
        project = LaunchContext._path(requested)
        for item in (project, *project.parents):
            if item.is_symlink() or getattr(item.stat(), "st_file_attributes", 0) & 0x400:
                raise ValueError("Lien ou point de reanalyse projet refuse.")
        if not S_ISDIR(project.stat().st_mode) or project.suffix.lower() != ".prj":
            raise StaleProjectPath("Un dossier projet .prj accessible est requis.")
        return project.resolve(strict=True)

    def _load(self, requested, issues: list[ProjectDiagnostic], *, remember=True) -> ProjectState:
        self._project_installation = {
            "status": "unknown", "reason": "no_installations",
        }
        project = self._validate_project_path(requested)
        self._document = None
        state = self._empty("error", list(issues))
        state["project"] = {"path": str(project), "name": project.name}
        try:
            identity_stat = project.stat()
            loaded_identity = (identity_stat.st_dev, identity_stat.st_ino)
            loaded_config = (project / "project.cfg").read_bytes()
        except OSError:
            state["diagnostics"].append(self._issue("project_identity_unavailable",
                                                    "Identite projet inaccessible au chargement."))
            return state
        try:
            discovered, discovery_issues = self._discover_installations()
        except (OSError, ValueError, KeyError, TypeError, UnicodeError,
                subprocess.SubprocessError) as exc:
            state["diagnostics"].append(self._issue("installation_discovery_error", str(exc)))
            return state
        for message in discovery_issues:
            state["diagnostics"].append(self._issue(
                "installation_discovery_diagnostic", message, "warning",
            ))
        config = read_project_config(project, encoding_hint="cp1252", require_attributes=True)
        state["diagnostics"].extend(_diagnostics(config.diagnostics))
        if config.state == Availability.UNAVAILABLE:
            state["selection"] = "error"
            state["definitions"] = {"status": "unavailable", "reason": "project_config_invalid"}
            state["diagnostics"].append(self._issue(
                "project_config_invalid", "project.cfg/ATTR invalide ; aucune source de repli.",
            ))
            return state
        mode = config.data["ATTR"]
        options = self._installation_options(discovered, state["diagnostics"])
        associated = [item for item in options
                      if self._associated(project, item, state["diagnostics"])]
        association_errors = any(
            issue["code"] == "installation_association_unavailable"
            for issue in state["diagnostics"]
        )
        if association_errors:
            self._project_installation = {
                "status": "unknown", "reason": "association_unavailable",
            }
        elif len(associated) == 1:
            item = associated[0]
            self._project_installation = {
                "status": "associated",
                "version": item.allplan_version,
                "verificationVersion": item.verification_version,
                "prjPath": str(item.paths["PRJ"].resolve(strict=False)),
            }
        elif len(associated) > 1:
            self._project_installation = {
                "status": "unknown", "reason": "ambiguous",
            }
        elif options:
            self._project_installation = {"status": "unassociated"}
        else:
            self._project_installation = {
                "status": "unknown", "reason": "no_installations",
            }
        if associated:
            active = self._launch_context
            associated.sort(key=lambda item: (
                item.allplan_version != active.allplan_version
                or item.verification_version != active.verification_version,
            ))
        state["installationCandidates"] = [self._installation(item) for item in options]
        for context in associated or options:
            selection = SourceSelection(
                "attributes", "project" if mode == "PRJ" else "std",
                project if mode == "PRJ" else context.paths["STD"],
            )
            files = discover_attributes(
                context, selection, self._definition_language, project_only=True,
            )
            definitions = read_project_definitions(files)
            if associated or definitions.state != Availability.UNAVAILABLE:
                break
            state["diagnostics"].append(self._issue(
                "installation_resources_unavailable",
                f"Installation Allplan {context.allplan_version} ignoree : "
                "definitions systeme absentes, illisibles ou incompatibles.", "warning",
            ))
        else:
            state["diagnostics"].append(self._issue(
                "installation_unavailable",
                "Aucune installation Allplan avec PRJ, STD, ETC et definitions exploitables.",
            ))
            return state
        context = replace(context, project_path=project)
        state["installation"] = self._installation(context)
        state["selection"] = "accepted"
        state["diagnostics"].append(self._issue(
            "installation_selected_project" if associated else "installation_selected_latest",
            f"Allplan {context.allplan_version} "
            f"({'verification' if context.verification_version else 'standard'}) : "
            + ("installation associee au projet."
               if associated else "installation exploitable la plus recente ; projet conserve sur place."),
            "info",
        ))
        state["definitions"] = {
            "status": definitions.state.value, "attr": mode,
            "language": files.data.language if files.data else None,
            "source": str(selection.directory),
            "systemFiles": [str(path) for path in files.data.system] if files.data else [],
            "customFiles": [str(path) for path in files.data.custom] if files.data else [],
            "priority": "first_valid_etc_then_custom_plain_preferred",
            "groupMask": 65536,
        }
        state["diagnostics"].extend(_diagnostics(definitions.diagnostics))
        if definitions.state == Availability.UNAVAILABLE:
            state["selection"] = "error"
            state["diagnostics"].append(self._issue(
                "definitions_unavailable", "Definitions projet absentes ou invalides ; aucun catalogue invente.",
            ))
        result = read_project_attributes(project)
        try:
            identity_stat = project.stat()
            if ((identity_stat.st_dev, identity_stat.st_ino) != loaded_identity
                    or (project / "project.cfg").read_bytes() != loaded_config):
                raise ValueError("Identite projet modifiee pendant le chargement.")
        except (OSError, ValueError):
            state["selection"] = "error"
            state["diagnostics"].append(self._issue("project_changed",
                                                    "Identite projet modifiee pendant le chargement."))
            return state
        self._document = replace(result.data, project_identity=loaded_identity,
                                 project_config=loaded_config)
        state["diagnostics"].extend(_diagnostics(result.diagnostics))
        state["prjatt"] = ProjectFileState(
            status=result.data.status, path=str(project / "prjatt.dat"),
            encodingHint="cp1252", header=result.data.header,
        )
        values = result.data.values()
        if definitions.state != Availability.UNAVAILABLE:
            state["data"]["attributes"] = [
                ProjectAttribute(
                    number=number, label=definition.label,
                    definition=self._json_metadata({**asdict(definition), "number": number}),
                    valueState=("unavailable" if values is None else
                                "set" if number in values else "unset"),
                    value=values.get(number) if values is not None else None,
                )
                for number, definition in definitions.data.items()
            ]
        if result.data.status == "error":
            state["selection"] = "error"
        elif state["selection"] == "accepted" and remember:
            self._remember_project(state)
        return state

    def _remember_project(self, state):
        project = LaunchContext._path(state["project"]["path"])
        try:
            recent = [project, *(path for path in self._recent_paths()
                                if self._path_key(path) != self._path_key(project))]
            self._settings_store.save(self.app_id, {
                "version": 1, "aimProject": {
                    "lastProject": str(project),
                    "recentProjects": [str(path) for path in recent],
                },
            })
        except (OSError, ValueError, SettingsStoreError) as exc:
            state["diagnostics"].append(self._issue("history_error", str(exc)))

    @staticmethod
    def _installation(context):
        return {
            "version": context.allplan_version,
            "verificationVersion": context.verification_version,
            "allplanLanguage": context.allplan_language,
            "paths": {name: str(context.paths[name]) for name in ("PRJ", "STD", "ETC")
                      if name in context.paths},
        }

    @classmethod
    def _json_metadata(cls, value):
        from pathlib import Path
        if isinstance(value, (Decimal, Path)):
            return str(value)
        if isinstance(value, dict):
            return {key: cls._json_metadata(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [cls._json_metadata(item) for item in value]
        return value
