"""Verified online VOB resources and a confined pywebview host."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import logging
import os
import re
import sys
from threading import Event
from urllib.request import Request, urlopen

from application.core.resources import PACKAGE_ROOT, resource_path
from .protocol_control import load_native
from .suite_recipe_pywebview import Boundary


ORIGIN = "https://allplan-tools.lovable.app"
ROUTE = ORIGIN + "/vob-editor"
COMPATIBILITY = "vob-editor-host/1"
VOB_FRONTEND_MARKERS = (b"vob_editor", b"vob.open", b"vob.save", b"vob.backups.restore")
CSP = (
    "default-src 'none'; script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; "
    "base-uri 'none'; form-action 'none'"
)


def fetch_public(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=30) as response:
        if response.geturl() != url or response.status != 200:
            raise ValueError("Published resource redirected or unavailable.")
        return response.read()


def compatible_online_manifest(manifest):
    return (
        type(manifest) is dict
        and manifest.get("schema") == "build-identity/1"
        and manifest.get("vobEditorCompatibility") == COMPATIBILITY
        and type(manifest.get("revision")) is str
        and re.fullmatch(r"[0-9a-f]{40}", manifest["revision"]) is not None
        and manifest.get("revisionStatus") == "git-rev-parse-HEAD"
        and manifest.get("trackedChangesAtBuild") is False
        and type(manifest.get("builtAt")) is str
        and bool(manifest["builtAt"])
        and type(manifest.get("files")) is list
        and bool(manifest["files"])
        and all(
            type(item) is dict
            and set(item) == {"file", "kind", "sha256"}
            and type(item["file"]) is str
            and item.get("kind") in ("entry", "chunk", "dynamic-chunk", "asset")
            and type(item["sha256"]) is str
            and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is not None
            for item in manifest["files"]
        )
    )


def _asset_path(value):
    if (not value.startswith("/assets/") or "\\" in value or "?" in value or "#" in value
            or "%" in value or any(part in ("", ".", "..") for part in value.split("/")[1:])):
        raise ValueError("Unsupported manifest resource.")
    if not value.endswith((".js", ".mjs", ".css")):
        raise ValueError("Unsupported manifest resource.")
    return value


def published_resources(fetch=fetch_public, *, route=ROUTE):
    if route != ROUTE:
        raise ValueError("VOB online route is not trusted.")
    manifest_url = ORIGIN + "/build-manifest.json"
    manifest = json.loads(fetch(manifest_url))
    if not compatible_online_manifest(manifest):
        raise ValueError("Published VOB build identity is incompatible.")

    files = {}
    for item in manifest["files"]:
        path = _asset_path(item["file"])
        if path in files:
            raise ValueError("Duplicate published resource.")
        files[path] = item
    javascript = [path for path in files if path.endswith((".js", ".mjs"))]
    if not javascript:
        raise ValueError("Published VOB JavaScript bundle is missing.")

    document = fetch(route)
    if not re.search(rb"<html(?:\s|>)", document, re.IGNORECASE):
        raise ValueError("Published VOB document is invalid.")
    resources = {route: ("text/html; charset=utf-8", document)}

    def asset(path):
        data = fetch(ORIGIN + path)
        if hashlib.sha256(data).hexdigest() != files[path]["sha256"]:
            raise ValueError("Published asset integrity mismatch.")
        mime = "text/css" if path.endswith(".css") else "text/javascript"
        return ORIGIN + path, (mime, data)

    with ThreadPoolExecutor(max_workers=4) as pool:
        for url, resource in pool.map(asset, files):
            resources[url] = resource

    bundle = b"\n".join(resources[ORIGIN + path][1] for path in javascript)
    if not all(marker in bundle for marker in VOB_FRONTEND_MARKERS):
        raise ValueError("Published VOB frontend contract is missing.")

    for reference in re.findall(rb"""(?:src|href)\s*=\s*["']([^"']+)""", document, re.IGNORECASE):
        try:
            value = reference.decode("ascii")
        except UnicodeDecodeError:
            continue
        if value.startswith("/assets/"):
            path = _asset_path(value)
            if ORIGIN + path not in resources:
                raise ValueError("Published document references an unverified asset.")

    if json.loads(fetch(manifest_url)) != manifest:
        raise ValueError("Published VOB build changed during preparation.")
    return manifest, resources


class VobPublishedBoundary(Boundary):
    """Only serve bytes whose URLs and fingerprints came from the verified manifest."""

    def __init__(self, resources, *args):
        super().__init__(ROUTE, set(), *args)
        self.resources = resources
        self.native = None

    def request(self, _sender, args):
        args.Response = self.environment.CreateWebResourceResponse(
            None, 403, "VOB resource denied", "Cache-Control: no-store\r\n",
        )
        uri = str(args.Request.Uri)
        resource = self.resources.get(uri)
        if (resource is None or str(args.Request.Method) != "GET"
                or getattr(args, "ResourceContext", None) == self.context.Document
                and uri != ROUTE):
            return
        mime, data = resource
        stream = self.native.MemoryStream(self.native.Array[self.native.Byte](data))
        headers = (
            f"Content-Type: {mime}\r\nCache-Control: no-store\r\n"
            "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n"
            f"Content-Security-Policy: {CSP}\r\n"
        )
        args.Response = self.environment.CreateWebResourceResponse(stream, 200, "OK", headers)


class VobProtectedApi:
    """Expose the existing VOB contract only after same-window identity verification."""

    def __init__(self, app):
        self._app = app
        self.active = False
        self.identified = False

    def get_app_info(self):
        if not self.active:
            raise RuntimeError("Protected VOB route not active.")
        info = self._app.get_app_info()
        if (type(info) is not dict
                or info.get("app_id", info.get("id")) != "vob_editor"
                or type(info.get("app_id", info.get("id"))) is not str
                or ("id" in info and "app_id" in info and info["id"] != info["app_id"])):
            raise RuntimeError("VOB host identity mismatch.")
        self.identified = True
        return info

    def get_initial_data(self):
        if not self.active or not self.identified:
            raise RuntimeError("VOB identity must be verified first.")
        logging.getLogger(__name__).info(
            "Protected VOB host dispatched get_initial_data to %s",
            type(self._app).__name__,
        )
        return self._app.get_initial_data()

    def call(self, command, payload):
        if not self.active or not self.identified:
            raise RuntimeError("VOB identity must be verified first.")
        return self._app.call(command, payload)


def run_protected(app, workspace, profile, *, route=ROUTE, coordinated_revision=None):
    import webview
    from importlib import import_module

    _manifest, resources = published_resources(route=route)
    if coordinated_revision is not None:
        if (not isinstance(coordinated_revision, str)
                or re.fullmatch(r"[0-9a-f]{40}", coordinated_revision) is None
                or _manifest["revision"] != coordinated_revision):
            raise ValueError("Coordinated VOB publication revision not verified.")
    common = resource_path(PACKAGE_ROOT / "core", "resources\\bridge.js")
    specific = resource_path(PACKAGE_ROOT / "plugins" / "vob_editor", app.script_name)
    scripts = common.read_text(encoding="utf-8") + "\n" + specific.read_text(encoding="utf-8")
    workspace.mkdir(parents=True, exist_ok=True)
    profile.mkdir(parents=True, exist_ok=True)

    from application.core.logging_setup import configure_logging
    configure_logging()
    from application.core.logging_setup import session_log_path
    logging.getLogger(__name__).info(
        "Protected VOB process identity: pid=%d executable=%r launcher_module=%r "
        "application_module=%r app_type=%s session_log=%r",
        os.getpid(), sys.executable, __file__,
        getattr(sys.modules.get(type(app).__module__), "__file__", None),
        type(app).__name__, session_log_path(),
    )
    app._initial_preferences()
    webview.settings["IGNORE_SSL_ERRORS"] = False
    api = VobProtectedApi(app)
    native = load_native()
    action = import_module("System").Action
    bootstrap_ready = Event()
    route_ready = Event()
    state = {"failure": None}
    window = webview.create_window(
        title=app.title, html="<html><body></body></html>", js_api=None,
        width=1280, height=850, min_size=(800, 600),
    )
    if window is None:
        raise RuntimeError("The protected VOB window could not be created.")
    app._attach_window(window)
    window.events.loaded += lambda: bootstrap_ready.set()
    if hasattr(app, "_close"):
        window.events.closed += app._close

    coordinator = None
    if coordinated_revision is not None:
        from application.plugins.vob_editor.coordinated_host import prepare_coordinated_host
        coordinator = prepare_coordinated_host(
            app, window, identified=lambda: api.active and api.identified,
            schedule_close=lambda close: window.native.BeginInvoke(action(close)),
        )

    def stop():
        if coordinator is not None:
            coordinator.abort_startup()
        api.active = False
        api.identified = False
        window.destroy()

    def on_loaded():
        if window.get_current_url() != route:
            bootstrap_ready.set()
            return
        try:
            window.evaluate_js(scripts)
            if hasattr(app, "_on_loaded"):
                app._on_loaded(window)
            route_ready.set()
        except Exception as exc:
            state["failure"] = type(exc).__name__
            route_ready.set()
            stop()

    window.events.loaded += on_loaded

    def prepare():
        try:
            if not bootstrap_ready.wait(30) or window.gui.renderer != "edgechromium":
                raise RuntimeError("WebView2 bootstrap unavailable.")

            def install():
                core = window.native.webview.CoreWebView2
                core.NewWindowRequested -= window.native.browser.on_new_window_request
                boundary = VobPublishedBoundary(
                    resources, core.Environment, native.ResourceContext,
                    native.RequestSourceKinds, [], stop,
                )
                boundary.native = native
                boundary.install(core)

                receiver_control = window.native.webview
                original_receiver = window.native.browser.on_script_notify
                receiver_control.WebMessageReceived -= original_receiver

                def message(sender, args):
                    if (api.active and str(args.Source) == route
                            and str(core.Source) == route):
                        original_receiver(sender, args)

                boundary.subscribe(receiver_control, "WebMessageReceived", message)

                def source_changed(_sender, _args):
                    if str(core.Source) != route:
                        api.active = False
                        api.identified = False

                def frame_navigation(_sender, args):
                    args.Cancel = True

                boundary.subscribe(core, "SourceChanged", source_changed)
                boundary.subscribe(core, "FrameNavigationStarting", frame_navigation)
                core.Settings.AreDevToolsEnabled = False
                core.Settings.AreDefaultContextMenusEnabled = False
                core.Settings.IsPasswordAutosaveEnabled = False
                core.Settings.IsGeneralAutofillEnabled = False

                def permission(_sender, args):
                    from application.core.windows_ui import clipboard_request_allowed

                    args.State = (
                        native.PermissionState.Allow
                        if clipboard_request_allowed(
                            str(args.Uri), ROUTE, str(args.PermissionKind),
                        )
                        else native.PermissionState.Deny
                    )

                boundary.subscribe(core, "PermissionRequested", permission)

            window.native.Invoke(action(install))
            window.expose(api.get_app_info, api.get_initial_data, api.call)
            if set(window._functions) != {"get_app_info", "get_initial_data", "call"}:
                raise RuntimeError("Unexpected VOB native API surface.")
            api.active = True
            window.load_url(route)
            if not route_ready.wait(40) or window.get_current_url() != route:
                raise RuntimeError("Published VOB route not responsive.")
        except Exception as exc:
            state["failure"] = type(exc).__name__
            logging.getLogger(__name__).error(
                "Protected VOB startup failed: %s", state["failure"],
            )
            stop()

    try:
        webview.start(
            prepare, gui="edgechromium", private_mode=True,
            storage_path=str(profile), debug=False,
        )
    finally:
        api.active = False
        if coordinator is not None:
            coordinator.closed()
        resources.clear()
    if state["failure"]:
        raise RuntimeError("Protected VOB startup failed: " + state["failure"])


def run(app, workspace, profile, *, coordinated_revision=None):
    return run_protected(
        app, workspace, profile, coordinated_revision=coordinated_revision,
    )
