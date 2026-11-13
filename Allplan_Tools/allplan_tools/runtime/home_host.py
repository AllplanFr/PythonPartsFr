"""Test-only Allplan Tools home adapter; no default launcher replacement."""
import hashlib
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
from threading import Lock
import traceback
import uuid


CONFIG = json.loads((Path(__file__).resolve().parents[1] / "runtime.json").read_text(encoding="utf-8"))
CANDIDATE = Path(CONFIG["pythonRoot"]).parent
PYTHON_ROOT = Path(CONFIG["pythonRoot"])
PROFILE = Path(CONFIG["profile"])
REVISION = "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65"
HOME_REVISION = "5dd43513ec8f170c8e8bc138f5fd2e0c82ae31ee"
HOME_DIRECTORY = Path(CONFIG["homeDirectory"])
PREFLIGHT = Path(__file__).with_name("preflight.py")
LOGGER = logging.getLogger(__name__)


def _services():
    if str(PYTHON_ROOT) not in sys.path:
        sys.path.insert(0, str(PYTHON_ROOT))
    from application.launcher.selector import SelectorApi
    from application.core.catalog import PLUGINS
    from application.core.work_identity import verify_work_copy
    verify_work_copy()
    for name, module in tuple(sys.modules.items()):
        if name == "application" or name.startswith("application."):
            location = getattr(module, "__file__", None)
            if not location or not Path(location).resolve().is_relative_to(PYTHON_ROOT):
                raise RuntimeError("Module applicatif hors candidate : " + name)
    if Path(os.environ["LOCALAPPDATA"]).resolve() != PROFILE:
        raise RuntimeError("Profil de test incorrect.")
    return SelectorApi, PLUGINS


def _verify_aim():
    """Reuse the existing test preflight in a separate, bounded child."""
    if not PREFLIGHT.is_file():
        raise FileNotFoundError("Precontrole de test absent.")
    token = uuid.uuid4().hex
    logs = PROFILE / "AllplanWebLauncher" / "home-test"
    logs.mkdir(parents=True, exist_ok=True)
    log = logs / ("preflight-" + token + ".log")
    with log.open("w", encoding="utf-8") as errors:
        try:
            from application.core.test_process import console_options
            result = subprocess.run(
                [sys.executable, "-I", str(PREFLIGHT), token], cwd=str(PYTHON_ROOT),
                stdout=subprocess.PIPE, stderr=errors,
                text=True, encoding="utf-8", timeout=60, shell=False,
                **console_options(),
            )
        except subprocess.TimeoutExpired as exc:
            traceback.print_exc(file=errors)
            raise RuntimeError("Precontrole AIM expire apres 60 s. Journal : " + str(log)) from exc
    if result.returncode:
        with log.open("a", encoding="utf-8") as errors:
            errors.write("\nstdout:\n" + result.stdout)
        raise RuntimeError("Precontrole AIM refuse. Traceback : " + str(log))
    try:
        data = json.loads(result.stdout)
        if (type(data) is not dict or data.get("status") != "verified"
                or data.get("token") != token or data.get("revision") != REVISION
                or data.get("profile") != str(PROFILE)
                or data.get("python_root") != str(PYTHON_ROOT)
                or Path(data.get("interpreter", "")).resolve() != Path(sys.executable).resolve()
                or not data.get("module_paths")):
            raise ValueError("Resultat du precontrole AIM invalide.")
    except (ValueError, TypeError) as exc:
        with log.open("a", encoding="utf-8") as errors:
            errors.write("\nstdout:\n" + result.stdout + "\n")
            traceback.print_exc(file=errors)
        raise RuntimeError("Resultat AIM invalide. Journal : " + str(log)) from exc
    (logs / ("preflight-" + token + ".json")).write_text(
        json.dumps(data, ensure_ascii=True, indent=2), encoding="utf-8",
    )


class HomeApi:
    """Same launch signature/replies as SelectorApi; no command or path input."""
    def __init__(self, context, timeout=15):
        selector, self._plugins = _services()
        self._selector = selector(context, timeout)
        self._context = context
        self._timeout = timeout
        self._year = context.allplan_version or ""
        self._verification = context.verification_version
        self._country = context.country or ""
        self._lock = Lock()
        self._home_window = None
        from application.core.plugin_updates import CatalogSession
        self._catalog = CatalogSession(lambda: self._plugins, self._year)
        self._catalog_configuration_error = None
        enabled = CONFIG.get("productionCatalogEnabled", False)
        try:
            if type(enabled) is not bool:
                raise ValueError("productionCatalogEnabled doit etre un booleen.")
            if enabled:
                from application.core.plugin_catalog_remote import RemoteCatalogLoader
                loader = RemoteCatalogLoader(CONFIG.get("pythonExecutable"))
                self._catalog = CatalogSession(
                    lambda: self._plugins, self._year, remote_loader=loader,
                    allowed_hosts=(), open_link=None,
                )
        except (ValueError, OSError) as exc:
            LOGGER.error("Home catalog configuration refused: %s", exc)
            self._catalog_configuration_error = "Configuration catalogue refusee : " + str(exc)

    @staticmethod
    def _failure(message):
        return {
            "ok": False,
            "error": message + "\nJournal : " + str(PROFILE / "AllplanWebLauncher" / "logs"),
        }

    def get_home_info(self):
        return {
            "home_launch_contract": 1,
            "plugin_inventory_contract": 1,
            "context": {
                "year": self._year, "verification": self._verification,
                "country": self._country,
            },
            "plugins": [self._plugin_info(plugin) for plugin in self._plugins.values()],
        }

    def close_home(self):
        if self._home_window is None:
            LOGGER.error("Home close: no home window bound")
            return self._failure("Aucune fenetre d'accueil associee.")
        try:
            self._home_window.destroy()
        except (OSError, RuntimeError, ValueError, TypeError) as exc:
            LOGGER.exception("Home close failed")
            return self._failure(str(exc) or "Fermeture de l'accueil impossible.")
        return {"ok": True, "status": "requested"}

    @staticmethod
    def _plugin_info(plugin):
        resource_reason = plugin.availability()
        construction = plugin.lifecycle == "construction"
        reason = "Plugin en construction." if construction else resource_reason
        launchable = reason is None
        return {
            "id": plugin.id, "name": plugin.name, "description": plugin.description,
            "installedVersion": plugin.version, "lifecycle": plugin.lifecycle,
            "launchable": launchable, "available": launchable, "reason": reason,
            "reasonCode": "construction" if construction else (
                "unavailable" if resource_reason is not None else None
            ),
            "iconUrl": "/plugin-icons/" + plugin.id + ".png",
        }

    def get_catalog(self):
        if self._catalog_configuration_error is not None:
            return {"ok": False, "error": {
                "code": "catalog_internal_error", "message": self._catalog_configuration_error,
            }}
        try:
            return self._catalog.get_catalog()
        except (OSError, ValueError, TypeError, KeyError, RuntimeError):
            LOGGER.exception("Home catalog: internal failure")
            return {"ok": False, "error": {
                "code": "catalog_internal_error", "message": "Lecture du catalogue impossible.",
            }}

    def update(self, plugin_id):
        try:
            return self._catalog.update(plugin_id)
        except (OSError, ValueError, TypeError, KeyError, RuntimeError):
            LOGGER.exception("Home update: internal failure")
            return {"ok": False, "error": {
                "code": "catalog_internal_error", "message": "Action Update impossible.",
                "reason": None,
            }}

    def launch(self, plugin_id, year, verification, country):
        if (type(plugin_id) is not str or plugin_id not in self._plugins
                or type(year) is not str or type(verification) is not bool
                or type(country) is not str):
            LOGGER.warning("Home launch: invalid arguments")
            return self._failure("Arguments de lancement invalides.")
        if (year, verification, country) != (self._year, self._verification, self._country):
            LOGGER.warning("Home launch: context change refused")
            return self._failure("Le contexte Allplan de cette fenetre doit etre conserve.")
        if not self._lock.acquire(blocking=False):
            LOGGER.info("Home launch: request already in progress")
            return self._failure("Une demande de lancement est deja en cours.")
        try:
            info = self._plugin_info(self._plugins[plugin_id])
            if not info["launchable"]:
                LOGGER.warning("Home launch: unavailable plugin %s", plugin_id)
                return self._failure(info["reason"])
            if plugin_id == "information_manager":
                _verify_aim()
            if plugin_id == "vob_editor" and "vobEntrypoint" in CONFIG:
                self._launch_vob()
                reply = {"ok": True}
            else:
                reply = self._selector.launch(plugin_id, year, verification, country)
            if reply["ok"]:
                LOGGER.info(
                    "Home launch accepted: plugin=%s; process created; window readiness not confirmed",
                    plugin_id,
                )
            return reply if reply["ok"] else self._failure(reply["error"])
        except (OSError, ValueError, TypeError, KeyError, RuntimeError,
                ImportError, subprocess.SubprocessError) as exc:
            LOGGER.exception("Home launch failed: %s", plugin_id)
            return self._failure(str(exc) or "Lancement impossible.")
        finally:
            self._lock.release()

    def _launch_vob(self):
        from application.core.context import context_to_arguments
        from application.core.launching import launcher_command
        from application.core.test_process import spawn_logged

        entrypoint = Path(CONFIG["vobEntrypoint"])
        if not entrypoint.is_absolute() or entrypoint.suffix.lower() != ".py":
            raise ValueError("Point d'entree Python VOB absolu requis.")
        if Path(os.environ["LOCALAPPDATA"]).resolve() != PROFILE:
            raise RuntimeError("Profil VOB different du profil de lancement.")
        if self._context.allplan_version is None:
            raise ValueError("Le lancement VOB raccorde exige le contexte Allplan.")
        kind = "verification" if self._verification else "standard"
        storage = PROFILE / "AllplanWebLauncher" / "vob_editor" / self._year / kind
        data_directory = storage / "data"
        if not data_directory.is_dir():
            raise FileNotFoundError("Dossier applicatif VOB data introuvable : " + str(data_directory))
        command = launcher_command(entrypoint, Path(CONFIG["pythonExecutable"]))
        command.insert(1, "-I")
        command.extend(context_to_arguments(self._context))
        command.extend(("--timeout", str(self._timeout)))
        spawn_logged(command, cwd=str(entrypoint.parent), env=dict(os.environ), shell=False)


def verified_home(directory, expected_revision):
    """A separate flat static delivery, never the AIM document/archive."""
    root = Path(directory).resolve()
    if root.is_relative_to(PYTHON_ROOT) or root.is_relative_to(Path(CONFIG["pinnedCandidate"])):
        raise ValueError("Les ressources d'accueil doivent etre separees de la candidate.")
    manifest_path = root / "home-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (set(manifest) != {"schema", "revision", "entry", "files"}
            or manifest["schema"] != "allplan-tools-home/1"
            or manifest["revision"] != expected_revision
            or manifest["entry"] != "index.html"
            or type(manifest["files"]) is not dict
            or "index.html" not in manifest["files"]):
        raise ValueError("Manifeste accueil invalide.")
    actual = set()
    for path in root.rglob("*"):
        if path.is_symlink() or path.is_junction():
            raise ValueError("Lien de ressources accueil interdit.")
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    if actual != {"home-manifest.json", *manifest["files"]}:
        raise ValueError("Inventaire accueil different.")
    for name, expected in manifest["files"].items():
        path = (root / name).resolve()
        if not path.is_relative_to(root) or path == manifest_path:
            raise ValueError("Chemin accueil interdit.")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError("Empreinte accueil incorrecte : " + name)
    return root / "index.html"


def show_home(context, directory, expected_revision, *, timeout=15, on_started=None):
    """Explicit test integration hook; never invoked by the normal launcher."""
    import webview
    import bottle
    entry = verified_home(directory, expected_revision)
    api = HomeApi(context, timeout)
    site = bottle.Bottle()
    files = json.loads((entry.parent / "home-manifest.json").read_text(encoding="utf-8"))["files"]

    @site.get("/")
    def index():
        return bottle.static_file("index.html", root=str(entry.parent))

    @site.get("/plugin-icons/<plugin_id>.png")
    def plugin_icon(plugin_id):
        if plugin_id not in api._plugins:
            return bottle.HTTPError(404, "Icone non declaree.")
        from application.core.plugin_icons import icon_path
        path = icon_path(api._plugins[plugin_id])
        if path is None:
            return bottle.HTTPError(404, "Icone et repli indisponibles.")
        return bottle.static_file(path.name, root=str(path.parent), mimetype="image/png")

    @site.get("/<filename:path>")
    def resource(filename):
        if filename not in files:
            return bottle.HTTPError(404, "Ressource accueil inconnue.")
        return bottle.static_file(filename, root=str(entry.parent))

    webview.settings["IGNORE_SSL_ERRORS"] = False
    window = webview.create_window(
        "Allplan Tools", url=site, js_api=api,
        width=1000, height=800, min_size=(800, 600),
    )
    api._home_window = window
    from application.core.plugin_icons import bind_window_icon
    bind_window_icon(window)
    if on_started is not None:
        window.events.shown += on_started
    webview.start(gui="edgechromium", debug=False, http_server=True,
                  private_mode=False,
                  storage_path=str(PROFILE / "AllplanWebLauncher" / "home-test" / "profile"))
