import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAppIdentity, resolveModuleAccess, resetVerifiedIdentity, type BindingWindow } from "@/shared/transport/native-binding";
import { connectHost, onHostEvent } from "@/lib/host-bridge";
import { browserOnlySaveNotice, parseAimInitialContainer } from "@/modules/information_manager/lib/aim-legacy";

const fakeWin = (extra: Partial<BindingWindow>): BindingWindow => {
  const t = new EventTarget();
  return { addEventListener: (k, f) => t.addEventListener(k, f), removeEventListener: (k, f) => t.removeEventListener(k, f), ...extra, dispatch: (k: string) => t.dispatchEvent(new Event(k)) } as BindingWindow;
};
afterEach(() => { delete window.pywebview; delete window.allplanLauncher; resetVerifiedIdentity(); });

describe("native identity verification", () => {
  it("binding absent: browser mode, nothing called", async () => {
    expect(await resolveModuleAccess("smartcatalog", { win: fakeWin({}) })).toEqual({ allowed: true, transport: "none" });
  });
  it("normalises BaseApp id and BridgeApp app_id, rejects contradictions", () => {
    expect(normalizeAppIdentity({ id: "smartcatalog" })).toBe("smartcatalog");
    expect(normalizeAppIdentity({ app_id: "vob_editor" })).toBe("vob_editor");
    expect(normalizeAppIdentity({ id: "a", app_id: "b" })).toBeNull();
    expect(normalizeAppIdentity({})).toBeNull();
  });
  it("binding present without get_app_info waits, then blocks", async () => {
    const r = await resolveModuleAccess("smartcatalog", { win: fakeWin({ pywebview: {} }), timeoutMs: 20 });
    expect(r).toEqual({ allowed: false, reason: "missing_identity" });
  });
  it("correct, missing and divergent identities; only get_app_info is called", async () => {
    const initial = vi.fn();
    const mk = (info: unknown) => fakeWin({ pywebview: { api: { get_app_info: async () => info, get_initial_data: initial } } });
    expect(await resolveModuleAccess("smartcatalog", { win: mk({ id: "smartcatalog" }) })).toEqual({ allowed: true, transport: "host_bridge" });
    expect(await resolveModuleAccess("smartcatalog", { win: mk({ name: "x" }) })).toEqual({ allowed: false, reason: "missing_identity" });
    expect(await resolveModuleAccess("smartcatalog", { win: mk({ app_id: "vob_editor" }) })).toEqual({ allowed: false, reason: "other_application" });
    expect(await resolveModuleAccess("smartcatalog", { win: fakeWin({ pywebview: { api: { get_app_info: async () => { throw new Error("x"); } } } }) })).toEqual({ allowed: false, reason: "identity_error" });
    expect(initial).not.toHaveBeenCalled();
  });
  it("unmount during the wait rejects and never resolves an access", async () => {
    const c = new AbortController();
    const p = resolveModuleAccess("vob_editor", { win: fakeWin({ pywebview: {} }), signal: c.signal });
    c.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
  it("connectHost never asks initial data on mismatch and reports it", async () => {
    const initial = vi.fn(async () => ({})); const ready = vi.fn(); const err = vi.fn();
    const off = onHostEvent("error", err);
    window.pywebview = { api: { get_app_info: async () => ({ id: "smartcatalog" }), get_initial_data: initial } as never };
    const stop = connectHost("vob_editor", ready);
    await vi.waitFor(() => expect(err).toHaveBeenCalledWith(expect.objectContaining({ code: "identity_mismatch" })));
    expect(initial).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled(); stop(); off();
  });
  it("connectHost reads info before initial data (no Promise.all) and keeps the launcher object", async () => {
    const order: string[] = [];
    const launcher = { appId: "smartcatalog", getAppInfo: async () => { order.push("info"); return { id: "smartcatalog" }; }, getInitialData: async () => { order.push("initial"); return 1; } };
    window.allplanLauncher = launcher;
    const ready = vi.fn(); const stop = connectHost("smartcatalog", ready);
    await vi.waitFor(() => expect(ready).toHaveBeenCalled());
    expect(order).toEqual(["info", "initial"]); expect(window.allplanLauncher).toBe(launcher); stop();
  });
  it("disposal during get_app_info ignores the late reply", async () => {
    let release!: (v: unknown) => void; const initial = vi.fn();
    window.pywebview = { api: { get_app_info: () => new Promise((r) => { release = r; }), get_initial_data: initial } as never };
    const ready = vi.fn(); const stop = connectHost("vob_editor", ready); stop(); release({ id: "vob_editor" });
    await new Promise((r) => setTimeout(r, 10));
    expect(initial).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
  });
});

describe("AIM limited pywebview container", () => {
  it("valid, absent and invalid contents", () => {
    expect(parseAimInitialContainer({ app: "information_manager", data: { catalog: [], attributes: [] } }).kind).toBe("valid");
    expect(parseAimInitialContainer(null)).toEqual({ kind: "absent" });
    expect(parseAimInitialContainer({ app: "information_manager", data: {} })).toEqual({ kind: "absent" });
    expect(parseAimInitialContainer({ app: "smartcatalog", data: { catalog: [] } })).toEqual({ kind: "invalid", reason: "app" });
    expect(parseAimInitialContainer({ app: "information_manager", data: [] })).toEqual({ kind: "invalid", reason: "data" });
    expect(parseAimInitialContainer({ app: "information_manager", data: { foo: 1 } })).toEqual({ kind: "invalid", reason: "content" });
  });
  it("browser save is never presented as a project save", () => {
    for (const l of ["fr", "en"]) { expect(browserOnlySaveNotice(l)).toMatch(/navigateur|browser/); expect(browserOnlySaveNotice(l)).not.toMatch(/projet enregistré|project saved/i); }
  });
});
