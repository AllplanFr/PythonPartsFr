import { afterEach, expect, it, vi } from "vitest";
import loaded from "../fixtures/aim-update/01-project-loaded.json";
import repeated from "../fixtures/aim-update/12-add-repeated-occurrence-updated.json";
import identity from "../fixtures/aim-update/21-host-identity-update.json";
import { callPresentationSave, canAdoptPresentationSaveWork, isWorkingStateV2, parsePresentationSave } from "@/modules/information_manager/lib/aim-working-contract";
import type { SaveRequest, WorkingStateV2 } from "@/modules/information_manager/contracts/AIM_PROJECT_MANAGER_CONTRACT";

const host = vi.hoisted(() => ({ info: null as unknown }));
vi.mock("@/shared/transport/native-binding", () => ({ getVerifiedAppInfo: () => host.info }));
const request: SaveRequest = { sessionId: "presentation-session", revision: 8, projectRevision: 3 };
function savedWork(): WorkingStateV2 {
  const presentation = structuredClone(repeated.presentation);
  const work: unknown = {
    revision: 9, sessionId: request.sessionId, projectRevision: 3,
    projectInstallation: { status: "unassociated" }, source: structuredClone(loaded),
    data: structuredClone(loaded.data), draftValues: { "7": "0" }, pendingImport: false,
    presentation: { ...presentation, model: { ...presentation.model, readOnly: false } },
    dirty: { values: true, presentation: false, any: true }, fileSaveAvailable: true,
    prjtoolsAvailable: false, save: { state: "idle", operationId: null, request: null, blockedReasons: [] },
  };
  if (!isWorkingStateV2(work)) throw new Error("Invalid saved work fixture");
  return work;
}
const reply = () => ({ ok: true, status: "saved", fileName: "ma-presentation.json", work: savedWork() });
afterEach(() => { vi.unstubAllGlobals(); host.info = null; });

it("sends exactly presentation.save and the confirmed triple, no path, values or export", async () => {
  host.info = { ...identity, read_only: false, working_state_contract: 2, project_save_contract: 1,
    project_save_capabilities: ["project.values.save", "project.values.save.status"],
    presentation_save_contract: 1, presentation_save_capabilities: ["presentation.save"] };
  const call = vi.fn(async () => reply());
  vi.stubGlobal("pywebview", { api: { call } });
  expect(await callPresentationSave(request)).toEqual(reply());
  expect(call.mock.calls).toEqual([["presentation.save", request]]);
});
it("accepts cancellation without a saved work state", () => {
  expect(parsePresentationSave({ ok: true, status: "cancelled" }, request)).toEqual({ ok: true, status: "cancelled" });
});
it("requires confirmed writing, never simple command acceptance", () => {
  expect(parsePresentationSave({ ok: true, status: "accepted" }, request)).toBeNull();
  expect(parsePresentationSave(undefined, request)).toBeNull();
});
it("accepts saved only with a newer revision and presentation acknowledgement", () => {
  expect(parsePresentationSave(reply(), request)).toEqual(reply());
  for (const work of [{ ...savedWork(), revision: 8 }, { ...savedWork(), dirty: { values: true, presentation: true, any: true } }]) {
    expect(parsePresentationSave({ ...reply(), work }, request)).toBeNull();
  }
});
it("rejects saved without an active presentation", () => {
  expect(parsePresentationSave({ ...reply(), work: { ...savedWork(), presentation: null } }, request)).toBeNull();
});
it("rejects saved with an unconfirmed import", () => {
  expect(parsePresentationSave({ ...reply(), work: { ...savedWork(), pendingImport: true } }, request)).toBeNull();
});
it("presentation saving cannot acknowledge remaining values via dirty.any=false", () => {
  expect(parsePresentationSave({ ...reply(), work: { ...savedWork(), dirty: { values: true, presentation: false, any: false } } }, request)).toBeNull();
});
it("rejects another session or changed project revision", () => {
  for (const work of [{ ...savedWork(), sessionId: "other" }, { ...savedWork(), projectRevision: 4 }]) {
    expect(parsePresentationSave({ ...reply(), work }, request)).toBeNull();
  }
});
it.each([false, true, null])("preserves explicit written=%s without converting failure to success", written => {
  const failure = { ok: false, status: written === false ? "failed" : "partial", written,
    error: { code: "write_or_verification_failed", message: "Fichier non confirmé" } };
  expect(parsePresentationSave(failure, request)).toEqual(failure);
});
it("absent capability sends no native command", async () => {
  host.info = identity;
  const call = vi.fn(); vi.stubGlobal("pywebview", { api: { call } });
  await expect(callPresentationSave(request)).rejects.toThrow("presentation_save_unavailable");
  expect(call).not.toHaveBeenCalled();
});
it.each([null, "", "0"])("presentation acknowledgement preserves the exact independent value %s", value => {
  const current = { ...savedWork(), revision: 8, draftValues: { "7": value }, dirty: { values: true, presentation: true, any: true } };
  const next = { ...savedWork(), draftValues: { "7": value } };
  expect(canAdoptPresentationSaveWork(current, next, request)).toBe(true);
  expect(canAdoptPresentationSaveWork(current, { ...next, draftValues: {} }, request)).toBe(false);
  expect(canAdoptPresentationSaveWork(current, { ...next, dirty: { values: false, presentation: false, any: false } }, request)).toBe(false);
});
it("rejects acknowledgement of a different presentation or another project", () => {
  const current = { ...savedWork(), revision: 8 };
  const next = savedWork();
  expect(canAdoptPresentationSaveWork(current, { ...next, presentation: null }, request)).toBe(false);
  expect(canAdoptPresentationSaveWork(current, { ...next, source: { ...next.source, project: { name: "Other", path: "other.prj" } } }, request)).toBe(false);
});