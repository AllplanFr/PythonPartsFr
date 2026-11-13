(() => {
    "use strict";
    const state = document.getElementById("state");
    const output = document.getElementById("result");
    let descriptor = null;
    let handshake = null;
    let alive = true;
    let connected = false;
    const seenEvents = new Set();
    const pending = new Map();
    function failure(error) {
        state.textContent = String(error);
    }
    function receive(message) {
        if (!alive || !descriptor || message.session_id !== descriptor.session_id) {
            throw new Error("RC1 session mismatch");
        }
        if (message.app_id !== descriptor.app_id || message.protocol_version !== "2.0") {
            throw new Error("RC1 identity mismatch");
        }
        if (message.kind === "event") {
            if (!connected || message.event !== "diagnostic.state" ||
                typeof message.payload?.enabled !== "boolean") {
                throw new Error("Unexpected RC1 event");
            }
            if (seenEvents.has(message.event_id)) return;
            seenEvents.add(message.event_id);
            output.textContent = JSON.stringify(message, null, 2);
            return;
        }
        const request = pending.get(message.request_id);
        if (!request || message.kind !== "response" ||
            message.command !== request.command || message.context_id !== null ||
            message.generation !== null ||
            !["success", "error", "cancelled"].includes(message.status)) {
            throw new Error("Unexpected RC1 response");
        }
        pending.delete(message.request_id);
        if (message.status !== "success") {
            request.reject(new Error(message.error?.message || message.status));
        } else {
            request.resolve(message.result);
        }
    }
    async function call(command, payload = {}) {
        if (!alive || (!connected && command !== "host.handshake")) {
            throw new Error("RC1 handshake required");
        }
        const request = {
            protocol_version: "2.0", kind: "request", session_id: descriptor.session_id,
            request_id: crypto.randomUUID(), app_id: descriptor.app_id,
            command, context_id: null, generation: null, payload
        };
        let timeout;
        try {
            const result = await new Promise((resolve, reject) => {
                pending.set(request.request_id, {command, resolve, reject});
                timeout = setTimeout(() => {
                    pending.delete(request.request_id);
                    reject(new Error("RC1 timeout"));
                }, 15000);
                window.chrome.webview.postMessage(request);
            });
            output.textContent = JSON.stringify(result, null, 2);
            return result;
        } finally {
            clearTimeout(timeout);
            pending.delete(request.request_id);
        }
    }
    function connect() {
        if (!alive || handshake) return handshake;
        const host = window.__allplanProtocolHost;
        if (!host) return;
        if (host.mode !== "protocol" || host.transport !== "webview2_post_message" ||
            host.contract_release !== "2.0.0-rc.1" || !host.protocol_versions.includes("2.0")) {
            failure("RC1 bootstrap incompatible");
            return;
        }
        descriptor = host;
        handshake = call("host.handshake", {
            supported_versions: ["2.0"], client_version: "0.1.0",
            contract_release: "2.0.0-rc.1"
        }).then(result => {
            if (result.session_id !== host.session_id || result.app_id !== host.app_id) {
                throw new Error("RC1 handshake identity mismatch");
            }
            connected = true;
            state.textContent = "Controle RC1 connecte ; aucun service metier.";
            document.querySelectorAll("button").forEach(button => { button.disabled = false; });
        }).catch(failure);
        return handshake;
    }
    if (Object.prototype.hasOwnProperty.call(window, "__allplanProtocolClient")) {
        failure("RC1 receiver collision");
        return;
    }
    const receiver = Object.freeze({receive_message: receive});
    Object.defineProperty(window, "__allplanProtocolClient", {
        value: receiver, writable: false, configurable: true
    });
    window.chrome.webview.addEventListener("message", event => {
        try { receive(event.data); } catch (error) { failure(error); }
    });
    window.addEventListener("allplan-protocol-host-ready", connect);
    const commands = {
        capabilities: ["host.capabilities", {}], context: ["host.context", {}],
        get: ["diagnostic.get", {}], on: ["diagnostic.set", {enabled: true}],
        off: ["diagnostic.set", {enabled: false}], logs: ["diagnostic.open_logs", {}]
    };
    for (const [id, [command, payload]] of Object.entries(commands)) {
        document.getElementById(id).onclick = () => call(command, payload).catch(failure);
    }
    window.addEventListener("pagehide", () => {
        alive = false;
        connected = false;
        for (const request of pending.values()) request.reject(new Error("RC1 page closed"));
        pending.clear();
        seenEvents.clear();
        window.removeEventListener("allplan-protocol-host-ready", connect);
        if (window.__allplanProtocolClient === receiver) delete window.__allplanProtocolClient;
    }, {once: true});
    connect();
})();
