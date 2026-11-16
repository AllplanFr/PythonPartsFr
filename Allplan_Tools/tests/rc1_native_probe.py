"""Explicit developer-only native probe. Not a launcher option or packaged module.

Run with the project's Windows venv. No external server, extra resources,
business context, log-directory opening, global process termination or installs.
"""
import json
import os
from pathlib import Path
import sys
import time


ROOT = Path(os.environ.get("ALLPLAN_RC1_PROBE_PACKAGE_ROOT", Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(ROOT))

from application.core.context import LaunchContext
from application.core import logging_setup
from application.core.protocol_control import ProtocolBoundaryError
from application.launcher.protocol_control import (
    DOCUMENT, NativeControl, control_resources, load_native,
)
from application.launcher import protocol_control as native_module

assert Path(native_module.__file__).resolve().is_relative_to(ROOT.resolve())


def wait_js(script, predicate=lambda value: value is True):
    while True:
        value = yield script
        if predicate(value):
            return value


def connected():
    return wait_js("Boolean(document.getElementById('get') && "
                   "!document.getElementById('get').disabled && "
                   "window.__allplanProtocolHost)")


def click_result(button, predicate):
    yield f"document.getElementById('result').textContent=''; document.getElementById('{button}').click(); true"
    return (yield from wait_js(
        "(() => {try{return JSON.parse(document.getElementById('result').textContent)}"
        "catch(e){return null}})()", predicate,
    ))


def normal(probe):
    yield from connected()
    host = yield "window.__allplanProtocolHost"
    assert host["transport"] == "webview2_post_message"
    assert host["contract_release"] == "2.0.0-rc.1"
    assert (yield "typeof window.pywebview === 'undefined' && typeof window.allplanHost === 'undefined'")
    probe.checks.append("actual-JS-bootstrap-handshake-no-alias")
    value = yield from click_result("capabilities", lambda v: isinstance(v, dict) and "capabilities" in v)
    assert len(value["capabilities"]) == 6
    value = yield from click_result("context", lambda v: isinstance(v, dict) and "context" in v)
    assert value["context"]["paths"] == {} and value["context"]["project_path"] is None
    yield from click_result("get", lambda v: isinstance(v, dict) and "enabled" in v)
    yield ("window.__rc1Events=[]; chrome.webview.addEventListener('message', e=>{"
           "if(e.data.kind==='event')window.__rc1Events.push(e.data)}); true")
    for button, expected in (("off", False), ("on", True), ("off", False)):
        value = yield from click_result(button, lambda v: isinstance(v, dict) and "enabled" in v)
        assert value["enabled"] is expected
        assert logging_setup.diagnostic_enabled() is expected
    events = yield "window.__rc1Events"
    assert [e["payload"]["enabled"] for e in events] == [False, True, False]
    probe.checks.append("five-commands-real-dispatch-and-diagnostic-events")
    assert probe.ui_thread_id != probe.worker_thread_id
    probe.checks.append("separate-worker-dispatch-and-STA-delivery")
    before = probe.audit.count("message-rejected")
    yield ("""(() => {
      const h=window.__allplanProtocolHost;
      const base={protocol_version:"2.0",kind:"request",session_id:h.session_id,
        app_id:h.app_id,request_id:"probe-reject",command:"diagnostic.get",
        context_id:null,generation:null,payload:{}};
      for (const changes of [
        {command:"vob.save"},{command:"operation.status"},{session_id:"stale"},
        {app_id:"vob_editor"},{command:"diagnostic.set",payload:{enabled:"true"}},
        {extra:true}
      ]) chrome.webview.postMessage({...base,...changes});
      chrome.webview.postMessage('{"a":1,"a":2}');
      return true;
    })()""")
    while probe.audit.count("message-rejected") < before + 7:
        yield "true"
    assert logging_setup.diagnostic_enabled() is False
    probe.checks.append("seven-native-to-Python-boundary-rejections-no-effects")
    denied = probe.audit.count("resource-denied")
    yield ("""(() => {for(const src of [
      '/not-allowed.js','/protocol_control_client.js?attack=1'
    ]) {const s=document.createElement('script');s.src=src;document.head.append(s)}
    return true})()""")
    while probe.audit.count("resource-denied") < denied + 2:
        yield "true"
    assert probe.authorized(probe.session)
    probe.checks.append("two-same-origin-unknown-resources-403")
    # CSP disallows fetch, workers, forms and external scripts before network.
    value = yield ("""(() => {
      window.__csp={fetch:false,worker:false};
      fetch('/not-allowed').catch(()=>window.__csp.fetch=true);
      try{new Worker('/not-allowed.js')}catch(e){window.__csp.worker=true}
      return true;
    })()""")
    yield from wait_js("window.__csp.fetch")
    probe.checks.append("CSP-connect-src-none-real-JS")
    popups = probe.audit.count("popup-denied")
    yield "window.open('https://rc1-control.invalid/popup'); true"
    while probe.audit.count("popup-denied") == popups:
        yield "true"
    probe.checks.append("native-popup-handled-no-external-open")
    old = probe.session
    old_id = old.descriptor()["session_id"]
    probe.core.Navigate(DOCUMENT + "?denied=1")
    while "navigation-denied" not in probe.audit:
        yield "true"
    assert probe.session is None
    try:
        old.dispatch({})
        raise AssertionError("Old session unexpectedly active")
    except ProtocolBoundaryError:
        pass
    probe.checks.append("exact-target-navigation-denied-old-session-invalid")
    probe.core.Navigate(DOCUMENT)
    # Wait on the Python identity too, because the denied document remains visible.
    while probe.session is None or probe.session.descriptor()["session_id"] == old_id:
        yield "true"
    yield from connected()
    new_id = yield "window.__allplanProtocolHost.session_id"
    assert new_id != old_id
    probe.checks.append("reload-new-native-and-JS-session")
    for uri in ("https://rc1-denied.invalid/foreign", "file:///C:/rc1-test-denied.html",
                "data:text/html,RC1-denied"):
        previous = probe.audit.count("navigation-denied")
        probe.core.Navigate(uri)
        while probe.audit.count("navigation-denied") == previous:
            yield "true"
        assert probe.session is None
        probe.core.Navigate(DOCUMENT)
        while probe.session is None:
            yield "true"
        yield from connected()
    probe.checks.append("HTTPS-file-data-navigation-denied-before-load")
    probe.shutdown("probe-normal-complete")


def frame(probe):
    yield from connected()
    probe.old_session = probe.session
    yield ("(() => {const f=document.createElement('iframe');"
           "f.srcdoc='<script>parent.chrome.webview.postMessage({attack:true})<\\/script>';"
           "document.body.append(f);return true})()")
    # The FrameCreated safety net closes even a blocked/empty/srcdoc frame.
    while not probe.closed:
        yield "true"


def crash(probe):
    yield from connected()
    probe.old_session = probe.session
    # Target only this instance's renderer, using its own native debugging API.
    probe.crash_task = probe.core.CallDevToolsProtocolMethodAsync("Page.crash", "{}")
    while not probe.closed:
        yield "true"


def redirect(probe):
    yield from connected()
    old = probe.session
    probe.redirect_next = True
    probe.core.Reload()
    while "navigation-denied" not in probe.audit:
        yield "true"
    assert probe.session is None and not probe.authorized(old)
    assert "controlled-302-same-target" in probe.audit
    probe.checks.append("native-synthetic-302-exact-target-redirect-denied")
    probe.shutdown("probe-redirect-complete")


class Probe(NativeControl):
    def __init__(self, n, scenario):
        super().__init__("information_manager", LaunchContext(), n, control_resources())
        self.checks = []
        self.scenario = scenario
        self.steps = scenario(self)
        self.script_task = None
        self.started = time.monotonic()
        self.finished = False
        self.old_session = None

    def tick(self, sender, args):
        super().tick(sender, args)
        if self.closed or self.form.IsDisposed:
            return
        if time.monotonic() - self.started > 45:
            self.fail("probe timeout: " + self.scenario.__name__)
            return
        if self.core is None or not self.ready:
            # Navigation tests must progress while temporarily invalidated.
            if self.core is None or self.script_task is None:
                return
        try:
            if self.script_task is None:
                script = next(self.steps)
            elif not self.script_task.IsCompleted:
                return
            else:
                text = str(self.script_task.GetAwaiter().GetResult())
                script = self.steps.send(json.loads(text))
            if not self.closed:
                self.script_task = self.core.ExecuteScriptAsync(script)
        except StopIteration:
            self.finished = True
            if not self.closed:
                self.shutdown("probe-complete")
        except Exception as exc:
            self.fail("probe assertion: " + repr(exc))


class RedirectProbe(Probe):
    """One controlled 302 on an already allowlisted URL; never add a resource.

    This override exists only in the explicit development script, not the wheel
    or launcher. The production navigation/resource guards remain installed.
    """
    redirect_next = False

    def resource_requested(self, sender, args):
        super().resource_requested(sender, args)
        if (self.redirect_next and str(args.Request.Uri) == DOCUMENT
                and str(args.Request.Method) == "GET"
                and args.ResourceContext == self.n.ResourceContext.Document):
            self.redirect_next = False
            args.Response = self.environment.CreateWebResourceResponse(
                None, 302, "Found", "Location: " + DOCUMENT + "\r\nCache-Control: no-store\r\n",
            )
            self.record("controlled-302-same-target")


def main():
    n = load_native()
    initial = logging_setup.diagnostic_enabled()
    results = []
    try:
        for scenario in (normal, frame, crash, redirect):
            probe_type = RedirectProbe if scenario is redirect else Probe
            probe = probe_type(n, scenario)
            thread = n.NetThread(n.ThreadStart(probe.run_ui))
            thread.SetApartmentState(n.ApartmentState.STA)
            thread.Start()
            thread.Join()
            if scenario is frame:
                assert "frame-shutdown" in probe.audit, probe.audit
                assert not probe.authorized(probe.old_session)
                probe.checks.append("native-srcdoc-frame-safety-shutdown")
            if scenario is crash:
                assert "process-failed" in probe.audit, probe.audit
                assert not probe.authorized(probe.old_session)
                # Expected native failure is the subject of this scenario.
                probe.errors = [e for e in probe.errors if e != "process-failed"]
                probe.checks.append("actual-renderer-ProcessFailed-invalidates-and-closes")
            assert not probe.profile.exists(), "Owned profile cleanup failed"
            assert not probe.worker or not probe.worker.is_alive(), "Worker leaked"
            result = {
                "scenario": scenario.__name__, "runtime": n.runtime,
                "from_extracted_wheel": bool(os.environ.get("ALLPLAN_RC1_PROBE_PACKAGE_ROOT")),
                "seconds": round(time.monotonic() - probe.started, 2),
                "checks": probe.checks, "audit": list(probe.audit), "errors": probe.errors,
                "profile_removed": not probe.profile.exists(),
                "worker_stopped": not probe.worker or not probe.worker.is_alive(),
            }
            results.append(result)
            print(json.dumps(result), flush=True)
            if probe.errors:
                return 1
    finally:
        logging_setup.set_diagnostic(initial)
        n.directory_handle.close()
    print("NATIVE PASS: 4 bounded isolated windows; diagnostic.open_logs NOT EXECUTED", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
