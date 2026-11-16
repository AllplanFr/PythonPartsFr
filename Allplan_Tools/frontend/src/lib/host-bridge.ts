import { normalizeAppIdentity, readAppInfo, type BindingWindow } from "@/shared/transport/native-binding";
/**
 * Bridge between the web view and the Python host (pywebview).
 *
 * Python -> view : the host script (smartcatalog.js / vob_editor.js) exposes
 *   window.allplanLauncher and dispatches "allplan-launcher-ready".
 *   The host pushes events with  window.evaluate_js("window.allplanHost.receive(type, payload)").
 * View -> Python : request(command, payload) calls api.call(command, payload)
 *   and expects a reply envelope { ok: true, data } | { ok: false, error }.
 * Without a host (plain browser), isHosted() is false and request() rejects with "no-host".
 */
export const BRIDGE_VERSION = 1;
export type HostAppId = "smartcatalog" | "vob_editor";
export type HostReply<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; confirmation?: unknown } };
type PyApi = { get_app_info?: () => Promise<unknown>; get_initial_data?: () => Promise<unknown>; call?: (command: string, payload: unknown) => Promise<HostReply> };
type Launcher = { appId: string; getAppInfo: () => Promise<unknown>; getInitialData: () => Promise<unknown> };
type Listener = (payload: unknown) => void;

declare global {
  interface Window {
    pywebview?: { api?: PyApi };
    allplanLauncher?: Launcher;
    allplanHost?: { version: number; receive: (type: string, payload?: unknown) => void };
  }
}

const listeners = new Map<string, Set<Listener>>();
export function onHostEvent(type: string, fn: Listener): () => void {
  const set = listeners.get(type) ?? new Set<Listener>(); set.add(fn); listeners.set(type, set);
  return () => { set.delete(fn); };
}
export function emitHostEvent(type: string, payload?: unknown): void { listeners.get(type)?.forEach((fn) => fn(payload)); }

export const isHosted = () => typeof window !== "undefined" && Boolean(window.pywebview?.api);

/** Commands the host answered with unknown_command/unavailable: the matching UI actions are disabled, never retried. */
const unavailable = new Set<string>(); const unavailableListeners = new Set<() => void>();
export const isCommandUnavailable = (command: string) => unavailable.has(command);
export function onUnavailableChange(fn: () => void) { unavailableListeners.add(fn); return () => { unavailableListeners.delete(fn); }; }
const markUnavailable = (command: string) => { if (unavailable.has(command)) return; unavailable.add(command); unavailableListeners.forEach((fn) => fn()); };

export class HostError extends Error { constructor(public code: string, message: string, public confirmation?: unknown) { super(message); } }

/** Sends a command to Python; resolves with data or throws HostError. timeoutMs <= 0 waits indefinitely (native dialogs). */
export async function request<T = unknown>(command: string, payload: unknown = {}, timeoutMs = 30000): Promise<T> {
  const api = typeof window === "undefined" ? undefined : window.pywebview?.api;
  if (!api) throw new HostError("no-host", "Application not launched from the Python WebView");
  if (typeof api.call !== "function") {
    markUnavailable(command);
    throw new HostError("unavailable", "Python WebView: api.call(command, payload) is not available.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      api.call(command, payload),
      new Promise<HostReply>((resolve) => { if (timeoutMs > 0) timer = setTimeout(() => resolve({ ok: false, error: { code: "timeout", message: `${command} timed out` } }), timeoutMs); }),
    ]);
    if (!reply || typeof reply !== "object" || (reply.ok !== true && reply.ok !== false)) throw new HostError("bad-reply", `Invalid reply for ${command}`);
    // Only a definitively absent implementation disables the action; a transient "unavailable" source does not (protocol 2.0 §5).
    if (!reply.ok && (reply.error?.code === "unknown_command" || reply.error?.code === "not_implemented")) markUnavailable(command);
    if (!reply.ok) throw new HostError(reply.error?.code ?? "error", reply.error?.message ?? command, reply.error?.confirmation);
    return reply.data as T;
  } finally { clearTimeout(timer); }
}

/**
 * Installs window.allplanHost and calls onReady(initialData, info) once the window identity
 * is verified: get_app_info first (BaseApp `id` / BridgeApp `app_id`), strict match with appId,
 * then get_initial_data. Missing identity or mismatch: no initial data, no onReady, an "error" event.
 * The launcher objects are never overwritten.
 */
export function connectHost(appId: HostAppId, onReady: (initial: unknown, info: unknown) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const receiver = { version: BRIDGE_VERSION, receive: (type: string, payload?: unknown) => emitHostEvent(type, payload) };
  window.allplanHost = receiver;
  let started = false, disposed = false;
  const start = async () => {
    const launcher = window.allplanLauncher;
    const api = window.pywebview?.api;
    const hasInfo = typeof api?.get_app_info === "function" || typeof launcher?.getAppInfo === "function";
    if (started || disposed || !hasInfo) return;
    started = true;
    try {
      const info = await readAppInfo(window as unknown as BindingWindow);
      if (disposed) return;
      const id = normalizeAppIdentity(info);
      if (id !== appId || (typeof launcher?.appId === "string" && launcher.appId !== appId)) {
        emitHostEvent("error", { code: id ? "identity_mismatch" : "identity_missing", message: `Window identity ${id ?? "absent"} ≠ ${appId}` });
        return;
      }
      const initial = typeof api?.get_initial_data === "function" ? await api.get_initial_data()
        : typeof launcher?.getInitialData === "function" ? await launcher.getInitialData() : null;
      if (!disposed) onReady(initial, info); // late initial data after the module left is ignored
    }
    catch (error) { if (!disposed) emitHostEvent("error", { code: "init", message: String(error) }); }
  };
  window.addEventListener("allplan-launcher-ready", start);
  window.addEventListener("pywebviewready", start);
  void start();
  return () => {
    disposed = true;
    window.removeEventListener("allplan-launcher-ready", start); window.removeEventListener("pywebviewready", start);
    if (window.allplanHost === receiver) delete window.allplanHost; // only the owner removes its receiver
  };
}
