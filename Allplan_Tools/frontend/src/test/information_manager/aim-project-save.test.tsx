import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import loaded from "../fixtures/aim-update/01-project-loaded.json";
import repeated from "../fixtures/aim-update/12-add-repeated-occurrence-updated.json";
import identity from "../fixtures/aim-update/21-host-identity-update.json";
import { AimEditor } from "@/modules/information_manager/AimEditor";
import { isWorkingState, isWorkingStateV2, parseWorking, parseWorkingV2, projectSaveAvailable, parseProjectSave, isSaveResult, canAdoptSaveWork } from "@/modules/information_manager/lib/aim-working-contract";
import type { WorkingStateV2, SaveRequest, SaveResult } from "@/modules/information_manager/contracts/AIM_PROJECT_MANAGER_CONTRACT";
import { useAppDialog } from "@/lib/app-dialog";
const host = vi.hoisted(() => ({ info: null as unknown }));
vi.mock("@/shared/transport/native-binding", async original => ({ ...await original<object>(), getVerifiedAppInfo: () => host.info }));
const info = { ...identity, read_only: false, working_state_contract: 2, project_save_contract: 1, project_save_capabilities: ["project.values.save", "project.values.save.status"] };
const request: SaveRequest = { sessionId: "session-one", revision: 8, projectRevision: 3 };
function initial(): WorkingStateV2 {
  const p = structuredClone(repeated.presentation);
  const candidate: unknown = { revision: 8, sessionId: "session-one", projectRevision: 3, projectInstallation: { status: "associated" }, source: structuredClone(loaded), data: structuredClone(loaded.data), draftValues: { "7": "Draft" }, pendingImport: false, presentation: { ...p, model: { ...p.model, readOnly: false } }, dirty: { values: true, presentation: true, any: true }, fileSaveAvailable: true, prjtoolsAvailable: false, save: { state: "idle", operationId: null, request: null, blockedReasons: [] } };
  if (!isWorkingStateV2(candidate)) throw Error("Invalid WorkV2 fixture");
  return candidate;
}
function result(status: SaveResult["status"] = "saved", tool = false): SaveResult {
  return { ok: status === "saved", status, stage: status === "saved" ? "complete" : status === "partial" ? "tool" : "validation", file: { written: status !== "failed", verified: status !== "failed" ? true : null, finalVerification: status === "saved" ? "confirmed" : "not_attempted", sourceSHA256: status !== "failed" ? "a".repeat(64) : null, backupId: null }, tool: { required: tool, launched: tool && status !== "failed", finished: tool && status !== "failed", returnCode: tool && status !== "failed" ? status === "saved" ? 0 : 2 : null, updateStatus: tool ? "unconfirmed" : "not_required", diagnosticId: null }, acknowledged: status === "saved", recoveryRequired: status === "partial", error: status === "saved" ? null : { code: status === "partial" ? "tool_failed" : "null_unspecified", message: status === "partial" ? "Outil échoué" : "Persistance de null non définie" }, message: status === "saved" ? "Enregistré" : status === "partial" ? "Fichier enregistré ; outil échoué" : "Aucune valeur écrite ; brouillons conservés" };
}
const flush = async () => { await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); }); };
beforeEach(() => { host.info = info; localStorage.clear(); localStorage.setItem("information_manager:lang", "fr"); globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); useAppDialog.setState({ queue: [] }); });
it("requires exact WorkV2/save markers and capabilities, never a number alone", () => {
  expect(projectSaveAvailable(info)).toBe(true);
  for (const change of [{ working_state_contract: 1 }, { working_state_contract: "2" }, { project_save_contract: undefined }, { project_save_capabilities: [] }, { project_save_capabilities: ["project.values.save"] }, { project_save_capabilities: [...info.project_save_capabilities, "extra"] }, { id: "vob_editor" }]) expect(projectSaveAvailable({ ...info, ...change })).toBe(false);
});
it("keeps V1 strict while parsing the exact V2 projection", () => {
  const w = initial();
  expect(isWorkingState(w)).toBe(false);
  expect(parseWorking("work.get", { ok: true, status: "current", work: w })).toBeNull();
  expect(isWorkingStateV2(w)).toBe(true);
  expect(parseWorkingV2("work.get", { ok: true, status: "current", work: w })).toBeTruthy();
  for (const change of [{ extra: true }, { sessionId: "" }, { projectRevision: -1 }, { save: { ...w.save, extra: true } }, { revision: Number.MAX_SAFE_INTEGER + 1 }]) expect(isWorkingStateV2({ ...w, ...change })).toBe(false);
  for (const value of [null, "", "0"]) expect(isWorkingStateV2({ ...w, draftValues: { "7": value } })).toBe(true);
});
it("validates exact direct save responses, correlation and terminal invariants", () => {
  expect(parseProjectSave("project.values.save", { ok: true, status: "accepted", operationId: "op", request }, request)).toBeTruthy();
  expect(parseProjectSave("project.values.save", { ok: true, data: { status: "accepted" } }, request)).toBeNull();
  expect(parseProjectSave("project.values.save", { ok: true, status: "accepted", operationId: "op", request: { ...request, sessionId: "old" } }, request)).toBeNull();
  for (const r of [result(), result("saved", true), result("partial", true), result("failed")]) expect(isSaveResult(r)).toBe(true);
  expect(isSaveResult({ ...result(), acknowledged: false })).toBe(false);
  expect(isSaveResult({ ...result("failed"), file: result().file })).toBe(false);
  expect(isSaveResult({ ...result("saved", true), tool: { ...result("saved", true).tool, returnCode: null } })).toBe(false);
});
type Mode = "saved" | "tool" | "partial" | "failed" | "lost-accept" | "lost-status" | "not-found" | "running" | "old-session" | "newer" | "refused";
async function mount(mode: Mode = "saved", setup?: (w: WorkingStateV2) => void) {
  let w = initial(); setup?.(w);
  let saves = 0;
  const call = vi.fn(async (command: string, payload: Record<string, unknown>) => {
    if (command === "work.get") return { ok: true, status: "current", work: structuredClone(w) };
    if (command === "work.value.set") {
      if (mode === "refused") return { ok: false, error: { code: "stale_work", message: "Révision périmée" } };
      w.revision++; w.draftValues["7"] = payload["value"] as string | null;
      for (const a of w.data.attributes) { a.value = payload["value"] as string | null; a.valueState = a.value === null ? "unset" : "set"; }
      if (w.presentation?.model.version === 1) for (const c of w.presentation.model.categories) for (const g of c.groups) for (const r of g.rows) { r.value = payload["value"] as string | null; r.valueState = r.value === null ? "unset" : "set"; }
      return { ok: true, status: "updated", work: structuredClone(w) };
    }
    if (command === "project.values.save") {
      saves++; w.save = { state: "running", operationId: "op", request: payload as SaveRequest, blockedReasons: ["save_busy"] };
      w.fileSaveAvailable = false;
      if (mode === "lost-accept") throw Error("lost acceptance");
      return { ok: true, status: "accepted", operationId: "op", request: payload };
    }
    if (command === "project.values.save.status") {
      if (mode === "lost-status") throw Error("lost status");
      if (mode === "not-found") return { ok: true, status: "not_found", request: payload };
      if (mode === "running") return { ok: true, status: "running", operationId: "op", request: payload, phase: "tool", file: result().file, tool: { ...result("saved", true).tool, finished: false, returnCode: null } };
      const r = result(mode === "partial" ? "partial" : mode === "failed" ? "failed" : "saved", mode === "tool" || mode === "partial");
      const completed = structuredClone(w);
      if (r.status === "saved") { completed.revision++; completed.projectRevision++; completed.draftValues = {}; completed.dirty.values = false; completed.dirty.any = completed.dirty.presentation; }
      completed.save.state = r.recoveryRequired ? "recovery_required" : "idle";
      if (mode === "old-session") w = { ...initial(), sessionId: "other-session" };
      else if (mode === "newer") { w = structuredClone(completed); w.revision += 2; w.draftValues = { "7": "Newer" }; w.dirty.values = true; }
      else w = structuredClone(completed);
      return { ok: true, status: "completed", operationId: "op", request: payload, result: r, work: mode === "old-session" ? null : completed };
    }
    throw Error(command);
  });
  vi.stubGlobal("pywebview", { api: { get_initial_data: async () => loaded, call } });
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  return { call, work: () => w, saves: () => saves, setMode: (next: Mode) => { mode = next; } };
}
const saveButton = () => {
  const button = screen.getAllByRole("button", { name: /^Enregistrer$/ }).find(e => e.getAttribute("aria-label") === "Enregistrer");
  if (!button) throw Error("missing toolbar save");
  return button;
};
it("historical backend leaves Save unavailable and sends no save", async () => {
  host.info = { ...identity, read_only: false, working_state_contract: 1 };
  const w = initial(); const { sessionId: _s, projectRevision: _p, projectInstallation: _i, save: _save, ...v1 } = w;
  const call = vi.fn(async (_command: string, _payload: unknown) => ({ ok: true, status: "current", work: { ...v1, fileSaveAvailable: false, prjtoolsAvailable: false } }));
  vi.stubGlobal("pywebview", { api: { get_initial_data: async () => loaded, call } });
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  expect(saveButton()).toBeDisabled(); fireEvent.click(saveButton()); await flush();
  expect(call.mock.calls.map(c => c[0])).toEqual(["work.get"]);
});
it("sends only the confirmed triple once, then status, preserving presentation dirty", async () => {
  const h = await mount(); fireEvent.click(saveButton()); fireEvent.click(saveButton()); await flush();
  expect(h.saves()).toBe(1);
  expect(h.call).toHaveBeenCalledWith("project.values.save", request);
  expect(h.call).toHaveBeenCalledWith("project.values.save.status", request);
  expect(h.work().dirty).toEqual({ values: false, presentation: true, any: true });
  expect(h.work().draftValues).toEqual({});
});
it("flushes active changed input before capturing the newer Python revision", async () => {
  const h = await mount(); const cell = screen.getAllByRole("textbox", { name: "Modifier la valeur 7" })[0];
  if (!cell) throw Error("missing cell");
  fireEvent.change(cell, { target: { value: "typed" } }); fireEvent.click(saveButton()); await flush();
  expect(h.call).toHaveBeenCalledWith("work.value.set", { revision: 8, number: "7", value: "typed" });
  expect(h.call).toHaveBeenCalledWith("project.values.save", { ...request, revision: 9 });
});
it("lost acceptance rereads save.request and follows it without repeating save", async () => {
  const h = await mount("lost-accept"); fireEvent.click(saveButton()); await flush();
  expect(h.saves()).toBe(1);
  expect(h.call.mock.calls.map(c => c[0])).toEqual(["work.get", "project.values.save", "work.get", "project.values.save.status", "work.get"]);
});
for (const mode of ["lost-status", "not-found"] as const) it(`${mode} keeps drafts and blocks a new save without claiming no writing`, async () => {
  const h = await mount(mode); fireEvent.click(saveButton()); await flush();
  expect(h.work().draftValues).toEqual({ "7": "Draft" }); expect(saveButton()).toBeDisabled();
  fireEvent.click(saveButton()); await flush(); expect(h.saves()).toBe(1);
  expect(screen.getByRole("button", { name: "Consulter le suivi" })).toBeEnabled();
});
for (const mode of ["tool", "partial", "failed"] as const) it(`${mode} preserves exact backend effects and presentation dirty`, async () => {
  const h = await mount(mode); fireEvent.click(saveButton()); await flush();
  expect(h.work().dirty.presentation).toBe(true);
  expect(h.work().draftValues).toEqual(mode === "tool" ? {} : { "7": "Draft" });
  expect(h.saves()).toBe(1);
  if (mode === "partial") expect(saveButton()).toBeDisabled();
});
it("running freezes mutations, project changes and normal closure, not a worker timeout", async () => {
  vi.useFakeTimers(); const h = await mount("running"); fireEvent.click(saveButton()); await flush();
  expect(screen.getAllByRole("textbox", { name: "Modifier la valeur 7" })[0]).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Choisir un projet Allplan" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Quitter" })[0] as HTMLElement); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(h.call.mock.calls.filter(c => c[0] === "project.values.save.status")).toHaveLength(4);
  expect(h.call.mock.calls.some(c => c[0] === "work.transition" || c[0] === "work.close")).toBe(false);
  expect(h.saves()).toBe(1);
});
it("null in unchanged attributes is not a frontend block, exact null drafts remain Python-owned", async () => {
  const h = await mount("failed", w => { w.data.attributes[0] = { ...w.data.attributes[0] as NonNullable<typeof w.data.attributes[0]>, value: null, valueState: "unset" }; w.draftValues = { "7": null }; });
  fireEvent.click(saveButton()); await flush();
  expect(h.call).toHaveBeenCalledWith("project.values.save", request);
  expect(h.work().draftValues).toEqual({ "7": null });
});
it("refused blur draft remains visible and Save never retries its mutation or sends save", async () => {
  const h = await mount("refused");
  const cell = screen.getAllByRole("textbox", { name: "Modifier la valeur 7" })[0];
  if (!cell) throw Error("missing cell");
  fireEvent.change(cell, { target: { value: "Not lost" } }); fireEvent.keyDown(cell, { key: "Enter" }); await flush();
  fireEvent.click(saveButton()); await flush();
  expect(h.call.mock.calls.filter(c => c[0] === "work.value.set")).toHaveLength(1);
  expect(h.saves()).toBe(0); expect(cell).toHaveValue("Not lost");
});
it("invalid local numeric draft blocks Save and sends no mutation", async () => {
  const h = await mount("saved", w => {
    if (w.presentation?.configuration.version === 1 && w.presentation.model.version === 1) {
      for (const c of w.presentation.configuration.categories) for (const g of c.groups) for (const r of g.rows) { if (r.widget === "entry") r.type = "FLOAT"; }
      for (const c of w.presentation.model.categories) for (const g of c.groups) for (const r of g.rows) { if (r.widget === "entry") r.type = "FLOAT"; }
    }
  });
  const cell = screen.getAllByRole("textbox", { name: "Modifier la valeur 7" })[0];
  if (!cell) throw Error("missing cell");
  fireEvent.change(cell, { target: { value: "-" } }); fireEvent.click(saveButton()); await flush();
  expect(h.saves()).toBe(0); expect(h.call.mock.calls.filter(c => c[0] === "work.value.set")).toHaveLength(0); expect(cell).toHaveValue("-");
});
it("does not adopt a terminal snapshot across sessions, projects or newer revisions", () => {
  const current = initial(); const newer = { ...initial(), revision: 10, projectRevision: 4 };
  expect(canAdoptSaveWork(current, newer, request)).toBe(true);
  expect(canAdoptSaveWork(newer, current, request)).toBe(false);
  expect(canAdoptSaveWork(current, { ...newer, sessionId: "other" }, request)).toBe(false);
  expect(canAdoptSaveWork({ ...current, sessionId: "other" }, newer, request)).toBe(false);
  expect(canAdoptSaveWork(current, { ...newer, source: { ...newer.source, project: { name: "Other", path: "other" } } }, request)).toBe(false);
});
it("terminal work=null rereads current session without adopting old acknowledgement", async () => {
  const h = await mount("old-session"); fireEvent.click(saveButton()); await flush();
  expect(h.call.mock.calls.map(c => c[0])).toEqual(["work.get", "project.values.save", "project.values.save.status", "work.get"]);
  expect(h.work().sessionId).toBe("other-session"); expect(h.work().draftValues).toEqual({ "7": "Draft" });
});
it("terminal evidence cannot erase an edit newer than its work snapshot", async () => {
  const h = await mount("newer"); fireEvent.click(saveButton()); await flush();
  expect(h.work().revision).toBe(11); expect(h.work().draftValues).toEqual({ "7": "Newer" });
  expect(screen.getByLabelText("État des modifications")).toHaveAttribute("data-edit-state", "modified");
});
it("manual status recovery follows the same request and never resubmits save", async () => {
  const h = await mount("lost-status"); fireEvent.click(saveButton()); await flush();
  h.setMode("saved"); fireEvent.click(screen.getByRole("button", { name: "Consulter le suivi" })); await flush();
  expect(h.saves()).toBe(1); expect(h.call.mock.calls.filter(c => c[0] === "project.values.save.status")).toHaveLength(2);
  expect(h.work().dirty.values).toBe(false);
});
it("remount projection recovers save.request without ever issuing save", async () => {
  const h = await mount("saved", w => { w.save = { state: "running", operationId: "op", request, blockedReasons: ["save_busy"] }; w.fileSaveAvailable = false; });
  expect(h.saves()).toBe(0); expect(h.call).toHaveBeenCalledWith("project.values.save.status", request);
});
it("WorkV2 with absent save capabilities stays visibly unavailable without work commands", async () => {
  host.info = { ...info, project_save_capabilities: [] };
  const call = vi.fn(); vi.stubGlobal("pywebview", { api: { get_initial_data: async () => loaded, call } });
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  expect(saveButton()).toBeDisabled(); expect(call).not.toHaveBeenCalled();
});
it("read_only profile never sends save even with a true file availability flag", async () => {
  host.info = { ...info, read_only: true }; const h = await mount();
  expect(saveButton()).toBeDisabled(); fireEvent.click(saveButton()); await flush(); expect(h.saves()).toBe(0);
});it("first local edit on a clean no_changes state can prepare Save, then flushes before dispatch", async () => {
  const h = await mount("saved", w => { w.draftValues = {}; w.dirty = { values: false, presentation: false, any: false }; w.fileSaveAvailable = false; w.save.blockedReasons = ["no_changes"]; });
  expect(saveButton()).toBeDisabled();
  const cell = screen.getAllByRole("textbox", { name: "Modifier la valeur 7" })[0]; if (!cell) throw Error("missing cell");
  h.work().fileSaveAvailable = true; h.work().save.blockedReasons = [];
  fireEvent.change(cell, { target: { value: "first" } }); await flush();
  expect(saveButton()).toBeEnabled(); fireEvent.click(saveButton()); await flush();
  expect(h.call).toHaveBeenCalledWith("project.values.save", { ...request, revision: 9 });
});
it("refused local input marks the editor modified", async () => {
  const h = await mount("refused", w => { w.draftValues = {}; w.dirty = { values: false, presentation: false, any: false }; });
  const cell = screen.getAllByRole("textbox", { name: "Modifier la valeur 7" })[0]; if (!cell) throw Error("missing cell");
  fireEvent.change(cell, { target: { value: "kept" } }); fireEvent.keyDown(cell, { key: "Enter" }); await flush();
  expect(screen.getByLabelText("État des modifications")).toHaveAttribute("data-edit-state", "modified"); expect(h.saves()).toBe(0);
});
const toolText = /Outil Allplan associé indisponible/;
it("external project with definitions installation: no missing-tool warning, Save allowed", async () => {
  await mount("saved", w => { w.projectInstallation = { status: "unassociated" }; w.prjtoolsAvailable = false; expect(w.source.installation).toBeTruthy(); });
  expect(screen.queryByText(toolText)).toBeNull(); expect(saveButton()).toBeEnabled();
});
it("associated project warns only when its tool is unavailable", async () => {
  await mount("saved", w => { w.prjtoolsAvailable = false; });
  expect(screen.getAllByText(toolText).length).toBeGreaterThan(0); expect(saveButton()).toBeEnabled();
  cleanup();
  await mount("saved", w => { w.prjtoolsAvailable = true; });
  expect(screen.queryByText(toolText)).toBeNull(); expect(saveButton()).toBeEnabled();
});
it("unknown membership disables Save without external-project wording or save command", async () => {
  const h = await mount("saved", w => { w.projectInstallation = { status: "unknown" }; });
  expect(saveButton()).toBeDisabled(); expect(saveButton().getAttribute("title")).toMatch(/non établie/);
  expect(screen.queryByText(toolText)).toBeNull(); expect(document.body.textContent).not.toMatch(/externe/i);
  fireEvent.click(saveButton()); await flush(); expect(h.saves()).toBe(0);
});
it("membership never overrides fileSaveAvailable=false", async () => {
  await mount("saved", w => { w.draftValues = {}; w.fileSaveAvailable = false; w.projectInstallation = { status: "unassociated" }; });
  expect(saveButton()).toBeDisabled();
});
it("WorkV2 requires the closed projectInstallation field; completed.work carries it; V1 unchanged", () => {
  const w = initial();
  const { projectInstallation: _i, ...missing } = w;
  expect(isWorkingStateV2(missing)).toBe(false);
  for (const bad of [{ status: "external" }, { status: "associated", extra: 1 }, {}, null]) expect(isWorkingStateV2({ ...w, projectInstallation: bad })).toBe(false);
  for (const status of ["associated", "unassociated", "unknown"]) expect(isWorkingStateV2({ ...w, projectInstallation: { status } })).toBe(true);
  const completed = { ok: true, status: "completed", operationId: "op", request, result: result(), work: { ...w, projectInstallation: { status: "unassociated" } } };
  expect(parseProjectSave("project.values.save.status", completed, request)).toBeTruthy();
  expect(parseProjectSave("project.values.save.status", { ...completed, work: missing }, request)).toBeNull();
  const { sessionId: _s, projectRevision: _p, save: _v, projectInstallation: _x, ...v1 } = w;
  expect(isWorkingState({ ...v1, fileSaveAvailable: false, prjtoolsAvailable: false })).toBe(true);
  expect(isWorkingState({ ...v1, fileSaveAvailable: false, prjtoolsAvailable: false, projectInstallation: { status: "associated" } })).toBe(false);
});
