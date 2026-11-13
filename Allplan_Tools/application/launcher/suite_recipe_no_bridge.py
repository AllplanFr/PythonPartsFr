"""Explicit development recipe only: direct WebView2, no native application API."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread
import time
from urllib.parse import urlsplit


ORIGIN = "https://allplan-smartcatalog-editor.lovable.app"
BLOCKED = frozenset((
    ORIGIN + "/~flock.js",
    ORIGIN + "/__l5e/events.b21a279f52bb8621.js",
))
REVISION = "cdc777cb45fb61662b0a0026194ec6a016f61470"
AIM_FIX_REVISION = "87ac9002b4e87ef1cd2fd556defccdbbb7ea4c41"
ROUTES = ("/smartcatalog", "/vob-editor", "/information-manager")
PROFILES = ("smartcatalog", "vob_editor", "information_manager\\absent")

REJECTION_OBSERVER = r"""
(() => {
    const observations = [];
    Object.defineProperty(window, '__recipeRejections', {value: observations});
    window.addEventListener('unhandledrejection', event => {
        const reason = event.reason;
        const record = {type: typeof reason, at: performance.now()};
        if (typeof reason === 'string') record.message = reason.slice(0, 2000);
        if (reason !== null && (typeof reason === 'object' || typeof reason === 'function')) {
            // Read only fixed own data descriptors, never getters or nested objects.
            for (const key of ['name', 'message', 'stack', 'code',
                               'remoteObjectId', 'methodName', 'callId']) {
                const descriptor = Object.getOwnPropertyDescriptor(reason, key);
                if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
                const value = descriptor.value;
                if (typeof value === 'string') record[key] = value.slice(0, 4000);
                else if (typeof value === 'number' || typeof value === 'boolean')
                    record[key] = value;
            }
        }
        observations.push(record);
    });
})();
"""


def diagnostic_stack(value, depth=0):
    if not value or depth >= 8:
        return None
    return {
        "description": value.get("description"),
        "callFrames": [
            {key: frame.get(key) for key in
             ("functionName", "url", "lineNumber", "columnNumber")}
            for frame in value.get("callFrames", [])[:40]
        ],
        "parent": diagnostic_stack(value.get("parent"), depth + 1),
    }


def install_filter(core, context, sources, handler):
    """Must complete synchronously before the caller can navigate."""
    core.Settings.AreHostObjectsAllowed = False
    core.Settings.IsWebMessageEnabled = False
    core.AddWebResourceRequestedFilter("*", context.All, sources.All)
    core.WebResourceRequested += handler


def install_then_navigate(core, context, sources, handler, url):
    install_filter(core, context, sources, handler)
    core.Navigate(url)


def is_variant(url):
    parsed = urlsplit(url)
    return (
        parsed.netloc == urlsplit(ORIGIN).netloc
        and (parsed.path.startswith("/~flock")
             or parsed.path.startswith("/__l5e/events"))
        and url not in BLOCKED
    )


def check_manifest(value, expected_revision=REVISION):
    if (value.get("revision") != expected_revision
            or value.get("revisionStatus") != "git-rev-parse-HEAD"
            or value.get("trackedChangesAtBuild") is not False
            or not value.get("builtAt")):
        raise RuntimeError("Published manifest identity mismatch: " + json.dumps(value))
    return {key: value[key] for key in ("revision", "builtAt")}


def check_asset(manifest, url, body):
    path = urlsplit(url).path
    entries = [entry for entry in manifest["files"] if entry["file"] == path]
    if not url.startswith(ORIGIN + "/") or len(entries) != 1:
        raise RuntimeError("Loaded JS/CSS not uniquely covered by manifest: " + url)
    digest = hashlib.sha256(body).hexdigest()
    if entries[0]["sha256"] != digest:
        raise RuntimeError("Served resource SHA256 mismatch: " + url)
    return {"url": url, "sha256": digest, "bytes": len(body)}


class RecipeWindow:
    def __init__(self, native, profile, url, blocked, synthetic=False, diagnostic=False):
        self.n = native
        self.profile, self.url, self.blocked = profile, url, blocked
        self.synthetic = synthetic
        self.diagnostic = diagnostic
        self.result = {"url": url, "blocked": [], "responses": [],
                       "errors": [], "runtimeErrors": [], "events": []}
        self.core = None
        self.done = False
        self.phase = "initialize"
        self.task = None
        self.subscriptions = []
        self.deadline = time.monotonic() + 90

    def subscribe(self, obj, name, handler):
        event = getattr(obj, name)
        event += handler
        self.subscriptions.append((obj, name, handler))

    def fail(self, message):
        self.result["errors"].append(message)
        self.form.Close()

    def request(self, _sender, args):
        url = str(args.Request.Uri)
        if url in self.blocked:
            args.Response = self.environment.CreateWebResourceResponse(
                None, 403, "Recipe blocked",
                "Content-Type: text/plain\r\nCache-Control: no-store\r\n",
            )
            self.result["blocked"].append(url)
        elif not self.synthetic and is_variant(url):
            # No substitute URL is added to the filter.
            self.fail("Hosting script variant observed: " + url)

    def response(self, _sender, args):
        url = str(args.Request.Uri)
        status = int(args.Response.StatusCode)
        self.result["responses"].append({"url": url, "status": status})
        if url == self.url and status != 200:
            self.fail(f"Document HTTP {status}: {url}")

    def navigation(self, _sender, args):
        if str(args.Uri) != self.url:
            args.Cancel = True
            self.fail("Unexpected navigation: " + str(args.Uri))

    def completed(self, _sender, args):
        if not args.IsSuccess:
            self.fail("Navigation failed: " + str(args.WebErrorStatus))
        else:
            self.ready_at = time.monotonic()

    def runtime_error(self, _sender, args):
        value = json.loads(str(args.ParameterObjectAsJson))
        if self.diagnostic:
            detail = value.get("exceptionDetails", {})
            exception = detail.get("exception", {})
            value = {
                "text": detail.get("text"), "url": detail.get("url"),
                "lineNumber": detail.get("lineNumber"),
                "columnNumber": detail.get("columnNumber"),
                "className": exception.get("className"),
                "stackTrace": diagnostic_stack(detail.get("stackTrace")),
            }
        self.result["runtimeErrors"].append(value)

    def console_error(self, _sender, args):
        value = json.loads(str(args.ParameterObjectAsJson))
        arguments = value.get("args", [])
        if (value.get("type") == "error" and arguments
                and arguments[0].get("value") == "\u00c9chec de l'envoi vers Allplan :"):
            self.result.setdefault("sendErrors", []).append({
                "message": arguments[0]["value"],
                "stackTrace": diagnostic_stack(value.get("stackTrace")),
            })

    def navigate(self):
        self.result["events"].append("navigate")
        self.core.Navigate(self.url)
        self.phase = "loading"

    def evaluate(self, code, next_phase):
        self.task = self.core.ExecuteScriptAsync(code)
        self.phase = next_phase

    def tick(self, _sender, _args):
        try:
            if time.monotonic() > self.deadline:
                raise RuntimeError("Recipe timeout in phase " + self.phase)
            if self.phase == "initialize" and self.environment_task.IsCompleted:
                self.environment = self.environment_task.GetAwaiter().GetResult()
                self.task = self.view.EnsureCoreWebView2Async(self.environment)
                self.phase = "core"
            elif self.phase == "core" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                self.core = self.view.CoreWebView2
                self.core.Settings.AreDevToolsEnabled = False
                self.core.Settings.IsGeneralAutofillEnabled = False
                self.core.Settings.IsPasswordAutosaveEnabled = False
                self.subscribe(self.core, "WebResourceResponseReceived", self.response)
                self.subscribe(self.core, "NavigationStarting", self.navigation)
                self.subscribe(self.core, "NavigationCompleted", self.completed)
                self.subscribe(self.core, "NewWindowRequested", self.popup)
                self.subscribe(self.core, "DownloadStarting", self.download)
                self.subscribe(self.core, "PermissionRequested", self.permission)
                self.receiver = self.core.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown")
                self.subscribe(self.receiver, "DevToolsProtocolEventReceived", self.runtime_error)
                self.task = self.core.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}")
                self.phase = "filter"
            elif self.phase == "filter" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                install_filter(self.core, self.n.ResourceContext,
                               self.n.RequestSourceKinds, self.request)
                self.subscriptions.append((self.core, "WebResourceRequested", self.request))
                self.result["events"].append("filter-installed")
                if self.core.Settings.AreHostObjectsAllowed or self.core.Settings.IsWebMessageEnabled:
                    raise RuntimeError("Native access was not disabled")
                self.result["nativeAccessDisabled"] = True
                if self.diagnostic:
                    self.console_receiver = self.core.GetDevToolsProtocolEventReceiver(
                        "Runtime.consoleAPICalled")
                    self.subscribe(self.console_receiver, "DevToolsProtocolEventReceived",
                                   self.console_error)
                    self.task = self.core.CallDevToolsProtocolMethodAsync("Debugger.enable", "{}")
                    self.phase = "debug-enabled"
                else:
                    self.navigate()
            elif self.phase == "debug-enabled" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                self.task = self.core.CallDevToolsProtocolMethodAsync(
                    "Debugger.setAsyncCallStackDepth", '{"maxDepth":32}')
                self.phase = "async-enabled"
            elif self.phase == "async-enabled" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                self.task = self.core.AddScriptToExecuteOnDocumentCreatedAsync(REJECTION_OBSERVER)
                self.phase = "observer-installed"
            elif self.phase == "observer-installed" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                self.result["events"].append("passive-observer-and-async-stacks-installed")
                self.navigate()
            elif self.phase == "loading" and hasattr(self, "ready_at"):
                if time.monotonic() - self.ready_at < (2 if self.synthetic else 15):
                    return
                if self.diagnostic:
                    self.evaluate("""JSON.stringify({
                        rejections: window.__recipeRejections,
                        webviewPresent: Boolean(window.chrome && window.chrome.webview),
                        bridgeAbsent: typeof window.pywebview === 'undefined'
                          && typeof window.allplanLauncher === 'undefined'
                          && typeof window.__allplanProtocolHost === 'undefined'
                    })""", "snapshot")
                    return
                self.evaluate("""JSON.stringify({
                    title: document.title, text: document.body.innerText,
                    scripts: [...document.scripts].map(s => s.src).filter(Boolean),
                    resources: performance.getEntriesByType('resource').map(r => r.name),
                    witness: window.recipeWitness || null,
                    bridgeAbsent: typeof window.pywebview === 'undefined'
                      && typeof window.allplanLauncher === 'undefined'
                      && typeof window.__allplanProtocolHost === 'undefined'
                })""", "snapshot")
            elif self.phase == "snapshot" and self.task.IsCompleted:
                self.result["page"] = json.loads(json.loads(str(self.task.GetAwaiter().GetResult())))
                if not self.result["page"]["bridgeAbsent"]:
                    raise RuntimeError("Unexpected bridge global")
                if self.synthetic:
                    self.done = True
                    self.form.Close()
                else:
                    # Poll a JS promise from native; no JS-to-native messaging.
                    self.evaluate("""(() => {
                        window.recipeManifest = null;
                        fetch('/build-manifest.json', {cache:'no-store'})
                          .then(async r => {if (!r.ok) throw Error('HTTP '+r.status);
                            return r.json();})
                          .then(value => window.recipeManifest = {value})
                          .catch(e => window.recipeManifest = {error:String(e)});
                    })()""", "fetch-started")
            elif self.phase == "fetch-started" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                self.evaluate("JSON.stringify(window.recipeManifest)", "manifest")
            elif self.phase == "manifest" and self.task.IsCompleted:
                value = json.loads(json.loads(str(self.task.GetAwaiter().GetResult())))
                if value is None:
                    self.evaluate("JSON.stringify(window.recipeManifest)", "manifest")
                    return
                if "error" in value:
                    raise RuntimeError("Manifest unavailable: " + value["error"])
                self.result["manifest"] = check_manifest(value["value"])
                self.done = True
                self.form.Close()
        except Exception as exc:
            self.fail(f"{type(exc).__name__}: {exc}")

    def popup(self, _sender, args):
        args.Handled = True
        self.fail("Popup requested")

    def download(self, _sender, args):
        args.Cancel = True
        self.fail("Download requested")

    def permission(self, _sender, args):
        args.State = self.n.PermissionState.Deny

    def closing(self, _sender, _args):
        self.timer.Stop()
        for obj, name, handler in reversed(self.subscriptions):
            event = getattr(obj, name)
            event -= handler
        self.subscriptions.clear()

    def run(self):
        try:
            self.form, self.view = self.n.Form(), self.n.WebView2()
            self.form.Text = "Allplan recipe - NO BRIDGE"
            self.form.Width, self.form.Height = 1280, 850
            self.view.Dock = self.n.DockStyle.Fill
            self.form.Controls.Add(self.view)
            self.timer = self.n.Timer()
            self.timer.Interval = 50
            self.timer.Tick += self.tick
            self.form.FormClosing += self.closing
            self.environment_task = self.n.Environment.CreateAsync(None, str(self.profile), None)
            self.timer.Start()
            self.n.Application.Run(self.form)
            if not self.done and not self.result["errors"]:
                self.result["errors"].append("Window closed before verification completed")
        except Exception as exc:
            self.result["errors"].append(f"{type(exc).__name__}: {exc}")
        finally:
            for name in ("timer", "view", "form"):
                obj = getattr(self, name, None)
                if obj is not None:
                    obj.Dispose()


class AimFixVerification(RecipeWindow):
    """One AIM navigation, bookended manifests and passive native observations."""
    def __init__(self, native, profile):
        super().__init__(native, profile, ORIGIN + "/build-manifest.json",
                         BLOCKED, diagnostic=True)
        self.content_tasks = []
        self.sources = {}
        self.result["assets"] = []
        self.result["startedAt"] = datetime.now(timezone.utc).isoformat()

    def response(self, sender, args):
        super().response(sender, args)
        url = str(args.Request.Uri)
        if url not in BLOCKED and urlsplit(url).path.endswith((".js", ".css")):
            if int(args.Response.StatusCode) != 200:
                self.fail("Application resource HTTP error: " + url)
                return
            self.content_tasks.append((url, args.Response.GetContentAsync()))

    def navigate(self):
        # Precise coverage observes execution without replacing the proxy or postMessage.
        self.task = self.core.CallDevToolsProtocolMethodAsync("Profiler.enable", "{}")
        self.phase = "verify-profiler"

    def collect_bodies(self):
        pending = []
        for url, task in self.content_tasks:
            if not task.IsCompleted:
                pending.append((url, task))
                continue
            stream = task.GetAwaiter().GetResult()
            if stream is None:
                raise RuntimeError("Served response body unavailable: " + url)
            memory = self.n.MemoryStream()
            try:
                stream.CopyTo(memory)
                body = bytes(memory.ToArray())
            finally:
                memory.Dispose()
                stream.Dispose()
            self.result["assets"].append(check_asset(self.manifest, url, body))
            if urlsplit(url).path.endswith(".js"):
                self.sources[url] = body.decode("utf-8")
        self.content_tasks = pending

    def begin_aim(self):
        self.url = ORIGIN + "/information-manager"
        self.result["url"] = self.url
        del self.ready_at
        self.result["events"].append("aim-navigate-once")
        self.core.Navigate(self.url)
        self.phase = "verify-aim-loading"

    def tick(self, sender, args):
        if not self.phase.startswith("verify-"):
            return super().tick(sender, args)
        try:
            if time.monotonic() > self.deadline:
                raise RuntimeError("AIM verification timeout: " + self.phase)
            if hasattr(self, "manifest"):
                self.collect_bodies()
            if self.phase == "verify-profiler" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                self.task = self.core.CallDevToolsProtocolMethodAsync(
                    "Profiler.startPreciseCoverage", '{"callCount":true,"detailed":true}')
                self.phase = "verify-coverage-started"
            elif self.phase == "verify-coverage-started" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                self.result["events"].append("coverage-installed")
                self.result["events"].append("manifest-start-navigate")
                self.core.Navigate(self.url)
                self.phase = "verify-start-loading"
            elif self.phase == "verify-start-loading" and hasattr(self, "ready_at"):
                self.evaluate("document.body.innerText", "verify-start-manifest")
            elif self.phase == "verify-start-manifest" and self.task.IsCompleted:
                text = json.loads(str(self.task.GetAwaiter().GetResult()))
                self.manifest = json.loads(text)
                self.result["manifestStart"] = check_manifest(self.manifest, AIM_FIX_REVISION)
                self.result["manifestStart"]["observedAt"] = datetime.now(timezone.utc).isoformat()
                self.begin_aim()
            elif self.phase == "verify-aim-loading" and hasattr(self, "ready_at"):
                if time.monotonic() - self.ready_at < 15 or self.content_tasks:
                    return
                self.evaluate("""JSON.stringify({
                    text: document.body.innerText,
                    rejections: window.__recipeRejections,
                    resources: performance.getEntriesByType('resource').map(r => r.name),
                    legacyGlobalsAbsent: typeof window.loadPresentation === 'undefined'
                      && typeof window.setProjectName === 'undefined',
                    bridgeAbsent: typeof window.pywebview === 'undefined'
                      && typeof window.allplanLauncher === 'undefined'
                      && typeof window.__allplanProtocolHost === 'undefined'
                })""", "verify-page")
            elif self.phase == "verify-page" and self.task.IsCompleted:
                page = json.loads(json.loads(str(self.task.GetAwaiter().GetResult())))
                self.result["page"] = page
                if (not page["bridgeAbsent"] or not page["legacyGlobalsAbsent"]
                        or page["rejections"] or self.result["runtimeErrors"]
                        or self.result.get("sendErrors")):
                    raise RuntimeError("Unexpected AIM bridge activity or rejection")
                if ("indisponible dans cette fen\u00eatre" not in page["text"]
                        or "passerelle attendue" not in page["text"]):
                    raise RuntimeError("Explicit no-adapter guard missing")
                if set(self.result["blocked"]) != BLOCKED:
                    raise RuntimeError("Expected script refusals missing")
                loaded = {u for u in page["resources"]
                          if urlsplit(u).path.endswith((".js", ".css")) and u not in BLOCKED}
                verified = {item["url"] for item in self.result["assets"]}
                if not loaded or not loaded <= verified:
                    raise RuntimeError("Loaded JS/CSS missing response-body verification")
                self.task = self.core.CallDevToolsProtocolMethodAsync(
                    "Profiler.takePreciseCoverage", "{}")
                self.phase = "verify-coverage"
            elif self.phase == "verify-coverage" and self.task.IsCompleted:
                coverage = json.loads(str(self.task.GetAwaiter().GetResult()))
                matches = []
                for script in coverage["result"]:
                    source = self.sources.get(script["url"])
                    if source is None:
                        continue
                    for function in script["functions"]:
                        span = function["ranges"][0]
                        # V8 coverage offsets count UTF-16 units, not Python codepoints.
                        code = source.encode("utf-16-le")[
                            span["startOffset"] * 2:span["endOffset"] * 2
                        ].decode("utf-16-le")
                        if ("SendToHost" in code and "JSON.stringify" in code
                                and len(code) < 1800):
                            matches.append({"url": script["url"],
                                            "function": function["functionName"],
                                            "calls": span["count"]})
                self.result["sendToHostCoverage"] = matches
                if not matches:
                    self.result.setdefault("observationLimits", []).append(
                        "sendToHost not identifiable in V8 coverage; "
                        "absence of ready/proxy access is not instrumentally established")
                elif any(item["calls"] != 0 for item in matches):
                    self.result["errors"].append("sendToHost execution observed in coverage")
                self.fetch_final_manifest()
            elif self.phase == "verify-end-fetch" and self.task.IsCompleted:
                self.task.GetAwaiter().GetResult()
                self.evaluate("JSON.stringify(window.recipeManifest)", "verify-end-manifest")
            elif self.phase == "verify-end-manifest" and self.task.IsCompleted:
                value = json.loads(json.loads(str(self.task.GetAwaiter().GetResult())))
                if value is None:
                    self.evaluate("JSON.stringify(window.recipeManifest)", "verify-end-manifest")
                    return
                if "error" in value:
                    raise RuntimeError("Final manifest unavailable: " + value["error"])
                identity = check_manifest(value["value"], AIM_FIX_REVISION)
                self.result["manifestEnd"] = identity | {
                    "observedAt": datetime.now(timezone.utc).isoformat()}
                if any(identity[key] != self.result["manifestStart"][key] for key in identity):
                    raise RuntimeError("Build changed during AIM verification")
                self.collect_bodies()
                if self.content_tasks:
                    raise RuntimeError("Response body verification incomplete")
                self.result["trackedChangesAtBuild"] = False
                self.result["revisionStatus"] = value["value"]["revisionStatus"]
                self.done = True
                self.form.Close()
        except Exception as exc:
            self.fail(f"{type(exc).__name__}: {exc}")

    def fetch_final_manifest(self):
        self.result["events"].append("final-manifest-attempt")
        self.evaluate("""(() => {
            window.recipeManifest = null;
            fetch('/build-manifest.json', {cache:'no-store'})
              .then(async r => {if (!r.ok) throw Error('HTTP '+r.status);
                return r.json();})
              .then(value => window.recipeManifest = {value})
              .catch(e => window.recipeManifest = {error:String(e)});
        })()""", "verify-end-fetch")


class AimGuardComplement(AimFixVerification):
    """Only manifests and one AIM guard observation; no coverage or asset replay."""
    def response(self, sender, args):
        RecipeWindow.response(self, sender, args)

    def collect_bodies(self):
        pass

    def navigate(self):
        self.result["events"].append("manifest-start-navigate")
        self.core.Navigate(self.url)
        self.phase = "verify-start-loading"

    def tick(self, sender, args):
        try:
            if self.phase == "verify-page" and self.task.IsCompleted:
                page = json.loads(json.loads(str(self.task.GetAwaiter().GetResult())))
                self.result["page"] = page
                self.result["guardDisplayed"] = (
                    "indisponible dans cette fen\u00eatre" in page["text"]
                    and "passerelle attendue" in page["text"])
                for condition, message in (
                    (not page["bridgeAbsent"], "Unexpected bridge global"),
                    (not page["legacyGlobalsAbsent"], "Unexpected legacy globals"),
                    (bool(page["rejections"]), "Unhandled rejection observed"),
                    (bool(self.result["runtimeErrors"]), "Runtime exception observed"),
                    (bool(self.result.get("sendErrors")), "Allplan send error observed"),
                    (not self.result["guardDisplayed"], "Explicit no-adapter guard missing"),
                    (set(self.result["blocked"]) != BLOCKED, "Expected script refusals missing"),
                ):
                    if condition:
                        self.result["errors"].append(message)
                self.result["observationLimits"] = [
                    "No runtime proof of zero ready/proxy access: "
                    "source/tests and the displayed gate support non-mounting, "
                    "not a per-call instrumentation result.",
                    "Resource hashes not repeated in this complementary observation.",
                ]
                self.fetch_final_manifest()
                return
            super().tick(sender, args)
        except Exception as exc:
            self.fail(f"{type(exc).__name__}: {exc}")


def run_window(native, profile, url, blocked=BLOCKED, synthetic=False, diagnostic=False,
               verify_aim_fix=False, guard_complement=False):
    if not profile.is_dir():
        raise RuntimeError("Prepared profile missing: " + str(profile))
    if guard_complement:
        window = AimGuardComplement(native, profile)
    elif verify_aim_fix:
        window = AimFixVerification(native, profile)
    else:
        window = RecipeWindow(native, profile, url, blocked, synthetic, diagnostic)
    thread = native.NetThread(native.ThreadStart(window.run))
    thread.SetApartmentState(native.ApartmentState.STA)
    thread.Start()
    thread.Join()
    return window.result


def synthetic(native, profile):
    counts = Counter()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            counts[self.path] += 1
            if self.path == "/":
                body = (f"<script>window.recipeWitness={{blocked:0,allowed:0}}</script>"
                        f'<script src="{base}/blocked-a.js"></script>'
                        f'<script src="{base}/blocked-b.js"></script>'
                        f'<script src="{base}/allowed.js"></script>').encode()
                mime = "text/html"
            else:
                field = "allowed" if self.path == "/allowed.js" else "blocked"
                body = f"window.recipeWitness.{field}++;".encode()
                mime = "text/javascript"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    base = f"http://127.0.0.1:{server.server_port}"
    targets = frozenset((base + "/blocked-a.js", base + "/blocked-b.js"))
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        result = run_window(native, profile, base + "/", targets, synthetic=True)
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
    result["serverCounts"] = dict(counts)
    if (not result["errors"] and (
            set(result["blocked"]) != targets
            or result["page"]["witness"] != {"blocked": 0, "allowed": 1}
            or counts["/blocked-a.js"] or counts["/blocked-b.js"]
            or counts["/allowed.js"] != 1)):
        result["errors"].append("Synthetic execution/server witness mismatch")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=(
        "synthetic", "published", "aim-diagnostic", "aim-fix-verification",
        "aim-guard-complement"), required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    if root.name != "native-suite-recipe-20261026":
        parser.error("Only the prepared isolated recipe root is accepted")
    from .protocol_control import load_native
    native = load_native()  # Dependencies only; no NativeControl instance.
    results = []
    try:
        if args.stage == "synthetic":
            results.append(synthetic(native, root / PROFILES[0] / "profile"))
        elif args.stage == "aim-diagnostic":
            result = run_window(native, root / PROFILES[2] / "profile",
                                ORIGIN + ROUTES[2], diagnostic=True)
            results.append(result)
            if not result["errors"] and set(result["blocked"]) != BLOCKED:
                result["errors"].append("Expected local script refusals missing")
        elif args.stage == "aim-fix-verification":
            results.append(run_window(native, root / PROFILES[2] / "profile",
                                      ORIGIN + ROUTES[2], verify_aim_fix=True))
        elif args.stage == "aim-guard-complement":
            results.append(run_window(native, root / PROFILES[2] / "profile",
                                      ORIGIN + ROUTES[2], guard_complement=True))
        else:
            identity = None
            # Manifest documents bookend the three route observations.
            visits = [(PROFILES[0], "/build-manifest.json")]
            visits += list(zip(PROFILES, ROUTES))
            visits += [(PROFILES[0], "/build-manifest.json")]
            for profile, route in visits:
                result = run_window(native, root / profile / "profile", ORIGIN + route)
                results.append(result)
                if result["errors"]:
                    break
                current = result["manifest"]
                if identity is None:
                    identity = current
                if current != identity:
                    result["errors"].append("Build changed during verification")
                    break
                if route in ROUTES:
                    page = result["page"]
                    if (set(result["blocked"]) != BLOCKED
                            or not any("/assets/" in url and url.endswith(".js")
                                       for url in page["resources"])
                            or len(page["text"].strip()) < 40):
                        result["errors"].append("Route/filter/module evidence incomplete")
                        break
    finally:
        native.directory_handle.close()
        args.report.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps([{"url": r["url"], "errors": r["errors"],
                       "blocked": r["blocked"], "manifest": r.get("manifest")}
                      for r in results], indent=2))
    return int(any(r["errors"] for r in results))


if __name__ == "__main__":
    raise SystemExit(main())
