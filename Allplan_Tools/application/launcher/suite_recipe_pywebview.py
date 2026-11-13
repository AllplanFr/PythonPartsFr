"""Explicit isolated pywebview recipes; remote access requires separate authorization."""
import argparse
from collections import Counter
import json
import hashlib
import logging
from copy import deepcopy
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
from threading import Event, Lock, Thread
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from application.core.configuration import SettingsStore
from .suite_recipe_no_bridge import (
    AIM_FIX_REVISION, BLOCKED, ORIGIN, REJECTION_OBSERVER, check_asset, check_manifest,
    diagnostic_stack,
)


CASES = ("resources", "navigation", "popup", "download", "installation-failure", "variant")
ROOT_NAME = "native-suite-recipe-20261026"


class AimRecipeApi:
    """Only the two actual read methods of the current Python plugin."""
    def __init__(self, fixture_data):
        from application.plugins.information_manager.application import InformationManagerApp
        self._app = InformationManagerApp(fixture_data)

    def get_app_info(self):
        return self._app.get_app_info()

    def get_initial_data(self):
        return self._app.get_initial_data()


class SmartCatalogRecipeApi:
    """Local preparation only: the real plugin behind one read-only command."""
    def __init__(self, recipe_root):
        from application.core.configuration import SettingsStore
        from application.plugins.smartcatalog.application import SmartCatalogApp

        root = prepared_root(recipe_root)
        data = root / "smartcatalog" / "data"
        settings = root / "settings" / "smartcatalog-recipe.json"
        log = root / "logs" / "smartcatalog-recipe.log"
        for path in (data, settings.parent, log.parent):
            if not path.is_dir():
                raise ValueError("Prepared SmartCatalog recipe directory missing")
        for path in (data, settings.parent, log.parent, settings,
                     settings.with_name(settings.name + ".lock"), log):
            if path.is_symlink() or (path.exists()
                                    and path.lstat().st_file_attributes & 0x400):
                raise ValueError("SmartCatalog recipe reparse points are not supported")
            if path.is_file() and path.stat().st_nlink != 1:
                raise ValueError("SmartCatalog recipe hard-linked files are not supported")
        self._app: SmartCatalogApp = SmartCatalogApp(
            data, settings_store=SettingsStore(settings),
            context={"allplan_version": None, "project": None, "paths": {}},
            open_app=None,
        )
        self._logger = logging.Logger("smartcatalog.isolated-recipe", logging.INFO)
        self._logger.propagate = False
        handler = logging.FileHandler(log, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        self._logger.addHandler(handler)
        self._app._logger = self._logger

    @staticmethod
    def _limited_capabilities(value):
        result = deepcopy(value)
        result["capabilities"] = ["settings.load"]
        result["unavailable_capabilities"] = {}
        return result

    def get_app_info(self):
        return self._limited_capabilities(self._app.get_app_info())

    def get_initial_data(self):
        return self._limited_capabilities(self._app.get_initial_data())

    def call(self, command, payload):
        if type(command) is not str or command != "settings.load":
            self._logger.warning("Recipe command refused before delegation: %r",
                                 command[:80] if type(command) is str else type(command).__name__)
            return {"ok": False, "error": {
                "code": "unknown_command", "message": "Command refused by isolated recipe.",
            }}
        if (type(payload) is not dict or set(payload) != {"app_id"}
                or type(payload["app_id"]) is not str or payload["app_id"] != "smartcatalog"):
            self._logger.warning("Recipe settings.load payload refused before delegation")
            return {"ok": False, "error": {
                "code": "invalid", "message": "Expected exactly app_id=smartcatalog.",
            }}
        return self._app.call(command, {"app_id": "smartcatalog"})


def _validate_vob_recipe_settings(value):
    if (type(value) is not dict or set(value) != {"version", "general"}
            or type(value["version"]) is not int or value["version"] != 1
            or type(value["general"]) is not dict
            or set(value["general"]) != {"lang", "dark"}
            or value["general"]["lang"] != "fr"
            or type(value["general"]["dark"]) is not bool
            or value["general"]["dark"]):
        raise ValueError("VOB recipe requires only version=1 and general lang=fr, dark=false")
    return value


class _VobRecipeSettingsStore(SettingsStore):
    def load(self, app_id):
        value = super().load(app_id)
        # Validate every read before the plugin can restore paths or sessions.
        return _validate_vob_recipe_settings(value)


class VobRecipeApi:
    """Prepared locally only; no VOB remote entry or business dispatch."""
    def __init__(self, recipe_root):
        from application.plugins.vob_editor.application import VobEditorApp

        root = prepared_root(recipe_root)
        folder = root / "vob_editor"
        data, profile = folder / "data", folder / "profile"
        settings = root / "settings" / "vob-recipe.json"
        log = root / "logs" / "vob-recipe.log"
        for path in (folder, data, profile, settings.parent, log.parent):
            if not path.is_dir():
                raise ValueError("Prepared VOB recipe directory missing")
        for path in (folder, data, profile, settings.parent, log.parent, settings,
                     settings.with_name(settings.name + ".lock"), log):
            if path.is_symlink() or (path.exists()
                                    and path.lstat().st_file_attributes & 0x400):
                raise ValueError("VOB recipe reparse points are not supported")
            if path.is_file() and path.stat().st_nlink != 1:
                raise ValueError("VOB recipe hard-linked files are not supported")
        _validate_vob_recipe_settings(json.loads(settings.read_text(encoding="utf-8")))
        self._app: VobEditorApp = VobEditorApp(
            data, roots={}, settings_store=_VobRecipeSettingsStore(settings),
            allplan_version=None, initial_path=None, allplan_datas=None, allplan_versions={},
        )
        self._logger = logging.Logger("vob_editor.isolated-recipe", logging.INFO)
        self._logger.propagate = False
        handler = logging.FileHandler(log, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        self._logger.addHandler(handler)
        self._app._logger = self._logger

    def get_app_info(self):
        return SmartCatalogRecipeApi._limited_capabilities(self._app.get_app_info())

    def get_initial_data(self):
        return SmartCatalogRecipeApi._limited_capabilities(self._app.get_initial_data())

    def call(self, command, payload):
        if type(command) is not str or command != "settings.load":
            self._logger.warning("Recipe command refused before delegation: %r",
                                 command[:80] if type(command) is str else type(command).__name__)
            message = ("Native VOB references unavailable in isolated recipe."
                       if type(command) is str and command == "reference.load"
                       else "Command refused by isolated recipe.")
            return {"ok": False, "error": {"code": "unknown_command", "message": message}}
        if (type(payload) is not dict or set(payload) != {"app_id"}
                or type(payload["app_id"]) is not str or payload["app_id"] != "vob_editor"):
            self._logger.warning("Recipe settings.load payload refused before delegation")
            return {"ok": False, "error": {
                "code": "invalid", "message": "Expected exactly app_id=vob_editor.",
            }}
        return self._app.call(command, {"app_id": "vob_editor"})


class Boundary:
    def __init__(self, route, blocked, environment, context, sources, record, stop):
        self.route, self.blocked = route, blocked
        self.environment, self.context, self.sources = environment, context, sources
        self.record, self.stop = record, stop
        self.subscriptions = []

    def subscribe(self, core, event_name, handler):
        event = getattr(core, event_name)
        event += handler
        self.subscriptions.append((core, event_name, handler))

    def install(self, core, fail_install=False):
        core.Settings.AreHostObjectsAllowed = False
        # pywebview needs web messages internally, but no application API is exposed.
        core.AddWebResourceRequestedFilter("*", self.context.All, self.sources.All)
        for name, handler in (
            ("WebResourceRequested", self.request),
            ("NavigationStarting", self.navigation),
            ("NewWindowRequested", self.popup),
            ("DownloadStarting", self.download),
        ):
            self.subscribe(core, name, handler)
        if fail_install:
            raise RuntimeError("Controlled installation failure")
        self.record.append("filter-installed")

    def request(self, _sender, args):
        uri = str(args.Request.Uri)
        parts = urlsplit(uri)
        origin = urlsplit(self.route)
        variant = (parts.netloc == origin.netloc
                   and (parts.path.startswith("/~flock")
                        or parts.path.startswith("/__l5e/events"))
                   and uri not in self.blocked)
        outside_document = (getattr(args, "ResourceContext", None) == self.context.Document
                            and uri != self.route)
        if uri in self.blocked or variant or outside_document:
            args.Response = self.environment.CreateWebResourceResponse(
                None, 403, "Recipe denied", "Cache-Control: no-store\r\n")
            prefix = ("variant:" if variant else
                      "document-denied:" if outside_document else "blocked:")
            self.record.append(prefix + uri)
            if variant:
                self.stop()

    def navigation(self, _sender, args):
        if str(args.Uri) != self.route:
            args.Cancel = True
            self.record.append("navigation-denied:" + str(args.Uri))

    def popup(self, _sender, args):
        args.Handled = True
        self.record.append("popup-denied:" + str(args.Uri))

    def download(self, _sender, args):
        args.Cancel = True
        self.record.append("download-denied")

    def detach(self):
        for obj, name, handler in reversed(self.subscriptions):
            event = getattr(obj, name)
            event -= handler
        self.subscriptions.clear()


def prepared_root(value):
    root = Path(value).resolve(strict=True)
    if root.name != ROOT_NAME:
        raise ValueError("Only the prepared recipe root is supported")
    # Explicitly selected paths must not escape through a link/junction.
    profile = root / "smartcatalog" / "profile"
    for path in (root, root / "smartcatalog", profile):
        if path.is_symlink() or path.lstat().st_file_attributes & 0x400:
            raise ValueError("Recipe reparse points are not supported")
    if not profile.is_dir():
        raise ValueError("Prepared profile missing")
    return root


def usual_profile_stamp():
    root = Path(os.environ["LOCALAPPDATA"]) / "AllplanWebLauncher"
    if not root.exists():
        return None
    return {str(path.relative_to(root)): (path.stat().st_size, path.stat().st_mtime_ns)
            for path in root.rglob("*") if path.is_file()}


def aim_paths(root):
    folder = root / "information_manager" / "populated"
    profile, data = folder / "profile", folder / "data"
    fixture = data / "initial_data.json"
    for path in (root / "information_manager", folder, profile, data, fixture):
        if path.is_symlink() or path.lstat().st_file_attributes & 0x400:
            raise ValueError("AIM recipe reparse points are not supported")
    if not profile.is_dir() or not data.is_dir() or not fixture.is_file():
        raise ValueError("Prepared populated AIM profile/fixture missing")
    value = json.loads(fixture.read_text(encoding="utf-8"))
    if (not value.get("catalog") or not value.get("attributes")
            or value.get("values", {}).get("7") != "SYNTHETIC-ONLY"):
        raise ValueError("Expected populated synthetic AIM fixture not found")
    return profile, data, fixture


def aim_fixture_displayed(page):
    return all(
        expected in page["text"] or expected in page["inputValues"]
        for expected in ("Synthetic recipe attribute", "SYNTHETIC-ONLY")
    )


def recipe_file_stamp(folder):
    return {str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in folder.rglob("*") if path.is_file()}


def startup_observation_complete(calls, now, navigation_at, include_references=False):
    reads = [item for item in calls if item.get("completed") and (
        item["method"] == "get_initial_data"
        or (item["method"] == "call" and item.get("command") == "settings.load"
            and item.get("reply", {}).get("ok") is True))]
    ready = ({item["method"] for item in reads} == {"get_initial_data", "call"})
    anchors = reads + ([item for item in calls if item.get("completed")
                       and item.get("command") == "reference.load"]
                      if include_references else [])
    return (now - navigation_at >= 45
            or (ready and now - max(item["finishedMonotonic"] for item in anchors) >= 15))


def run_remote_aim(root):
    return run_remote_recipe(root, "information_manager")


def run_remote_recipe(root, app_id):
    """One authorized read-only run; no retries, dialogs or module switching."""
    import webview
    from .protocol_control import load_native
    from importlib import import_module

    if app_id not in ("information_manager", "smartcatalog", "vob_editor"):
        raise ValueError("Unsupported isolated recipe application")
    vob = app_id == "vob_editor"
    dispatched = app_id in ("smartcatalog", "vob_editor")
    if dispatched:
        root = prepared_root(root)
        profile, data = root / app_id / "profile", root / app_id / "data"
        technical_before = {name: recipe_file_stamp(root / name) for name in ("settings", "logs")}
        api = VobRecipeApi(root) if vob else SmartCatalogRecipeApi(root)
        fixture = None
    else:
        profile, data, fixture = aim_paths(root)
        api = AimRecipeApi(data)
    data_before = recipe_file_stamp(data)
    normal_before = usual_profile_stamp()
    native = load_native()
    action = import_module("System").Action
    result = {
        "url": ORIGIN + {"smartcatalog": "/smartcatalog", "vob_editor": "/vob-editor",
                         "information_manager": "/information-manager"}[app_id],
        "appId": app_id, "profile": str(profile),
        "dataDirectory": str(data), "fixture": str(fixture) if fixture else None,
        "events": [], "calls": [], "errors": [],
        "runtimeErrors": [], "consoleErrors": [], "assets": [], "responses": [],
        "apiExposed": False,
        "externalLaunchEvents": [],
    }
    page_ready, stop, unexpected_call = Event(), Event(), Event()
    lock = Lock()
    state = {"apiActive": False}
    boundary = None
    tasks = []
    receiver = None
    deadline = time.monotonic() + 100
    manifest_url = ORIGIN + "/build-manifest.json"
    route = result["url"]

    def audit(event, _args):
        if event in ("os.startfile", "subprocess.Popen"):
            result["externalLaunchEvents"].append(event)
    sys.addaudithook(audit)

    def ui(function):
        window.native.Invoke(action(function))

    def ensure_running():
        if stop.is_set():
            raise RuntimeError("Recipe stopped by native protection or window closure")
        if time.monotonic() > deadline:
            raise RuntimeError("Isolated recipe timed out")

    def wait_for(predicate):
        while not predicate():
            ensure_running()
            if dispatched and state.get("navigationAt") is not None:
                if time.monotonic() - state["navigationAt"] >= 45:
                    raise RuntimeError("Recipe navigation observation exceeded 45 seconds")
            time.sleep(0.05)
        ensure_running()

    def read_method(name, method):
        with lock:
            if not state["apiActive"]:
                raise RuntimeError("API is not active on its assigned recipe route")
            if name == "get_initial_data" and not state.get("identityVerified"):
                raise RuntimeError("Initial data refused before native identity verification")
            item = {"method": name, "at": datetime.now(timezone.utc).isoformat()}
            result["calls"].append(item)
            try:
                value = method()
            except Exception as exc:
                item["error"] = f"{type(exc).__name__}: {exc}"
                raise
            item["completed"] = True
            item["finishedMonotonic"] = time.monotonic()
            if name == "get_app_info":
                item["id"] = value.get("app_id", value.get("id"))
                if item["id"] != app_id:
                    raise RuntimeError("Native recipe identity mismatch")
                state["identityVerified"] = True
                if dispatched:
                    item["capabilities"] = value["capabilities"]
                    item["unavailable_capabilities"] = value["unavailable_capabilities"]
            else:
                if dispatched:
                    item["initialData"] = value
                else:
                    item["app"] = value["app"]
                    item["catalogCount"] = len(value["data"].get("catalog", []))
            return value

    def get_app_info():
        return read_method("get_app_info", api.get_app_info)

    def get_initial_data():
        return read_method("get_initial_data", api.get_initial_data)

    def call(command, payload):
        with lock:
            if not state["apiActive"]:
                raise RuntimeError("Recipe API is not active")
            item = {"method": "call", "command": command if type(command) is str else None,
                    "payloadKeys": sorted(map(str, payload)) if type(payload) is dict else None,
                    "at": datetime.now(timezone.utc).isoformat()}
            result["calls"].append(item)
            try:
                reply = api.call(command, payload)
            except Exception as exc:
                item["error"] = f"{type(exc).__name__}: {exc}"
                unexpected_call.set()
                raise
            item.update(reply=reply, completed=True, finishedMonotonic=time.monotonic())
            item["delegated"] = (type(command) is str and command == "settings.load"
                                 and type(payload) is dict
                                 and payload == {"app_id": app_id})
            if (not item["delegated"] and command != "settings.save"
                    and not (vob and command == "reference.load")):
                unexpected_call.set()
            return reply

    def response(_sender, args):
        try:
            url = str(args.Request.Uri)
            status = int(args.Response.StatusCode)
            result["responses"].append({"url": url, "status": status})
            if url in (route, manifest_url) and status != 200:
                raise RuntimeError(f"Document HTTP {status}: {url}")
            if url not in BLOCKED and urlsplit(url).path.endswith((".js", ".css")):
                if status != 200:
                    raise RuntimeError(f"Resource HTTP {status}: {url}")
                tasks.append((url, args.Response.GetContentAsync()))
        except Exception as exc:
            result["errors"].append(f"Response observation failed: {type(exc).__name__}: {exc}")
            stop.set()

    def runtime_error(_sender, args):
        detail = json.loads(str(args.ParameterObjectAsJson)).get("exceptionDetails", {})
        result["runtimeErrors"].append({
            "text": detail.get("text"), "url": detail.get("url"),
            "stackTrace": diagnostic_stack(detail.get("stackTrace")),
        })

    def console_error(_sender, args):
        value = json.loads(str(args.ParameterObjectAsJson))
        if value.get("type") == "error":
            result["consoleErrors"].append({
                "messages": [str(arg.get("value", arg.get("description", "")))[:2000]
                             for arg in value.get("args", [])],
                "stackTrace": diagnostic_stack(value.get("stackTrace")),
            })

    def loaded():
        page_ready.set()

    def closing():
        state["apiActive"] = False
        if boundary:
            boundary.detach()
        stop.set()

    def closed():
        result["closed"] = True

    def navigate_document(url):
        page_ready.clear()
        def navigate():
            boundary.route = url
            result["events"].append("navigate:" + url)
            window.native.webview.CoreWebView2.Navigate(url)
        ui(navigate)
        wait_for(page_ready.is_set)
        if window.get_current_url() != url:
            raise RuntimeError("Unexpected current URL")

    def collect_bodies():
        pending = []
        for url, task in tasks:
            if not task.IsCompleted:
                pending.append((url, task))
                continue
            stream = task.GetAwaiter().GetResult()
            if stream is None:
                raise RuntimeError("Response body unavailable: " + url)
            memory = native.MemoryStream()
            try:
                stream.CopyTo(memory)
                body = bytes(memory.ToArray())
            finally:
                memory.Dispose()
                stream.Dispose()
            try:
                result["assets"].append(check_asset(state["manifest"], url, body))
            except Exception:
                stop.set()
                raise
        tasks[:] = pending

    def final_manifest():
        result["events"].append("final-manifest-attempt")
        window.evaluate_js("""(() => {
            window.recipeManifest=null;
            fetch('/build-manifest.json',{cache:'no-store'})
              .then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()})
              .then(value=>window.recipeManifest={value})
              .catch(e=>window.recipeManifest={error:String(e)});
        })()""")
        final = None
        final_deadline = time.monotonic() + 10
        while final is None:
            if stop.is_set() or time.monotonic() > final_deadline:
                raise RuntimeError("Final manifest observation stopped or timed out")
            final = window.evaluate_js("window.recipeManifest")
            time.sleep(0.05)
        if "error" in final:
            raise RuntimeError("Final manifest unavailable: " + final["error"])
        result["manifestEnd"] = check_manifest(final["value"], AIM_FIX_REVISION) | {
            "observedAt": datetime.now(timezone.utc).isoformat()}
        if any(result["manifestStart"][key] != result["manifestEnd"][key]
               for key in ("revision", "builtAt")):
            raise RuntimeError("Build changed during recipe")
        if final["value"]["files"] != state["manifest"]["files"]:
            raise RuntimeError("Manifest resources changed during recipe")

    def worker():
        nonlocal boundary, receiver
        try:
            wait_for(page_ready.is_set)
            if window.gui.renderer != "edgechromium":
                raise RuntimeError("Only edgechromium is supported")
            if window.evaluate_js("Object.keys(window.pywebview.api)") != []:
                raise RuntimeError("Bootstrap unexpectedly exposes an API")

            def install():
                nonlocal boundary, receiver
                core = window.native.webview.CoreWebView2
                actual_profile = Path(str(core.Environment.UserDataFolder)).resolve(strict=True)
                if actual_profile != profile.resolve(strict=True):
                    raise RuntimeError("Actual WebView2 data folder differs from isolated profile")
                result["nativeUserDataFolder"] = str(actual_profile)
                if api._app._data_dir.resolve(strict=True) != data.resolve(strict=True):
                    raise RuntimeError("Plugin data folder differs from isolated data directory")
                if vob:
                    expected_settings = root / "settings" / "vob-recipe.json"
                    expected_log = root / "logs" / "vob-recipe.log"
                    if (api._app._settings_store._path != expected_settings
                            or api._logger.propagate
                            or any(Path(h.baseFilename) != expected_log
                                   for h in api._logger.handlers)):
                        raise RuntimeError("VOB settings/log isolation mismatch")
                    if (api._app._roots or api._app._initial_path is not None
                            or api._app._allplan_datas is not None
                            or api._app._allplan_versions
                            or api._app._allplan_version is not None):
                        raise RuntimeError("VOB native context is not empty")
                    _validate_vob_recipe_settings(json.loads(
                        expected_settings.read_text(encoding="utf-8")))
                    result["isolatedSettingsPath"] = str(expected_settings)
                    result["isolatedLogPath"] = str(expected_log)
                core.NewWindowRequested -= window.native.browser.on_new_window_request
                result["events"].append("automatic-popup-handler-detached")
                boundary = Boundary(manifest_url, BLOCKED, core.Environment,
                                    native.ResourceContext, native.RequestSourceKinds,
                                    result["events"], stop.set)
                boundary.install(core)
                boundary.subscribe(core, "WebResourceResponseReceived", response)
                receiver = core.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown")
                boundary.subscribe(receiver, "DevToolsProtocolEventReceived", runtime_error)
                console = core.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled")
                boundary.subscribe(console, "DevToolsProtocolEventReceived", console_error)
                state["runtimeTask"] = core.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}")
                state["observerTask"] = core.AddScriptToExecuteOnDocumentCreatedAsync(
                    REJECTION_OBSERVER)
                if core.Settings.AreHostObjectsAllowed:
                    raise RuntimeError("Host objects must remain disabled")
                result["nativeSettings"] = {
                    "hostObjectsAllowed": bool(core.Settings.AreHostObjectsAllowed),
                    "webMessagesEnabledForPywebview": bool(core.Settings.IsWebMessageEnabled),
                    "automaticPopupHandlerDetachedForThisWindow": True,
                    "boundarySubscriptionsInstalled": len(boundary.subscriptions),
                }
            ui(install)
            wait_for(lambda: state["runtimeTask"].IsCompleted
                     and state["observerTask"].IsCompleted)
            ui(lambda: (state["runtimeTask"].GetAwaiter().GetResult(),
                        state["observerTask"].GetAwaiter().GetResult()))
            result["events"].append("protections-confirmed-before-api")
            navigate_document(manifest_url)
            manifest = json.loads(window.evaluate_js("document.body.innerText"))
            result["manifestStart"] = check_manifest(manifest, AIM_FIX_REVISION) | {
                "observedAt": datetime.now(timezone.utc).isoformat()}
            result["trackedChangesAtBuild"] = False
            state["manifest"] = manifest
            exposed = [get_app_info, get_initial_data] + ([call] if dispatched else [])
            window.expose(*exposed)
            result["nativeApiSurface"] = sorted(window._functions)
            expected_surface = sorted(function.__name__ for function in exposed)
            if (window._js_api is not None
                    or result["nativeApiSurface"] != expected_surface):
                raise RuntimeError("Unexpected native application API registration")
            result["apiExposed"] = True
            result["events"].append("recipe-methods-exposed")
            state["apiActive"] = True
            navigation_at = time.monotonic()
            if dispatched:
                state["navigationAt"] = navigation_at
            navigate_document(route)
            common = Path(__file__).resolve().parents[1] / "core" / "resources" / "bridge.js"
            specific = (Path(__file__).resolve().parents[1] / "plugins" /
                        app_id / "resources" / "bridge.js")
            window.evaluate_js(common.read_text(encoding="utf-8") + "\n"
                               + specific.read_text(encoding="utf-8"))
            result["events"].append("existing-legacy-bootstrap-injected")
            observed_until = time.monotonic() + 15
            while True:
                ensure_running()
                ui(collect_bodies)
                if dispatched:
                    with lock:
                        complete = startup_observation_complete(
                            result["calls"], time.monotonic(), navigation_at,
                            include_references=vob)
                    if unexpected_call.is_set() or complete:
                        result["observation"] = {
                            "secondsSinceNavigation": time.monotonic() - navigation_at,
                            "endedForUnexpectedCall": unexpected_call.is_set(),
                            "passiveAfterReadsSeconds": 15, "navigationCeilingSeconds": 45,
                        }
                        break
                elif time.monotonic() >= observed_until:
                    break
                time.sleep(0.1)
            page = window.evaluate_js("""({
                api: Object.keys(window.pywebview.api).sort(),
                launcherId: window.allplanLauncher && window.allplanLauncher.appId,
                launcherHasInitialData: typeof window.allplanLauncher?.getInitialData === 'function',
                legacyGlobalsAbsent: typeof window.loadPresentation === 'undefined',
                rejections: window.__recipeRejections,
                text: document.body.innerText,
                inputValues: [...document.querySelectorAll('input,textarea')].map(e=>e.value),
                headings: [...document.querySelectorAll('h1,h2,h3')].map(e=>e.innerText),
                resources: performance.getEntriesByType('resource').map(r=>r.name)
            })""")
            result["page"] = page
            if page["api"] != expected_surface:
                raise RuntimeError("Unexpected exposed API surface")
            if (page["launcherId"] != app_id or not page["launcherHasInitialData"]
                    or (not dispatched and not page["legacyGlobalsAbsent"])):
                raise RuntimeError("Recipe transport evidence incomplete")
            result["transport"] = {
                "expected": app_id + "_pywebview" if dispatched else "aim_pywebview_limited",
                "evidence": "pywebview API, verified launcher identity, "
                            "getInitialData present and aim_legacy globals absent",
                "directFrontendTransportField": False,
            }
            if dispatched:
                result["mountObservation"] = {
                    "text": page["text"], "headings": page["headings"],
                    "limit": "DOM observation; no internal React state inspection"}
                if unexpected_call.is_set():
                    result["errors"].append("Unexpected call refused; observation stopped")
                result["mounted"] = (
                    ("VOB" if vob else "SmartCatalog") in page["text"]
                    and len(page["text"].strip()) > 100
                    and not any(message in page["text"] for message in
                                ("Native adapter required", "Adaptateur natif requis")))
                if not result["mounted"]:
                    result["errors"].append("Editor mounting not conclusively observed")
            else:
                fixture_shown = aim_fixture_displayed(page)
                result["fixtureDisplayed"] = fixture_shown
                if not fixture_shown:
                    raise RuntimeError("Synthetic fixture name/value not both displayed")
            if page["rejections"] or result["runtimeErrors"] or result["consoleErrors"]:
                result["errors"].append("JavaScript rejection/runtime/console error observed")
            with lock:
                calls = list(result["calls"])
            initial_index = next((i for i, call in enumerate(calls)
                                  if call["method"] == "get_initial_data"), None)
            if (initial_index is None or initial_index == 0
                    or any(call.get("error") for call in calls)
                    or calls[0].get("id") != app_id):
                raise RuntimeError("Native identity/initial-data sequence not established")
            result["identityBeforeInitialData"] = True
            if dispatched:
                if not any(c["method"] == "call" and c.get("delegated")
                           and c.get("reply", {}).get("ok") is True for c in calls):
                    raise RuntimeError("Successful settings.load delegation not observed")
                for c in calls:
                    if c["method"] == "get_app_info":
                        value = c
                    elif c["method"] == "get_initial_data":
                        value = c["initialData"]
                    else:
                        continue
                    if (value["capabilities"] != ["settings.load"]
                            or value["unavailable_capabilities"] != {}):
                        raise RuntimeError("Unexpected recipe capabilities")
                if vob:
                    for c in calls:
                        if c["method"] == "get_initial_data":
                            initial = c["initialData"]
                            if (initial["files"] != [] or initial["document"] is not None
                                    or initial["context"] != {
                                        "version": "", "source": "", "versions": []}
                                    or initial["backups"] != {"filePath": None, "files": []}):
                                raise RuntimeError("VOB initial data unexpectedly contains a file/context")
            ui(collect_bodies)
            if tasks:
                raise RuntimeError("Pending application resource bodies")
            loaded_urls = {url for url in page["resources"]
                           if url not in BLOCKED and urlsplit(url).path.endswith((".js", ".css"))}
            verified_urls = {item["url"] for item in result["assets"]}
            if not loaded_urls or not loaded_urls <= verified_urls:
                raise RuntimeError("Loaded JS/CSS missing hash verification")
            if {e.removeprefix("blocked:") for e in result["events"]
                    if e.startswith("blocked:")} != BLOCKED:
                raise RuntimeError("Two expected hosting-script refusals not observed")
        except Exception as exc:
            result["errors"].append(f"{type(exc).__name__}: {exc}")
        finally:
            if (not stop.is_set() and "manifestStart" in result
                    and window.get_current_url() == route):
                try:
                    final_manifest()
                except Exception as exc:
                    result["errors"].append(f"Final manifest: {type(exc).__name__}: {exc}")
            state["apiActive"] = False
            if not result.get("closed"):
                window.destroy()

    window = webview.create_window(
        "Isolated " + app_id + " recipe - READ ONLY",
        html="<html><body>Inert recipe bootstrap</body></html>",
        js_api=None, width=1280, height=850)
    window.events.loaded += loaded
    window.events.closing += closing
    window.events.closed += closed
    webview.settings["IGNORE_SSL_ERRORS"] = False
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False
    webview.settings["ALLOW_DOWNLOADS"] = False
    try:
        webview.start(worker, gui="edgechromium", private_mode=False,
                      storage_path=str(profile), debug=False)
    finally:
        native.directory_handle.close()
        if dispatched:
            api._app._close()
    result["fixtureUnchanged"] = recipe_file_stamp(data) == data_before
    if dispatched:
        result["noForbiddenCommandDelegated"] = all(
            item.get("command") == "settings.load"
            for item in result["calls"] if item.get("delegated"))
        if unexpected_call.is_set() and not any(
                "Unexpected call" in error for error in result["errors"]):
            result["errors"].append("Unexpected call refused during final observation")
        result["technicalEffects"] = {}
        for name in ("settings", "logs"):
            after = recipe_file_stamp(root / name)
            before = technical_before[name]
            result["technicalEffects"][name] = {
                "added": sorted(after.keys() - before.keys()),
                "removed": sorted(before.keys() - after.keys()),
                "changed": sorted(key for key in before.keys() & after.keys()
                                  if before[key] != after[key]),
            }
    result["usualProfilesUnchanged"] = normal_before == usual_profile_stamp()
    for name in ("closed", "fixtureUnchanged", "usualProfilesUnchanged"):
        if result.get(name) is not True:
            result["errors"].append("Final check failed: " + name)
    if result["externalLaunchEvents"]:
        result["errors"].append("Unexpected external launch")
    return result


def run_case(root, case):
    import webview
    from .protocol_control import load_native
    from importlib import import_module

    native = load_native()  # Assembly loading only; no RC1 controller.
    action = import_module("System").Action
    counts = Counter()
    record = []
    result = {"case": case, "events": record, "errors": [], "apiExposed": False}
    external_launches = []

    def audit(event, _args):
        if event in ("os.startfile", "subprocess.Popen"):
            external_launches.append(event)

    sys.addaudithook(audit)
    server = None
    boundary = None
    window = None

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            counts[self.path] += 1
            if self.path == "/recipe":
                body = ("""<!doctype html><title>Controlled pywebview recipe</title>
<script>window.witness={blocked:0,allowed:0}</script>
<script src="/~flock.js"></script>
<script src="/__l5e/events.b21a279f52bb8621.js"></script>
<script src="/allowed.js"></script><body>Controlled recipe</body>""").encode()
                mime = "text/html"
            elif self.path == "/allowed.js":
                body, mime = b"window.witness.allowed++;", "text/javascript"
            elif self.path == "/download":
                body, mime = b"SYNTHETIC ONLY", "application/octet-stream"
            else:
                body, mime = b"window.witness.blocked++;", "text/javascript"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            if self.path == "/download":
                self.send_header("Content-Disposition", 'attachment; filename="recipe-only.txt"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *args):
            pass

    def ui(function):
        window.native.Invoke(action(function))

    def closed():
        result["closed"] = True

    def worker():
        nonlocal boundary
        try:
            if not window.events.loaded.wait(20):
                raise RuntimeError("Inert bootstrap did not initialize")
            if window.gui.renderer != "edgechromium":
                raise RuntimeError("Only edgechromium is supported")

            def install():
                nonlocal boundary
                core = window.native.webview.CoreWebView2
                # Replace only this recipe window's automatic popup action.
                # The built-in handler otherwise opens a browser or changes Source
                # before our later NewWindowRequested handler can refuse it.
                core.NewWindowRequested -= window.native.browser.on_new_window_request
                record.append("automatic-popup-handler-detached")
                boundary = Boundary(route, blocked, core.Environment, native.ResourceContext,
                                    native.RequestSourceKinds, record,
                                    lambda: result.update(stopRequested=True))
                boundary.install(core, case == "installation-failure")
                record.append("navigate")
                # Native UI navigation; no backend patch and no app API exposure.
                core.Navigate(route)

            try:
                ui(install)
            except Exception as exc:
                if (case != "installation-failure"
                        or "Controlled installation failure" not in str(exc)):
                    raise
                result["installationError"] = str(exc)
                return
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if window.get_current_url() == route:
                    witness = window.evaluate_js("window.witness || null")
                    if witness and witness.get("allowed") == 1:
                        result["witness"] = witness
                        break
                time.sleep(0.1)
            else:
                raise RuntimeError("Controlled document did not load")
            if case == "navigation":
                window.evaluate_js("location.href='/outside'")
            elif case == "popup":
                window.evaluate_js("window.open('/popup')")
            elif case == "download":
                # A download attribute tests DownloadStarting without top-level navigation.
                window.evaluate_js(
                    "(()=>{const a=document.createElement('a');a.href='/download';"
                    "a.download='recipe-only.txt';document.body.append(a);a.click()})()")
            elif case == "variant":
                window.evaluate_js(
                    "(()=>{const s=document.createElement('script');"
                    "s.src='/__l5e/events.changed.js';document.head.append(s)})()")
            if case not in ("resources", "installation-failure"):
                wanted = {"navigation": "navigation-denied:", "popup": "popup-denied:",
                          "download": "download-denied", "variant": "variant:"}[case]
                while time.monotonic() < deadline:
                    if any(event.startswith(wanted) for event in record):
                        break
                    time.sleep(0.1)
                else:
                    raise RuntimeError("Expected refusal event missing: " + wanted)
            if case != "variant":
                result["applicationApiAbsent"] = window.evaluate_js(
                    "typeof window.allplanLauncher==='undefined' && "
                    "Object.keys(window.pywebview.api).length===0")
            else:
                # Let WebResourceRequested return its local response before disposal.
                ui(lambda: None)
                time.sleep(0.2)
                result["variantWitness"] = window.evaluate_js("window.witness.blocked")
        except Exception as exc:
            result["errors"].append(f"{type(exc).__name__}: {exc}")
        finally:
            if not result.get("closed"):
                window.destroy()

    before = usual_profile_stamp()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        base = f"http://127.0.0.1:{server.server_port}"
        route = base + "/recipe"
        # Same exact path spellings as the HAR, but controlled loopback origin only.
        blocked = frozenset(base + urlsplit(url).path for url in BLOCKED)
        Thread(target=server.serve_forever, daemon=True).start()
        window = webview.create_window(
            "Synthetic pywebview recipe - NO APPLICATION API",
            html="<html><body>Inert local bootstrap</body></html>",
            js_api=None, width=900, height=650,
        )
        window.events.closed += closed
        window.events.closing += lambda: boundary.detach() if boundary else None
        webview.settings["IGNORE_SSL_ERRORS"] = False
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False
        webview.settings["ALLOW_DOWNLOADS"] = False
        webview.start(worker, gui="edgechromium", private_mode=False,
                      storage_path=str(root / "smartcatalog" / "profile"), debug=False)
    finally:
        if server:
            server.shutdown()
            server.server_close()
        native.directory_handle.close()
    result["serverCounts"] = dict(counts)
    result["usualProfilesUnchanged"] = before == usual_profile_stamp()
    result["externalLaunchEvents"] = external_launches
    checks = {
        "closed": result.get("closed") is True,
        "usual profiles unchanged": result["usualProfilesUnchanged"],
        "no external process or browser launch": not external_launches,
        "blocked never reached server": all(counts[urlsplit(u).path] == 0 for u in blocked),
    }
    if case == "installation-failure":
        checks["no navigation on installation failure"] = (
            "installationError" in result and "navigate" not in record and counts["/recipe"] == 0)
    else:
        checks["filter before navigation"] = record.index("filter-installed") < record.index("navigate")
        checks["blocked non-execution"] = result.get("witness") == {"blocked": 0, "allowed": 1}
        checks["allowed reached server"] = counts["/allowed.js"] == 1
        checks["two exact refusals"] = sum(e.startswith("blocked:") for e in record) == 2
        if case != "variant":
            checks["no application API"] = result.get("applicationApiAbsent") is True
    if case in ("navigation", "popup"):
        checks["denied route never reached server"] = counts["/outside"] == counts["/popup"] == 0
    if case == "variant":
        checks["variant never reached server"] = counts["/__l5e/events.changed.js"] == 0
        checks["variant did not execute"] = result.get("variantWitness") == 0
        checks["variant requested stop"] = result.get("stopRequested") is True
    if case == "download":
        checks["native download canceled"] = "download-denied" in record
    result["checks"] = checks
    result["errors"].extend(name for name, ok in checks.items() if not ok)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--synthetic-case", choices=CASES)
    parser.add_argument("--aim-remote-once", action="store_true",
                        help="Explicit read-only populated AIM recipe; separate authorization required.")
    parser.add_argument("--smartcatalog-remote-once", action="store_true",
                        help="Explicit settings.load-only SmartCatalog recipe.")
    parser.add_argument("--vob-remote-once", action="store_true",
                        help="Explicit VOB recipe without files or native references.")
    args = parser.parse_args()
    root = prepared_root(args.root)
    remote_modes = [args.aim_remote_once, args.smartcatalog_remote_once, args.vob_remote_once]
    if any(remote_modes):
        if args.synthetic_case or sum(remote_modes) != 1:
            parser.error("Remote recipes and synthetic cases are mutually exclusive")
        if args.report.exists():
            parser.error("Remote report already exists; refusing to overwrite or repeat")
        selected = ("vob_editor" if args.vob_remote_once else
                    "smartcatalog" if args.smartcatalog_remote_once else "information_manager")
        result = run_remote_recipe(root, selected)
        args.report.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({key: result.get(key) for key in (
            "errors", "fixtureDisplayed", "calls", "manifestStart", "manifestEnd",
            "closed", "fixtureUnchanged", "usualProfilesUnchanged")}, indent=2))
        return int(bool(result["errors"]))
    if args.synthetic_case:
        result = run_case(root, args.synthetic_case)
        args.report.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return int(bool(result["errors"]))
    results = []
    for case in CASES:
        report = args.report.with_name(args.report.stem + "-" + case + ".json")
        report.unlink(missing_ok=True)
        try:
            process = subprocess.run([
                sys.executable, "-m", "application.launcher.suite_recipe_pywebview",
                "--root", str(root),
                "--report", str(report), "--synthetic-case", case,
            ], timeout=90, check=False)
        except subprocess.TimeoutExpired:
            results.append({"case": case, "errors": ["Synthetic subprocess timed out"]})
            break
        result = (json.loads(report.read_text(encoding="utf-8")) if report.is_file()
                  else {"case": case, "errors": ["Synthetic subprocess report missing"],
                        "checks": {}})
        if process.returncode:
            result["errors"].append(f"Synthetic subprocess exited {process.returncode}")
        results.append(result)
        print(json.dumps({"case": case, "errors": result["errors"],
                          "checks": result["checks"]}), flush=True)
        if result["errors"]:
            break
    args.report.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return int(any(result["errors"] for result in results))


if __name__ == "__main__":
    raise SystemExit(main())
