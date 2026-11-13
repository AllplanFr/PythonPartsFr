"""Explicit single-window AIM recipe, pinned published resources, no general guard bypass."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import logging
import os
from pathlib import Path
from threading import Event, Lock
import time
from collections import Counter
import re
import sys
from uuid import uuid4
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from application.core.context import LaunchContext
from application.plugins.information_manager.presentation import (
    AimPresentationApp, ICON_SELECT_COMMAND, PRESENTATION_COMMANDS,
)
from application.plugins.information_manager.presentation_import import COMMANDS
from application.plugins.information_manager.project import PROJECT_COMMANDS
from application.plugins.information_manager.project_manager import MANAGER_COMMANDS, MANAGER_MENU_COMMANDS
from application.plugins.information_manager.presentation_structure import groups as presentation_groups
from application.plugins.information_manager.working import WORK_COMMANDS
from .suite_recipe_pywebview import Boundary


ORIGIN = "https://allplan-tools.lovable.app"
ROUTE = ORIGIN + "/information-manager"
CSP = (
    "default-src 'none'; script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; "
    "base-uri 'none'; form-action 'none'"
)
REVIEW_COMMANDS = (
    *PRESENTATION_COMMANDS, *PROJECT_COMMANDS, *MANAGER_COMMANDS,
    *MANAGER_MENU_COMMANDS, *WORK_COMMANDS, ICON_SELECT_COMMAND,
)
SAVE_FRONTENDS = frozenset({"aim-save-dbcef9c-accessibility-1"})
ONLINE_COMPATIBILITY = "aim-workv2-presentation-save/1"
WORKING_STATE_FRONTENDS = frozenset({
    "7767f56fec9d75300d488e543af49c8474008e01",
    "c1749a9316a08dba51f29b6426367c98053852d2",
    "f65c7bb00b8fbb89051ab367a2b34d5feb35dcb3",
    "c47028df57d956a22c0bcb5220f4d3cb81607c05",
    "3001786f16b9f1dd00489f1cea63a8014197f255",
    "81d09588e544dac971a229ea4e63d4833707eb6c",
    "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
    "6d240f64ba5dc7c25aacda2b114080225b532a11",
    "57995006e2d389734ed0b6e137e0c2f78364eb0b",
})
UPDATE_FRONTENDS = frozenset({
    "7767f56fec9d75300d488e543af49c8474008e01",
    "c1749a9316a08dba51f29b6426367c98053852d2",
    "f65c7bb00b8fbb89051ab367a2b34d5feb35dcb3",
    "c47028df57d956a22c0bcb5220f4d3cb81607c05",
    "3001786f16b9f1dd00489f1cea63a8014197f255",
    "81d09588e544dac971a229ea4e63d4833707eb6c",
    "2bd4fbbad1f9d8c2a86db515377bfb32778395de",
    "05427002aaa64bd20f72ba27afc7586cd5b177fa",
    "b00bb3bcda3b491d79188a39c34034d49b23e5bd",
    "55c7fd90966bb19978b0c24b91fc153994c96e28",
    "0a89f8150ec881d0bdb204e53841d0742643c2d3",
    "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
    "6d240f64ba5dc7c25aacda2b114080225b532a11",
    "57995006e2d389734ed0b6e137e0c2f78364eb0b",
})
TREE_FRONTENDS = frozenset({
    "7767f56fec9d75300d488e543af49c8474008e01",
    "c1749a9316a08dba51f29b6426367c98053852d2",
    "f65c7bb00b8fbb89051ab367a2b34d5feb35dcb3",
    "c47028df57d956a22c0bcb5220f4d3cb81607c05",
    "3001786f16b9f1dd00489f1cea63a8014197f255",
    "81d09588e544dac971a229ea4e63d4833707eb6c",
    "05427002aaa64bd20f72ba27afc7586cd5b177fa",
    "b00bb3bcda3b491d79188a39c34034d49b23e5bd",
    "55c7fd90966bb19978b0c24b91fc153994c96e28",
    "0a89f8150ec881d0bdb204e53841d0742643c2d3",
    "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
    "6d240f64ba5dc7c25aacda2b114080225b532a11",
    "57995006e2d389734ed0b6e137e0c2f78364eb0b",
})
MANAGER_MENU_FRONTENDS = frozenset({
    "7767f56fec9d75300d488e543af49c8474008e01",
    "c1749a9316a08dba51f29b6426367c98053852d2",
    "f65c7bb00b8fbb89051ab367a2b34d5feb35dcb3",
    "c47028df57d956a22c0bcb5220f4d3cb81607c05",
    "3001786f16b9f1dd00489f1cea63a8014197f255",
    "81d09588e544dac971a229ea4e63d4833707eb6c",
    "b00bb3bcda3b491d79188a39c34034d49b23e5bd",
    "55c7fd90966bb19978b0c24b91fc153994c96e28",
    "0a89f8150ec881d0bdb204e53841d0742643c2d3",
    "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
    "6d240f64ba5dc7c25aacda2b114080225b532a11",
    "57995006e2d389734ed0b6e137e0c2f78364eb0b",
})
PREVIEW_COLOR_FRONTENDS = frozenset({
    "7767f56fec9d75300d488e543af49c8474008e01",
    "c1749a9316a08dba51f29b6426367c98053852d2",
    "f65c7bb00b8fbb89051ab367a2b34d5feb35dcb3",
    "c47028df57d956a22c0bcb5220f4d3cb81607c05",
    "3001786f16b9f1dd00489f1cea63a8014197f255",
    "81d09588e544dac971a229ea4e63d4833707eb6c",
    "55c7fd90966bb19978b0c24b91fc153994c96e28",
    "0a89f8150ec881d0bdb204e53841d0742643c2d3",
    "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
    "6d240f64ba5dc7c25aacda2b114080225b532a11",
    "57995006e2d389734ed0b6e137e0c2f78364eb0b",
})
PROJECT_MANAGER_ASSIGNMENT_FRONTENDS = frozenset({
    "7767f56fec9d75300d488e543af49c8474008e01",
    "c1749a9316a08dba51f29b6426367c98053852d2",
    "f65c7bb00b8fbb89051ab367a2b34d5feb35dcb3",
    "c47028df57d956a22c0bcb5220f4d3cb81607c05",
    "3001786f16b9f1dd00489f1cea63a8014197f255",
    "81d09588e544dac971a229ea4e63d4833707eb6c",
    "0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65",
    "6d240f64ba5dc7c25aacda2b114080225b532a11",
    "57995006e2d389734ed0b6e137e0c2f78364eb0b",
})
PRESENTATION_EXPORT_FRONTENDS = frozenset({
    "7767f56fec9d75300d488e543af49c8474008e01",
    "c1749a9316a08dba51f29b6426367c98053852d2",
    "f65c7bb00b8fbb89051ab367a2b34d5feb35dcb3",
    "c47028df57d956a22c0bcb5220f4d3cb81607c05",
    "3001786f16b9f1dd00489f1cea63a8014197f255",
    "81d09588e544dac971a229ea4e63d4833707eb6c",
    "6d240f64ba5dc7c25aacda2b114080225b532a11",
    "57995006e2d389734ed0b6e137e0c2f78364eb0b",
})


def trace(message, *, flush=True):
    """Keep structural host events in the existing journal, not stdout."""
    logging.getLogger("application.aim.events").info(message)

DOM_OBSERVATION = """(() => {
    const root = document.querySelector('[aria-label="organized-presentation"]');
    const box = e => {
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return {width:r.width,height:r.height,top:r.top,scrollHeight:e.scrollHeight,
                clientHeight:e.clientHeight,scrollTop:e.scrollTop};
    };
    return {
        ready:document.readyState,
        organized:!!root,
        categoryButtons:root?.querySelectorAll('aside button').length ?? 0,
        groups:root?.querySelectorAll('section').length ?? 0,
        rows:root?.querySelectorAll('tr[data-row-id]').length ?? 0,
        visibleRows:root ? [...root.querySelectorAll('tr[data-row-id]')].filter(e => {
            const r = e.getBoundingClientRect();
            const p = root.lastElementChild.getBoundingClientRect();
            return r.height > 0 && r.bottom > p.top && r.top < p.bottom;
        }).length : 0,
        emptySetRows:root ? [...root.querySelectorAll('[data-value-state="set"]')]
            .filter(e=>e.textContent === '').length : 0,
        alerts:document.querySelectorAll('[role="alert"]').length,
        refreshError:[...document.querySelectorAll('[role="alert"]')]
            .some(e=>e.textContent.includes('Impossible de récupérer la présentation organisée')),
        globalDiagnostics:root?.querySelectorAll('[aria-label="global-diagnostics"] li').length ?? 0,
        diagnosticsExpanded:root?.querySelector('[aria-controls="aim-global-diagnostics"]')
            ?.getAttribute('aria-expanded') ?? null,
        diagnosticsHidden:root?.querySelector('[aria-label="global-diagnostics"]')?.hidden ?? null,
        rootBox:box(root),
        contentBox:box(root?.lastElementChild)
    };
})()"""


def python_log_diagnostic(record):
    """Do not capture formatted messages, arguments or exception values from project readers."""
    return {
        "logger": record.name, "level": record.levelname,
        "exceptionType": record.exc_info[0].__name__ if record.exc_info else None,
    }


class RecipeLogHandler(logging.Handler):
    def emit(self, record):
        trace("AIM_PYTHON_LOG " + json.dumps(python_log_diagnostic(record)), flush=True)


class AimLogSummary(logging.Handler):
    """Count safe codes, not formatted messages, paths or attribute values."""
    def __init__(self):
        super().__init__(logging.WARNING)
        self._counts = Counter()
        self._guard = Lock()

    def emit(self, record):
        code = "python_" + record.levelname.lower()
        args = record.args
        if isinstance(args, tuple):
            candidate = None
            if record.name == "application.core.allplan.models" and record.msg == (
                "Allplan reader: category=%s code=%s attribute=%s conflict=%s"
            ) and len(args) == 4:
                candidate = args[1]
            elif record.msg in ("AIM %s: %s", "AIM presentation command refused: %s") and args:
                candidate = args[0]
            if isinstance(candidate, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", candidate):
                code = candidate
        exception = record.exc_info[0].__name__ if record.exc_info else None
        with self._guard:
            self._counts[(code, record.levelname, exception)] += 1

    def flush(self):
        if not hasattr(self, "_guard"):
            return
        with self._guard:
            counts, self._counts = self._counts, Counter()
        if counts:
            trace("AIM_DIAGNOSTICS " + json.dumps({
                "pid": os.getpid(),
                "total": sum(counts.values()),
                "codes": [{"code": c, "level": level, "exceptionType": exc, "count": n}
                          for (c, level, exc), n in sorted(counts.items(), key=lambda item: item[0][0])],
            }), flush=True)


def flush_diagnostics():
    for handler in logging.getLogger().handlers:
        if isinstance(handler, AimLogSummary):
            handler.flush()


def runtime_diagnostic(parameters):
    """Keep structural stack data, never exception objects or arbitrary console values."""
    detail = parameters.get("exceptionDetails", parameters)
    exception = detail.get("exception", {})
    description = exception.get("description", "")
    first_line = description.split("\n", 1)[0]
    # Only engine-generated generic messages known not to embed field values.
    safe_message = first_line.split(";", 1)[0] if (
        first_line.startswith(("TypeError: Cannot read properties of ",
                               "TypeError: Cannot convert undefined or null to object",
                               "ReferenceError: ", "Error: Minified React error #"))
    ) else None
    frames = detail.get("stackTrace", {}).get("callFrames", [])
    return {
        "kind": exception.get("className"),
        "message": safe_message,
        "frames": [{
            "function": f.get("functionName"),
            "path": urlsplit(f.get("url", "")).path,
            "line": f.get("lineNumber"), "column": f.get("columnNumber"),
        } for f in frames],
    }


def fetch_public(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=30) as response:
        if response.geturl() != url or response.status != 200:
            raise ValueError("Published resource redirected or unavailable.")
        return response.read()


def trusted_online_url(value):
    """One explicit HTTPS document; no credentials, redirects or inferred URL."""
    if type(value) is not str or not value or value != value.strip():
        raise ValueError("Configurez AIM_ONLINE_URL avec l'URL HTTPS publiee exacte.")
    parts = urlsplit(value)
    if (parts.scheme != "https" or not parts.hostname or parts.username is not None
            or parts.password is not None or parts.query or parts.fragment
            or "\\" in value or any(char.isspace() or ord(char) < 32 for char in value)
            or parts.port not in (None, 443) or not parts.path.startswith("/")
            or not re.fullmatch(r"[a-z0-9.-]+", parts.hostname)
            or parts.netloc != parts.hostname):
        raise ValueError("URL HTTPS absolue sans identifiants, port, requete ni fragment requise.")
    return value


def compatible_online_manifest(manifest):
    return (
        type(manifest) is dict
        and manifest.get("schema") == "build-identity/1"
        and manifest.get("compatibility") == ONLINE_COMPATIBILITY
        and type(manifest.get("revision")) is str
        and re.fullmatch(r"[0-9a-f]{40}", manifest["revision"]) is not None
        and manifest.get("trackedChangesAtBuild") is False
        and type(manifest.get("files")) is list
        and bool(manifest["files"])
        and all(
            type(item) is dict and set(item) == {"file", "sha256"}
            and type(item["file"]) is str and type(item["sha256"]) is str
            and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is not None
            for item in manifest["files"]
        )
    )


def published_resources(revision, fetch=fetch_public, *, route=ROUTE):
    origin = "https://" + urlsplit(route).netloc
    manifest_url = origin + "/build-manifest.json"
    manifest = json.loads(fetch(manifest_url))
    compatible = compatible_online_manifest(manifest) if revision is None else (
        type(manifest) is dict and manifest.get("schema") == "build-identity/1"
        and manifest.get("revision") == revision
        and manifest.get("trackedChangesAtBuild") is False
    )
    if not compatible:
        raise ValueError("Published build identity changed.")
    document = fetch(route)
    resources = {route: ("text/html; charset=utf-8", document)}

    def asset(item):
        path = item["file"]
        if (not path.startswith("/assets/") or ".." in path or "?" in path
                or "#" in path or "\\" in path or not path.endswith((".js", ".css"))):
            raise ValueError("Unsupported manifest resource.")
        data = fetch(origin + path)
        if hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("Published asset integrity mismatch.")
        mime = "text/javascript" if path.endswith(".js") else "text/css"
        return origin + path, (mime, data)

    with ThreadPoolExecutor(max_workers=4) as pool:
        for url, resource in pool.map(asset, manifest["files"]):
            if url in resources:
                raise ValueError("Duplicate published resource.")
            resources[url] = resource
    aim = b"\n".join(data for url, (_, data) in resources.items()
                     if "/assets/information-manager-" in url)
    if not all(marker.encode() in aim for marker in (
        "presentation_contract", "presentation_capabilities", "aim-organized-presentation",
        *COMMANDS,
    )):
        raise ValueError("Published presentation consumer missing.")
    if json.loads(fetch(manifest_url)) != manifest:
        raise ValueError("Published build changed during preparation.")
    return manifest, resources


class PublishedBoundary(Boundary):
    """Every request is fulfilled from verified public bytes or denied locally."""
    def __init__(self, resources, *args, route=ROUTE):
        super().__init__(route, set(), *args)
        self.resources = resources

    def request(self, _sender, args):
        # Fail closed even if constructing an allowlisted response raises.
        args.Response = self.environment.CreateWebResourceResponse(
            None, 403, "Recipe denied", "Cache-Control: no-store\r\n")
        uri = str(args.Request.Uri)
        resource = self.resources.get(uri)
        is_document = args.ResourceContext == self.context.Document
        if (resource is None or str(args.Request.Method) != "GET"
                or is_document and uri != self.route):
            return
        mime, data = resource
        # MemoryStream must remain alive until WebView has consumed its response.
        native = self.native
        stream = native.MemoryStream(native.Array[native.Byte](data))
        headers = (
            f"Content-Type: {mime}\r\nCache-Control: no-store\r\n"
            "X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n"
            f"Content-Security-Policy: {CSP}\r\n"
        )
        args.Response = self.environment.CreateWebResourceResponse(stream, 200, "OK", headers)


class ReviewApi:
    """Only three functions are registered; the internal service is never exposed."""
    def __init__(self, app):
        self._app = app
        self.active = False
        self.identified = False
        self._sequence = 0

    def get_app_info(self):
        if not self.active:
            raise RuntimeError("Protected route not active.")
        self.identified = True
        return self._app.get_app_info()

    def get_initial_data(self):
        if not self.active or not self.identified:
            raise RuntimeError("Native identity must be verified first.")
        try:
            result = self._app.get_initial_data()
        finally:
            flush_diagnostics()
        trace("AIM_NATIVE_INITIAL_RETURN " + json.dumps({
            "selection": result["selection"],
            "attributes": len(result["data"]["attributes"]),
            "diagnostics": len(result["diagnostics"]),
        }), flush=True)
        return result

    def call(self, command, payload):
        if not self.active or not self.identified:
            raise RuntimeError("Native identity must be verified first.")
        save_command = (
            (command in ("project.values.save", "project.values.save.status")
             or command in ("presentation.save", "project.manager.isActive")
             and getattr(self._app, "_presentation_save", False))
            if type(command) is str and getattr(self._app, "_save_transport", None) is not None else False
        )
        if type(command) is not str or command not in REVIEW_COMMANDS and not save_command:
            return {"ok": False, "error": {
                "code": "recipe_command_refused", "message": "Commande hors recette AIM.",
            }}
        self._sequence += 1
        sequence = self._sequence
        started = time.monotonic()
        trace("AIM_NATIVE_COMMAND " + json.dumps({
            "sequence": sequence, "command": command,
        }), flush=True)
        try:
            reply = self._app.call(command, payload)
        except Exception as exc:
            trace("AIM_NATIVE_EXCEPTION " + json.dumps({
                "sequence": sequence, "command": command, "exceptionType": type(exc).__name__,
            }), flush=True)
            raise
        finally:
            flush_diagnostics()
        trace("AIM_NATIVE_REPLY " + json.dumps({
            "sequence": sequence, "elapsedMs": round((time.monotonic() - started) * 1000),
            "command": command, "ok": reply.get("ok"), "status": reply.get("status"),
            "errorCode": reply.get("error", {}).get("code"),
        }), flush=True)
        if command == "project.select" and "data" in reply:
            snapshot = reply["data"]
            trace("AIM_PROJECT_STATE " + json.dumps({
                "sequence": sequence, "selection": snapshot["selection"],
                "attributes": len(snapshot["data"]["attributes"]),
                "diagnostics": len(snapshot["diagnostics"]),
                "prjattStatus": snapshot["prjatt"]["status"],
            }), flush=True)
        if (command in PRESENTATION_COMMANDS
                and reply.get("status") in ("prepared", "applied", "current", "updated")):
            presentation = reply.get("candidate", reply.get("presentation"))
            model = presentation["model"]
            trace("AIM_PRESENTATION_COUNTS " + json.dumps({
                "status": reply["status"], "categories": len(model["categories"]),
                "groups": len(presentation_groups(model)),
                "configurationSha256": hashlib.sha256(json.dumps(
                    presentation["configuration"], sort_keys=True,
                ).encode()).hexdigest(),
                **model["counts"],
            }), flush=True)
        if command == "work.close" and reply.get("status") == "close_requested" and reply.get("ok"):
            self._app._window.destroy()
        return reply


def run(project, workspace, revision):
    manifest, resources = published_resources(revision)
    workspace.mkdir(exist_ok=False)
    data = workspace / "data"
    data.mkdir()
    app = AimPresentationApp(
        data, LaunchContext(allplan_version="2026", project_path=project),
        definition_language="fr",
    )
    initial = app.get_initial_data()
    if (initial["selection"] != "accepted" or initial["installation"]["version"] != "2026"
            or initial["prjatt"]["status"] != "read"):
        raise ValueError("Recognized Allplan 2026 project could not be loaded.")
    run_protected(app, workspace, manifest, resources, observe=True,
                  title="AIM - Recette publiee en lecture seule")


def run_protected(app, workspace, manifest, resources, *, observe=False, online_url=None,
                  title="AIM - Version locale en lecture seule"):
    """Same native boundary for verified resources, without recipe-only project requirements."""
    import webview
    from importlib import import_module
    from .protocol_control import load_native

    route = trusted_online_url(online_url) if online_url is not None else ROUTE
    if online_url is not None and not compatible_online_manifest(manifest):
        raise ValueError("Contrat de la vue en ligne incompatible.")
    if route not in resources:
        raise ValueError("Document AIM verifie absent.")
    save_profile = manifest["revision"] in SAVE_FRONTENDS or (
        online_url is not None and compatible_online_manifest(manifest)
    )
    if save_profile != (getattr(app, "_save_transport", None) is not None):
        raise ValueError("Le profil frontend et le transport WorkV2 doivent etre negocies ensemble.")

    from application.core.logging_setup import configure_logging
    configure_logging()
    native_logger = logging.getLogger("pywebview")
    for handler in native_logger.handlers[:]:
        if isinstance(handler, logging.StreamHandler) and not isinstance(handler, logging.FileHandler):
            native_logger.removeHandler(handler)
            handler.close()
    native_logger.propagate = True
    app._set_presentation_update(save_profile or manifest["revision"] in UPDATE_FRONTENDS)
    app._set_presentation_tree(save_profile or manifest["revision"] in TREE_FRONTENDS)
    app._set_project_manager_menu(save_profile or manifest["revision"] in MANAGER_MENU_FRONTENDS)
    app._set_project_manager_preview_color(save_profile or manifest["revision"] in PREVIEW_COLOR_FRONTENDS)
    app._set_project_manager_assignment(
        save_profile or manifest["revision"] in PROJECT_MANAGER_ASSIGNMENT_FRONTENDS,
    )
    app._set_working_state(save_profile or manifest["revision"] in WORKING_STATE_FRONTENDS)
    app._set_presentation_export(save_profile or manifest["revision"] in PRESENTATION_EXPORT_FRONTENDS)
    summary = AimLogSummary()
    workspace.mkdir(parents=True, exist_ok=True)
    profile = workspace / "profiles" / uuid4().hex
    profile.mkdir(parents=True, exist_ok=False)
    trace("AIM_HOST_START " + json.dumps({"pid": os.getpid(), "isolatedProfile": True}), flush=True)
    webview.settings["IGNORE_SSL_ERRORS"] = False
    api = ReviewApi(app)
    native = load_native()
    action = import_module("System").Action
    ready = Event()
    closed = Event()
    state = {"boundary": None, "failure": None}
    window = webview.create_window(
        title, html="<html><body></body></html>",
        js_api=None, width=1280, height=900,
    )
    if window is None:
        raise RuntimeError("La fenetre AIM protegee n'a pas pu etre creee.")
    app._attach_window(window)
    window.events.loaded += lambda: ready.set()

    def stop():
        app._close_session()
        api.active = False
        window.destroy()

    def closing():
        app._close_session()
        api.active = False
        closed.set()
        # Keep protections installed through disposal, not detached before navigation stops.
        resources.clear()
        trace("AIM_WINDOW_CLOSED " + json.dumps({"pid": os.getpid()}), flush=True)

    window.events.closed += closing
    window.events.closing += app._confirm_close_work

    def prepare():
        try:
            if not ready.wait(30) or window.gui.renderer != "edgechromium":
                raise RuntimeError("WebView2 bootstrap unavailable.")

            def install():
                core = window.native.webview.CoreWebView2
                core.NewWindowRequested -= window.native.browser.on_new_window_request
                boundary = PublishedBoundary(
                    resources, core.Environment, native.ResourceContext,
                    native.RequestSourceKinds, [], stop, route=route,
                )
                boundary.native = native
                boundary.install(core)
                # Replace pywebview's unfiltered receiver, not its public API/transport.
                receiver_control = window.native.webview
                original_receiver = window.native.browser.on_script_notify
                receiver_control.WebMessageReceived -= original_receiver

                def message(sender, args):
                    if (api.active and str(args.Source) == route
                            and str(core.Source) == route):
                        original_receiver(sender, args)
                    else:
                        trace("AIM_BRIDGE_MESSAGE_DENIED")

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
                    args.State = native.PermissionState.Deny
                boundary.subscribe(core, "PermissionRequested", permission)
                receiver = core.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown")

                def exception(_sender, args):
                    parameters = json.loads(str(args.ParameterObjectAsJson))
                    trace("AIM_FRONTEND_EXCEPTION " + json.dumps(
                        runtime_diagnostic(parameters)), flush=True)
                boundary.subscribe(receiver, "DevToolsProtocolEventReceived", exception)
                console = core.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled")

                def console_event(_sender, args):
                    value = json.loads(str(args.ParameterObjectAsJson))
                    if value.get("type") == "error":
                        trace("AIM_FRONTEND_CONSOLE_ERROR " + json.dumps(
                            runtime_diagnostic(value)), flush=True)
                boundary.subscribe(console, "DevToolsProtocolEventReceived", console_event)
                state["runtimeTask"] = core.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}")
                state["boundary"] = boundary

            window.native.Invoke(action(install))
            deadline = time.monotonic() + 10
            while not state["runtimeTask"].IsCompleted:
                if time.monotonic() > deadline:
                    raise RuntimeError("Runtime error observer unavailable.")
                time.sleep(0.05)
            state["runtimeTask"].GetAwaiter().GetResult()
            window.expose(api.get_app_info, api.get_initial_data, api.call)
            if set(window._functions) != {"get_app_info", "get_initial_data", "call"}:
                raise RuntimeError("Unexpected native API surface.")
            api.active = True
            ready.clear()
            window.load_url(route)
            if not ready.wait(40) or window.get_current_url() != route:
                raise RuntimeError("Published route not responsive.")
            trace(("AIM_REVIEW_READY" if observe else "AIM_HOST_READY") + " " + json.dumps({
                "pid": os.getpid(), "revision": manifest["revision"],
            }), flush=True)
            if not observe:
                return
            # Passive structure only: never serialize text/inputs or project values.
            previous = None
            while not closed.wait(1):
                counts = window.evaluate_js(DOM_OBSERVATION)
                if counts != previous:
                    trace("AIM_REVIEW_DOM " + json.dumps(counts), flush=True)
                    previous = counts
        except Exception as exc:
            state["failure"] = type(exc).__name__
            trace(("AIM_REVIEW_FAILED" if observe else "AIM_HOST_FAILED") + " " + json.dumps({
                "pid": os.getpid(), "exceptionType": state["failure"],
            }), flush=True)
            stop()

    logging.getLogger().addHandler(summary)
    try:
        webview.start(prepare, gui="edgechromium", private_mode=True,
                      storage_path=str(profile), debug=False)
    finally:
        app._close_session()
        api.active = False
        resources.clear()
        summary.flush()
        logging.getLogger().removeHandler(summary)
        summary.close()
        trace(("AIM_REVIEW_CLOSED" if observe else "AIM_HOST_RETURN") + " " + json.dumps({
            "pid": os.getpid(), "windowClosed": closed.is_set(),
            "bootstrapFailure": state["failure"],
            "hostExceptionType": sys.exc_info()[0].__name__ if sys.exc_info()[0] else None,
        }), flush=True)
    if state["failure"]:
        raise RuntimeError("Protected review failed: " + state["failure"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    run(args.project, args.workspace, args.revision)


if __name__ == "__main__":
    main()
