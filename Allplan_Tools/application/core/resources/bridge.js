window.__connectAllplanLauncher = (appId) => {
    let pending = null;
    let alive = true;
    const identity = (info) => {
        if (!info || typeof info !== "object" || Array.isArray(info)) {
            throw new Error("Native identity unavailable");
        }
        const hasId = Object.prototype.hasOwnProperty.call(info, "id");
        const hasAppId = Object.prototype.hasOwnProperty.call(info, "app_id");
        if ((!hasId && !hasAppId) ||
            (hasId && info.id !== appId) || (hasAppId && info.app_id !== appId)) {
            throw new Error("Native identity mismatch or missing");
        }
        return hasAppId ? info.app_id : info.id;
    };
    const connect = async () => {
        if (!alive || !window.pywebview?.api) return;
        if (pending) return pending;
        const api = window.pywebview.api;
        pending = (async () => {
            const verifiedId = identity(await api.get_app_info());
            if (!alive) return;
            if (window.allplanLauncher) {
                if (window.allplanLauncher.appId !== verifiedId) {
                    throw new Error("Launcher identity collision");
                }
                return;
            }
            const getAppInfo = async () => {
                const info = await api.get_app_info();
                identity(info);
                if (!alive) throw new Error("Launcher document closed");
                return info;
            };
            const launcher = {
                appId: verifiedId,
                getAppInfo,
                getInitialData: async () => {
                    await getAppInfo();
                    const data = await api.get_initial_data();
                    if (!alive) throw new Error("Launcher document closed");
                    return data;
                }
            };
            if (typeof api.call === "function") {
                launcher.call = async (command, payload) => {
                    const info = await getAppInfo();
                    const unavailable = info.unavailable_capabilities?.[command];
                    if (unavailable) return {ok: false, error: unavailable};
                    return api.call(command, payload);
                };
            }
            window.allplanLauncher = launcher;
            window.dispatchEvent(new CustomEvent("allplan-launcher-ready", {
                detail: { appId: verifiedId }
            }));
        })();
        return pending;
    };
    const start = () => {
        connect().catch(error => {
            console.error("Allplan launcher identity verification failed", error);
            window.dispatchEvent(new CustomEvent("allplan-launcher-error", {
                detail: { message: String(error) }
            }));
        });
    };
    window.addEventListener("pywebviewready", start, { once: true });
    window.addEventListener("pagehide", () => {
        alive = false;
        window.removeEventListener("pywebviewready", start);
    }, { once: true });
    start();
};
