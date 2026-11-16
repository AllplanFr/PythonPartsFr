"""Read shipped JSON manifests without importing or starting plugin code."""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import logging
from pathlib import Path
import re
from urllib.parse import urlsplit

from .context import LaunchContext
from .resources import PLUGIN_ROOT, resource_path


LOGGER = logging.getLogger(__name__)


def url_key(url: str) -> tuple[str, str]:
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname
        if (parsed.scheme.lower() != "https" or not hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443)):
            raise ValueError("Une URL HTTPS sans identifiants est requise.")
        return hostname.lower(), parsed.path or "/"
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"URL refusee : {exc}") from exc


@dataclass(frozen=True)
class Plugin:
    id: str
    name: str
    description: str
    package_dir: Path
    entrypoint: str
    url: str
    script: str
    application_type: str = "webview"
    icon: str | None = None
    validator: str | None = None
    requires_version: bool = False
    required_paths: tuple[str, ...] = ()
    path_options: dict[str, str] = field(default_factory=dict)
    settings_rules: dict = field(default_factory=dict)
    language_paths: tuple[str, ...] = ()
    required_resources: tuple[str, ...] = ()
    version: str | None = None
    lifecycle: str = "ready"

    def validate(self, context: LaunchContext) -> None:
        if self.requires_version and context.allplan_version is None:
            raise ValueError(f"{self.name} : selectionnez une version Allplan.")
        for name in self.required_paths:
            if name not in context.paths:
                raise ValueError(f"{self.name} : chemin {name} requis.")
        if self.validator:
            from .runtime import load_callable
            load_callable(self, self.validator)(context)

    def availability(self) -> str | None:
        try:
            for target in (self.entrypoint, self.validator):
                if target:
                    module = target.split(":")[0]
                    if not resource_path(
                        self.package_dir, module.replace(".", "\\") + ".py",
                    ).is_file():
                        return f"Module livre manquant : {module}."
            for relative in (self.script, self.icon, *self.required_resources):
                if relative and not resource_path(self.package_dir, relative).is_file():
                    return f"Ressource livree manquante : {relative}."
        except (OSError, ValueError) as exc:
            LOGGER.warning("Ressource indisponible : %s (%s)", self.id, type(exc).__name__)
            return f"Ressources inaccessibles : {exc}"
        return None


@dataclass(frozen=True)
class UnavailablePlugin:
    name: str
    reason: str


@dataclass
class Catalog:
    plugins: dict[str, Plugin] = field(default_factory=dict)
    unavailable: list[UnavailablePlugin] = field(default_factory=list)


def read_manifest(path: Path) -> Plugin:
    data = json.loads(path.read_text(encoding="utf-8"))
    required = {"id", "name", "description", "entrypoint", "url", "script"}
    optional = {"application_type", "icon", "validator", "requires_version",
                "required_paths", "path_options", "settings_rules", "language_paths",
                "required_resources", "version", "lifecycle"}
    if not isinstance(data, dict) or not required <= data.keys() or data.keys() - required - optional:
        raise ValueError("Declaration incomplete ou champs non reconnus.")
    for name in required:
        if not isinstance(data[name], str) or not data[name].strip():
            raise ValueError(f"Champ textuel requis : {name}.")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", data["id"]):
        raise ValueError("Identifiant de plugin invalide.")
    if data["id"] != path.parent.name:
        raise ValueError("L'identifiant doit correspondre au nom du package.")
    if data.get("version") is not None and (
        not isinstance(data["version"], str) or not data["version"].strip()
    ):
        raise ValueError("Version produit textuelle non vide ou null requise.")
    if data.get("lifecycle", "ready") not in ("ready", "construction"):
        raise ValueError("Lifecycle de plugin invalide.")
    for name in ("entrypoint", "validator"):
        target = data.get(name)
        if target is not None and (
            not isinstance(target, str)
            or not re.fullmatch(r"[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*:[a-zA-Z_]\w*", target)
        ):
            raise ValueError(f"Point d'entree local invalide : {name}.")
    url_key(data["url"])
    if data.get("application_type", "webview") != "webview":
        raise ValueError("Type d'application non pris en charge.")
    if type(data.get("requires_version", False)) is not bool:
        raise ValueError("requires_version doit etre un booleen.")
    for name in ("script", "icon"):
        if data.get(name) is not None:
            if not isinstance(data[name], str):
                raise ValueError(f"Ressource textuelle requise : {name}.")
            resource_path(path.parent, data[name])
    paths = data.get("required_paths", [])
    if not isinstance(paths, list) or any(p not in ("ETC", "PRG", "STD", "PRJ", "USR", "TMP") for p in paths):
        raise ValueError("Liste de chemins requis invalide.")
    options = data.get("path_options", {})
    reserved = {
        "allplan_version", "verification_version", "country", "origin",
        "allplan_language", "diagnostic", "protocol_control_test",
        "catalog_user_path", "project_path", "paths", "timeout", "app_id",
        "etc_path", "prg_path", "std_path", "prj_path", "usr_path", "tmp_path",
        "help", "installation_id",
    }
    if not isinstance(options, dict) or any(
        not re.fullmatch(r"[a-z][a-z_]*", key) or not isinstance(value, str)
        or key in reserved
        for key, value in options.items()
    ):
        raise ValueError("Options de chemins invalides.")
    rules = data.get("settings_rules", {})
    if not isinstance(rules, dict):
        raise ValueError("Regles de preferences invalides.")
    for key, rule in rules.items():
        if (not isinstance(key, str) or not re.fullmatch(r"\w+(?:\.\w+)*", key)
                or not isinstance(rule, dict) or set(rule) != {"min", "max"}
                or type(rule["min"]) is not int or type(rule["max"]) is not int
                or rule["min"] > rule["max"]):
            raise ValueError("Regle de preference entiere invalide.")
    languages = data.get("language_paths", [])
    if not isinstance(languages, list) or any(
        not isinstance(key, str) or not re.fullmatch(r"\w+(?:\.\w+)*", key)
        for key in languages
    ):
        raise ValueError("Chemins de langue invalides.")
    resources = data.get("required_resources", [])
    if not isinstance(resources, list) or any(not isinstance(value, str) for value in resources):
        raise ValueError("Liste de ressources invalide.")
    for relative in resources:
        resource_path(path.parent, relative)
    return Plugin(package_dir=path.parent, **{
        **data, "required_paths": tuple(paths), "language_paths": tuple(languages),
        "required_resources": tuple(resources),
    })


def discover_plugins(root: Path = PLUGIN_ROOT) -> Catalog:
    catalog = Catalog()
    seen = set()
    for manifest in sorted(root.glob("*\\plugin.json")):
        try:
            manifest.resolve().relative_to(root.resolve())
            plugin = read_manifest(manifest)
            if plugin.id in seen:
                catalog.plugins.pop(plugin.id, None)
                raise ValueError("Identifiant duplique.")
            seen.add(plugin.id)
            if any(url_key(existing.url) == url_key(plugin.url) for existing in catalog.plugins.values()):
                raise ValueError("URL deja declaree par un autre plugin.")
            catalog.plugins[plugin.id] = plugin
        except (OSError, ValueError, TypeError) as exc:
            LOGGER.warning("Declaration de plugin refusee : %s (%s)", manifest.parent.name, type(exc).__name__)
            catalog.unavailable.append(UnavailablePlugin(manifest.parent.name, str(exc)))
    return catalog


CATALOG = discover_plugins()
PLUGINS = CATALOG.plugins


def resolve_plugin(plugin_id: str) -> Plugin:
    try:
        return PLUGINS[plugin_id.strip().lower()]
    except (KeyError, AttributeError):
        raise ValueError(f"Application inconnue : {plugin_id!r}. "
                         f"Applications disponibles : {', '.join(PLUGINS)}") from None


def resolve_url(url: str) -> Plugin:
    key = url_key(url)
    for plugin in PLUGINS.values():
        if key == url_key(plugin.url):
            return plugin
    raise ValueError("URL non enregistree dans le catalogue.")
