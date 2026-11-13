import hashlib
import os
import re
import stat
import subprocess
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict
from uuid import uuid4

from application.core.bridge import BridgeApp, UnsupportedVersionError
from application.core.allplan.paths import is_supported_version
from .messages import MessageError, tr
from application.plugins.vob_editor.format import VobLayout, read_vob_data, serialize_vob, write_vob
from application.core.catalog import PLUGINS
from .references import VobReferences, load_references


class _VobFileRequired(TypedDict):
    id: str
    name: str
    path: str


class VobFile(_VobFileRequired, total=False):
    version: str
    source: str
    projectName: str
    projectPath: str


class VobRule(TypedDict):
    trade: str
    object: str
    unit: str
    method: str
    formula: str
    comment: str


class VobRuleWithEnabled(VobRule, total=False):
    enabled: bool
    id: str


class VobDocument(TypedDict):
    file: VobFile | None
    header: list[str]
    rules: list[VobRuleWithEnabled]


class EtcWriteProtectedError(PermissionError):
    """An ETC operation requiring explicit confirmation, not a Windows refusal."""


@dataclass(frozen=True)
class PendingEtcWrite:
    confirmation_id: str
    operation: str
    target: Path
    fingerprint: str | None
    document: dict


class VobEditorApp(BridgeApp):
    app_id = "vob_editor"
    title = PLUGINS[app_id].name
    canonical_url = PLUGINS[app_id].url
    script_name = PLUGINS[app_id].script

    _RULE_FIELDS = ("trade", "object", "unit", "method", "formula", "comment")
    _HEADER_DEFAULT = (
        "COMPANY=NEMETSCHEK",
        "PRODUCT=ALLPLAN",
        "MODULE=Lists, quantity takeoff",
        "TITLE=VOB-compliant quantity takeoff",
        "COUNTRY=FRA",
        "LANGUAGE=independent",
        "description:",
        "1st entry  -> trade identifier",
        "2nd entry  -> component (-1 == default)",
        "3rd entry  -> billing type (0 = m3 / 1 = m2 / 2 = m / -1 = default)",
        "4th entry  -> calculation method (-1=default, 1=Volume, 2=Base, 3=Floor, 4=Ceiling, 5=Sides, 6=Median surface)",
        "5th entry  -> billing criterion",
        "================================================================",
    )
    _FILE_FIELDS = ("id", "name", "path")
    _FILE_OPTIONAL_FIELDS = ("version", "source", "projectName", "projectPath")
    _EVENTS = frozenset({
        "vob.files", "vob.document", "vob.backups", "vob.context",
        "vob.recent_files", "error",
    })
    _RESOURCE_FILE_FIELDS = (
        "id", "name", "path", "source", "version", "projectName", "projectPath",
    )
    _BACKUP_SUFFIX = re.compile(r"^(?P<stamp>\d{8}T\d{6}\.\d{6}Z)(?:-(?P<seq>\d+))?$")
    _OBJECT_DIAGNOSTIC_MAX_DEPTH = 8
    _OBJECT_DIAGNOSTIC_MAX_ENTRIES = 20000
    _OBJECT_DIAGNOSTIC_TIMEOUT = 5.0
    _SETTINGS_SECTIONS = (
        "general", "toolbars", "dialogs", "formulaFavorites", "vobEditor",
        "vobResources", "app", "toolbar", "lang",
    )

    def __init__(
        self, data_dir, roots=None, settings_store=None,
        allplan_version=None, initial_path=None, allplan_datas=None,
        allplan_versions=None,
    ):
        self._allplan_datas = allplan_datas
        self._allplan_versions = dict(allplan_versions or {})
        if allplan_datas is not None:
            allplan_version = allplan_datas.get_context()["version"]
            roots = allplan_datas.get_vob_roots()
            self._allplan_versions.setdefault(str(allplan_version), allplan_datas)
        super().__init__(data_dir, settings_store, allplan_version)
        self._roots = self._configure_roots(roots)
        self._authorized_files = set()
        self._layouts: dict[str, VobLayout] = {}
        self._initial_path = initial_path
        self._session_restored = False
        self._current_document: VobDocument | None = None
        self._references: dict[str, VobReferences] = {}
        self._personal_files: dict[str, dict] = {}
        self._object_diagnostic_logged = False
        self._pending_etc_write: PendingEtcWrite | None = None
        self._handlers.update({
            "vob.files.add": self._handle_files_add,
            "vob.files.list": self._handle_files_list,
            "vob.preview": self._handle_preview,
            "vob.header.default": self._handle_header_default,
            "vob.projects.add": self._handle_projects_add,
            "vob.file.reveal": self._handle_file_reveal,
            "vob.file.open_external": self._handle_file_open_external,
            "vob.open": self._handle_open,
            "vob.save": self._handle_save,
            "vob.save_as": self._handle_save_as,
            "vob.saveAs": self._handle_save_as,
            "vob.write.confirm": self._handle_write_confirm,
            "vob.backups.list": self._handle_backups_list,
            "vob.backups.create": self._handle_backups_create,
            "vob.backups.restore": self._handle_backups_restore,
            "reference.load": self._handle_reference_load,
        })

    @staticmethod
    def _configure_roots(roots):
        configured = {}
        if roots is None:
            roots = {
                "std": os.environ.get("ALLPLAN_STD_DIR"),
                "prj": os.environ.get("ALLPLAN_PRJ_DIR"),
                "test": os.environ.get("ALLPLAN_VOB_TEST_DIR"),
            }

        for name, value in roots.items():
            if value:
                root = Path(value).expanduser().resolve()
                if not root.is_dir():
                    raise ValueError(f"Le dossier VOB configure n'existe pas : {root}")
                configured[name] = root
        return configured

    def _on_loaded(self, window):
        from application.core.windows_ui import configure_clipboard
        configure_clipboard(window, self.canonical_url, self._logger)

    def _tr(self, code, **params):
        return tr(code, self._language, **params)

    def _error_message_key(self, command, default):
        return "backup-error" if str(command).startswith("vob.backups.") else default

    def _io_error_code(self, command, exc):
        if command in ("vob.save", "vob.save_as", "vob.saveAs", "vob.write.confirm") and isinstance(exc, OSError):
            return "write_error"
        return super()._io_error_code(command, exc)

    def _io_error_message_key(self, command, exc):
        if isinstance(exc, EtcWriteProtectedError):
            return "etc-write-protected"
        return super()._io_error_message_key(command, exc)

    def _io_error_response(self, command, exc):
        if isinstance(exc, EtcWriteProtectedError) and self._pending_etc_write is not None:
            pending = self._pending_etc_write
            return {"ok": False, "error": {
                "code": "write_confirmation_required",
                "message": self._tr("etc-write-confirmation"),
                "confirmation": {
                    "confirmationId": pending.confirmation_id,
                    "operation": pending.operation, "path": str(pending.target),
                },
            }}
        if (isinstance(exc, PermissionError) and not isinstance(exc, EtcWriteProtectedError)
                and command in ("vob.save", "vob.save_as", "vob.saveAs", "vob.write.confirm")):
            return {"ok": False, "error": {
                "code": self._io_error_code(command, exc),
                "message": self._tr("write-permission-denied", detail=str(exc)),
            }}
        return super()._io_error_response(command, exc)

    def get_initial_data(self):
        self._trace("get_initial_data")
        self._require_supported_version()
        with self._lock:
            preferences = self._initial_preferences()
            if not self._session_restored:
                self._restore_session()
                self._session_restored = True
            if self._initial_path is not None and self._current_document is None:
                path = self._resolve_authorized_path(self._initial_path)
                self._current_document = self._read_document(path)
                self._remember_file(path, opened=True)
                self._initial_path = None
            result = {
                "files": self._list_files(),
                "document": deepcopy(self._current_document),
                "recentFiles": self._recent_files(),
                "settings": preferences,
                **self._capability_data(),
                "context": self._resource_context(),
                "backups": self._backup_inventory(
                    self._current_document["file"]
                    if self._current_document is not None else None
                ),
            }
            if self._allplan_datas is not None:
                result.update(
                    allplan=self._allplan_datas.get_context(),
                    warnings=list(self._listing_warnings),
                    truncated=self._listing_truncated,
                )
            return result

    # Temporary startup diagnostic; remove after the host paths have been confirmed.
    def _log_temporary_object_reference_diagnostic(self):
        if self._object_diagnostic_logged:
            return
        self._object_diagnostic_logged = True
        try:
            from application.core.logging_setup import session_log_path
            log_path = session_log_path()
        except (ImportError, OSError):
            log_path = None
        self._logger.info(
            "VOB object-reference diagnostic: phase=entry app_id=%s app_type=%s "
            "pid=%d log_path=%r",
            self.app_id, type(self).__name__, os.getpid(),
            str(log_path) if log_path is not None else None,
        )
        status = "unknown"
        root_count = found_count = denied_count = error_count = entries = 0
        try:
            if self._allplan_datas is None:
                status = "allplan_context_unavailable"
                self._logger.warning(
                    "VOB object-reference diagnostic: allplan context was not provided"
                )
                return

            context = self._allplan_datas.get_context()
            paths = context.get("paths", {}) if isinstance(context, dict) else {}
            if not isinstance(paths, dict):
                raise ValueError("allplan.paths is not an object")
            self._logger.info(
                "VOB object-reference diagnostic: allplan.version=%r allplan.paths=%r",
                context.get("version"), paths,
            )
            candidates = {key: paths.get(key) for key in ("ETC", "STD", "PRJ")}
            try:
                vob_roots = self._allplan_datas.get_vob_roots()
            except (OSError, RuntimeError, ValueError) as exc:
                self._logger.warning(
                    "VOB object-reference diagnostic: project-root resolution failed: %s",
                    type(exc).__name__,
                )
                vob_roots = {}
            for label, path in vob_roots.items():
                if label.startswith("project"):
                    candidates[label] = str(path)

            unique_roots = {}
            for label, raw in candidates.items():
                if not isinstance(raw, (str, os.PathLike)) or not os.fspath(raw).strip():
                    self._logger.info(
                        "VOB object-reference diagnostic: root=%s status=not_provided",
                        label,
                    )
                    continue
                root = Path(raw)
                try:
                    root_info = root.stat()
                except PermissionError:
                    root_status = "access_denied"
                except FileNotFoundError:
                    root_status = "missing"
                except OSError as exc:
                    root_status = f"unavailable:{type(exc).__name__}"
                else:
                    root_status = (
                        None if stat.S_ISDIR(root_info.st_mode) else "not_a_directory"
                    )
                if root_status is not None:
                    self._logger.info(
                        "VOB object-reference diagnostic: root=%s path=%r status=%s",
                        label, str(root), root_status,
                    )
                    continue
                resolved = root.resolve()
                unique_roots.setdefault(
                    os.path.normcase(str(resolved)), (label, resolved),
                )

            root_count = len(unique_roots)
            deadline = time.monotonic() + self._OBJECT_DIAGNOSTIC_TIMEOUT
            remaining_entries = self._OBJECT_DIAGNOSTIC_MAX_ENTRIES
            root_statuses = []
            for label, root in unique_roots.values():
                found, denied, errors, scanned, limited = self._find_object_reference_files(
                    root, deadline=deadline, max_entries=remaining_entries,
                )
                remaining_entries -= scanned
                entries += scanned
                denied_count += denied
                error_count += errors
                found_count += len(found)
                root_statuses.append(
                    "found" if found else "access_denied" if denied else
                    "scan_error" if errors else "incomplete" if limited else "file_absent"
                )
                for path in found:
                    self._log_object_reference_header(label, path)
                if not found:
                    self._logger.info(
                        "VOB object-reference diagnostic: root=%s path=%r status=%s "
                        "denied_subdirectories=%d scan_errors=%d entries=%d",
                        label, str(root), root_statuses[-1], denied, errors, scanned,
                    )
                elif denied or errors or limited:
                    self._logger.info(
                        "VOB object-reference diagnostic: root=%s path=%r "
                        "search_incomplete denied_subdirectories=%d scan_errors=%d "
                        "entries=%d limit_reached=%s",
                        label, str(root), denied, errors, scanned, limited,
                    )
            status = (
                "found" if found_count else
                "no_searchable_roots" if not root_count else
                "access_denied" if denied_count else
                "scan_error" if error_count else
                "incomplete" if "incomplete" in root_statuses else "file_absent"
            )
        except Exception as exc:
            status = f"error:{type(exc).__name__}"
            self._logger.exception(
                "VOB object-reference diagnostic failed: %s", type(exc).__name__,
            )
        finally:
            self._logger.info(
                "VOB object-reference diagnostic: phase=final status=%s "
                "roots=%d found=%d denied=%d scan_errors=%d entries=%d log_path=%r",
                status, root_count, found_count, denied_count, error_count,
                entries, str(log_path) if log_path is not None else None,
            )

    @classmethod
    def _find_object_reference_files(cls, root, *, deadline, max_entries):
        pending = [(root, 0)]
        found = []
        denied = 0
        errors = 0
        entries = 0
        limited = False
        while pending:
            if entries >= max_entries or time.monotonic() >= deadline:
                limited = True
                break
            directory, depth = pending.pop()
            try:
                with os.scandir(directory) as children:
                    for child in children:
                        entries += 1
                        try:
                            if child.name.casefold() == "objekt.000":
                                if child.is_file(follow_symlinks=False):
                                    found.append(Path(child.path))
                                continue
                            is_directory = child.is_dir(follow_symlinks=False)
                            if depth < cls._OBJECT_DIAGNOSTIC_MAX_DEPTH:
                                attributes = getattr(
                                    child.stat(follow_symlinks=False),
                                    "st_file_attributes", 0,
                                )
                                is_reparse_point = bool(attributes & 0x400)
                                if is_directory and not is_reparse_point:
                                    pending.append((Path(child.path), depth + 1))
                            elif is_directory:
                                limited = True
                        except PermissionError:
                            denied += 1
                            continue
                        except OSError:
                            errors += 1
                            continue
                        if entries >= max_entries or time.monotonic() >= deadline:
                            limited = True
                            break
            except PermissionError:
                denied += 1
            except OSError:
                errors += 1
            if limited:
                break
        return found, denied, errors, entries, limited

    def _log_object_reference_header(self, root_label, path):
        try:
            with path.open("rb") as source:
                sample = source.read(4096)
            size = path.stat().st_size
        except PermissionError:
            self._logger.info(
                "VOB object-reference diagnostic: root=%s file=%r status=access_denied",
                root_label, str(path),
            )
            return
        except OSError as exc:
            self._logger.info(
                "VOB object-reference diagnostic: root=%s file=%r status=read_error:%s",
                root_label, str(path), type(exc).__name__,
            )
            return

        encoding = "utf-8"
        for marker, candidate in (
            (b"\xff\xfe\x00\x00", "utf-32"),
            (b"\x00\x00\xfe\xff", "utf-32"),
            (b"\xff\xfe", "utf-16"),
            (b"\xfe\xff", "utf-16"),
            (b"\xef\xbb\xbf", "utf-8-sig"),
        ):
            if sample.startswith(marker):
                encoding = candidate
                break
        try:
            lines = sample.decode(encoding).splitlines()
        except (UnicodeError, LookupError):
            self._logger.info(
                "VOB object-reference diagnostic: root=%s file=%r size=%d "
                "encoding=%s header_decode=failed",
                root_label, str(path), size, encoding,
            )
            return
        first = lines[0] if lines else ""
        second = lines[1] if len(lines) > 1 else ""
        format_matches = (
            first == "35.0 PFAD STEU OBJNR OBJEKT-NAME"
            and second == "95 -----------------------------------------"
        )
        self._logger.info(
            "VOB object-reference diagnostic: root=%s file=%r size=%d "
            "encoding=%s header1=%r header2=%r observed_format_match=%s",
            root_label, str(path), size, encoding, first, second, format_matches,
        )

    def _handle_settings_save(self, payload):
        super()._handle_settings_save(payload)
        if "vobResources" in payload:
            removed = set(self._personal_files) - {
                os.path.normcase(item["path"])
                for item in payload["vobResources"]["addedFiles"]
            }
            self._authorized_files.difference_update(removed)
            if removed:
                session = self._settings_store.load(self.app_id).get(
                    "vobEditorSession", {}
                )
                if isinstance(session, dict):
                    selected = session.get("selectedFiles", [])
                    if isinstance(selected, list):
                        session["selectedFiles"] = [
                            path for path in selected
                            if os.path.normcase(path) not in removed
                        ]
                    last_file = session.get("lastFile")
                    if isinstance(last_file, str) and os.path.normcase(last_file) in removed:
                        session.pop("lastFile", None)
                    self._settings_store.save(
                        self.app_id,
                        {"version": 1, "vobEditorSession": session},
                    )
            self._personal_files = {
                os.path.normcase(item["path"]): dict(item)
                for item in payload["vobResources"]["addedFiles"]
            }
            self._restore_project_roots(
                payload["vobResources"].get("addedProjects", [])
            )

    def _validate_payload(self, command, payload):
        super()._validate_payload(command, payload)
        if command == "reference.load":
            self._require_fields(payload, {"lang"})
            self._require_text(payload["lang"], "lang")
        elif command == "vob.files.list":
            if (
                not {"version", "source"} <= set(payload)
                or set(payload) - {
                    "version", "source", "allVersions", "projects", "minVersion",
                }
            ):
                raise ValueError(
                    "vob.files.list attend version, source et éventuellement "
                    "allVersions, projects ou minVersion."
                )
            if not isinstance(payload["version"], str):
                raise ValueError("version doit être une chaîne.")
            self._require_text(payload["source"], "source")
            if "minVersion" in payload:
                minimum = payload["minVersion"]
                if (
                    isinstance(minimum, bool)
                    or not isinstance(minimum, (int, str))
                    or not str(minimum).isdigit()
                ):
                    raise ValueError("minVersion doit être une année entière.")
                if int(minimum) < 2022:
                    raise UnsupportedVersionError(
                        "L’inventaire VOB est limité à Allplan 2022 et versions ultérieures."
                    )
            if "allVersions" in payload and not isinstance(payload["allVersions"], bool):
                raise ValueError("allVersions doit être un booléen.")
            if "projects" in payload:
                projects = payload["projects"]
                if not isinstance(projects, list):
                    raise ValueError("projects doit être une liste de projets.")
                for project in projects:
                    if (
                        not isinstance(project, dict)
                        or set(project) != {"name", "path", "version"}
                        or any(
                            not isinstance(project[field], str) or not project[field]
                            for field in ("name", "path", "version")
                        )
                    ):
                        raise ValueError("Une référence de projet de la liste est invalide.")
        elif command == "vob.files.add":
            if set(payload) not in ({"paths"}, {"paths", "multiple"}):
                raise ValueError("vob.files.add attend paths et éventuellement multiple.")
            paths = payload["paths"]
            if paths is not None and (
                not isinstance(paths, list)
                or any(not isinstance(path, str) or not path.strip() for path in paths)
            ):
                raise ValueError("paths doit être null ou une liste de chemins absolus.")
            if "multiple" in payload and not isinstance(payload["multiple"], bool):
                raise ValueError("multiple doit être un booléen.")
        elif command == "vob.preview":
            self._require_fields(payload, {"path"})
            self._require_text(payload["path"], "path")
        elif command == "vob.header.default":
            self._require_fields(payload, {"file"})
            if payload["file"] is not None:
                VobEditorApp._validate_file_info(payload["file"])
        elif command == "vob.projects.add":
            if set(payload) not in ({"path"}, {"path", "multiple"}):
                raise ValueError("vob.projects.add attend path et éventuellement multiple.")
            path = payload["path"]
            if path is not None and (
                not isinstance(path, str) or not path.strip()
            ):
                raise ValueError("path doit être un dossier non vide ou null.")
            if "multiple" in payload and not isinstance(payload["multiple"], bool):
                raise ValueError("multiple doit être un booléen.")
        elif command == "vob.open":
            if set(payload) != {"path"}:
                raise ValueError("vob.open attend uniquement path.")
            if payload["path"] is not None and (
                not isinstance(payload["path"], str) or not payload["path"].strip()
            ):
                raise ValueError("path doit être un chemin non vide ou null.")
        elif command in ("vob.save", "vob.save_as", "vob.saveAs"):
            VobEditorApp._validate_document(payload)
        elif command == "vob.write.confirm":
            self._require_fields(payload, {"confirmationId", "accept"})
            self._require_text(payload["confirmationId"], "confirmationId")
            if type(payload["accept"]) is not bool:
                raise ValueError("accept doit etre un booleen.")
        elif command == "vob.backups.list":
            self._require_fields(payload, {"file"})
            self._validate_file_info(payload["file"])
        elif command == "vob.backups.create":
            if not {"file", "rules"} <= set(payload) or set(payload) - {
                "file", "rules", "header",
            }:
                raise ValueError(
                    "vob.backups.create attend file, rules et éventuellement header."
                )
            self._validate_file_info(payload["file"])
            self._validate_rules(payload["rules"])
            if "header" in payload:
                self._validate_header(payload["header"])
        elif command == "vob.backups.restore":
            self._require_fields(payload, {"file", "backup"})
            self._validate_file_info(payload["file"])
            self._validate_backup_info(payload["backup"])
        elif command == "settings.save":
            allowed = {"version", *self._SETTINGS_SECTIONS}
            if set(payload) - allowed:
                raise ValueError("settings.save contient une section non autorisée.")
            if "vobResources" in payload and payload["vobResources"] is None:
                raise ValueError("vobResources doit être un objet.")
            self._validate_editor_settings(payload.get("vobEditor"))
            self._validate_resources_section(payload.get("vobResources"))
            if (
                self._allplan_datas is not None
                and "vobResources" in payload
                and int(self._allplan_version) >= 2027
            ):
                for project in payload["vobResources"].get("addedProjects", []):
                    self._allplan_datas.resolve_project_path(project["path"])
        elif command in ("vob.file.reveal", "vob.file.open_external"):
            self._require_fields(payload, {"path"})
            self._require_text(payload["path"], "path")

    @classmethod
    def _validate_document(cls, document):
        if set(document) not in ({"file", "rules"}, {"file", "header", "rules"}):
            raise ValueError("Le document doit contenir file, rules et éventuellement header.")
        file_info = document["file"]
        if file_info is not None:
            cls._validate_file_info(file_info)
        if "header" in document:
            cls._validate_header(document["header"])
        cls._validate_rules(document["rules"])

    @staticmethod
    def _validate_header(header):
        if not isinstance(header, list) or any(
            not isinstance(line, str) or "\n" in line or "\r" in line
            for line in header
        ):
            raise MessageError("invalid-header")

    @classmethod
    def _validate_file_info(cls, file_info):
        if (
            not isinstance(file_info, dict)
            or not set(cls._FILE_FIELDS) <= set(file_info)
            or set(file_info) - {*cls._FILE_FIELDS, *cls._FILE_OPTIONAL_FIELDS}
        ):
            raise ValueError("Les informations du fichier VOB sont invalides.")
        if any(
            not isinstance(file_info[field], str) or not file_info[field]
            for field in cls._FILE_FIELDS
        ) or any(
            field in file_info and not isinstance(file_info[field], str)
            for field in cls._FILE_OPTIONAL_FIELDS
        ):
            raise ValueError("Chaque champ de fichier doit être une chaîne valide.")

    @classmethod
    def _validate_rules(cls, rules):
        if not isinstance(rules, list):
            raise ValueError("rules doit être une liste.")
        for index, rule in enumerate(rules):
            if (
                not isinstance(rule, dict)
                or set(rule) - {*cls._RULE_FIELDS, "enabled", "id"}
                or not set(cls._RULE_FIELDS) <= set(rule)
            ):
                raise MessageError("invalid-rule", index=index + 1)
            if any(not isinstance(rule[field], str) for field in cls._RULE_FIELDS):
                raise MessageError("invalid-rule", index=index + 1)
            if "enabled" in rule and not isinstance(rule["enabled"], bool):
                raise MessageError("invalid-rule", index=index + 1)
            if "id" in rule and not isinstance(rule["id"], str):
                raise MessageError("invalid-rule", index=index + 1)

    def _handle_reference_load(self, _payload) -> VobReferences:
        references = (
            self._allplan_datas.load_references()
            if self._allplan_datas is not None else load_references(None)
        )
        for category, metadata in references["metadata"].items():
            self._logger.info(
                "VOB references: category=%s status=%s sources=%r diagnostics=%d",
                category, metadata["status"], metadata["sources"],
                len(metadata["diagnostics"]),
            )
        return references

    @staticmethod
    def _validate_backup_info(backup):
        expected = {"id", "name", "path", "createdAt"}
        if (
            not isinstance(backup, dict)
            or set(backup) != expected
            or any(not isinstance(backup[field], str) or not backup[field] for field in expected)
        ):
            raise ValueError("Les informations de sauvegarde sont invalides.")

    @staticmethod
    def _validate_editor_settings(section):
        if section is None:
            return
        if not isinstance(section, dict):
            raise ValueError("vobEditor doit être un objet.")
        order = section.get("order")
        if isinstance(order, list) and any(not isinstance(key, str) for key in order):
            raise ValueError("vobEditor.order doit contenir des identifiants de colonnes.")

    @classmethod
    def _validate_resources_section(cls, section):
        if section is None:
            return
        if (
            not isinstance(section, dict)
            or "addedFiles" not in section
            or set(section) - {"addedFiles", "favorites", "addedProjects"}
        ):
            raise ValueError("vobResources doit contenir addedFiles et éventuellement favorites.")
        favorites = section.get("favorites", [])
        if not isinstance(favorites, list) or any(
            not isinstance(path, str) or not path for path in favorites
        ):
            raise ValueError("vobResources.favorites doit être une liste de chemins.")
        files = section["addedFiles"]
        if not isinstance(files, list):
            raise ValueError("vobResources.addedFiles doit être une liste.")
        seen = set()
        for item in files:
            if (
                not isinstance(item, dict)
                or not {"id", "name", "path"} <= set(item)
                or set(item) - {*cls._RESOURCE_FILE_FIELDS}
                or any(not isinstance(item[key], str) or not item[key] for key in ("id", "name", "path"))
                or (
                    "source" in item
                    and (not isinstance(item["source"], str) or not item["source"])
                )
                or any(
                    field in item and (not isinstance(item[field], str) or not item[field])
                    for field in ("version", "projectName", "projectPath")
                )
            ):
                raise ValueError("Une référence de fichier personnel est invalide.")
            path = Path(item["path"])
            source = item.get("source", str(path.parent))
            project_path = Path(item["projectPath"]) if "projectPath" in item else None
            if (
                not path.is_absolute() or ".." in path.parts
                or os.path.normcase(item["name"]) != os.path.normcase(path.name)
                or (
                    source not in {"ETC", "STD", "PRJ"}
                    and (
                        not Path(source).is_absolute() or ".." in Path(source).parts
                        or os.path.normcase(str(Path(source)))
                        != os.path.normcase(str(path.parent))
                    )
                )
                or not cls._valid_vob_name(path.name)
                or (
                    "version" in item
                    and not item["version"].isdigit()
                )
                or (("projectName" in item) != (project_path is not None))
                or (
                    project_path is not None
                    and (
                        not project_path.is_absolute() or ".." in project_path.parts
                        or project_path.name != item["projectName"]
                        or source != "PRJ"
                    )
                )
            ):
                raise ValueError("Les fichiers personnels doivent utiliser un chemin VOB absolu valide.")
            key = os.path.normcase(str(path))
            if key in seen:
                raise ValueError("vobResources contient un chemin en double.")
            seen.add(key)
        projects = section.get("addedProjects", [])
        if not isinstance(projects, list):
            raise ValueError("vobResources.addedProjects doit être une liste.")
        seen_projects = set()
        for project in projects:
            if (
                not isinstance(project, dict)
                or set(project) != {"name", "path", "version"}
                or any(
                    not isinstance(project[key], str) or not project[key]
                    for key in ("name", "path", "version")
                )
            ):
                raise ValueError("Une référence de projet ajouté est invalide.")
            path = Path(project["path"])
            if (
                not path.is_absolute() or ".." in path.parts
                or project["name"] != path.name
                or not project["version"].isdigit()
            ):
                raise ValueError("Les projets ajoutés doivent utiliser un chemin absolu valide.")
            key = os.path.normcase(str(path))
            if key in seen_projects:
                raise ValueError("vobResources contient un projet en double.")
            seen_projects.add(key)

    @staticmethod
    def _valid_vob_name(filename):
        lowered = filename.casefold()
        return lowered.startswith(("vob", "vo2")) and "." in lowered

    def _handle_files_add(self, payload):
        requested = payload["paths"]
        if requested is None:
            requested = self._add_files_dialog(
                multiple=payload.get("multiple", False),
            )
            if requested is None:
                return None

        candidates = []
        batch_seen = set()
        valid_paths = set()
        errors = []
        unsupported_version = False
        for requested_path in requested:
            try:
                if not Path(requested_path).is_absolute():
                    raise ValueError("Le chemin ajouté doit être absolu.")
                if not self._valid_vob_name(Path(requested_path).name):
                    raise ValueError(
                        "Seuls les fichiers vob*.* et vo2*.* peuvent être ajoutés."
                    )
                path = self._authorize_dialog_selection(
                    requested_path, register=False,
                )
                key = os.path.normcase(str(path))
                if key in batch_seen:
                    continue
                batch_seen.add(key)
                if not path.is_file():
                    raise FileNotFoundError(str(path))
                raw = self._read_vob_bytes(path, selected=True)
                rules, layout = read_vob_data(raw)
                if b"\0" in raw or (raw.strip() and not rules and not layout.header):
                    raise MessageError("invalid-vob")
                candidates.append(path)
                valid_paths.add(key)
            except UnsupportedVersionError as exc:
                unsupported_version = True
                errors.append(f"{Path(requested_path).name} : {self._exception_message(exc)}")
            except (OSError, ValueError) as exc:
                errors.append(f"{Path(requested_path).name} : {self._exception_message(exc)}")

        existing = dict(self._personal_files)
        for path in candidates:
            key = os.path.normcase(str(path))
            existing[key] = self._describe_file(path)
        updated = sorted(
            existing.values(),
            key=lambda resource: (
                resource["name"].casefold(), resource["path"].casefold()
            ),
        )
        previous_resources = self._settings_store.load(self.app_id).get("vobResources", {})
        resources = {"addedFiles": updated}
        if "favorites" in previous_resources:
            resources["favorites"] = previous_resources["favorites"]
        if "addedProjects" in previous_resources:
            resources["addedProjects"] = [
                item for item in previous_resources["addedProjects"]
                if item.get("version", "0").isdigit()
                and is_supported_version(item["version"])
            ]
        self._settings_store.save(
            self.app_id,
            {"version": 1, "vobResources": resources},
        )
        self._personal_files = {
            os.path.normcase(item["path"]): dict(item) for item in updated
        }
        if errors:
            self._push_event("error", {
                "code": (
                    "unsupported-version"
                    if unsupported_version
                    else "invalid"
                ),
                "message": self._tr("files-skipped", files="; ".join(errors)),
            })
        return {
            "files": [
                dict(item) for item in updated
                if os.path.normcase(item["path"]) in valid_paths
            ]
        }

    def _handle_preview(self, payload):
        path = self._resolve_authorized_path(payload["path"])
        if not path.is_file():
            raise FileNotFoundError(str(path))
        raw = self._read_vob_bytes(path, selected=True)
        rules, layout = read_vob_data(raw, log_ignored=False)
        if b"\0" in raw or (raw.strip() and not rules and not layout.header):
            raise MessageError("invalid-vob")
        return {"file": self._describe_file(path), "header": list(layout.header), "rules": rules}

    def _handle_header_default(self, payload):
        country = None
        file_info = payload["file"]
        if file_info is not None:
            match = re.match(r"^vob_([A-Za-z]{3})(?:[._]|$)", file_info["name"], re.IGNORECASE)
            if match:
                country = match.group(1).upper()
            if country is None:
                for provider in self._allplan_providers(include_unsupported=True):
                    context = provider.get_context()
                    if (
                        file_info.get("version") == str(context.get("version"))
                        and context.get("country")
                    ):
                        country = str(context["country"]).upper()
                        break
        if country is None and self._allplan_datas is not None:
            country = self._allplan_datas.get_context().get("country")
        header = list(self._HEADER_DEFAULT)
        if country:
            header[4] = f"COUNTRY={country}"
        return {"header": header}

    def _handle_projects_add(self, payload):
        if self._allplan_datas is None:
            raise NotImplementedError(
                "L’ajout de projets nécessite une source Allplan configurée."
            )
        if int(self._allplan_version) < 2027:
            raise NotImplementedError(
                "L’ajout de projets VOB est disponible à partir d’Allplan 2027."
            )
        requested = payload["path"]
        if requested is None:
            requested = self._add_projects_dialog(
                multiple=payload.get("multiple", False),
            )
            if requested is None:
                return None
        paths = requested if isinstance(requested, (list, tuple)) else [requested]
        previous = self._settings_store.load(self.app_id).get("vobResources", {})
        projects_by_path = {
            os.path.normcase(item["path"]): dict(item)
            for item in previous.get("addedProjects", [])
        }
        selected_projects = {}
        errors = []
        for requested_path in paths:
            try:
                self._ensure_supported_path(requested_path)
                path = self._allplan_datas.resolve_project_path(requested_path)
                key = os.path.normcase(str(path))
                project = {
                    "name": path.name,
                    "path": str(path),
                    "version": str(self._allplan_version),
                }
                projects_by_path[key] = project
                selected_projects[key] = project
            except UnsupportedVersionError:
                raise
            except (OSError, ValueError) as exc:
                errors.append(f"{Path(requested_path).name} : {self._exception_message(exc)}")

        all_projects = sorted(
            projects_by_path.values(),
            key=lambda item: (item["name"].casefold(), item["path"].casefold()),
        )
        previous_files = previous.get("addedFiles", [])
        resources = {
            "addedFiles": previous_files,
            "addedProjects": all_projects,
        }
        if "favorites" in previous:
            resources["favorites"] = previous["favorites"]
        self._settings_store.save(
            self.app_id, {"version": 1, "vobResources": resources},
        )
        self._allplan_datas.set_projects(
            item["path"] for item in all_projects
        )

        listing = self._allplan_datas.list_vob_files()
        files_by_project = {}
        for item in listing["files"]:
            project_path = item.get("projectPath")
            if project_path is not None:
                files_by_project.setdefault(
                    os.path.normcase(project_path), []
                ).append(self._describe_file(Path(item["path"]).resolve()))
        results = [
            {
                "project": dict(project),
                "files": files_by_project.get(
                    os.path.normcase(project["path"]), []
                ),
            }
            for project in selected_projects.values()
        ]
        if errors:
            self._push_event("error", {
                "code": "invalid",
                "message": self._tr("projects-skipped", files="; ".join(errors)),
            })
        self._push_event("vob.files", self._list_files())
        return {"projects": results}

    def _handle_files_list(self, payload):
        self._sync_projects_for_listing(payload)
        min_version = (
            max(2022, int(payload.get("minVersion", 2022)))
            if self._allplan_datas is not None else 0
        )
        if payload.get("allVersions", False):
            files = [
                item for item in self._list_all_versions(min_version)
                if item.get("version") == "99" or int(item.get("version", 0)) >= min_version
            ]
            versions = []
            for item in files:
                version = item.get("version")
                if version and version not in versions:
                    versions.append(version)
            active = self._resource_context()
            return {
                "files": files,
                "context": {
                    "version": active["version"],
                    "source": active["source"],
                    "versions": versions,
                },
            }
        context = self._resource_context()
        if self._allplan_datas is not None and int(payload["version"]) < min_version:
            raise UnsupportedVersionError(
                f"L’inventaire demandé est limité à Allplan {min_version} et versions ultérieures."
            )
        if payload["version"] != context["version"]:
            raise ValueError("Cette version Allplan n'est pas disponible dans cette session.")
        source = self._resolve_source(payload["source"])
        context["source"] = str(source)
        active_version = str(context["version"])
        provider = self._allplan_versions.get(active_version, self._allplan_datas)
        source_label = self._source_label(provider, source)
        files = [
            item for item in self._list_files()
            if item.get("version", active_version) == active_version
            and (
                os.path.normcase(item.get("source", "")) == os.path.normcase(str(source))
                or item.get("source") == source_label
            )
        ]
        return {"files": files, "context": context}

    def _sync_projects_for_listing(self, payload):
        if self._allplan_datas is None or int(self._allplan_version) < 2027:
            return
        resources = self._settings_store.load(self.app_id).get(
            "vobResources", {"addedFiles": []}
        )
        if resources is None:
            resources = {"addedFiles": []}
        self._validate_resources_section(resources)
        projects = (
            payload["projects"]
            if "projects" in payload
            else resources.get("addedProjects", [])
        )
        projects_by_version = {}
        for project in projects:
            version = project["version"]
            projects_by_version.setdefault(version, []).append(project["path"])
        for provider in self._allplan_providers():
            version = str(provider.get_context()["version"])
            if int(version) < 2027 or int(version) < 2022:
                continue
            project_paths = projects_by_version.get(version)
            if project_paths is None:
                project_paths = [
                    item["path"]
                    for item in resources.get("addedProjects", [])
                    if item["version"] == version
                ]
            validated = [
                provider.resolve_project_path(path) for path in project_paths
            ]
            provider.set_projects(validated)

    def _handle_file_reveal(self, payload):
        path = self._known_file_path(payload["path"])
        if os.name != "nt":
            raise NotImplementedError("L'ouverture de l'Explorateur est disponible uniquement sous Windows.")
        subprocess.Popen(["explorer.exe", f'/select,"{path}"'])
        return None

    def _handle_file_open_external(self, payload):
        path = self._known_file_path(payload["path"])
        if os.name != "nt":
            raise NotImplementedError("L'ouverture par l'application par défaut est disponible uniquement sous Windows.")
        startfile = getattr(os, "startfile", None)
        if not callable(startfile):
            raise NotImplementedError("L'ouverture par l'application par défaut n'est pas disponible.")
        startfile(str(path))
        return None

    def _known_file_path(self, requested):
        candidate = Path(requested)
        if not candidate.is_absolute() or ".." in candidate.parts:
            raise FileNotFoundError("Le fichier demandé n'est pas dans l'inventaire.")
        self._reject_links(candidate)
        self._ensure_supported_path(candidate)
        resolved = candidate.resolve(strict=True)
        known = {
            os.path.normcase(str(Path(item["path"]).resolve()))
            for item in self._list_files()
        }
        if os.path.normcase(str(resolved)) not in known or not resolved.is_file():
            raise FileNotFoundError("Le fichier n'existe plus ou n'appartient pas aux ressources connues.")
        return resolved

    def _handle_backups_list(self, payload):
        return self._backup_inventory(payload["file"])

    def _handle_backups_create(self, payload):
        path = self._resolve_document_path(payload["file"])
        if not path.is_file():
            raise FileNotFoundError(str(path))
        layout = self._layout_for(path)
        data, _new_layout = serialize_vob(
            payload["rules"], layout, payload.get("header"),
        )
        backup = self._create_backup(path, data)
        self._push_event("vob.files", self._list_files())
        self._push_event("vob.backups", self._backup_inventory(payload["file"]))
        return backup

    def _handle_backups_restore(self, payload):
        path = self._resolve_document_path(payload["file"])
        if not path.is_file():
            raise FileNotFoundError(str(path))
        inventory = self._backup_inventory(payload["file"])
        backup = payload["backup"]
        match = next((item for item in inventory["files"] if item == backup), None)
        if match is None:
            raise ValueError("Cette sauvegarde n'appartient pas au fichier VOB sélectionné.")
        backup_path = self._resolve_backup_path(path, backup)
        data = backup_path.read_bytes()
        rules, layout = read_vob_data(data)
        if b"\0" in data or (data.strip() and not rules and not layout.header):
            raise ValueError("La sauvegarde ne contient pas de règles VOB valides.")
        self._create_backup(path, path.read_bytes())
        self._atomic_replace_bytes(path, data)
        document = self._read_document(path)
        key = os.path.normcase(str(path.resolve()))
        if key in self._personal_files:
            self._authorized_files.add(key)
        self._current_document = deepcopy(document)
        self._remember_file(path)
        self._push_event("vob.files", self._list_files())
        self._push_event("vob.backups", self._backup_inventory(document["file"]))
        return document

    def _resource_context(self):
        if self._allplan_datas is not None:
            context = self._allplan_datas.get_context()
            version = str(context["version"])
            roots = self._allplan_datas.get_vob_roots()
            source = str(next(iter(roots.values()))) if roots else ""
            return {"version": version, "source": source, "versions": [version]}
        source = str(next(iter(self._roots.values()))) if self._roots else ""
        version = str(self._allplan_version) if self._allplan_version is not None else ""
        versions = [version] if version else []
        return {"version": version, "source": source, "versions": versions}

    @staticmethod
    def _source_label(provider, source_path):
        if provider is None:
            return str(source_path)
        for label, root in provider.get_vob_roots().items():
            if Path(root).resolve() == source_path.resolve():
                return "PRJ" if label.startswith("project") else label.upper()
        return str(source_path)

    def _list_all_versions(self, min_version=2022):
        files = []
        seen = set()
        for version, provider in self._allplan_versions.items():
            if not is_supported_version(version) or (
                int(version) != 99 and int(version) < max(2022, min_version)
            ):
                continue
            listing = provider.list_vob_files()
            roots = provider.get_vob_roots()
            for entry in listing["files"]:
                path = Path(entry["path"]).resolve()
                classification = self._describe_file(path)
                if classification.get("version") != str(version):
                    continue
                key = os.path.normcase(str(path))
                if key in seen:
                    continue
                seen.add(key)
                root_label = entry.get("root", "")
                source = (
                    "PRJ" if root_label.startswith("project")
                    else root_label.upper() or str(roots.get(root_label, path.parent))
                )
                files.append({
                    "id": (
                        f"{version}:PRJ:{hashlib.sha256(str(path).encode('utf-8')).hexdigest()[:16]}"
                        if root_label.startswith("project")
                        else f"{version}:{root_label.upper()}:{path.name}"
                    ),
                    "name": path.name,
                    "path": str(path),
                    "version": str(version),
                    "source": source,
                    **(
                        {
                            "projectName": entry["projectName"],
                            "projectPath": entry["projectPath"],
                        }
                        if "projectName" in entry else {}
                    ),
                })
            for warning in listing.get("warnings", []):
                self._logger.warning("Liste VOB %s: %s", version, warning)
        for item in self._personal_files.values():
            key = os.path.normcase(str(Path(item["path"]).resolve()))
            try:
                self._ensure_supported_path(item["path"])
            except UnsupportedVersionError:
                continue
            if key not in seen:
                seen.add(key)
                files.append(dict(item))
        for authorized_path in self._authorized_files:
            path = Path(authorized_path)
            try:
                self._ensure_supported_path(path)
            except UnsupportedVersionError:
                continue
            if not path.is_file():
                continue
            key = os.path.normcase(str(path.resolve()))
            if key not in seen:
                seen.add(key)
                files.append(self._personal_file(path))
        return files

    def _resolve_source(self, source):
        candidate = Path(source).expanduser()
        if not candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError("La source doit être un dossier absolu autorisé.")
        self._reject_links(candidate)
        resolved = candidate.resolve(strict=True)
        if self._allplan_datas is not None:
            roots = self._allplan_datas.get_vob_roots().values()
        else:
            roots = self._roots.values()
        if not any(resolved == root.resolve() for root in roots):
            raise ValueError("Cette source n'est pas disponible dans la session Allplan.")
        return resolved

    def _read_vob_bytes(self, path, *, selected=False):
        if self._allplan_datas is None:
            return Path(path).read_bytes()
        self._ensure_supported_path(path)
        selected = selected or os.path.normcase(
            str(Path(path).resolve())
        ) in self._authorized_files
        last_error = None
        for provider in self._allplan_providers():
            try:
                return provider.read_vob_bytes(path, selected=selected)
            except (OSError, ValueError) as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise ValueError("Aucune source Allplan n’est disponible.")

    def _allplan_providers(self, *, include_unsupported=False):
        providers = []
        for provider in (self._allplan_datas, *self._allplan_versions.values()):
            version = provider.get_context()["version"] if provider is not None else None
            if (
                provider is not None
                and str(version).isdigit()
                and (include_unsupported or is_supported_version(version))
                and all(provider is not item for item in providers)
            ):
                providers.append(provider)
        return providers

    @staticmethod
    def _path_is_within(path, root):
        path = os.path.normcase(str(Path(path).expanduser().resolve(strict=False)))
        root = os.path.normcase(str(Path(root).expanduser().resolve(strict=False)))
        try:
            return os.path.commonpath((path, root)) == root
        except ValueError:
            return False

    def _ensure_supported_path(self, path):
        if self._allplan_datas is None:
            return
        supported_roots = {
            os.path.normcase(str(root.resolve(strict=False)))
            for provider in self._allplan_providers()
            for root in provider.get_installation_roots()
        }
        for provider in (self._allplan_datas, *self._allplan_versions.values()):
            if provider is None:
                continue
            version = str(provider.get_context()["version"])
            if not version.isdigit() or is_supported_version(version):
                continue
            matched_roots = [
                root for root in provider.get_installation_roots()
                if self._path_is_within(path, root)
            ]
            unsupported_roots = [
                root for root in matched_roots
                if os.path.normcase(str(root.resolve(strict=False))) not in supported_roots
            ]
            if unsupported_roots:
                raise UnsupportedVersionError(
                    f"Le chemin appartient à Allplan {version}, qui n’est pas pris en charge. "
                    "Allplan 2022 ou une version plus récente est requis (exception : 99)."
                )

    def _require_supported_version(self):
        self._require_supported_allplan_version()

    @staticmethod
    def _personal_file(path):
        normalized = os.path.normcase(str(path.resolve()))
        return {
            "id": "custom:" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16],
            "name": path.name,
            "path": str(path.resolve()),
            "source": str(path.resolve().parent),
        }

    def _backup_inventory(self, file_info):
        if file_info is None:
            return {"filePath": None, "files": []}
        path = self._resolve_document_path(file_info)
        directory = path.parent / "backup"
        files = []
        if directory.is_dir():
            prefix = path.name + "."
            for item in directory.iterdir():
                if (
                    item.is_symlink() or not item.is_file()
                    or not item.name.startswith(prefix) or not item.name.endswith(".bak")
                ):
                    continue
                suffix = item.name[len(prefix):-4]
                match = self._BACKUP_SUFFIX.fullmatch(suffix)
                if match is None:
                    continue
                created = datetime.fromtimestamp(item.stat().st_mtime, timezone.utc)
                files.append({
                    "id": f"backup:{path.name}:{suffix}",
                    "name": item.name,
                    "path": str(item.resolve()),
                    "createdAt": created.isoformat(timespec="seconds").replace("+00:00", "Z"),
                })
        files.sort(key=lambda backup_file: backup_file["createdAt"], reverse=True)
        return {"filePath": str(path), "files": files}

    def _create_backup(self, path, data):
        directory = path.parent / "backup"
        self._reject_links(directory, allow_missing_leaf=True)
        directory.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        sequence = 0
        while True:
            suffix = stamp if sequence == 0 else f"{stamp}-{sequence}"
            target = directory / f"{path.name}.{suffix}.bak"
            if not target.exists():
                break
            sequence += 1
        self._atomic_create_bytes(target, data)
        created = datetime.fromtimestamp(target.stat().st_mtime, timezone.utc)
        return {
            "id": f"backup:{path.name}:{suffix}",
            "name": target.name,
            "path": str(target.resolve()),
            "createdAt": created.isoformat(timespec="seconds").replace("+00:00", "Z"),
        }

    def _resolve_backup_path(self, target, backup):
        requested = Path(backup["path"])
        expected_directory = target.parent / "backup"
        if not requested.is_absolute() or ".." in requested.parts:
            raise ValueError("Le chemin de sauvegarde est invalide.")
        self._reject_links(expected_directory)
        self._reject_links(requested)
        if requested.parent.resolve() != expected_directory.resolve():
            raise ValueError("La sauvegarde doit être dans le dossier backup du fichier.")
        if requested.name != backup["name"] or not requested.name.startswith(target.name + "."):
            raise ValueError("La sauvegarde ne correspond pas au fichier sélectionné.")
        if requested.is_symlink() or not requested.is_file():
            raise FileNotFoundError(str(requested))
        return requested.resolve(strict=True)

    @staticmethod
    def _atomic_create_bytes(path, data):
        import tempfile

        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=str(path.parent), prefix=".vob-backup-",
                suffix=".tmp", delete=False,
            ) as handle:
                temporary = Path(handle.name)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(str(temporary), str(path))
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()

    @staticmethod
    def _atomic_replace_bytes(path, data):
        import tempfile

        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb", dir=str(path.parent), prefix=f".{path.name}-",
                suffix=".tmp", delete=False,
            ) as handle:
                temporary = Path(handle.name)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(str(temporary), str(path))
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()

    def _handle_open(self, payload):
        path = payload["path"]
        if path is None:
            path = self._open_dialog()
            if path is None:
                return None
            path = self._authorize_dialog_selection(path)
        else:
            path = self._resolve_authorized_path(path)
        if not path.is_file():
            raise FileNotFoundError(str(path))
        document = self._read_document(path)
        self._pending_etc_write = None
        self._current_document = deepcopy(document)
        recent_files = self._remember_file(path, "openDirectory", opened=True)
        self._push_event("vob.recent_files", recent_files)
        return document

    def _handle_save(self, document, *, confirmed_target=None):
        self._pending_etc_write = None
        if document["file"] is None:
            return self._handle_save_as(document)
        path = self._resolve_document_path(document["file"])
        if not path.is_file():
            raise FileNotFoundError(str(path))
        result = self._write_with_confirmation(
            path, document, "vob.save", confirmed_target=confirmed_target,
        )
        current_file = self._current_document["file"] if self._current_document else None
        if current_file and os.path.normcase(current_file["path"]) == os.path.normcase(str(path)):
            self._current_document = {
                "file": deepcopy(result["file"]),
                "header": list(result["header"]),
                "rules": deepcopy(document["rules"]),
            }
            self._remember_file(path)
        self._push_event("vob.files", self._list_files())
        self._push_event("vob.backups", self._backup_inventory(result["file"]))
        return result

    def _handle_save_as(self, document, *, confirmed_target=None) -> dict | None:
        self._pending_etc_write = None
        source_info = document["file"]
        if source_info is None and self._current_document is not None:
            source_info = self._current_document["file"]
        if source_info is None:
            raise ValueError("Enregistrer sous nécessite un fichier VOB source.")
        source = self._resolve_document_path(source_info)
        if not source.is_file():
            raise FileNotFoundError(str(source))
        target = (
            confirmed_target if confirmed_target is not None
            else self._save_dialog(source.name, source.parent)
        )
        if target is None:
            return None
        target = self._authorize_dialog_selection(target, allow_new=True)
        result = self._write_with_confirmation(
            target, document, "vob.save_as", template=source,
            confirmed_target=confirmed_target,
        )
        self._current_document = {
            "file": deepcopy(result["file"]),
            "header": list(result["header"]),
            "rules": deepcopy(document["rules"]),
        }
        recent_files = self._remember_file(target, "saveDirectory", opened=True)
        self._push_event("vob.recent_files", recent_files)
        self._push_event("vob.files", self._list_files())
        self._push_event("vob.backups", self._backup_inventory(result["file"]))
        return result

    @staticmethod
    def _write_fingerprint(path):
        return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

    def _write_with_confirmation(
        self, path, document, operation, *, template=None, confirmed_target=None,
    ):
        try:
            return self._write_document(
                path, document["rules"], template=template, header=document.get("header"),
                etc_confirmed=confirmed_target is not None and path == confirmed_target,
            )
        except EtcWriteProtectedError:
            self._pending_etc_write = PendingEtcWrite(
                uuid4().hex, operation, path.resolve(),
                self._write_fingerprint(path), deepcopy(document),
            )
            raise

    def _handle_write_confirm(self, payload):
        pending = self._pending_etc_write
        self._pending_etc_write = None
        if pending is None or payload["confirmationId"] != pending.confirmation_id:
            raise ValueError("Confirmation ETC expiree ou inconnue.")
        if not payload["accept"]:
            return None
        if self._write_fingerprint(pending.target) != pending.fingerprint:
            raise ValueError("La cible a change depuis la demande de confirmation ETC.")
        if pending.operation == "vob.save":
            return self._handle_save(pending.document, confirmed_target=pending.target)
        return self._handle_save_as(pending.document, confirmed_target=pending.target)

    def _session_settings(self):
        session = self._settings_store.load(self.app_id).get("vobEditorSession", {})
        if not isinstance(session, dict):
            raise ValueError("Les reglages vobEditorSession doivent etre un objet.")
        return session

    def _recent_files(self):
        stored = self._session_settings().get("recentFiles", [])
        if not isinstance(stored, list) or any(
            not isinstance(item, str) or not item for item in stored
        ):
            raise ValueError("vobEditorSession.recentFiles doit contenir des chemins valides.")
        recent = []
        seen = set()
        for item in stored:
            normalized = str(Path(item).expanduser().resolve())
            key = os.path.normcase(normalized)
            if key not in seen:
                seen.add(key)
                recent.append(normalized)
            if len(recent) == 10:
                break
        return recent

    def _remember_file(self, path, directory_key=None, *, opened=False):
        session = dict(self._session_settings())
        session["lastFile"] = str(path)
        session["selectedFiles"] = sorted(self._authorized_files)
        if directory_key is not None:
            session[directory_key] = str(path.parent)
        recent_files = self._recent_files() if opened else None
        if opened:
            assert recent_files is not None
            normalized = str(Path(path).expanduser().resolve())
            key = os.path.normcase(normalized)
            recent_files = [
                item for item in recent_files
                if os.path.normcase(item) != key
            ]
            recent_files.insert(0, normalized)
            recent_files = recent_files[:10]
            session["recentFiles"] = recent_files
        self._settings_store.save(
            self.app_id, {"version": 1, "vobEditorSession": session},
        )
        return recent_files

    def _restore_session(self):
        self._restore_resources()
        session = self._session_settings()
        selected = session.get("selectedFiles", [])
        if not isinstance(selected, list) or any(not isinstance(p, str) for p in selected):
            raise ValueError("selectedFiles doit etre une liste de chemins.")
        for requested in selected:
            candidate = Path(requested)
            if candidate.is_absolute() and self._is_vob_filename(candidate.name):
                try:
                    self._ensure_supported_path(candidate)
                except UnsupportedVersionError as exc:
                    self._logger.warning(
                        "Fichier de session non pris en charge ignoré %s : %s",
                        candidate, exc,
                    )
                    continue
                if candidate.is_file():
                    self._authorized_files.add(os.path.normcase(str(candidate.resolve())))
        if self._initial_path is not None or self._current_document is not None:
            return
        requested = session.get("lastFile")
        if requested is None:
            return
        try:
            path = self._resolve_authorized_path(requested)
            self._current_document = self._read_document(path)
            self._remember_file(path, opened=True)
        except (ValueError, OSError) as exc:
            self._logger.warning("Reouverture du dernier fichier impossible: %s", exc)
            self._push_event("error", {
                "code": "not_found" if isinstance(exc, FileNotFoundError) else "io",
                "message": self._tr("reopen-error", path=requested),
            })

    def _dialog_directory(self, key, fallback):
        requested = self._session_settings().get(key)
        if isinstance(requested, str) and Path(requested).is_dir():
            return str(Path(requested))
        return str(fallback)

    def _read_document(self, path) -> VobDocument:
        path = Path(path).resolve()
        raw = self._read_vob_bytes(
            path,
            selected=(
                os.path.normcase(str(path)) in self._authorized_files
                or os.path.normcase(str(path)) in self._personal_files
            ),
        )
        rules, layout = read_vob_data(raw)
        if b"\0" in raw or (raw.strip() and not rules and not layout.header):
            raise MessageError("invalid-vob")
        self._layouts[os.path.normcase(str(path))] = layout
        self._trace("vob.read", {"file": str(path), "rules": len(rules), "encoding": layout.encoding})
        return {
            "file": self._describe_file(path),
            "header": list(layout.header),
            "rules": rules,
        }

    def _describe_file(self, path) -> VobFile:
        path = Path(path).resolve()
        self._ensure_supported_path(path)
        matches = []
        for provider in self._allplan_providers(include_unsupported=True):
            version = str(provider.get_context()["version"])
            for source, root, project_path in provider.get_classification_roots():
                if self._path_is_within(path, root):
                    matches.append((version, source, root, project_path))
        unique = {
            (version, source, os.path.normcase(str(root)), str(project_path or ""))
            for version, source, root, project_path in matches
        }
        if len(unique) == 1:
            version, source, _root, project_path = matches[0]
            is_project = source == "PRJ"
            return {
                "id": (
                    f"{version}:PRJ:"
                    f"{hashlib.sha256(str(path).encode('utf-8')).hexdigest()[:16]}"
                    if is_project
                    else f"{version}:{source}:{hashlib.sha256(str(path).encode('utf-8')).hexdigest()[:16]}"
                ),
                "name": path.name,
                "path": str(path),
                "version": version,
                "source": source,
                **(
                    {"projectName": project_path.name, "projectPath": str(project_path)}
                    if project_path is not None else {}
                ),
            }
        if self._allplan_datas is None:
            for root_name, root in self._roots.items():
                try:
                    relative = path.relative_to(root).as_posix()
                except ValueError:
                    continue
                version = (
                    str(self._allplan_version)
                    if self._allplan_version is not None else None
                )
                return {
                    "id": f"vob:{version}:{root_name}/{relative}" if version else f"{root_name}/{relative}",
                    "name": path.name,
                    "path": str(path),
                    **({"version": version} if version else {}),
                    "source": str(root),
                }
        return self._personal_file(path)

    def _write_document(self, path, rules, template=None, header=None, *, etc_confirmed=False) -> dict:
        path = Path(path).resolve()
        if self._allplan_datas is not None:
            selected = (
                os.path.normcase(str(path)) in self._authorized_files
                or os.path.normcase(str(path)) in self._personal_files
            )
            providers = self._allplan_providers()
            last_error = None
            for provider in providers:
                try:
                    provider.resolve_file(path, selected=selected, allow_new=True)
                    break
                except (OSError, ValueError) as exc:
                    last_error = exc
            else:
                if last_error is not None:
                    raise last_error
                raise ValueError("Aucune source Allplan n'est disponible.")
            for provider in providers:
                etc = provider.get_context()["paths"].get("ETC")
                if (etc is not None and path.is_relative_to(Path(etc).resolve())
                        and not etc_confirmed):
                    raise EtcWriteProtectedError(
                        "Confirmation explicite requise pour cette ecriture dans ETC."
                    )
        layout = self._layout_for(template or path)
        serialize_vob(rules, layout, header)
        if path.exists():
            self._create_backup(path, path.read_bytes())
        new_layout = write_vob(path, rules, layout, header)
        self._layouts[os.path.normcase(str(path))] = new_layout
        self._trace("vob.write", {"file": str(path), "rules": len(rules)})
        return {"file": self._describe_file(path), "header": list(new_layout.header)}

    def _layout_for(self, path):
        path = Path(path).resolve()
        key = os.path.normcase(str(path))
        if key not in self._layouts and path.is_file():
            self._read_document(path)
        return self._layouts.get(key)

    def _list_files(self):
        self._require_supported_version()
        files = []
        seen = set()
        if self._allplan_datas is not None:
            listing = self._allplan_datas.list_vob_files()
            version = str(self._allplan_datas.get_context()["version"])
            files = []
            for item in listing["files"]:
                classification = self._describe_file(item["path"])
                if classification.get("version") != version:
                    continue
                root_label = item.get("root", "")
                is_project = root_label.startswith("project")
                source = "PRJ" if is_project else root_label.upper()
                files.append({
                    "id": (
                        f"{version}:PRJ:"
                        f"{hashlib.sha256(str(Path(item['path']).resolve()).encode('utf-8')).hexdigest()[:16]}"
                        if is_project else f"vob:{version}:{item['id']}"
                    ),
                    "name": item["name"],
                    "path": item["path"],
                    "version": version,
                    "source": source,
                    **(
                        {
                            "projectName": item["projectName"],
                            "projectPath": item["projectPath"],
                        }
                        if "projectName" in item else {}
                    ),
                })
            seen = {os.path.normcase(item["path"]) for item in files}
            self._listing_warnings = listing["warnings"]
            self._listing_truncated = listing["truncated"]
            for warning in self._listing_warnings:
                self._logger.warning("Liste VOB: %s", warning)
        for root_name, root in (() if self._allplan_datas is not None else self._roots.items()):
            for pattern in ("vob*.*", "vo2*.*"):
                for path in root.rglob(pattern):
                    if not path.is_file() or path.suffix.casefold() in (".bak", ".tmp"):
                        continue
                    resolved = path.resolve()
                    if not self._is_in_roots(resolved):
                        continue
                    key = os.path.normcase(str(resolved))
                    if key in seen:
                        continue
                    seen.add(key)
                    relative = path.relative_to(root).as_posix()
                    files.append(
                        {
                            "id": (
                                f"vob:{self._allplan_version}:{root_name}/{relative}"
                                if self._allplan_version is not None
                                else f"{root_name}/{relative}"
                            ),
                            "name": path.name,
                            "path": str(resolved),
                            **({"version": str(self._allplan_version)} if self._allplan_version is not None else {}),
                            "source": str(root),
                        }
                    )
        for key, item in self._personal_files.items():
            try:
                self._ensure_supported_path(item["path"])
            except UnsupportedVersionError:
                continue
            if key in seen:
                continue
            seen.add(key)
            files.append(dict(item))
        for authorized_path in self._authorized_files - set(self._personal_files):
            path = Path(authorized_path)
            try:
                self._ensure_supported_path(path)
            except UnsupportedVersionError:
                continue
            if not path.is_file():
                continue
            key = os.path.normcase(str(path.resolve()))
            if key not in seen:
                seen.add(key)
                files.append(self._personal_file(path))
        if self._allplan_datas is not None:
            return files if not self._allplan_versions else self._list_all_versions()
        return sorted(
            files, key=lambda file_info: (file_info["name"].casefold(), file_info["id"])
        )

    def _resolve_document_path(self, file_info):
        requested = file_info["path"]
        resolved = self._resolve_authorized_path(requested)
        if Path(requested).name != file_info["name"]:
            raise ValueError("Le nom du fichier ne correspond pas à son chemin.")
        return resolved

    def _resolve_authorized_path(self, requested):
        if not isinstance(requested, str) or not requested:
            raise ValueError("Le chemin du fichier doit être une chaîne non vide.")
        candidate = Path(requested).expanduser()
        if not candidate.is_absolute():
            raise MessageError("absolute-path")
        if ".." in candidate.parts:
            raise ValueError("Les chemins contenant '..' ne sont pas autorisés.")
        self._reject_links(candidate)
        self._ensure_supported_path(candidate)
        normalized = os.path.normcase(str(candidate.resolve()))
        if normalized in self._personal_files and not candidate.is_file():
            raise FileNotFoundError(str(candidate))
        if self._allplan_datas is not None:
            selected = normalized in self._authorized_files or normalized in self._personal_files
            last_error = None
            for provider in self._allplan_providers():
                try:
                    return provider.resolve_file(requested, selected=selected)
                except (OSError, ValueError) as exc:
                    last_error = exc
            if last_error is not None:
                raise last_error
            raise ValueError("Aucune source Allplan n’est disponible.")
        if not self._is_vob_filename(candidate.name):
            raise ValueError("Seuls les fichiers vob*.* et vo2*.* sont autorisés.")
        resolved = candidate.resolve()
        if (
            not self._is_in_roots(resolved)
            and os.path.normcase(str(resolved)) not in self._authorized_files
            and os.path.normcase(str(resolved)) not in self._personal_files
        ):
            raise ValueError("Le chemin n'est pas dans un dossier VOB autorisé.")
        return resolved

    def _is_in_roots(self, path):
        for root in self._roots.values():
            try:
                path.relative_to(root)
                return True
            except ValueError:
                continue
        return False

    def _open_dialog(self):
        directory = self._dialog_directory(
            "openDirectory", next(iter(self._roots.values()), Path.home()),
        )
        from webview import FileDialog

        result = self._file_dialog(
            FileDialog.OPEN,
            directory=directory,
            allow_multiple=False,
            file_types=(f"{self._tr('vob-files')} (*.*)",),
        )
        if not result:
            return None
        return result[0] if isinstance(result, (list, tuple)) else result

    def _save_dialog(self, filename, directory):
        from webview import FileDialog

        result = self._file_dialog(
            FileDialog.SAVE,
            directory=self._dialog_directory("saveDirectory", directory),
            save_filename=filename,
            file_types=(f"{self._tr('vob-files')} (*.*)",),
        )
        if not result:
            return None
        return result[0] if isinstance(result, (list, tuple)) else result

    def _authorize_dialog_selection(self, selected_path, allow_new=False, register=True):
        candidate = Path(selected_path).expanduser()
        if not candidate.is_absolute():
            raise MessageError("absolute-path")
        self._reject_links(candidate, allow_missing_leaf=allow_new)
        self._ensure_supported_path(candidate)
        if self._allplan_datas is not None:
            candidate = self._allplan_datas.resolve_file(
                selected_path, selected=True, allow_new=allow_new,
            )
        if ".." in candidate.parts:
            raise ValueError("Les chemins contenant '..' ne sont pas autorisés.")
        if not self._is_vob_filename(candidate.name):
            raise ValueError("Seuls les fichiers vob*.* et vo2*.* sont autorisés.")
        resolved = candidate.resolve()
        if not allow_new and not resolved.is_file():
            raise FileNotFoundError(str(resolved))
        if allow_new and not resolved.parent.is_dir():
            raise ValueError("Le dossier de destination n'existe pas.")
        if register:
            self._authorized_files.add(os.path.normcase(str(resolved)))
        return resolved

    def _is_vob_filename(self, filename):
        lowered = filename.casefold()
        if self._allplan_datas is not None:
            return lowered.startswith("vo")
        return lowered.startswith(("vob", "vo2")) and "." in lowered

    def _add_files_dialog(self, *, multiple=True):
        directory = self._dialog_directory(
            "openDirectory", next(iter(self._roots.values()), Path.home()),
        )
        from webview import FileDialog

        result = self._file_dialog(
            FileDialog.OPEN,
            directory=directory,
            allow_multiple=multiple,
            file_types=(f"{self._tr('vob-files')} (*.*)",),
        )
        if not result:
            return None
        return list(result) if isinstance(result, (list, tuple)) else [result]

    def _add_projects_dialog(self, *, multiple=True):
        if self._allplan_datas is None:
            raise NotImplementedError(
                "L’ajout de projets nécessite une source Allplan configurée."
            )
        from webview import FileDialog

        project_root = self._allplan_datas.get_project_root()
        if project_root is None:
            raise ValueError("Le dossier PRJ n’est pas configuré.")
        result = self._file_dialog(
            FileDialog.FOLDER,
            directory=str(project_root),
            allow_multiple=multiple,
        )
        if not result:
            return None
        if isinstance(result, (list, tuple)):
            return list(result)
        selected = [result]
        if multiple:
            while True:
                result = self._file_dialog(
                    FileDialog.FOLDER,
                    directory=str(project_root),
                    allow_multiple=False,
                )
                if not result:
                    break
                selected.append(
                    result[0] if isinstance(result, (list, tuple)) else result
                )
        return selected

    def _restore_resources(self):
        settings = self._settings_store.load(self.app_id)
        section = settings.get("vobResources")
        self._validate_resources_section(section)
        if section is None:
            return
        old_projects = section.get("addedProjects", [])
        projects = [
            dict(project) for project in old_projects
            if is_supported_version(project["version"])
        ]
        projects_by_version = {}
        providers_by_version = {
            str(provider.get_context()["version"]): provider
            for provider in self._allplan_providers()
            if int(provider.get_context()["version"]) >= 2027
        }
        valid_projects = []
        for project in projects:
            provider = providers_by_version.get(project["version"])
            if provider is None:
                self._logger.warning(
                    "Version du projet ajoutée indisponible %s : %s",
                    project["version"], project["path"],
                )
                continue
            try:
                path = provider.resolve_project_path(project["path"])
                restored = {**project, "path": str(path), "name": path.name}
                valid_projects.append(restored)
                projects_by_version.setdefault(project["version"], []).append(str(path))
            except (OSError, ValueError) as exc:
                self._logger.warning(
                    "Projet ajouté indisponible %s : %s", project["path"], exc
                )
        for version, provider in providers_by_version.items():
            provider.set_projects(projects_by_version.get(version, []))

        restored_files = []
        changed = projects != old_projects or projects != valid_projects
        for item in section["addedFiles"]:
            path = Path(item["path"]).expanduser().resolve(strict=False)
            if "version" in item and not is_supported_version(item["version"]):
                changed = True
                self._logger.warning("Fichier VOB d’une version non prise en charge ignoré : %s", path)
                continue
            try:
                self._ensure_supported_path(path)
                restored = self._describe_file(path)
            except UnsupportedVersionError as exc:
                self._logger.warning("Fichier VOB non pris en charge %s : %s", path, exc)
                changed = True
                continue
            key = os.path.normcase(str(path))
            self._personal_files[key] = dict(restored)
            restored_files.append(dict(restored))
            changed = changed or restored != item
            if not path.is_file():
                self._logger.warning("Fichier personnel indisponible: %s", path)
        if changed:
            updated_section = dict(section)
            updated_section["addedFiles"] = restored_files
            if "addedProjects" in section or valid_projects:
                updated_section["addedProjects"] = valid_projects
            self._settings_store.save(
                self.app_id, {"version": 1, "vobResources": updated_section},
            )

    def _restore_project_roots(self, projects):
        if self._allplan_datas is None:
            return
        providers = {
            str(provider.get_context()["version"]): provider
            for provider in self._allplan_providers()
            if int(provider.get_context()["version"]) >= 2027
        }
        grouped = {version: [] for version in providers}
        for project in projects:
            version = project["version"]
            provider = providers.get(version)
            if provider is None:
                continue
            try:
                grouped[version].append(provider.resolve_project_path(project["path"]))
            except (OSError, ValueError) as exc:
                self._logger.warning(
                    "Projet ajouté indisponible %s : %s", project["path"], exc
                )
        for version, provider in providers.items():
            provider.set_projects(grouped[version])

    @staticmethod
    def _reject_links(path, allow_missing_leaf=False):
        path = Path(path)
        for index, item in enumerate((path, *path.parents)):
            if allow_missing_leaf and index == 0 and not item.exists():
                continue
            try:
                attributes = item.lstat().st_file_attributes
            except AttributeError:
                attributes = 0
            if item.is_symlink() or attributes & 0x400:
                raise ValueError("Les liens symboliques et points de réanalyse sont refusés.")
