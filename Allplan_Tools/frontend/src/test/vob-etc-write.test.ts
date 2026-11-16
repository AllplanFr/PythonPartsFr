import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, HostError } from "@/lib/host-bridge";
import { applyVobDocument, vobSave, vobSaveFiles } from "@/lib/vob-bridge";
import { useVobEditor, vobHasChanges } from "@/lib/vob-editor";
import { useAppDialog } from "@/lib/app-dialog";
import { clearVobSessions, rememberVobSession, vobDirtyPaths } from "@/lib/vob-resources";
import { shouldBlockLeave } from "@/suite/leave-guard";
import { VobCloseCoordinator } from "@/lib/vob-close";

const file = { id: "fixture", name: "vob.fra", path: "C:\\Synthetic\\Etc\\vob.fra" };
const other = { id: "copy", name: "copy.fra", path: "C:\\Synthetic\\Etc\\copy.fra" };
const confirmation = (operation = "vob.save", id = "one", path = file.path) => ({ ok: false as const, error: { code: "write_confirmation_required", message: "Arbitrary translated message", confirmation: { confirmationId: id, operation, path } } });
const load = () => {
  applyVobDocument({ file, rules: [{ trade: "001", object: "0035", unit: "1", method: "2", formula: "A", comment: "original" }], header: ["original"] });
  const row = useVobEditor.getState().rules[0]; if (!row) throw new Error("Missing fixture");
  useVobEditor.getState().update(row.id, { comment: "modified" });
};
beforeEach(() => { clearVobSessions(); useAppDialog.setState({ queue: [] }); load(); });
afterEach(() => { delete window.pywebview; useAppDialog.setState({ queue: [] }); clearVobSessions(); });
const host = (call: ReturnType<typeof vi.fn>) => { window.pywebview = { api: { call: call as never } }; };
async function choose(value: string | null) {
  await vi.waitFor(() => expect(useAppDialog.getState().queue[0]?.kind).toBe("choice"));
  useAppDialog.getState().close(value);
}
describe("exact ETC confirmation contract", () => {
  it("preserves reply.error.confirmation through HostError without parsing messages", async () => {
    const envelope = confirmation(); host(vi.fn(async () => envelope));
    try { await request("vob.save"); throw new Error("Expected failure"); }
    catch (error) { expect(error).toBeInstanceOf(HostError); expect((error as HostError).confirmation).toBe(envelope.error.confirmation); expect((error as HostError).code).toBe("write_confirmation_required"); }
  });
  it("replace sends only token/accept and marks exactly the captured document saved", async () => {
    const before = useVobEditor.getState();
    const call = vi.fn(async (c: string) => c === "vob.save" ? confirmation() : { ok: true, data: { file, header: ["original"] } }); host(call);
    const saving = vobSave(); await choose("replace"); expect(await saving).toBe(true);
    expect(call.mock.calls).toHaveLength(2);
    expect(call).toHaveBeenLastCalledWith("vob.write.confirm", { confirmationId: "one", accept: true });
    expect(useVobEditor.getState().saved).toBe(before.rules); expect(vobHasChanges(useVobEditor.getState())).toBe(false);
  });
  it.each(["cancel", null])("cancel/dismiss %s rejects token and preserves modifications", async (choice) => {
    const before = useVobEditor.getState(); const call = vi.fn(async (c: string) => c === "vob.save" ? confirmation() : { ok: true, data: null }); host(call);
    const saving = vobSave(); await choose(choice); expect(await saving).toBe(false);
    expect(call).toHaveBeenLastCalledWith("vob.write.confirm", { confirmationId: "one", accept: false });
    expect(useVobEditor.getState().rules).toBe(before.rules); expect(useVobEditor.getState().saved).toBe(before.saved);
  });
  it("save-as rejects the first token before picker and handles a second ETC target", async () => {
    const call = vi.fn(async (c: string, p: unknown) => c === "vob.save" ? confirmation() : c === "vob.save_as" ? confirmation("vob.save_as", "two", other.path) : { ok: true, data: (p as { accept: boolean }).accept ? { file: other, header: [] } : null }); host(call);
    const saving = vobSave(); await choose("save_as"); await choose("replace"); expect(await saving).toBe(true);
    expect(call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.write.confirm", "vob.save_as", "vob.write.confirm"]);
    expect(call.mock.calls[1]?.[1]).toEqual({ confirmationId: "one", accept: false });
    expect(call.mock.calls[3]?.[1]).toEqual({ confirmationId: "two", accept: true });
    expect(useVobEditor.getState().file).toEqual(other);
  });
  it.each(["cancel", "error"])("save-as %s after token rejection leaves original dirty", async (outcome) => {
    const before = useVobEditor.getState(); const call = vi.fn(async (c: string) => c === "vob.save" ? confirmation() : c === "vob.write.confirm" ? { ok: true, data: null } : outcome === "cancel" ? { ok: true, data: null } : { ok: false, error: { code: "io_error", message: "failed" } }); host(call);
    const saving = vobSave(); await choose("save_as"); expect(await saving).toBe(false);
    expect(useVobEditor.getState().file).toBe(before.file); expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  });
  it("write error never updates the saved baseline", async () => {
    const before = useVobEditor.getState(); host(vi.fn(async (c: string) => c === "vob.save" ? confirmation() : { ok: false, error: { code: "io_error", message: "failed" } }));
    const saving = vobSave(); await choose("replace"); expect(await saving).toBe(false); expect(useVobEditor.getState().saved).toBe(before.saved);
  });
  it("new edits during confirmation remain unsaved after effective write", async () => {
    const sent = useVobEditor.getState(); host(vi.fn(async (c: string) => c === "vob.save" ? confirmation() : { ok: true, data: { file, header: [] } }));
    const saving = vobSave(); await vi.waitFor(() => expect(useAppDialog.getState().queue).toHaveLength(1));
    const row = sent.rules[0]; if (!row) throw new Error("Missing row"); useVobEditor.getState().update(row.id, { comment: "newer" });
    await choose("replace"); expect(await saving).toBe(true);
    expect(useVobEditor.getState().saved).toBe(sent.rules); expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  });
  it("interruption while deciding rejects the token instead of accepting a stale choice", async () => {
    let current = true; const call = vi.fn(async (c: string) => c === "vob.save" ? confirmation() : { ok: true, data: null }); host(call);
    const saving = vobSave(false, { isCurrent: () => current });
    await vi.waitFor(() => expect(useAppDialog.getState().queue).toHaveLength(1)); current = false;
    await choose("replace"); expect(await saving).toBe(false);
    expect(call).toHaveBeenLastCalledWith("vob.write.confirm", { confirmationId: "one", accept: false });
  });
  it("late confirmed write after interrupted close cannot mark saved or authorize", async () => {
    let release: ((raw: unknown) => void) | undefined;
    const call = vi.fn(async (c: string, p: unknown) => c === "vob.save" ? confirmation() : c === "vob.write.confirm" ? new Promise((r) => { release = r; }) : { ok: true, data: { requestId: (p as { requestId: string }).requestId, status: "cancelled" } }); host(call);
    const before = useVobEditor.getState(); const stayed = vi.fn();
    const coordinator = new VobCloseCoordinator({ call: request, ask: async () => true, blockLeave: (isCurrent) => shouldBlockLeave({ isDirty: () => vobDirtyPaths().length > 0, ask: async () => "save", save: () => vobSaveFiles(vobDirtyPaths(), isCurrent) }), report: vi.fn(), stayed });
    coordinator.setEnabled(true); coordinator.receive({ requestId: "close", reason: "native_window_close" }); await choose("replace");
    await vi.waitFor(() => expect(release).toBeDefined()); coordinator.setEnabled(false); coordinator.setEnabled(true);
    release?.({ ok: true, data: { file, header: [] } });
    await vi.waitFor(() => expect(stayed).toHaveBeenCalled());
    expect(call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.write.confirm", "vob.close.cancel"]);
    expect(useVobEditor.getState().saved).toBe(before.saved);
  });
  it("multidocument closure waits for both effective saves", async () => {
    rememberVobSession(); applyVobDocument({ file: other, rules: [{ trade: "1", object: "2", unit: "1", method: "2", formula: "B", comment: "old" }] });
    const row = useVobEditor.getState().rules[0]; if (!row) throw new Error("Missing row"); useVobEditor.getState().update(row.id, { comment: "dirty" });
    const call = vi.fn(async (c: string, p: unknown) => {
      if (c === "vob.save") { const target = (p as { file: typeof file }).file; return confirmation("vob.save", target.id, target.path); }
      if (c === "vob.write.confirm") return { ok: true, data: { file: (p as { confirmationId: string }).confirmationId === other.id ? other : file, header: [] } };
      return { ok: true, data: { requestId: "multi", status: "authorized" } };
    }); host(call);
    const coordinator = new VobCloseCoordinator({ call: request, ask: async () => true, blockLeave: (isCurrent) => shouldBlockLeave({ isDirty: () => vobDirtyPaths().length > 0, ask: async () => "save", save: () => vobSaveFiles(vobDirtyPaths(), isCurrent) }), report: vi.fn() });
    coordinator.setEnabled(true); coordinator.receive({ requestId: "multi", reason: "native_window_close" });
    await choose("replace"); await vi.waitFor(() => expect(useAppDialog.getState().queue).toHaveLength(1));
    expect(call.mock.calls.some(([c]) => c === "vob.close.authorize")).toBe(false);
    await choose("replace"); await vi.waitFor(() => expect(coordinator.requestId).toBeNull());
    expect(call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.write.confirm", "vob.save", "vob.write.confirm", "vob.close.authorize"]);
    expect(vobDirtyPaths()).toEqual([]);
  });
  it("malformed or mismatched structured confirmation is never accepted", async () => {
    const call = vi.fn(async () => confirmation("vob.save_as")); host(call);
    expect(await vobSave()).toBe(false); expect(call).toHaveBeenCalledTimes(1); expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  });
  it("successful replacement never grants approval to the next write", async () => {
    const call = vi.fn(async (c: string) => c === "vob.save" ? confirmation() : { ok: true, data: { file, header: [] } }); host(call);
    const first = vobSave(); await choose("replace"); expect(await first).toBe(true);
    const second = vobSave(); await choose("cancel"); expect(await second).toBe(false);
    expect(call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.write.confirm", "vob.save", "vob.write.confirm"]);
    expect(call).toHaveBeenLastCalledWith("vob.write.confirm", { confirmationId: "one", accept: false });
  });
  it("ETC cancellation cancels close once without offering another save dialog", async () => {
    const call = vi.fn(async (c: string) => c === "vob.save" ? confirmation() : { ok: true, data: c === "vob.write.confirm" ? null : { requestId: "cancel", status: "cancelled" } }); host(call);
    const stayed = vi.fn(); const coordinator = new VobCloseCoordinator({ call: request, ask: async () => true, blockLeave: (isCurrent) => shouldBlockLeave({ isDirty: () => vobDirtyPaths().length > 0, ask: async () => "save", save: () => vobSaveFiles(vobDirtyPaths(), isCurrent) }), report: vi.fn(), stayed });
    coordinator.setEnabled(true); coordinator.receive({ requestId: "cancel", reason: "native_window_close" }); await choose("cancel");
    await vi.waitFor(() => expect(stayed).toHaveBeenCalledExactlyOnceWith(true));
    expect(call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.write.confirm", "vob.close.cancel"]);
    expect(useAppDialog.getState().queue).toHaveLength(0); expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  });
  it("new edits during effective replacement cancel multidocument close instead of authorizing", async () => {
    let release: ((raw: unknown) => void) | undefined;
    const call = vi.fn(async (c: string) => c === "vob.save" ? confirmation() : c === "vob.write.confirm" ? new Promise((r) => { release = r; }) : { ok: true, data: { requestId: "new-edits", status: "cancelled" } }); host(call);
    const coordinator = new VobCloseCoordinator({ call: request, ask: async () => true, blockLeave: (isCurrent) => shouldBlockLeave({ isDirty: () => vobDirtyPaths().length > 0, ask: async () => "save", save: () => vobSaveFiles(vobDirtyPaths(), isCurrent) }), report: vi.fn() });
    coordinator.setEnabled(true); coordinator.receive({ requestId: "new-edits", reason: "native_window_close" }); await choose("replace");
    await vi.waitFor(() => expect(release).toBeDefined());
    const row = useVobEditor.getState().rules[0]; if (!row) throw new Error("Missing row"); useVobEditor.getState().update(row.id, { comment: "newest" });
    release?.({ ok: true, data: { file, header: [] } }); await vi.waitFor(() => expect(coordinator.requestId).toBeNull());
    expect(call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.write.confirm", "vob.close.cancel"]);
    expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  });
});