"""Opt-in, direct WinForms/WebView2 adapter; no pywebview bridge or fallback."""
from importlib import import_module
from importlib.util import find_spec
from collections import deque
import json
import logging
import os
from pathlib import Path
from queue import Empty, Full, Queue
import shutil
import struct
from threading import Lock, Thread, get_ident
import time
from types import MappingProxyType, SimpleNamespace
from uuid import uuid4


LOGGER = logging.getLogger(__name__)
ORIGIN = "https://rc1-control.invalid"
DOCUMENT = ORIGIN + "/protocol_control.html"
SCRIPT = ORIGIN + "/protocol_control_client.js"
CSP = ("default-src 'none'; script-src 'self'; style-src 'none'; "
       "connect-src 'none'; frame-src 'none'; child-src 'none'; "
       "object-src 'none'; worker-src 'none'; form-action 'none'; "
       "base-uri 'none'; frame-ancestors 'none'")


def control_resources():
    root = Path(__file__).resolve().parents[1] / "core" / "resources"
    resources = {}
    for uri, name, mime in (
        (DOCUMENT, "protocol_control.html", "text/html; charset=utf-8"),
        (SCRIPT, "protocol_control_client.js", "text/javascript; charset=utf-8"),
    ):
        path = root / name
        if not path.is_file():
            raise RuntimeError(f"RC1 packaged resource missing: {name}")
        resources[uri] = (path.read_bytes(), mime)
    return MappingProxyType(resources)


def load_native():
    """Check Python, managed/native DLLs and runtime separately, without installing."""
    if os.name != "nt":
        raise RuntimeError("RC1 direct WebView2 requires Windows.")
    for package in ("clr", "webview"):
        if find_spec(package) is None:
            raise RuntimeError(f"RC1 Python dependency missing: {package}; no auto-install.")
    lib = Path(find_spec("webview").origin).parent / "lib"
    architecture = "win-x64" if struct.calcsize("P") == 8 else "win-x86"
    if os.environ.get("PROCESSOR_ARCHITECTURE", "").upper() == "ARM64":
        architecture = "win-arm64"
    native = lib / "runtimes" / architecture / "native"
    for path in (lib / "Microsoft.Web.WebView2.Core.dll",
                 lib / "Microsoft.Web.WebView2.WinForms.dll", native / "WebView2Loader.dll"):
        if not path.is_file():
            raise RuntimeError(f"RC1 WebView2 assembly/loader missing: {path.name}")
    directory_handle = None
    try:
        import clr
        clr.AddReference("System.Windows.Forms")
        clr.AddReference("System.Drawing")
        clr.AddReference(str(lib / "Microsoft.Web.WebView2.Core.dll"))
        clr.AddReference(str(lib / "Microsoft.Web.WebView2.WinForms.dll"))
        # CLR namespaces are provided dynamically, not Python distribution modules.
        system = import_module("System")
        io = import_module("System.IO")
        threading = import_module("System.Threading")
        forms = import_module("System.Windows.Forms")
        core = import_module("Microsoft.Web.WebView2.Core")
        controls = import_module("Microsoft.Web.WebView2.WinForms")
        directory_handle = os.add_dll_directory(str(native))
        # pythonnet's P/Invoke resolution also searches the managed assembly folder.
        import sys
        if str(native) not in sys.path:
            sys.path.append(str(native))
        runtime = core.CoreWebView2Environment.GetAvailableBrowserVersionString(None)
        if not runtime:
            raise RuntimeError("No installed WebView2 runtime.")
        return SimpleNamespace(
            Array=system.Array, Byte=system.Byte, MemoryStream=io.MemoryStream,
            ApartmentState=threading.ApartmentState, NetThread=threading.Thread,
            ThreadStart=threading.ThreadStart,
            Application=forms.Application, DockStyle=forms.DockStyle, Form=forms.Form,
            Timer=forms.Timer, Environment=core.CoreWebView2Environment,
            PermissionState=core.CoreWebView2PermissionState,
            ResourceContext=core.CoreWebView2WebResourceContext,
            RequestSourceKinds=core.CoreWebView2WebResourceRequestSourceKinds,
            WebView2=controls.WebView2,
            directory_handle=directory_handle, runtime=str(runtime),
        )
    except Exception as exc:
        if directory_handle is not None:
            directory_handle.close()
        raise RuntimeError(
            "RC1 CLR/WebView2 runtime initialization failed; no fallback or auto-install: "
            + str(exc)
        ) from exc


class NativeControl:
    """All COM access and delivery run on the STA; worker sees only guarded data."""

    def __init__(self, app_id, context, native, resources):
        if set(resources) != {DOCUMENT, SCRIPT}:
            raise ValueError("RC1 resource allowlist must contain only the two packaged URLs.")
        self.app_id, self.context, self.n, self.resources = app_id, context, native, resources
        self.profile = Path.cwd() / ".rc1-control-profiles" / uuid4().hex
        self.owns_profile = False
        self.lock = Lock()
        self.session = None
        self.facade = None
        self.ready = False
        self.closed = False
        self.navigation_id = None
        self.navigation_pending = False
        self.tasks, self.deliveries = Queue(128), Queue(128)
        self.stop = False
        self.worker = None
        self.subscriptions = []
        self.errors = []
        self.audit = deque(maxlen=2048)
        self.form = self.view = self.core = self.environment = self.timer = None

    def record(self, label):
        # Labels only: never log envelopes, context, user paths or business data.
        self.audit.append(label)
        LOGGER.info("RC1 native: %s", label)

    def subscribe(self, obj, name, callback):
        def guarded(sender, args):
            try:
                callback(sender, args)
            except Exception as exc:
                self.fail(f"native event failed: {name} ({type(exc).__name__})")
        event = getattr(obj, name)
        event += guarded
        self.subscriptions.append((obj, name, guarded))

    def authorized(self, session):
        with self.lock:
            return not self.closed and self.ready and self.session is session

    def invalidate(self, label):
        with self.lock:
            self.ready = False
            session, self.session = self.session, None
            self.facade = None
        if session is not None:
            session.invalidate()
        self.record(label)

    def shutdown(self, label):
        self.invalidate(label)
        if self.form is not None and not self.form.IsDisposed:
            self.form.Close()

    def fail(self, label):
        self.errors.append(label)
        self.shutdown(label)

    def enqueue_delivery(self, session, value):
        try:
            self.deliveries.put_nowait((session, value))
        except Full:
            with self.lock:
                self.ready = False
            self.errors.append("delivery queue full")

    def dispatch_worker(self):
        from application.core.protocol_control import ProtocolBoundaryError
        self.worker_thread_id = get_ident()
        while not self.stop:
            try:
                session, facade, envelope = self.tasks.get(timeout=0.1)
            except Empty:
                continue
            if not self.authorized(session):
                continue
            try:
                value = facade.dispatch(envelope)
                self.enqueue_delivery(session, value)
            except ProtocolBoundaryError:
                self.record("message-rejected")
            except Exception:
                with self.lock:
                    self.ready = False
                self.errors.append("worker dispatch failed")

    def resource_requested(self, _sender, args):
        # Set a pre-created deny response before inspecting untrusted properties.
        args.Response = self.denied_response
        resource = self.resources.get(str(args.Request.Uri))
        expected = (self.n.ResourceContext.Document if str(args.Request.Uri) == DOCUMENT
                    else self.n.ResourceContext.Script)
        if (self.closed or resource is None or str(args.Request.Method) != "GET"
                or args.ResourceContext != expected):
            data, mime, status, reason = b"", "text/plain", 403, "Forbidden"
            self.record("resource-denied")
        else:
            data, mime = resource
            status, reason = 200, "OK"
        stream = self.n.MemoryStream(self.n.Array[self.n.Byte](data))
        headers = (f"Content-Type: {mime}\r\nContent-Security-Policy: {CSP}\r\n"
                   "X-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n")
        args.Response = self.environment.CreateWebResourceResponse(
            stream, status, reason, headers,
        )

    def navigation_starting(self, _sender, args):
        args.Cancel = True
        self.invalidate("document-replaced")
        self.navigation_pending = False
        if str(args.Uri) != DOCUMENT or args.IsRedirected:
            args.Cancel = True
            self.navigation_id = None
            self.record("navigation-denied")
            return
        self.navigation_id = args.NavigationId
        self.navigation_pending = True
        args.Cancel = False
        self.record("navigation-allowed")

    def navigation_completed(self, _sender, args):
        if (not args.IsSuccess or not self.navigation_pending
                or args.NavigationId != self.navigation_id
                or str(self.core.Source) != DOCUMENT or self.closed):
            self.invalidate("document-not-trusted")
            return
        self.navigation_pending = False
        from application.core.protocol_control import ControlFacade, ControlSession, bootstrap_script
        session = ControlSession(
            self.app_id, self.context, transport="webview2_post_message",
            authorize=lambda: self.authorized(session),
            emit=lambda value: self.enqueue_delivery(session, value),
        )
        with self.lock:
            self.session, self.facade, self.ready = session, ControlFacade(session), True
        self.bootstrap_task = self.core.ExecuteScriptAsync(bootstrap_script(session.descriptor()))
        self.record("bootstrap-issued")

    def message_received(self, _sender, args):
        session, facade = self.session, self.facade
        if (session is None or not self.authorized(session)
                or str(args.Source) != DOCUMENT or str(self.core.Source) != DOCUMENT
                or self.navigation_id is None):
            self.invalidate("message-source-denied")
            return
        envelope = str(args.WebMessageAsJson)
        if len(envelope.encode("utf-8")) > 16 * 1024 * 1024:
            self.record("message-rejected")
            return
        try:
            self.tasks.put_nowait((session, facade, envelope))
        except Full:
            self.invalidate("request-queue-full")

    def popup(self, _sender, args):
        args.Handled = True
        self.record("popup-denied")

    def frame(self, _sender, args):
        # Frame messages are never subscribed; even an about:blank/srcdoc frame shuts down.
        self.shutdown("frame-shutdown")

    def permission(self, _sender, args):
        args.State = self.n.PermissionState.Deny
        args.Handled = True

    def download(self, _sender, args):
        args.Cancel = True
        self.record("download-denied")

    def source_changed(self, _sender, args):
        if str(self.core.Source) != DOCUMENT or args.IsNewDocument:
            self.invalidate("source-changed")

    def unsubscribe(self, only=None):
        retained = []
        for obj, name, callback in reversed(self.subscriptions):
            if only is not None and obj is not only:
                retained.append((obj, name, callback))
                continue
            try:
                event = getattr(obj, name)
                event -= callback
            except Exception as exc:
                self.errors.append(f"event unsubscribe failed: {name} ({type(exc).__name__})")
        self.subscriptions = list(reversed(retained))

    def on_closing(self, _sender, _args):
        with self.lock:
            self.closed = True
        self.invalidate("window-closing")
        # A Form disposes child controls before Application.Run returns.
        # Detach COM event sinks while the controller is still live.
        self.unsubscribe(only=self.core)

    def install_boundary(self):
        self.core = self.view.CoreWebView2
        self.denied_response = self.environment.CreateWebResourceResponse(
            None, 403, "Forbidden",
            "Content-Type: text/plain\r\nCache-Control: no-store\r\n"
            f"Content-Security-Policy: {CSP}\r\nX-Content-Type-Options: nosniff\r\n",
        )
        settings = self.core.Settings
        settings.IsWebMessageEnabled = True
        settings.AreHostObjectsAllowed = False
        settings.AreDevToolsEnabled = False
        settings.AreDefaultContextMenusEnabled = False
        settings.AreBrowserAcceleratorKeysEnabled = False
        settings.AreDefaultScriptDialogsEnabled = False
        settings.IsStatusBarEnabled = False
        settings.IsBuiltInErrorPageEnabled = False
        settings.IsGeneralAutofillEnabled = False
        settings.IsPasswordAutosaveEnabled = False
        self.core.AddWebResourceRequestedFilter(
            "*", self.n.ResourceContext.All, self.n.RequestSourceKinds.All,
        )
        for name, handler in (
            ("WebResourceRequested", self.resource_requested),
            ("NavigationStarting", self.navigation_starting),
            ("NavigationCompleted", self.navigation_completed),
            ("SourceChanged", self.source_changed),
            ("NewWindowRequested", self.popup), ("FrameCreated", self.frame),
            ("WebMessageReceived", self.message_received),
            ("PermissionRequested", self.permission), ("DownloadStarting", self.download),
            ("ProcessFailed", lambda _s, _a: self.fail("process-failed")),
        ):
            self.subscribe(self.core, name, handler)
        self.record("boundary-installed")
        self.core.Navigate(DOCUMENT)

    def tick(self, _sender, _args):
        try:
            if not self.core:
                if time.monotonic() > self.deadline:
                    self.fail("WebView2 initialization timeout")
                    return
                if self.environment is None and self.environment_task.IsCompleted:
                    self.environment = self.environment_task.GetAwaiter().GetResult()
                    self.initialize_task = self.view.EnsureCoreWebView2Async(self.environment)
                if self.environment is not None and self.initialize_task.IsCompleted:
                    self.initialize_task.GetAwaiter().GetResult()
                    self.install_boundary()
            if self.errors:
                self.shutdown("adapter-error")
                return
            if hasattr(self, "bootstrap_task") and self.bootstrap_task.IsCompleted:
                self.bootstrap_task.GetAwaiter().GetResult()
                del self.bootstrap_task
            for _ in range(32):
                try:
                    session, value = self.deliveries.get_nowait()
                except Empty:
                    break
                if (self.authorized(session) and str(self.core.Source) == DOCUMENT
                        and self.navigation_id is not None):
                    self.core.PostWebMessageAsJson(json.dumps(value, ensure_ascii=True, allow_nan=False))
                    self.record("event-delivered" if value["kind"] == "event" else "response-delivered")
                else:
                    self.record("stale-delivery-dropped")
        except Exception as exc:
            self.fail("native initialization/delivery failed: " + str(exc))

    def on_closed(self, _sender, _args):
        with self.lock:
            self.closed = True
        self.invalidate("window-closed")

    def run_ui(self):
        self.ui_thread_id = get_ident()
        try:
            self.profile.mkdir(parents=True, exist_ok=False)
            self.owns_profile = True
            self.form, self.view = self.n.Form(), self.n.WebView2()
            self.form.Text = "Allplan - controle RC1 local (aucun service metier)"
            self.form.Width, self.form.Height = 900, 650
            self.view.Dock = self.n.DockStyle.Fill
            self.form.Controls.Add(self.view)
            self.subscribe(self.form, "FormClosing", self.on_closing)
            self.subscribe(self.form, "FormClosed", self.on_closed)
            self.environment_task = self.n.Environment.CreateAsync(None, str(self.profile), None)
            self.deadline = time.monotonic() + 30
            self.worker = Thread(target=self.dispatch_worker, name="rc1-dispatch", daemon=True)
            self.worker.start()
            self.timer = self.n.Timer()
            self.timer.Interval = 25
            self.subscribe(self.timer, "Tick", self.tick)
            self.timer.Start()
            self.n.Application.Run(self.form)
        except Exception as exc:
            self.errors.append("RC1 native window failed: " + str(exc))
        finally:
            self.dispose()

    def dispose(self):
        with self.lock:
            self.closed = True
        self.invalidate("disposed")
        self.stop = True
        if self.timer is not None:
            self.timer.Stop()
        self.unsubscribe()
        for obj in (self.view, self.form, self.timer):
            if obj is not None:
                try:
                    obj.Dispose()
                except Exception as exc:
                    self.errors.append(f"native disposal failed ({type(exc).__name__})")
        self.core = self.environment = None
        self.denied_response = None
        if self.worker:
            self.worker.join(2)
            if self.worker.is_alive():
                self.errors.append("dispatch worker did not stop within 2 seconds")
        # Delete only this instance's UUID path, never a shared/user browser profile.
        for _ in range(40 if self.owns_profile else 0):
            try:
                if self.profile.exists():
                    shutil.rmtree(self.profile)
                self.record("owned-profile-cleaned")
                break
            except OSError:
                time.sleep(0.1)
        else:
            if self.owns_profile:
                message = f"owned RC1 profile cleanup failed: {self.profile}; no process killed"
                self.errors.append(message)
                LOGGER.error("%s", message)
        if not self.owns_profile:
            return
        try:
            self.profile.parent.rmdir()
        except OSError:
            pass


def run_control_test(app_id, context):
    from application.core.protocol_control import ControlValidator
    ControlValidator()
    resources = control_resources()
    native = load_native()
    adapter = NativeControl(app_id, context, native, resources)
    thread = native.NetThread(native.ThreadStart(adapter.run_ui))
    thread.SetApartmentState(native.ApartmentState.STA)
    try:
        thread.Start()
        thread.Join()
    finally:
        native.directory_handle.close()
    if adapter.errors:
        raise RuntimeError("; ".join(adapter.errors))
