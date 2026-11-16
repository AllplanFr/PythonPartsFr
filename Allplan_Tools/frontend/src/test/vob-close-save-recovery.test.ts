import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyVobDocument, vobSaveFiles } from "@/lib/vob-bridge";
import { useVobEditor, vobHasChanges } from "@/lib/vob-editor";
import { clearVobSessions, rememberVobSession, peekVobSessionState, vobDirtyPaths } from "@/lib/vob-resources";
import { useAppDialog } from "@/lib/app-dialog";
import { VobCloseCoordinator } from "@/lib/vob-close";
import { shouldBlockLeave } from "@/suite/leave-guard";

const file = { id: "synthetic-etc", path: "C:/synthetic/ETC/protected.fra", name: "protected.fra", source: "ETC", version: "2027" };
const copy = { id: "synthetic-copy", path: "C:/synthetic/user/copy.fra", name: "copy.fra", source: "USER" };
const event = { requestId: "close-1", reason: "native_window_close" };
beforeEach(() => {
  clearVobSessions(); useAppDialog.setState({ queue: [] });
  applyVobDocument({ file, rules: [{ trade: "001", object: "0035", unit: "1", method: "2", formula: "A", comment: "original" }] });
  const row = useVobEditor.getState().rules[0]; if (!row) throw new Error("Missing fixture");
  useVobEditor.getState().update(row.id, { comment: "unsaved" });
});
afterEach(() => { delete window.pywebview; clearVobSessions(); useAppDialog.setState({ queue: [] }); });

function setup(outcome: "success" | "cancel" | "failure", inactive = false) {
  if (inactive) {
    rememberVobSession();
    applyVobDocument({ file: { id: "other", name: "other.fra", path: "C:/synthetic/other.fra" }, rules: [] });
  }
  const paths = vobDirtyPaths();
  let release: ((reply: unknown) => void) | undefined;
  const call = vi.fn(async (command: string, payload: unknown) => {
    if (command === "vob.save") return { ok: false, error: { code: "error", message: "Synthetic refused write" } };
    if (command === "vob.save_as") return new Promise((resolve) => { release = resolve; });
    return { ok: true, data: { requestId: (payload as { requestId: string }).requestId, status: command.endsWith("authorize") ? "authorized" : "cancelled" } };
  });
  window.pywebview = { api: { call: call as never } };
  const stayed = vi.fn();
  const coordinator = new VobCloseCoordinator({
    call: async (command, payload) => {
      const reply = await call(command, payload);
      return (reply as { data?: unknown }).data;
    },
    ask: async () => true,
    blockLeave: (isCurrent) => shouldBlockLeave({ isDirty: () => vobDirtyPaths().length > 0, ask: async () => "save", save: () => vobSaveFiles(paths, isCurrent) }),
    report: vi.fn(), stayed,
  });
  coordinator.setEnabled(true);
  return { coordinator, call, stayed, release: () => release?.(outcome === "success" ? { ok: true, data: { file: copy } } : outcome === "cancel" ? { ok: true, data: null } : { ok: false, error: { code: "error", message: "Synthetic save-as failure" } }) };
}
async function pickSaveAs() {
  await vi.waitFor(() => expect(useAppDialog.getState().queue).toHaveLength(2));
  useAppDialog.getState().close(); // Preserve the exact bridge message, then explicitly choose recovery.
  useAppDialog.getState().close("save_as");
}
describe("protected VOB close save recovery", () => {
  it.each([false, true])("waits for acknowledged save-as before authorize (inactive=%s)", async (inactive) => {
    const before = useVobEditor.getState(); const s = setup("success", inactive);
    s.coordinator.receive(event); await pickSaveAs();
    await vi.waitFor(() => expect(s.call.mock.calls.some(([c]) => c === "vob.save_as")).toBe(true));
    expect(s.call.mock.calls.some(([c]) => c === "vob.close.authorize")).toBe(false);
    if (!inactive) { expect(useVobEditor.getState().saved).toBe(before.saved); expect(vobHasChanges(useVobEditor.getState())).toBe(true); }
    s.release(); await vi.waitFor(() => expect(s.coordinator.requestId).toBeNull());
    expect(s.call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.save_as", "vob.close.authorize"]);
    expect(vobDirtyPaths()).toEqual([]);
    if (inactive) { expect(peekVobSessionState(file.path)).toBeNull(); expect(peekVobSessionState(copy.path)?.file).toEqual(copy); expect(useVobEditor.getState().file?.id).toBe("other"); }
  });
  it.each(["cancel", "failure"] as const)("save-as %s cancels closure and retains dirty original", async (outcome) => {
    const before = useVobEditor.getState(); const s = setup(outcome);
    s.coordinator.receive(event); await pickSaveAs();
    await vi.waitFor(() => expect(s.call.mock.calls.some(([c]) => c === "vob.save_as")).toBe(true));
    s.release(); await vi.waitFor(() => expect(s.stayed).toHaveBeenCalledExactlyOnceWith(true));
    expect(s.call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.save_as", "vob.close.cancel"]);
    expect(useVobEditor.getState().file).toBe(before.file); expect(useVobEditor.getState().rules).toBe(before.rules);
    expect(useVobEditor.getState().saved).toBe(before.saved); expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  });
  it("return to editing after refusal does not launch save-as or authorize", async () => {
    const before = useVobEditor.getState(); const s = setup("success"); s.coordinator.receive(event);
    await vi.waitFor(() => expect(useAppDialog.getState().queue).toHaveLength(2));
    useAppDialog.getState().close(); useAppDialog.getState().close("stay");
    await vi.waitFor(() => expect(s.stayed).toHaveBeenCalledExactlyOnceWith(true));
    expect(s.call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.close.cancel"]);
    expect(useVobEditor.getState().rules).toBe(before.rules); expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  });
  it("an interrupted save-as success cannot authorize the abandoned close attempt", async () => {
    const s = setup("success"); s.coordinator.receive(event); await pickSaveAs();
    await vi.waitFor(() => expect(s.call.mock.calls.some(([c]) => c === "vob.save_as")).toBe(true));
    s.coordinator.setEnabled(false); s.coordinator.setEnabled(true); s.release();
    await vi.waitFor(() => expect(s.stayed).toHaveBeenCalledExactlyOnceWith(true));
    expect(s.call.mock.calls.map(([c]) => c)).toEqual(["vob.save", "vob.save_as", "vob.close.cancel"]);
  });
});