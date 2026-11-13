import { createElement, StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVerifiedIdentity, resolveModuleAccess, resetVerifiedIdentity, type BindingWindow } from "@/shared/transport/native-binding";
import { ModuleGate } from "@/suite/ModuleGate";

function fixture() {
  const events = new EventTarget();
  const win: BindingWindow = {
    chrome: { webview: {} },
    addEventListener: vi.fn((type, fn) => events.addEventListener(type, fn)),
    removeEventListener: vi.fn((type, fn) => events.removeEventListener(type, fn)),
  };
  const initial = vi.fn();
  const info = vi.fn(async () => ({ id: "information_manager" }));
  const install = () => { win.pywebview = { api: { get_app_info: info, get_initial_data: initial } }; };
  return { win, initial, info, install, ready: () => events.dispatchEvent(new Event("pywebviewready")) };
}
beforeEach(() => { vi.useFakeTimers(); resetVerifiedIdentity(); });
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); resetVerifiedIdentity();
  delete window.pywebview; delete window.allplanLauncher; Reflect.deleteProperty(window, "chrome");
});

describe("AIM late bridge availability, identity only", () => {
  it("accepts pywebview already ready, without reading initial data", async () => {
    const f = fixture(); f.install();
    expect(await resolveModuleAccess("information_manager", { win: f.win })).toEqual({ allowed: true, transport: "aim_pywebview_limited" });
    expect(f.info).toHaveBeenCalledTimes(1); expect(f.initial).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("waits for WebView2 then pywebview ready, with one identity for multiple events", async () => {
    const f = fixture(); const result = resolveModuleAccess("information_manager", { win: f.win });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.info).not.toHaveBeenCalled(); expect(getVerifiedIdentity()).toBeNull();
    f.install(); f.ready(); f.ready(); f.ready();
    expect(await result).toEqual({ allowed: true, transport: "aim_pywebview_limited" });
    expect(f.info).toHaveBeenCalledTimes(1); expect(f.initial).not.toHaveBeenCalled();
    expect(f.win.removeEventListener).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it("redetects a bridge injected while listeners are being installed", async () => {
    const f = fixture(); const add = f.win.addEventListener;
    f.win.addEventListener = (type, fn) => { add?.(type, fn); if (type === "allplan-launcher-ready") f.install(); };
    expect(await resolveModuleAccess("information_manager", { win: f.win })).toEqual({ allowed: true, transport: "aim_pywebview_limited" });
    expect(f.info).toHaveBeenCalledTimes(1);
  });
  it("ready without methods stays waiting until the unchanged 15 s deadline", async () => {
    const f = fixture(); const done = vi.fn();
    const result = resolveModuleAccess("information_manager", { win: f.win }).then(done);
    f.win.pywebview = { api: {} }; f.ready(); f.ready();
    await vi.advanceTimersByTimeAsync(14999); expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2); await result;
    expect(done).toHaveBeenCalledExactlyOnceWith({ allowed: false, reason: "missing_identity" });
    expect(f.info).not.toHaveBeenCalled(); expect(f.initial).not.toHaveBeenCalled();
  });
  it("redetects at expiry without a ready event", async () => {
    const f = fixture(); const result = resolveModuleAccess("information_manager", { win: f.win });
    await vi.advanceTimersByTimeAsync(14999); f.install();
    await vi.advanceTimersByTimeAsync(2);
    expect(await result).toEqual({ allowed: true, transport: "aim_pywebview_limited" });
    expect(f.info).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not give a hanging identity a new timeout at expiry", async () => {
    const f = fixture(); const result = resolveModuleAccess("information_manager", { win: f.win });
    await vi.advanceTimersByTimeAsync(14999); f.install(); f.info.mockImplementation(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(2);
    expect(await result).toEqual({ allowed: false, reason: "missing_identity" });
    expect(f.info).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("expires when absent and cannot reactivate from a late ready event", async () => {
    const f = fixture(); const done = vi.fn();
    const result = resolveModuleAccess("information_manager", { win: f.win }).then(done);
    await vi.advanceTimersByTimeAsync(15001); await result;
    f.install(); f.ready(); await vi.advanceTimersByTimeAsync(100);
    expect(done).toHaveBeenCalledExactlyOnceWith({ allowed: false, reason: "missing_identity" });
    expect(f.info).not.toHaveBeenCalled(); expect(getVerifiedIdentity()).toBeNull();
  });
  it("rejects a wrong identity even after availability", async () => {
    const f = fixture(); const result = resolveModuleAccess("information_manager", { win: f.win });
    f.install(); f.info.mockResolvedValue({ id: "vob_editor" }); f.ready();
    expect(await result).toEqual({ allowed: false, reason: "other_application" });
    expect(f.initial).not.toHaveBeenCalled(); expect(getVerifiedIdentity()).toBeNull();
  });
  it("unmount during waiting removes both listeners and the timer", async () => {
    const f = fixture(); const controller = new AbortController();
    const result = resolveModuleAccess("information_manager", { win: f.win, signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" }); controller.abort(); await rejected;
    f.install(); f.ready(); await vi.advanceTimersByTimeAsync(15001);
    expect(f.info).not.toHaveBeenCalled(); expect(f.win.removeEventListener).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores identity replies after abort", async () => {
    const f = fixture(); f.install(); let release: (info: { id: string }) => void = () => {};
    f.info.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const result = resolveModuleAccess("information_manager", { win: f.win, signal: controller.signal });
    await Promise.resolve();
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" }); controller.abort(); await rejected;
    release({ id: "information_manager" }); await vi.advanceTimersByTimeAsync(1);
    expect(getVerifiedIdentity()).toBeNull(); expect(f.initial).not.toHaveBeenCalled();
  });
  it.each(["smartcatalog", "vob_editor"] as const)("preserves immediate bare-WebView2 refusal for %s", async (appId) => {
    const f = fixture();
    expect(await resolveModuleAccess(appId, { win: f.win })).toEqual({ allowed: false, reason: "incompatible_host" });
    expect(f.win.addEventListener).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

it("ModuleGate under StrictMode mounts once only after late verified identity", async () => {
  Object.defineProperty(window, "chrome", { configurable: true, value: { webview: {} } });
  const initial = vi.fn(); const mounted = vi.fn();
  function Child() { mounted(); return null; }
  const child = vi.fn(() => createElement(Child));
  const view = render(createElement(ModuleGate, { appId: "information_manager", children: child }));
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(child).not.toHaveBeenCalled(); expect(initial).not.toHaveBeenCalled();
  // Remount the waiting gate under effect replay; only its surviving effect may validate.
  view.unmount();
  render(createElement(StrictMode, null, createElement(ModuleGate, { appId: "information_manager", children: child })));
  const info = vi.fn(async () => ({ id: "information_manager" }));
  window.pywebview = { api: { get_app_info: info, get_initial_data: initial } as never };
  await act(async () => { window.dispatchEvent(new Event("pywebviewready")); window.dispatchEvent(new Event("pywebviewready")); await vi.advanceTimersByTimeAsync(1); });
  expect(info).toHaveBeenCalledTimes(1); expect(child).toHaveBeenCalledTimes(2); // StrictMode render replay, not two live mounts
  expect(mounted).toHaveBeenCalledTimes(2); expect(initial).not.toHaveBeenCalled();
});