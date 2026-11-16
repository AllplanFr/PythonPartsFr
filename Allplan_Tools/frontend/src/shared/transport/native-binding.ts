/**
 * Native window binding: which application a native window belongs to and which
 * legacy adapter a module may start. Sharing one origin never grants another
 * module's capabilities, and navigation never changes the bound app_id.
 *
 * Sequence (shared by every module):
 *   1. no native binding            -> browser mode (every module, no transport);
 *   2. binding present              -> waiting_identity;
 *   3. only get_app_info is called; BaseApp `id` / BridgeApp `app_id` are normalised;
 *   4. identity must equal the module -> verified, then the module mounts and may ask
 *      for its initial data. Error, missing identity or mismatch -> blocked, never a
 *      silent browser fallback.
 * These frontend guards are not a native revocation of js_api.
 * Installs nothing on the launcher objects and sends nothing else.
 */
import type { LegacyTransport, SuiteAppId } from "@/suite/catalog";

export type NativeBinding =
  | { kind: "browser" }
  | { kind: "pywebview"; appId: string | null }
  | { kind: "webview2" };

type InfoFn = () => Promise<unknown> | unknown;
export type BindingWindow = {
  pywebview?: { api?: { get_app_info?: InfoFn; get_initial_data?: InfoFn; call?: unknown } };
  allplanLauncher?: { appId?: unknown; getAppInfo?: InfoFn; getInitialData?: InfoFn };
  chrome?: { webview?: unknown };
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
};

const currentWindow = () => (typeof window === "undefined" ? undefined : (window as unknown as BindingWindow));

export function detectNativeBinding(win: BindingWindow | undefined = currentWindow()): NativeBinding {
  if (!win) return { kind: "browser" };
  // pywebview also runs on WebView2: its own globals take precedence over chrome.webview.
  if (win.pywebview || (win.allplanLauncher && (!win.chrome?.webview || typeof win.allplanLauncher.getInitialData === "function"))) return { kind: "pywebview", appId: typeof win.allplanLauncher?.appId === "string" ? win.allplanLauncher.appId : null };
  if (win.chrome?.webview) return { kind: "webview2" };
  return { kind: "browser" };
}

/** Normalises the two legacy identity contracts: BaseApp `id`, BridgeApp `app_id`. Anything else is absent. */
export function normalizeAppIdentity(info: unknown): string | null {
  if (!info || typeof info !== "object" || Array.isArray(info)) return null;
  const o = info as Record<string, unknown>;
  const id = typeof o["app_id"] === "string" ? o["app_id"] : typeof o["id"] === "string" ? o["id"] : null;
  if (typeof o["app_id"] === "string" && typeof o["id"] === "string" && o["app_id"] !== o["id"]) return null; // contradictory identity
  return id && id.trim() ? id.trim() : null;
}

export type ModuleTransport = LegacyTransport | "aim_pywebview_limited" | "none";
export type ModuleAccess =
  | { allowed: true; transport: ModuleTransport }
  | { allowed: false; reason: "other_application" | "incompatible_host" | "missing_identity" | "identity_error" };

/**
 * Access once the identity is known. `verifiedId` is the normalised get_app_info identity
 * There is no tolerance for a missing identity when a binding exists.
 * WebView2 alone proves no adapter; AIM legacy also requires launcher identity verification.
 */
export function moduleAccess(appId: SuiteAppId, binding: NativeBinding, verifiedId?: string | null): ModuleAccess {
  if (binding.kind === "browser") return { allowed: true, transport: "none" };
  if (binding.kind === "webview2" && appId !== "information_manager") return { allowed: false, reason: "incompatible_host" };
  if (!verifiedId) return { allowed: false, reason: "missing_identity" };
  if (verifiedId !== appId) return { allowed: false, reason: "other_application" };
  if (binding.kind === "webview2") return { allowed: true, transport: "aim_legacy" };
  if (binding.appId !== null && binding.appId !== verifiedId) return { allowed: false, reason: "other_application" };
  return { allowed: true, transport: appId === "information_manager" ? "aim_pywebview_limited" : "host_bridge" };
}

/** Identity verified by the gate in this window; read by connectHost before any initial data request. */
let verifiedIdentity: string | null = null;
/** Detached copy of the get_app_info reply that established the identity (contract/capabilities), null otherwise. */
let verifiedAppInfo: unknown = null;
export const getVerifiedIdentity = () => verifiedIdentity;
export const getVerifiedAppInfo = () => verifiedAppInfo;
/** Test-only reset. */
export const resetVerifiedIdentity = () => { verifiedIdentity = null; verifiedAppInfo = null; };

/** A JS marker or the WebView2 engine alone cannot establish the legacy adapter. */
export function isAimLegacyEstablished(win: BindingWindow | undefined = currentWindow()): boolean {
  return !!win && detectNativeBinding(win).kind === "webview2" &&
    typeof win.allplanLauncher?.getAppInfo === "function" && verifiedIdentity === "information_manager";
}

/** Calls only get_app_info (pywebview api first, launcher otherwise). Rejects if none is exposed. */
export async function readAppInfo(win: BindingWindow): Promise<unknown> {
  const api = win.pywebview?.api;
  if (typeof api?.get_app_info === "function") return await api.get_app_info();
  if (typeof win.allplanLauncher?.getAppInfo === "function") return await win.allplanLauncher.getAppInfo();
  throw new Error("get_app_info unavailable");
}

/**
 * Resolves the access of a module in this window. For pywebview, waits for the api
 * (pywebviewready / allplan-launcher-ready) up to `timeoutMs`, then verifies identity.
 * `signal` aborts the wait (unmount/reload): the promise then never resolves the caller's state.
 */
export function resolveModuleAccess(appId: SuiteAppId, opts: { win?: BindingWindow; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ModuleAccess> {
  verifiedIdentity = null; verifiedAppInfo = null;
  const win = opts.win ?? currentWindow();
  const binding = detectNativeBinding(win);
  if (!win || binding.kind === "browser") return Promise.resolve(moduleAccess(appId, binding));
  if (binding.kind === "webview2" && appId !== "information_manager") {
    return Promise.resolve({ allowed: false, reason: "incompatible_host" });
  }
  const timeoutMs = opts.timeoutMs ?? 15000;
  return new Promise<ModuleAccess>((resolve, reject) => {
    let settled = false, inflight = false, timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); win.removeEventListener?.("pywebviewready", attempt); win.removeEventListener?.("allplan-launcher-ready", attempt); opts.signal?.removeEventListener("abort", onAbort); };
    const finish = (access: ModuleAccess, info: unknown = null) => {
      if (settled) return; settled = true; cleanup();
      if (opts.signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
      if (access.allowed) { verifiedIdentity = appId; try { verifiedAppInfo = info === null ? null : structuredClone(info); } catch { verifiedAppInfo = null; } }
      resolve(access);
    };
    const onAbort = () => { if (settled) return; settled = true; cleanup(); reject(new DOMException("aborted", "AbortError")); };
    function attempt() {
      if (settled || !win) return;
      const currentBinding = appId === "information_manager" ? detectNativeBinding(win) : binding;
      if (currentBinding.kind === "browser") return; // a native wait never falls back to browser access
      const ready = typeof win.pywebview?.api?.get_app_info === "function" || typeof win.allplanLauncher?.getAppInfo === "function";
      if (!ready) return; // keep waiting for the binding to expose get_app_info
      if (inflight) return; inflight = true; // single get_app_info call; timeout and abort stay armed
      // AIM effects can be replayed/unmounted before this microtask. Do not call an obsolete host.
      const infoRequest = appId === "information_manager"
        ? Promise.resolve().then(() => settled || opts.signal?.aborted ? undefined : readAppInfo(win))
        : readAppInfo(win);
      infoRequest
        .then((info) => {
          if (settled || opts.signal?.aborted) return;
          const id = normalizeAppIdentity(info);
          const declaredId = win.allplanLauncher?.appId;
          finish(typeof declaredId === "string" && declaredId !== id
            ? { allowed: false, reason: "other_application" }
            : moduleAccess(appId, detectNativeBinding(win), id), info);
        })
        .catch(() => finish({ allowed: false, reason: "identity_error" }));
    }
    if (opts.signal?.aborted) { onAbort(); return; }
    opts.signal?.addEventListener("abort", onAbort);
    win.addEventListener?.("pywebviewready", attempt);
    win.addEventListener?.("allplan-launcher-ready", attempt);
    timer = setTimeout(() => {
      if (appId !== "information_manager") { finish({ allowed: false, reason: "missing_identity" }); return; }
      // Final AIM redetection at the existing deadline. One task turn lets an immediately
      // available identity resolve; a pending native read gets no additional grace period.
      attempt();
      if (!settled) timer = setTimeout(() => finish({ allowed: false, reason: "missing_identity" }), 0);
    }, timeoutMs);
    attempt();
  });
}
