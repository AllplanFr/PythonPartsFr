"""Development-only bridge regression probe; run with venv\\Scripts\\python.exe.

Reuses the direct native probe's bounded STA lifecycle and unchanged control
page. Only a fake window and fake APIs receive the legacy bridge under test.
No business calls, remote pages, Explorer, or resource allowlist changes.
"""
import hashlib
import json
from pathlib import Path
import shutil
import time

from rc1_native_probe import Probe, connected, load_native, wait_js


ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "application" / "core" / "resources" / "bridge.js"

SANDBOX = r"""
(() => {
    const result = window.__legacyBridgeProbe = {
        done: false, assertions: 0, checks: [], error: null
    };
    const check = (condition, message) => {
        result.assertions++;
        if (!condition) throw new Error(message);
    };
    const flush = async () => {
        for (let i = 0; i < 16; i++) await Promise.resolve();
    };
    const deferred = () => {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        return {promise, resolve, reject};
    };
    const install = new Function("window", "CustomEvent", "console", __BRIDGE__);
    const make = (appId, answer, existing) => {
        const listeners = new Map();
        const events = [], errors = [], calls = {info: 0, initial: 0, call: 0};
        let getInfo = answer;
        const fake = {
            addEventListener(type, callback, options) {
                if (!listeners.has(type)) listeners.set(type, []);
                listeners.get(type).push({callback, once: Boolean(options?.once)});
            },
            removeEventListener(type, callback) {
                listeners.set(type, (listeners.get(type) || [])
                    .filter(item => item.callback !== callback));
            },
            dispatchEvent(event) {
                events.push(event);
                for (const item of [...(listeners.get(event.type) || [])]) {
                    if (item.once) fake.removeEventListener(event.type, item.callback);
                    item.callback(event);
                }
                return true;
            },
            pywebview: {api: {
                async get_app_info() { calls.info++; return getInfo(); },
                async get_initial_data() { calls.initial++; return {fake: "initial"}; },
                async call(command, payload) { calls.call++; return {command, payload}; }
            }}
        };
        if (existing !== undefined) fake.allplanLauncher = existing;
        install(fake, class {
            constructor(type, options) { this.type = type; this.detail = options?.detail; }
        }, {error: (...args) => errors.push(args.map(String))});
        const count = type => events.filter(event => event.type === type).length;
        const emit = type => fake.dispatchEvent({type});
        return {fake, calls, events, errors, count, emit,
            start: () => fake.__connectAllplanLauncher(appId),
            info: callback => { getInfo = callback; }};
    };
    const reject = async (operation, message) => {
        let error;
        try { await operation(); } catch (caught) { error = caught; }
        check(error instanceof Error && error.message.includes(message),
            "Expected explicit rejection: " + message);
    };
    (async () => {
        for (const appId of ["smartcatalog", "vob_editor", "information_manager"]) {
            for (const field of ["id", "app_id", "both"]) {
                const info = field === "both" ? {id: appId, app_id: appId} : {[field]: appId};
                const pending = deferred();
                const s = make(appId, () => pending.promise);
                let published = false;
                s.fake.addEventListener("allplan-launcher-ready", event => {
                    published = s.fake.allplanLauncher?.appId === appId &&
                        event.detail.appId === appId;
                });
                s.start();
                s.emit("pywebviewready");
                s.emit("pywebviewready");
                await flush();
                check(s.calls.info === 1, "Duplicate initialization while pending");
                check(s.fake.allplanLauncher === undefined, "Launcher published before identity");
                check(s.count("allplan-launcher-ready") === 0, "Ready before identity");
                check(s.calls.initial === 0 && s.calls.call === 0, "Business API before identity");
                pending.resolve(info);
                await flush();
                check(published, "Identity must be published before ready event");
                check(s.count("allplan-launcher-ready") === 1, "Expected one ready event");
                s.emit("pywebviewready");
                await flush();
                check(s.calls.info === 1, "Duplicate ready reinitialized bridge");
                check(s.count("allplan-launcher-ready") === 1, "Duplicate ready published twice");

                const initialIdentity = deferred();
                s.info(() => initialIdentity.promise);
                const initial = s.fake.allplanLauncher.getInitialData();
                await flush();
                check(s.calls.initial === 0, "getInitialData did not wait for identity");
                initialIdentity.resolve(info);
                check((await initial).fake === "initial" && s.calls.initial === 1,
                    "getInitialData did not resume after verified identity");
                s.info(() => info);
                const response = await s.fake.allplanLauncher.call("fake.command", {fake: true});
                check(response.command === "fake.command" && response.payload.fake &&
                    s.calls.call === 1, "Verified mock call did not preserve arguments");
                check(s.errors.length === 0, "Unexpected valid-identity error");
                result.checks.push(appId + ":" + field + ":delayed-identity-ready-once-initial-call");
            }

            const wrong = appId === "smartcatalog" ? "vob_editor" : "smartcatalog";
            const invalid = [
                null, [], {}, {id: wrong}, {app_id: wrong},
                {id: appId, app_id: wrong}, {id: wrong, app_id: appId},
                {id: null}, {app_id: 42}, {id: appId.toUpperCase()},
                {app_id: appId + " "}, {id: appId, app_id: null}
            ];
            for (let index = 0; index < invalid.length; index++) {
                const s = make(appId, () => invalid[index]);
                s.start();
                await flush();
                check(s.fake.allplanLauncher === undefined, "Invalid identity published launcher");
                check(s.count("allplan-launcher-ready") === 0, "Invalid identity emitted ready");
                check(s.calls.initial === 0 && s.calls.call === 0, "Invalid identity used API");
                check(s.count("allplan-launcher-error") === 1 &&
                    s.events.find(e => e.type === "allplan-launcher-error")
                        .detail.message.includes("Native identity"), "Missing explicit identity error");
                check(s.errors.length === 1 &&
                    s.errors[0][0].includes("identity verification failed"), "Missing console error");
                result.checks.push(appId + ":invalid-" + index + ":no-launcher-ready-or-api");
            }
            const s = make(appId, () => ({id: appId}));
            s.start();
            await flush();
            for (const info of invalid) {
                s.info(() => info);
                await reject(() => s.fake.allplanLauncher.getInitialData(), "Native identity");
                await reject(() => s.fake.allplanLauncher.call("fake.command", {}), "Native identity");
                check(s.calls.initial === 0 && s.calls.call === 0,
                    "Changed identity reached initial/call API");
            }
            result.checks.push(appId + ":changed-invalid-identity-blocks-initial-and-call");

            const existing = {appId, sentinel: {untouched: true}};
            const preserved = make(appId, () => ({app_id: appId}), existing);
            preserved.start();
            await flush();
            check(preserved.fake.allplanLauncher === existing, "Existing launcher replaced");
            check(Object.keys(existing).join(",") === "appId,sentinel" &&
                existing.sentinel.untouched, "Existing launcher mutated");
            check(preserved.count("allplan-launcher-ready") === 0 &&
                preserved.errors.length === 0, "Existing launcher initialized again");
            const conflict = {appId: wrong, sentinel: true};
            const collision = make(appId, () => ({id: appId}), conflict);
            collision.start();
            await flush();
            check(collision.fake.allplanLauncher === conflict &&
                Object.keys(conflict).join(",") === "appId,sentinel", "Conflicting launcher overwritten");
            check(collision.count("allplan-launcher-ready") === 0 &&
                collision.calls.initial === 0 && collision.calls.call === 0,
                "Collision emitted ready or called API");
            check(collision.count("allplan-launcher-error") === 1 &&
                collision.errors[0]?.[1].includes("Launcher identity collision"),
                "Collision error not explicit");
            result.checks.push(appId + ":preexisting-launcher-preserved-and-conflict-rejected");

            const gate = deferred();
            const closed = make(appId, () => gate.promise);
            closed.start();
            closed.emit("pagehide");
            closed.emit("pywebviewready");
            gate.resolve({id: appId});
            await flush();
            check(closed.fake.allplanLauncher === undefined &&
                closed.count("allplan-launcher-ready") === 0, "Pagehide published stale launcher");
            check(closed.calls.info === 1 && closed.calls.initial === 0 &&
                closed.calls.call === 0, "Pagehide permitted initialization/API");
            result.checks.push(appId + ":pagehide-pending-no-ready-or-launcher");

            const unavailable = make(appId, () => Promise.reject(new Error("fake native failure")));
            unavailable.start();
            await flush();
            check(unavailable.count("allplan-launcher-error") === 1 &&
                unavailable.errors[0]?.[1].includes("fake native failure"),
                "Native rejection not explicit");
            check(!unavailable.fake.allplanLauncher && unavailable.calls.initial === 0 &&
                unavailable.calls.call === 0, "Native rejection published or called API");
            result.checks.push(appId + ":native-error-explicit");
        }
        result.done = true;
    })().catch(error => { result.error = String(error.stack || error); result.done = true; });
    return true;
})()
"""


def regression(probe):
    yield from connected()
    probe.checks.append("existing-native-control-connection")
    assert (yield "typeof window.pywebview === 'undefined' && "
                  "typeof window.allplanLauncher === 'undefined'")
    source = BRIDGE.read_text(encoding="utf-8")
    probe.bridge_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
    assert (yield SANDBOX.replace("__BRIDGE__", json.dumps(source)))
    result = yield from wait_js(
        "window.__legacyBridgeProbe", lambda value: isinstance(value, dict) and value.get("done"),
    )
    probe.result = result
    assert result["error"] is None, result["error"]
    assert len(result["checks"]) == 57, result
    assert (yield "typeof window.pywebview === 'undefined' && "
                  "typeof window.allplanLauncher === 'undefined'")
    probe.checks.append("real-page-legacy-globals-untouched")
    probe.shutdown("legacy-bridge-probe-complete")


def main():
    try:
        native = load_native()
    except Exception as exc:
        print(json.dumps({"status": "NATIVE UNAVAILABLE", "error": str(exc)}), flush=True)
        return 2
    probe = Probe(native, regression)
    try:
        thread = native.NetThread(native.ThreadStart(probe.run_ui))
        thread.SetApartmentState(native.ApartmentState.STA)
        thread.Start()
        thread.Join()
        # WebView2 may release its owned profile shortly after the STA exits.
        cleanup_retried = probe.owns_profile and probe.profile.exists()
        deadline = time.monotonic() + 10
        while probe.owns_profile and probe.profile.exists() and time.monotonic() < deadline:
            try:
                shutil.rmtree(probe.profile)
            except OSError:
                time.sleep(0.1)
        if cleanup_retried and not probe.profile.exists():
            prefix = f"owned RC1 profile cleanup failed: {probe.profile};"
            probe.errors = [error for error in probe.errors if not error.startswith(prefix)]
            probe.record("owned-profile-cleaned-after-STA")
            try:
                probe.profile.parent.rmdir()
            except OSError:
                pass
        cleanup = {
            "profile_removed": not probe.profile.exists(),
            "worker_stopped": not probe.worker or not probe.worker.is_alive(),
        }
        passed = (not probe.errors and all(cleanup.values())
                  and hasattr(probe, "result") and probe.result["error"] is None)
        print(json.dumps({
            "status": "NATIVE PASS" if passed else "NATIVE FAIL",
            "runtime": native.runtime,
            "seconds": round(time.monotonic() - probe.started, 2),
            "bridge_sha256": getattr(probe, "bridge_sha256", None),
            "sandbox": getattr(probe, "result", None),
            "checks": probe.checks, "errors": probe.errors, "audit": list(probe.audit),
            "cleanup_retried_after_STA": cleanup_retried,
            **cleanup,
        }), flush=True)
        return 0 if passed else 1
    finally:
        native.directory_handle.close()


if __name__ == "__main__":
    raise SystemExit(main())
