import { describe, expect, it, vi } from "vitest";
import { VobCloseCoordinator, VOB_CLOSE_COMMANDS, vobCloseAvailable } from "@/lib/vob-close";
import { shouldBlockLeave } from "@/suite/leave-guard";
const event = { requestId: "host-1", reason: "native_window_close" };
function setup() {
  const call = vi.fn(async (command: string, payload: object) => command === "vob.close.ready" ? { status: "ready" } : command === "vob.close.request" ? { requestId: "host-1", status: "requested" } : { requestId: (payload as { requestId: string }).requestId, status: command.endsWith("authorize") ? "authorized" : "cancelled" });
  const ask = vi.fn(async () => false); const blockLeave = vi.fn(async () => false); const report = vi.fn();
  const coordinator = new VobCloseCoordinator({ call, ask, blockLeave, report }); coordinator.setEnabled(true);
  return { coordinator, call, ask, blockLeave, report };
}
describe("event-owned VOB close", () => {
  it.each(VOB_CLOSE_COMMANDS)("missing %s prevents activation", (missing) => {
    expect(vobCloseAvailable({ app_id: "vob_editor", capabilities: VOB_CLOSE_COMMANDS.filter((c) => c !== missing) })).toBe(false);
  });
  it("requires exact identity and all four announced commands", () => {
    expect(vobCloseAvailable({ id: "vob_editor", capabilities: [...VOB_CLOSE_COMMANDS] })).toBe(true);
    expect(vobCloseAvailable({ id: "smartcatalog", capabilities: [...VOB_CLOSE_COMMANDS] })).toBe(false);
    expect(vobCloseAvailable({ id: "vob_editor" })).toBe(false);
  });
  it("disabled coordinator sends no commands and opens no dialog", async () => {
    const s = setup(); s.coordinator.setEnabled(false); await s.coordinator.ready(); await s.coordinator.request(); s.coordinator.receive(event);
    expect(s.call).not.toHaveBeenCalled(); expect(s.ask).not.toHaveBeenCalled();
  });
  it("request ack before event never opens a dialog", async () => {
    const s = setup(); await s.coordinator.request(); expect(s.ask).not.toHaveBeenCalled(); s.coordinator.receive(event);
    await vi.waitFor(() => expect(s.call).toHaveBeenCalledWith("vob.close.cancel", { requestId: "host-1" }));
  });
  it("event before request ack and repeated events open only one dialog", async () => {
    const s = setup(); s.call.mockImplementation(async (command, payload) => {
      if (command === "vob.close.request") { s.coordinator.receive(event); s.coordinator.receive(event); return { requestId: "host-1", status: "requested" }; }
      return { requestId: (payload as { requestId: string }).requestId, status: "cancelled" };
    });
    await s.coordinator.request(); await vi.waitFor(() => expect(s.coordinator.requestId).toBeNull()); s.coordinator.receive(event);
    expect(s.ask).toHaveBeenCalledTimes(1);
  });
  it("return or dismissed dialog cancels without save guard", async () => {
    const s = setup(); s.coordinator.receive(event); await vi.waitFor(() => expect(s.coordinator.requestId).toBeNull());
    expect(s.blockLeave).not.toHaveBeenCalled(); expect(s.call).toHaveBeenCalledExactlyOnceWith("vob.close.cancel", { requestId: "host-1" });
  });
  it.each(["stay", "save"] as const)("cancelled/failed save (%s) cancels and never authorizes", async (decision) => {
    const s = setup(); s.ask.mockResolvedValue(true); const save = vi.fn(async () => false);
    s.blockLeave.mockImplementation(() => shouldBlockLeave({ isDirty: () => true, ask: async () => decision, save }));
    s.coordinator.receive(event); await vi.waitFor(() => expect(s.coordinator.requestId).toBeNull());
    expect(s.call).toHaveBeenCalledExactlyOnceWith("vob.close.cancel", { requestId: "host-1" }); expect(save).toHaveBeenCalledTimes(decision === "save" ? 1 : 0);
  });
  it("verified save or explicit discard authorizes once, ignores later events", async () => {
    const s = setup(); s.ask.mockResolvedValue(true); s.coordinator.receive(event); s.coordinator.receive(event);
    await vi.waitFor(() => expect(s.coordinator.requestId).toBeNull()); s.coordinator.receive({ ...event, requestId: "later" }); await s.coordinator.request();
    expect(s.blockLeave).toHaveBeenCalledTimes(1); expect(s.call).toHaveBeenCalledExactlyOnceWith("vob.close.authorize", { requestId: "host-1" }); expect(s.ask).toHaveBeenCalledTimes(1);
  });
  it("a save reply after disable/re-enable cannot revive the old close attempt", async () => {
    const s = setup(); s.ask.mockResolvedValue(true);
    let release: ((blocked: boolean) => void) | undefined;
    s.blockLeave.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    s.coordinator.receive(event);
    await vi.waitFor(() => expect(s.blockLeave).toHaveBeenCalledTimes(1));
    s.coordinator.setEnabled(false); s.coordinator.setEnabled(true);
    release?.(false);
    await vi.waitFor(() => expect(s.call).toHaveBeenCalledExactlyOnceWith("vob.close.cancel", { requestId: "host-1" }));
    expect(s.coordinator.requestId).toBeNull();
  });
  it("a confirmed cancellation prevents replay or late continuation from authorizing the same id", async () => {
    const s = setup(); let release: ((blocked: boolean) => void) | undefined;
    s.ask.mockResolvedValue(true);
    s.blockLeave.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    s.coordinator.receive(event);
    await vi.waitFor(() => expect(s.blockLeave).toHaveBeenCalledTimes(1));
    s.coordinator.setEnabled(false); s.coordinator.setEnabled(true);
    release?.(false);
    await vi.waitFor(() => expect(s.coordinator.requestId).toBeNull());
    s.coordinator.receive(event); await s.coordinator.request();
    expect(s.call.mock.calls.map(([command]) => command)).toEqual(["vob.close.cancel", "vob.close.request"]);
    expect(s.blockLeave).toHaveBeenCalledTimes(1);
  });
  it("blocked saves also return to editing after confirmed cancellation", async () => {
    const stayed = vi.fn(); const s = setup(); s.ask.mockResolvedValue(true); s.blockLeave.mockResolvedValue(true);
    const coordinator = new VobCloseCoordinator({ call: s.call, ask: s.ask, blockLeave: s.blockLeave, report: s.report, stayed });
    coordinator.setEnabled(true); coordinator.receive(event);
    await vi.waitFor(() => expect(stayed).toHaveBeenCalledTimes(1));
    expect(s.call).toHaveBeenCalledExactlyOnceWith("vob.close.cancel", { requestId: "host-1" });
  });
  it("transport error retains active id for manual same-request recovery", async () => {
    const s = setup(); s.call.mockRejectedValueOnce(new Error("transport lost")); s.coordinator.receive(event);
    await vi.waitFor(() => expect(s.report).toHaveBeenCalledTimes(1)); expect(s.coordinator.requestId).toBe("host-1");
    s.coordinator.receive(event); expect(s.ask).toHaveBeenCalledTimes(1); await s.coordinator.request();
    expect(s.coordinator.requestId).toBeNull(); expect(s.call.mock.calls.map((c) => c[0])).toEqual(["vob.close.cancel", "vob.close.cancel"]);
  });
  it("ignored and wrong-id replies never acknowledge or erase current request", async () => {
    for (const reply of [{ requestId: "host-1", status: "ignored", reason: "not_current_request" }, { requestId: "old", status: "cancelled" }]) {
      const s = setup(); s.call.mockResolvedValueOnce(reply); s.coordinator.receive(event); await vi.waitFor(() => expect(s.report).toHaveBeenCalledTimes(1));
      expect(s.coordinator.requestId).toBe("host-1");
    }
  });
  it("repeated ready reemissions deduplicate and ready error grants nothing", async () => {
    const s = setup();
    const error = new Error("vob.close.ready transport lost");
    s.call.mockRejectedValueOnce(error);
    await s.coordinator.ready();
    expect(s.report).toHaveBeenCalledExactlyOnceWith(error);
    expect(s.call).toHaveBeenCalledExactlyOnceWith("vob.close.ready", {});
    expect(s.coordinator.requestId).toBeNull();
    expect(s.ask).not.toHaveBeenCalled();
    expect(s.blockLeave).not.toHaveBeenCalled();

    // No automatic retry: only a subsequent explicit ready resumes listening.
    s.call.mockImplementation(async () => { s.coordinator.receive(event); return { status: "ready" }; });
    s.ask.mockImplementation(() => new Promise(() => {}));
    await s.coordinator.ready();
    expect(s.ask).toHaveBeenCalledTimes(1); expect(s.coordinator.requestId).toBe("host-1");

    // A ready failure while pending cannot clear or acknowledge the active request.
    s.call.mockRejectedValueOnce(error);
    await s.coordinator.ready();
    expect(s.report).toHaveBeenCalledTimes(2);
    expect(s.coordinator.requestId).toBe("host-1");
    await s.coordinator.ready();
    expect(s.ask).toHaveBeenCalledTimes(1);
    expect(s.coordinator.requestId).toBe("host-1");
    expect(s.blockLeave).not.toHaveBeenCalled();
    expect(s.call.mock.calls).toEqual([
      ["vob.close.ready", {}], ["vob.close.ready", {}],
      ["vob.close.ready", {}], ["vob.close.ready", {}],
    ]); // Neither cancel nor authorize was sent, including after manual recovery.
  });
});