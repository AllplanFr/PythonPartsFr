import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AimEditor } from "@/modules/information_manager/AimEditor";
import { detectNativeBinding, resolveModuleAccess, resetVerifiedIdentity, type BindingWindow } from "@/shared/transport/native-binding";
import { setCatalog } from "@/modules/information_manager/lib/attribute-catalog";
import { ModuleGate } from "@/suite/ModuleGate";

const win = () => window as unknown as BindingWindow;
const mount = () => render(createElement(AimEditor, { hostEnabled: true }));
const status = () => document.querySelector('[role="status"]')?.textContent ?? "";
const establish = async () => {
  win().allplanLauncher = { getAppInfo: vi.fn(async () => ({ id: "information_manager" })) };
  expect(await resolveModuleAccess("information_manager")).toEqual({ allowed: true, transport: "aim_legacy" });
};
const installWebView = (hostObjects?: object) => {
  const postMessage = vi.fn();
  const addEventListener = vi.fn();
  Object.defineProperty(window, "chrome", { configurable: true, value: { webview: { postMessage, addEventListener, removeEventListener: vi.fn(), hostObjects } } });
  return { postMessage, addEventListener };
};

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.useFakeTimers(); localStorage.clear(); setCatalog([]); resetVerifiedIdentity();
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); resetVerifiedIdentity();
  delete window.allplanLauncher; delete window.pywebview;
  Reflect.deleteProperty(window, "chrome");
});

describe("AIM legacy: adapter establishment and single awaited proxy read", () => {
  it("bare WebView2 with disabled host objects never reads proxy or sends ready", async () => {
    const read = vi.fn(() => { throw new Error("host objects disabled"); });
    const hostObjects = Object.defineProperty({}, "bridge", { get: read });
    const { postMessage, addEventListener } = installWebView(hostObjects);
    expect(detectNativeBinding(win())).toEqual({ kind: "webview2" });
    const access = resolveModuleAccess("information_manager");
    await vi.advanceTimersByTimeAsync(15001);
    expect(await access).toEqual({ allowed: false, reason: "missing_identity" });
    mount(); await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(status()).toMatch(/Hôte non connecté|Host disconnected/);
    expect(read).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it("a launcher appId marker without an identity function cannot establish legacy", async () => {
    const { postMessage } = installWebView();
    win().allplanLauncher = { appId: "information_manager" };
    const access = resolveModuleAccess("information_manager");
    await vi.advanceTimersByTimeAsync(15001);
    expect(await access).toEqual({ allowed: false, reason: "missing_identity" });
    mount(); await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("verified legacy adapter keeps ready and reads the native bridge once", async () => {
    const send = vi.fn(async () => undefined);
    const read = vi.fn(() => Promise.resolve({ SendToHost: send }));
    const { postMessage } = installWebView(Object.defineProperty({}, "bridge", { get: read }));
    await establish(); mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "ready" }));
    expect(postMessage).not.toHaveBeenCalled();
    expect(window.allplanLauncher?.getAppInfo).toHaveBeenCalledTimes(1);
  });

  it("verified message-only legacy adapter retains ready without a host object", async () => {
    const { postMessage } = installWebView(); await establish(); mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "ready" }));
  });

  it("the real module gate mounts AIM only after the native identity reply", async () => {
    const { postMessage } = installWebView();
    let release: (info: unknown) => void = () => { throw new Error("identity not requested"); };
    const info = vi.fn(() => new Promise<unknown>((resolve) => { release = resolve; }));
    win().allplanLauncher = { getAppInfo: info };
    const child = vi.fn(() => createElement(AimEditor, { hostEnabled: true }));
    render(createElement(ModuleGate, { appId: "information_manager", children: child }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(child).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
    await act(async () => { release({ id: "information_manager" }); await vi.advanceTimersByTimeAsync(10); });
    expect(child).toHaveBeenCalled(); expect(info).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "ready" }));
  });

  it("launcher-only host-bridge with WebView2 retains limited AIM transport", async () => {
    installWebView();
    win().allplanLauncher = { getAppInfo: async () => ({ id: "information_manager" }), getInitialData: async () => null };
    expect(detectNativeBinding(win()).kind).toBe("pywebview");
    expect(await resolveModuleAccess("information_manager")).toEqual({ allowed: true, transport: "aim_pywebview_limited" });
  });

  it("legacy identity mismatch blocks before any ready or proxy access", async () => {
    const read = vi.fn(); const { postMessage } = installWebView(Object.defineProperty({}, "bridge", { get: read }));
    win().allplanLauncher = { getAppInfo: async () => ({ id: "vob_editor" }) };
    expect(await resolveModuleAccess("information_manager")).toEqual({ allowed: false, reason: "other_application" });
    mount(); await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(read).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
  });

  it("pywebview stays limited even with WebView2, loading once with no legacy access", async () => {
    const read = vi.fn(); const { postMessage } = installWebView(Object.defineProperty({}, "bridge", { get: read }));
    const initial = vi.fn(async () => ({ app: "information_manager", data: { catalog: [], attributes: [] } }));
    window.pywebview = { api: { get_app_info: async () => ({ id: "information_manager" }), get_initial_data: initial } as never };
    expect(await resolveModuleAccess("information_manager")).toEqual({ allowed: true, transport: "aim_pywebview_limited" });
    render(createElement(AimEditor, { hostEnabled: false, limitedHost: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(initial).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
  });

  it("rejecting bridge proxy is read once, caught, and never becomes an orphan rejection", async () => {
    const read = vi.fn(() => Promise.reject(new Error("proxy unavailable")));
    const { postMessage } = installWebView(Object.defineProperty({}, "bridge", { get: read }));
    const orphan = vi.fn(); window.addEventListener("unhandledrejection", orphan);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await establish(); mount();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(read).toHaveBeenCalledTimes(1); expect(error).toHaveBeenCalledTimes(1);
      expect(status()).toMatch(/Erreur de chargement|Loading error/);
      expect(postMessage).not.toHaveBeenCalled(); expect(orphan).not.toHaveBeenCalled();
    } finally { window.removeEventListener("unhandledrejection", orphan); }
  });
});