import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyVobDocument, vobSwitch, vobSaveFile, connectVobHost, useVobHost } from "@/lib/vob-bridge";
import { useVobEditor, vobHasChanges } from "@/lib/vob-editor";
import { clearVobSessions, peekVobSessionState, useVobResources } from "@/lib/vob-resources";
import { useAppDialog } from "@/lib/app-dialog";

const doc = (path: string) => ({ file: { id: path, name: `${path}.dat`, path: `C:/vob/${path}.dat` }, rules: [{ trade: "12", object: "62", unit: "1", method: "02", formula: "A", comment: path }] });
beforeEach(() => { clearVobSessions(); useVobResources.setState({ busy: false, backups: [], backupFile: null, addedFiles: [], addedProjects: [], favorites: [] }); useVobEditor.getState().setFiles([]); useAppDialog.setState({ queue: [] }); useVobHost.setState({ references: { kind: "none" } }); });
afterEach(() => { vi.useRealTimers(); delete window.pywebview; delete window.allplanLauncher; useAppDialog.setState({ queue: [] }); });

it("inactive session save timeout: one request, uncertain message, baseline kept, active untouched, no retry, late success ignored", async () => {
  applyVobDocument(doc("a"));
  const r = useVobEditor.getState().rules[0]!; useVobEditor.getState().update(r.id, { comment: "edited" });
  window.pywebview = { api: { call: async () => ({ ok: true, data: doc("b") }) } };
  const sw = vobSwitch("C:/vob/b.dat"); useAppDialog.getState().close("keep"); await sw;
  const pathA = "C:/vob/a.dat"; const before = peekVobSessionState(pathA)!;
  expect(vobHasChanges(before)).toBe(true);
  const activeBefore = useVobEditor.getState();
  useAppDialog.setState({ queue: [] });

  vi.useFakeTimers();
  let release!: (v: unknown) => void;
  const call = vi.fn(() => new Promise((res) => { release = res; }));
  window.pywebview = { api: { call: call as never } };
  const saving = vobSaveFile(pathA);
  await vi.advanceTimersByTimeAsync(30001);
  expect(await saving).toBe(false);
  expect(call).toHaveBeenCalledTimes(1);
  const msg = String((useAppDialog.getState().queue[0] as { text?: string } | undefined)?.text ?? "");
  expect(msg).toMatch(/incertain|uncertain/); expect(msg).toContain("a.dat"); expect(msg).toContain(pathA);
  const after = peekVobSessionState(pathA)!;
  expect(after.saved).toBe(before.saved); expect(vobHasChanges(after)).toBe(true);
  expect(useVobEditor.getState().file).toBe(activeBefore.file); expect(useVobEditor.getState().rules).toBe(activeBefore.rules);
  release({ ok: true, data: { file: doc("a").file } }); // late success
  await vi.advanceTimersByTimeAsync(60000);
  expect(call).toHaveBeenCalledTimes(1);
  expect(peekVobSessionState(pathA)!.saved).toBe(before.saved);
});

it("a reference reply after disconnect never overwrites the new connection's references", async () => {
  const pending: ((v: unknown) => void)[] = [];
  const refs = (n: string) => ({ trades: [{ index: 1, name: n }], objects: [], methods: [], units: [] });
  window.pywebview = { api: {
    get_app_info: async () => ({ app_id: "vob_editor" }),
    get_initial_data: async () => ({}),
    call: ((command: string) => command === "reference.load" ? new Promise((res) => pending.push(res)) : Promise.resolve({ ok: true, data: null })) as never,
  } as never };
  const stop1 = connectVobHost();
  await vi.waitFor(() => expect(pending).toHaveLength(1)); // request launched
  stop1(); // unmount
  const stop2 = connectVobHost(); // remount, new connection
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  pending[1]!({ ok: true, data: refs("new") });
  await vi.waitFor(() => expect((useVobHost.getState().references as { entries?: { trades: { name: string }[] } }).entries?.trades[0]?.name).toBe("new"));
  pending[0]!({ ok: true, data: refs("old") }); // stale reply
  await new Promise((r) => setTimeout(r, 10));
  expect((useVobHost.getState().references as { entries: { trades: { name: string }[] } }).entries.trades[0]?.name).toBe("new");
  stop2();
});
