import { describe, it, expect, afterEach, vi } from "vitest";
import { request, HostError, connectHost } from "@/lib/host-bridge";
import { applyVobDocument, connectVobHost, useVobHost, toVobPayload, vobSave } from "@/lib/vob-bridge";
import { useVobEditor, vobHasChanges } from "@/lib/vob-editor";
import { useAppDialog } from "@/lib/app-dialog";
import { vobOpen } from "@/lib/vob-bridge";

afterEach(() => { delete window.pywebview; delete window.allplanLauncher; useAppDialog.setState({ queue: [] }); });

describe("vob bridge", () => {
  it("replaces recent files from direct events in Python order, capped at ten, and unsubscribes on exit", async () => {
    const call = vi.fn(async (_command: string, _payload: unknown) => ({ ok: true as const, data: null }));
    window.pywebview = { api: { get_app_info: async () => ({ app_id: "vob_editor" }), get_initial_data: async () => ({ recentFiles: ["C:/initial.fra"] }), call } };
    const stop = connectVobHost();
    await vi.waitFor(() => expect(useVobHost.getState().recentFiles).toEqual(["C:/initial.fra"]));
    const document = useVobEditor.getState();
    const paths = Array.from({ length: 12 }, (_, index) => `C:/python-${11 - index}.fra`);
    window.allplanHost?.receive("vob.recent_files", paths);
    expect(useVobHost.getState().recentFiles).toEqual(paths.slice(0, 10));
    expect(useVobEditor.getState()).toBe(document);
    expect(call.mock.calls.some(([command]) => command === "vob.recent_files")).toBe(false);
    const receiver = window.allplanHost;
    stop();
    receiver?.receive("vob.recent_files", ["C:/after-exit.fra"]);
    expect(useVobHost.getState().recentFiles).toEqual(paths.slice(0, 10));
    const stopAgain = connectVobHost();
    await vi.waitFor(() => expect(useVobHost.getState().recentFiles).toEqual(["C:/initial.fra"]));
    let updates = 0;
    const off = useVobHost.subscribe(() => { updates += 1; });
    window.allplanHost?.receive("vob.recent_files", []);
    expect(useVobHost.getState().recentFiles).toEqual([]);
    expect(updates).toBe(1);
    off(); stopAgain();
  });
  it("shows only allplan.version and Python recentFiles from initial data", async () => {
    window.pywebview = { api: { get_app_info: async () => ({ app_id: "vob_editor" }), get_initial_data: async () => ({ context: { version: "2027", source: "STD" }, allplan: { version: "2027.1" }, recentFiles: ["C:/b.fra", "C:/a.fra"] }) } as never };
    const stop = connectVobHost();
    await vi.waitFor(() => expect(useVobHost.getState().dataVersion).toBe("2027.1"));
    expect(useVobHost.getState().recentFiles).toEqual(["C:/b.fra", "C:/a.fra"]);
    window.allplanHost?.receive("vob.context", { version: "2028", source: "STD" });
    expect(useVobHost.getState().dataVersion).toBe("2027.1");
    stop();
  });
  it("shows no Allplan Data version when allplan.version is absent", async () => {
    window.pywebview = { api: { get_app_info: async () => ({ app_id: "vob_editor" }), get_initial_data: async () => ({ context: { version: "2027", source: "STD" } }) } as never };
    const stop = connectVobHost();
    await vi.waitFor(() => expect(window.allplanHost).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(useVobHost.getState().dataVersion).toBeNull();
    stop();
  });
  it("rejects with no-host outside the Python window", async () => {
    await expect(request("vob.open")).rejects.toMatchObject({ code: "no-host" } satisfies Partial<HostError>);
  });
  it("loads a document from Python as the saved state", () => {
    applyVobDocument({ file: { id: "f", name: "vob_fra.fra", path: "C:/vob_fra.fra" }, rules: [{ trade: "5", object: "1", unit: "2", method: "02", formula: "A", comment: "c" }] });
    const s = useVobEditor.getState();
    expect(s.rules).toHaveLength(1); expect(s.rules[0]?.method).toBe("02"); expect(s.file?.name).toBe("vob_fra.fra"); expect(s.saved).toBe(s.rules);
  });
  it("sends rules without view ids on save", async () => {
    let sent: unknown;
    window.pywebview = { api: { call: async (_c: string, p: unknown) => { sent = p; return { ok: true, data: { file: { id: "f", name: "x", path: "x" } } }; } } };
    const first = useVobEditor.getState().rules[0];
    if (!first) throw new Error("Expected a loaded rule");
    useVobEditor.getState().update(first.id, { comment: "new" });
    await vobSave();
    expect((sent as { rules: unknown[] }).rules).toEqual(toVobPayload(useVobEditor.getState().rules));
    expect(JSON.stringify((sent as { rules: unknown[] }).rules)).not.toContain("\"id\"");
    expect(useVobEditor.getState().saved).toBe(useVobEditor.getState().rules);
  });
  it("preserves the Python API receiver and clears the timeout after a reply", async () => {
    const api = { call: async function () { expect(this).toBe(api); return { ok: true as const, data: "ready" }; } };
    window.pywebview = { api };
    const clear = vi.spyOn(globalThis, "clearTimeout");
    await expect(request("test.receiver")).resolves.toBe("ready");
    expect(clear).toHaveBeenCalled(); clear.mockRestore();
  });
  it("distinguishes a Python host missing api.call from the browser preview", async () => {
    window.pywebview = { api: {} };
    await expect(request("test.missing")).rejects.toMatchObject({ code: "unavailable" });
  });
  it("waits for pywebviewready before reading initial data", async () => {
    const ready = vi.fn(); const initial = vi.fn(async () => ({ files: [] }));
    const stop = connectHost("vob_editor", ready);
    expect(ready).not.toHaveBeenCalled();
    window.pywebview = { api: { get_app_info: async () => ({ app_id: "vob_editor" }), get_initial_data: initial } as never };
    window.dispatchEvent(new Event("pywebviewready"));
    await vi.waitFor(() => expect(ready).toHaveBeenCalledWith({ files: [] }, { app_id: "vob_editor" }));
    expect(initial).toHaveBeenCalledTimes(1); stop();
  });
  it("does not mark changes saved when Python is absent", async () => {
    applyVobDocument({ rules: [{ trade: "1", object: "2", unit: "3", method: "2", formula: "A", comment: "" }] });
    const first = useVobEditor.getState().rules[0]; if (!first) throw new Error("Missing rule");
    useVobEditor.getState().update(first.id, { comment: "not saved" });
    await vobSave();
    expect(vobHasChanges(useVobEditor.getState())).toBe(true);
    expect(useAppDialog.getState().queue).toHaveLength(1);
  });
  it("opens the requested path and reads back raw strings", async () => {
    const call = vi.fn(async () => ({ ok: true as const, data: { file: { id: "std/x", name: "x", path: "C:/x" }, rules: [{ trade: "1", object: "2", unit: "3", method: "02", formula: "A<-B", comment: "c" }] } }));
    window.pywebview = { api: { call } };
    await vobOpen("C:/x");
    expect(call).toHaveBeenCalledWith("vob.open", { path: "C:/x" });
    expect(useVobEditor.getState().rules[0]).toMatchObject({ trade: "1", method: "02", formula: "A<-B" });
  });
  it("does not replace the document or saved state on cancelled open/save as", async () => {
    const before = useVobEditor.getState();
    window.pywebview = { api: { call: async () => ({ ok: true, data: null }) } };
    await vobOpen(); await vobSave(true);
    expect(useVobEditor.getState().rules).toBe(before.rules);
    expect(useVobEditor.getState().saved).toBe(before.saved);
    expect(useAppDialog.getState().queue).toHaveLength(0);
  });
  it("rejects a save success without file metadata", async () => {
    const before = useVobEditor.getState().saved;
    window.pywebview = { api: { call: async () => ({ ok: true, data: {} }) } };
    await vobSave();
    expect(useVobEditor.getState().saved).toBe(before);
    expect(useAppDialog.getState().queue).toHaveLength(1);
  });
  it("keeps edits made while Python is saving dirty", async () => {
    const sent = useVobEditor.getState().rules;
    let reply: ((v: { ok: true; data: { file: { id: string; name: string; path: string } } }) => void) | undefined;
    window.pywebview = { api: { call: () => new Promise((resolve) => { reply = resolve; }) } };
    const saving = vobSave();
    const first = sent[0]; if (!first || !reply) throw new Error("Save not started");
    useVobEditor.getState().update(first.id, { comment: "edited during save" });
    reply({ ok: true, data: { file: { id: "std/x", name: "x", path: "C:/x" } } });
    await saving;
    expect(useVobEditor.getState().saved).toBe(sent);
    expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  });
});

import { formatVobIndex } from "@/lib/vob-bridge";
import { collectSettings, APP_SECTIONS } from "@/lib/app-settings";
import { isCommandUnavailable } from "@/lib/host-bridge";
describe("vob backend contract", () => {
  it("keeps the document unsaved and disables save on unknown_command", async () => {
    window.pywebview = { api: { call: async () => ({ ok: false, error: { code: "unknown_command", message: "disabled" } }) } };
    const first = useVobEditor.getState().rules[0]; if (!first) throw new Error("Missing rule");
    useVobEditor.getState().update(first.id, { comment: "dirty" });
    await vobSave();
    expect(useVobEditor.getState().saved).not.toBe(useVobEditor.getState().rules);
    expect(isCommandUnavailable("vob.save")).toBe(true);
    expect(useVobHost).toBeDefined();
  });
  it("pads raw indices for display only", () => {
    expect(formatVobIndex("trade", "1")).toBe("001");
    expect(formatVobIndex("object", "12")).toBe("0012");
    expect(formatVobIndex("method", "2")).toBe("02");
  });
  it("sends only accepted settings sections", () => {
    expect(Object.keys(collectSettings(APP_SECTIONS.vob_editor)).sort()).toEqual(["dialogs", "formulaFavorites", "general", "toolbars", "version", "vobEditor", "vobResources"]);
  });
  it("does not retry unsupported open or save-as commands", async () => {
    const call = vi.fn(async () => ({ ok: false as const, error: { code: "unknown_command", message: "Writing is disabled by Python" } }));
    window.pywebview = { api: { call } };
    const stop = connectVobHost();
    await vobOpen(); await vobOpen();
    await vobSave(true); await vobSave(true);
    expect(call.mock.calls).toHaveLength(2);
    expect(useVobHost.getState().unavailable["vob.open"]).toBe(true);
    expect(useVobHost.getState().unavailable["vob.save_as"]).toBe(true);
    expect(useAppDialog.getState().queue[1]?.text).toBe("Writing is disabled by Python");
    stop();
  });
});

describe("vob native dialogs", () => {
  it("waits beyond the default timeout when timeout is disabled", async () => {
    vi.useFakeTimers();
    let reply: ((v: unknown) => void) | undefined;
    window.pywebview = { api: { call: () => new Promise((r) => { reply = r as (v: unknown) => void; }) as never } };
    const pending = request("test.dialog", {}, 0);
    await vi.advanceTimersByTimeAsync(120000);
    reply?.({ ok: true, data: "picked" });
    vi.useRealTimers();
    await expect(pending).resolves.toBe("picked");
  });
});
