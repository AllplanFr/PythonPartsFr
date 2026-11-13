"""Presentation-only extension of AIM 2; normal remote launch remains blocked."""
from copy import deepcopy
import logging

from application.core.configuration import SettingsStoreError
from .icon_selection import COMMAND as ICON_SELECT_COMMAND, select_icon
from .project import AimProjectApp
from .presentation_import import (
    COMMANDS, PresentationImport, PresentationSnapshot, display_model, validation_report,
)
from .project_manager import ACTIVE_COMMAND, MANAGER_COMMANDS, MANAGER_MENU_COMMANDS, ProjectManager
from .working import WORK_COMMANDS, WorkingState


PRESENTATION_COMMANDS = (*COMMANDS, "presentation.update")


class EditablePresentationImport(PresentationImport):
    """Adds an atomic in-memory update, reusing the import state and validation."""
    def call(self, command, payload):
        if command != "presentation.update":
            return super().call(command, payload)
        if type(payload) is not dict or set(payload) != {"configuration"}:
            return self._error("invalid_payload", "presentation.update attend {configuration}.")
        try:
            configuration = deepcopy(payload["configuration"])
            validation_report(configuration)
            if configuration["version"] == 2 and not self.mixed:
                return self._error("unsupported_presentation_version",
                                   "Cette interface ne prend pas en charge les enfants ordonnes.")
            candidate = {
                "configuration": configuration, "report": None,
                "model": display_model(configuration, None, self._snapshot()),
            }
            response = {"ok": True, "status": "updated", "presentation": deepcopy(candidate)}
        except (ValueError, KeyError, TypeError, RecursionError):
            return self._error("invalid_presentation", "Structure de presentation invalide.")
        except (OSError, RuntimeError):
            return self._error("model_unavailable", "Modele indisponible ; presentation precedente conservee.")
        self._current = candidate
        self._pending = None
        return response


class AimPresentationApp(AimProjectApp):
    def __init__(self, *args, choose_presentation=None, choose_export=None,
                 presentation_update=False, presentation_tree=False,
                 project_manager_menu=False, project_manager_preview_color=False,
                 project_manager_assignment=False, working_state=False,
                 presentation_export=False, project_save=False,
                 presentation_save=False, **kwargs):
        super().__init__(*args, **kwargs)
        # Existing installed consumers require exactly five capabilities.
        self._presentation_commands = PRESENTATION_COMMANDS if presentation_update else COMMANDS
        self._presentation = EditablePresentationImport(
            self._presentation_snapshot,
            choose_presentation or self._choose_presentation,
            choose_export or self._choose_export,
            mixed=presentation_tree,
        )
        self._manager = ProjectManager(self)
        self._set_project_manager_menu(project_manager_menu)
        self._set_project_manager_preview_color(project_manager_preview_color)
        self._set_project_manager_assignment(project_manager_assignment)
        self._set_presentation_export(presentation_export)
        self._work = WorkingState(self)
        from .project_save import ProjectValueSave
        self._project_save = ProjectValueSave(self)
        self._set_working_state(working_state)
        if type(project_save) is not bool or project_save and not working_state:
            raise ValueError("Project save requires explicit working-state profile.")
        self._save_transport = None
        if project_save:
            from .save_transport import SaveTransport
            self._save_transport = SaveTransport(self)
        if type(presentation_save) is not bool or presentation_save and not project_save:
            raise ValueError("Presentation save requires explicit WorkV2 project save profile.")
        self._presentation_save = presentation_save
        self._presentation_saving = False
        self._close_dispatching = False
        self._presentation_restore_attempted = False
        self._presentation_restore_error = None

    def get_initial_data(self):
        initial = super().get_initial_data()
        with self._lock:
            if self._presentation_save and self._state is not None and self._session_open:
                from .presentation_save import PresentationSave
                PresentationSave(self).restore()
            return self._snapshot() if self._state is not None else initial

    def get_app_info(self):
        info = {
            **super().get_app_info(),
            "presentation_contract": 1,
            "presentation_capabilities": list(self._presentation_commands),
            "project_manager_contract": 1,
            "presentation_tree_contract": 1 if self._presentation.mixed else 0,
            "icon_select_contract": 1,
        }
        if self._project_manager_menu:
            info["project_manager_menu_contract"] = 1
        if self._project_manager_preview_color:
            info["project_manager_preview_color_contract"] = 1
        if self._project_manager_assignment:
            info["project_manager_assignment_contract"] = 1
        if self._presentation_export:
            info["presentation_export_contract"] = 1
        if self._working_state:
            info["working_state_contract"] = 1
            info["read_only"] = False
        if self._save_transport is not None:
            info["working_state_contract"] = 2
            info["project_save_contract"] = 1
            info["project_save_capabilities"] = [
                "project.values.save", "project.values.save.status",
            ]
        if self._presentation_save:
            info["presentation_save_contract"] = 1
            info["presentation_save_capabilities"] = ["presentation.save"]
            info["work_close_contract"] = 1
            info["project_manager_active_contract"] = 1
        return info

    def _remember_project(self, state):
        super()._remember_project(state)
        if self._presentation_save:
            try:
                self._manager.remember(state)
            except (OSError, ValueError, SettingsStoreError) as exc:
                state["diagnostics"].append(self._issue("manager_history_error", str(exc)))

    def _set_working_state(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Working state capability must be boolean.")
        with self._lock:
            if not enabled and getattr(self, "_save_transport", None) is not None:
                raise ValueError("Project save profile requires working state.")
            self._working_state = enabled

    def _can_close_work(self):
        with self._lock:
            return not self._working_state or self._work.close_permitted or (
                not any(self._work.dirty().values()) and self._presentation._pending is None
            )

    def _confirm_close_work(self):
        if self._presentation_save:
            # Native closing is on the UI thread: never wait for the bridge or a file dialog.
            if self._presentation_saving or not self._lock.acquire(blocking=False):
                return False
            try:
                if self._work.close_permitted:
                    return True
                if self._save_transport.busy() or self._close_dispatching:
                    return False
                self._close_dispatching = True
            finally:
                self._lock.release()
            from threading import Thread

            def request():
                try:
                    self._window.evaluate_js(
                        "window.dispatchEvent(new Event('aim-close-requested'))"
                    )
                except Exception:
                    logging.getLogger(__name__).exception("AIM close request delivery failed; window kept open")
                finally:
                    self._close_dispatching = False

            Thread(target=request, name="aim-close-request", daemon=True).start()
            return False
        with self._lock:
            if self._save_transport is not None and self._save_transport.busy():
                logging.getLogger(__name__).warning("AIM close refused: save_busy")
                return False
            session = self._invalidate_session()
        accepted = False
        try:
            accepted = self._confirm_close_work_current()
            return accepted
        finally:
            if not accepted:
                self._rearm_session(session)

    def _confirm_close_work_current(self):
        from application.core.windows_ui import confirm_discard_work
        with self._lock:
            if self._can_close_work():
                return True
            revision = self._work.revision
            pending = self._presentation._pending
            dirty = self._work.dirty()
        try:
            accepted = confirm_discard_work(
                self._window, values=dirty["values"], presentation=dirty["presentation"],
                pending=pending is not None,
            )
        except Exception:
            # pywebview swallows event exceptions and otherwise permits closure.
            logging.getLogger(__name__).exception("AIM dialogue de brouillon en echec ; fermeture refusee.")
            return False
        with self._lock:
            if not accepted or revision != self._work.revision or pending != self._presentation._pending:
                return False
            self._work.close_permitted = True
            return True

    def _set_project_manager_preview_color(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Project manager preview color capability must be boolean.")
        with self._lock:
            self._project_manager_preview_color = enabled

    def _set_project_manager_assignment(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Project manager assignment capability must be boolean.")
        with self._lock:
            self._project_manager_assignment = enabled

    def _set_presentation_export(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Presentation export capability must be boolean.")
        with self._lock:
            self._presentation_export = enabled

    def _export_refusal(self, payload):
        """Working-state export writes one new JSON file; Python's configuration is the source."""
        if not self._presentation_export:
            return self._work.error("file_write_forbidden", "Export de fichier indisponible dans ce lot.")
        if type(payload) is not dict or set(payload) != {"configuration"}:
            return None
        current = self._presentation._current
        if current is None:
            return self._work.error("presentation_required", "Aucune presentation active a exporter.")
        if payload["configuration"] != current["configuration"]:
            return self._work.error(
                "stale_presentation",
                "La presentation affichee differe de celle du service ; appliquez presentation.update avant l'export.",
            )
        return None

    def _set_project_manager_menu(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Project manager menu capability must be boolean.")
        with self._lock:
            self._project_manager_menu = enabled

    def _set_presentation_update(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Presentation update capability must be boolean.")
        with self._lock:
            self._presentation_commands = PRESENTATION_COMMANDS if enabled else COMMANDS

    def _set_presentation_tree(self, enabled):
        if type(enabled) is not bool:
            raise ValueError("Presentation tree capability must be boolean.")
        with self._lock:
            self._presentation.mixed = enabled

    def _presentation_snapshot(self) -> PresentationSnapshot:
        state = self._snapshot() if self._state is not None else self._empty("required", [])
        return {
            **state,
            "_workingEditable": self._working_state,
            "_presentationValues": self._work.effective_values() if self._working_state else (
                self._document.values() if self._document else None
            ),
        }

    def _selectable_paths(self):
        return [*super()._selectable_paths(), *self._manager.paths()]

    def _file_dialog(self, *, save=False):
        if self._window is None:
            raise RuntimeError("Aucune fenetre native attachee.")
        import webview
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE if save else webview.FileDialog.OPEN,
            allow_multiple=False,
            save_filename="presentation-aim.json" if save else "",
            file_types=(
                ("Presentation AIM (*.json)",) if save else (
                    "Pr\u00e9sentations AIM (*.json;*.db)",
                )
            ),
        )
        if not selected:
            return None
        if isinstance(selected, (tuple, list)):
            if len(selected) != 1:
                raise ValueError("Un seul fichier attendu.")
            return selected[0]
        if not isinstance(selected, str):
            raise ValueError("Selection native invalide.")
        return selected

    def _choose_presentation(self):
        return self._file_dialog()

    def _choose_export(self):
        return self._file_dialog(save=True)

    def _choose_presentation_save(self):
        if self._window is None:
            raise RuntimeError("Aucune fenetre native attachee.")
        import webview
        from application.core.windows_ui import create_file_dialog
        selected = create_file_dialog(
            self._window, webview.FileDialog.SAVE,
            title="Enregistrer la presentation", save_filename="presentation-aim.json",
            file_types=("Presentation AIM (*.json)",),
        )
        if not selected:
            return None
        if isinstance(selected, (tuple, list)):
            if len(selected) != 1:
                raise ValueError("Une seule destination attendue.")
            return selected[0]
        if not isinstance(selected, str):
            raise ValueError("Destination native invalide.")
        return selected

    def call(self, command, payload):
        if self._presentation_saving:
            return self._work.error("save_busy", "Enregistrement de presentation en cours.")
        if command == "presentation.save":
            if not self._presentation_save:
                return self._work.error("unsupported_command", "Enregistrement de presentation non negocie.")
            from .presentation_save import PresentationSave
            return PresentationSave(self).call(payload)
        if command == ACTIVE_COMMAND and self._presentation_save:
            with self._lock:
                return self._manager.call(command, payload)
        if self._save_transport is not None:
            from .save_transport import COMMANDS
            if type(command) is str and command in COMMANDS:
                return self._save_transport.call(command, payload)
            with self._lock:
                if self._save_transport.busy() and command not in (
                    "work.get", "presentation.get", "project.source", "project.recent",
                    "project.manager.list", "project.manager.preview",
                    "project.manager.favorites.list",
                ):
                    return self._work.error("save_busy", "Enregistrement en cours ; mutation refusee.")
        if command == "project.select":
            if self._working_state:
                return self._work.select(payload)
            return super().call(command, payload)
        if command == "project.manager.open":
            if self._working_state:
                return self._work.select_transition(payload, manager=True)
            return self._manager.open(payload)
        if (self._working_state and command == "work.transition"
                and type(payload) is dict and payload.get("command") in (
                    "project.select", "project.manager.open",
                )):
            return self._work.select_transition(
                payload.get("payload"), transition=payload,
                manager=payload["command"] == "project.manager.open",
            )
        with self._lock:
            if self._presentation_restore_error is not None and command in ("work.get", "presentation.get"):
                return deepcopy(self._presentation_restore_error)
            if self._save_transport is not None and self._save_transport.busy() and command not in (
                "work.get", "presentation.get", "project.source", "project.recent",
                "project.manager.list", "project.manager.preview",
                "project.manager.favorites.list",
            ):
                return self._work.error("save_busy", "Enregistrement en cours ; mutation refusee.")
            if self._working_state:
                if type(command) is str and command in WORK_COMMANDS:
                    return self._work.call(command, payload)
                if command == "presentation.export":
                    refused = self._export_refusal(payload)
                    if refused is not None:
                        return refused
                if command == "presentation.import.apply" and not self._work.authorized and (
                    self._work.dirty()["presentation"]
                ):
                    return self._work.error("work_confirmation_required", "Confirmez le remplacement de presentation.")
            if type(command) is str and command in MANAGER_COMMANDS:
                return self._manager.call(command, payload)
            if (self._project_manager_menu and type(command) is str
                    and command in MANAGER_MENU_COMMANDS):
                return self._manager.call(command, payload)
            if command == ICON_SELECT_COMMAND:
                return select_icon(self, payload)
            if type(command) is str and command in self._presentation_commands:
                pending = self._presentation._pending
                previous = (
                    deepcopy(self._presentation._current),
                    self._presentation._working_file, self._presentation._working_bytes,
                    self._presentation._pending_file,
                ) if self._presentation_save and command == "presentation.import.apply" else None
                reply = self._presentation.call(command, payload)
                mutated = reply["ok"] and reply.get("status") in ("updated", "applied")
                if self._presentation_save and mutated and reply["status"] == "applied":
                    from .presentation_save import PresentationSave
                    try:
                        PresentationSave(self).remember(self._presentation._working_file)
                    except (OSError, ValueError, SettingsStoreError):
                        logging.getLogger(__name__).exception("AIM presentation association failed")
                        (self._presentation._current, self._presentation._working_file,
                         self._presentation._working_bytes, self._presentation._pending_file) = previous
                        self._presentation._pending = pending
                        return self._work.error(
                            "presentation_preferences_unavailable",
                            "Presentation precedente conservee ; association durable non confirmee.",
                        )
                    self._presentation_restore_error = None
                    self._presentation_restore_attempted = True
                    if self._state is not None:
                        self._state["diagnostics"] = [
                            issue for issue in self._state["diagnostics"]
                            if issue["code"] not in (
                                "presentation_file_missing", "presentation_preferences_unavailable",
                                "presentation_file_unavailable", "presentation_file_invalid",
                            )
                        ]
                if self._working_state and (mutated or pending != self._presentation._pending):
                    if mutated and reply["status"] == "applied":
                        self._work.baseline = deepcopy(self._presentation._current)
                    self._work.changed()
                return reply
            return super().call(command, payload)
