from copy import deepcopy
from typing import Literal, TypedDict

from application.core.bridge import BridgeApp, UnavailableError
from application.core.catalog import PLUGINS


class CatalogInfo(TypedDict):
    name: str
    path: str
    version: str
    source: str
    defAttr: int


class CatalogNodeRequired(TypedDict):
    id: str
    type: Literal["folder", "group", "component", "link"]
    name: str
    description: str
    parentId: str | None
    attrs: dict[str, str]


class CatalogNode(CatalogNodeRequired, total=False):
    children: list[str]
    icon: str
    attrOrder: list[int]


class CatalogDocument(TypedDict):
    nodes: dict[str, CatalogNode]
    rootIds: list[str]


class CurrentCatalog(TypedDict):
    info: CatalogInfo
    document: CatalogDocument


class AttributeDefinitionRequired(TypedDict):
    num: int
    name: str
    type: Literal["text", "int", "dec"]


class AttributeDefinition(AttributeDefinitionRequired, total=False):
    control: Literal["edit", "combo", "check", "date", "formula"]
    unit: str
    min: float
    max: float
    options: list[str]
    codes: list[str]
    groups: list[int]
    comment: str
    readOnly: bool


class SmartCatalogReferences(TypedDict):
    attributes: list[AttributeDefinition]
    groups: list[dict]
    objects: list[dict]
    trades: list[dict]
    layers: list[dict]
    fills: dict
    finishing: dict
    formulaFunctions: list[dict]
    userAttributes: list[AttributeDefinition]
    importedAttributes: list[AttributeDefinition]


class SmartCatalogApp(BridgeApp):
    _UNAVAILABLE_CAPABILITIES = {"reference.load": "references-not-implemented"}
    app_id = "smartcatalog"
    title = PLUGINS[app_id].name
    canonical_url = PLUGINS[app_id].url
    script_name = PLUGINS[app_id].script

    _EVENTS = frozenset({
        "catalog.list", "catalog.document", "backup.list", "error",
        "job.progress", "job.done",
    })
    _SETTINGS_SECTIONS = (
        "general", "toolbars", "dialogs", "attributeFavorites", "attributeOrder",
        "formulaFavorites", "attributeModels", "folderIcons", "externalLibraries",
        "textures",
    )
    _DEFAULT_TITLE_ATTRIBUTE = 83

    def __init__(self, data_dir, settings_store=None, context=None, open_app=None):
        context = deepcopy(context) if context is not None else {
            "allplan_version": None,
            "project": None,
            "paths": {},
        }
        super().__init__(data_dir, settings_store, context.get("allplan_version"))
        self._context = context
        self._catalogs: list[CatalogInfo] = []
        self._current: CurrentCatalog | None = None
        self._revisions: dict[str, str] = {}
        self._libraries: dict[str, dict] = {}
        self._references: dict[str, SmartCatalogReferences] = {}
        self._open_app = open_app
        self._handlers.update({
            "catalog.list": self._handle_catalog_list,
            "catalog.open": self._handle_catalog_open,
            "catalog.save": self._handle_catalog_save,
            "catalog.save_as": self._handle_catalog_save_as,
            "catalog.create": self._handle_catalog_create,
            "catalog.add_existing": self._handle_catalog_add_existing,
            "catalog.remove_from_list": self._handle_catalog_remove_from_list,
            "catalog.duplicate": self._handle_catalog_duplicate,
            "catalog.convert": self._handle_catalog_convert,
            "catalog.update_projects": self._handle_catalog_update_projects,
            "backup.list": self._handle_backup_list,
            "backup.restore": self._handle_backup_restore,
            "file.browse": self._handle_file_browse,
            "library.open": self._handle_library_open,
            "library.reload": self._handle_library_reload,
            "library.sync": self._handle_library_sync,
            "reference.load": self._handle_reference_load,
            "app.open": self._handle_app_open,
        })

    def get_initial_data(self):
        self._trace("get_initial_data")
        self._require_supported_allplan_version()
        with self._lock:
            return {
                "context": deepcopy(self._context),
                "catalogs": deepcopy(self._catalogs),
                "current": deepcopy(self._current),
                "settings": self._initial_preferences(),
                **self._capability_data(),
            }

    def _capabilities(self):
        available = ["settings.load", "settings.save"]
        if self._open_app is not None:
            available.append("app.open")
        return available

    def _validate_payload(self, command, payload):
        super()._validate_payload(command, payload)
        fields = {
            "catalog.list": set(),
            "catalog.open": {"path"},
            "catalog.save": {"info", "document", "revision"},
            "catalog.save_as": {"info", "document"},
            "catalog.create": {"name", "source", "defAttr"},
            "catalog.add_existing": set(),
            "catalog.remove_from_list": {"path"},
            "catalog.duplicate": {"path", "name"},
            "catalog.convert": {"path"},
            "catalog.update_projects": {"path"},
            "backup.list": {"path"},
            "backup.restore": {"path", "index"},
            "file.browse": {"kind", "root"},
            "library.reload": {"id"},
            "reference.load": {"lang"},
            "app.open": {"app_id"},
        }
        if command in fields:
            self._require_fields(payload, fields[command])
        if command == "library.open":
            if set(payload) not in ({"path", "kind"}, {"url", "kind"}):
                raise ValueError("library.open attend path ou url, et kind.")
            for name, value in payload.items():
                self._require_text(value, name)
        for name in ("path", "name", "source", "id", "lang", "revision"):
            if name in payload and command != "settings.save":
                self._require_text(payload[name], name)
        if command == "catalog.create":
            value = payload["defAttr"]
            if type(value) is not int or value < 0:
                raise ValueError("defAttr doit etre un entier positif ou nul.")
        if command in ("catalog.save", "catalog.save_as"):
            if not isinstance(payload["info"], dict) or not isinstance(payload["document"], dict):
                raise ValueError("info et document doivent etre des objets JSON.")
        if command == "backup.restore":
            if type(payload["index"]) is not int or payload["index"] < 0:
                raise ValueError("index doit etre un entier positif ou nul.")
        if command == "file.browse":
            if payload["kind"] not in ("image", "surf", "folder", "library"):
                raise ValueError("Type de ressource non pris en charge.")
            if payload["root"] not in ("design_std", "design_prj", "std", "prj"):
                raise ValueError("Racine de recherche non prise en charge.")
        if command == "app.open" and payload["app_id"] != "vob_editor":
            raise ValueError("Cette commande ouvre uniquement vob_editor.")

    @staticmethod
    def _unavailable(command):
        raise NotImplementedError(
            f"{command} n'est pas encore disponible : le service Allplan "
            "ou le format reel doit etre verifie."
        )

    def _handle_catalog_list(self, _payload):
        return self._unavailable("catalog.list")

    def _handle_catalog_open(self, _payload):
        return self._unavailable("catalog.open")

    def _handle_catalog_save(self, _payload):
        return self._unavailable("catalog.save")

    def _handle_catalog_save_as(self, _payload):
        return self._unavailable("catalog.save_as")

    def _handle_catalog_create(self, _payload):
        return self._unavailable("catalog.create")

    def _handle_catalog_add_existing(self, _payload):
        return self._unavailable("catalog.add_existing")

    def _handle_catalog_remove_from_list(self, _payload):
        return self._unavailable("catalog.remove_from_list")

    def _handle_catalog_duplicate(self, _payload):
        return self._unavailable("catalog.duplicate")

    def _handle_catalog_convert(self, _payload):
        return self._unavailable("catalog.convert")

    def _handle_catalog_update_projects(self, _payload):
        return self._unavailable("catalog.update_projects")

    def _handle_backup_list(self, _payload):
        return self._unavailable("backup.list")

    def _handle_backup_restore(self, _payload):
        return self._unavailable("backup.restore")

    def _handle_file_browse(self, _payload):
        return self._unavailable("file.browse")

    def _handle_library_open(self, _payload):
        return self._unavailable("library.open")

    def _handle_library_reload(self, _payload):
        return self._unavailable("library.reload")

    def _handle_library_sync(self, _payload):
        raise UnavailableError("library.sync est differee et n'est pas disponible.")

    def _handle_reference_load(self, _payload):
        raise NotImplementedError(
            "Le chargement des referentiels SmartCatalog n'est pas encore implemente."
        )

    def _handle_app_open(self, payload):
        if self._open_app is None:
            return self._unavailable("app.open")
        self._open_app(payload["app_id"])
        return None
