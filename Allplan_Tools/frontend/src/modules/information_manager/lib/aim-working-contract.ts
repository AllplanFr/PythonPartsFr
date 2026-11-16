import type { WorkingState, WorkingRequests, WorkingResponses, WorkingPresentation, WorkingProfileResponses, WorkingStateV2, NegotiatedWorkingResponses, WorkingResponsesV2, SaveRequest, SaveAccepted, SaveStatus, SaveResult } from "../contracts/AIM_PROJECT_MANAGER_CONTRACT";
import { parseAimProjectSnapshot } from "./aim-project-contract";
import { isPresentationStructure, isReport } from "./aim-presentation-contract";
import { getVerifiedAppInfo } from "@/shared/transport/native-binding";

export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const numberKey = (v: unknown): v is string => typeof v === "string" && /^(0|[1-9]\d*)$/.test(v);

/** Independent opt-in; never relax the historical identity/capability validators. */
export function workingAvailable(info: unknown): boolean {
  return object(info) && info["id"] === "information_manager" && info["project_contract"] === 2 && info["working_state_contract"] === 1;
}
export function projectSaveAvailable(info: unknown): boolean {
  if (!object(info) || info["id"] !== "information_manager" || info["project_contract"] !== 2 || info["working_state_contract"] !== 2 || info["project_save_contract"] !== 1) return false;
  const caps = info["project_save_capabilities"];
  return Array.isArray(caps) && caps.length === 2 && caps[0] === "project.values.save" && caps[1] === "project.values.save.status";
}
export const workingProfileAvailable = (info: unknown) => workingAvailable(info) || projectSaveAvailable(info);
export const workingEditable = (info: unknown) => workingProfileAvailable(info) && object(info) && info["read_only"] === false;
export function presentationSaveAvailable(info: unknown): boolean {
  if (!projectSaveAvailable(info) || !object(info) || info["presentation_save_contract"] !== 1) return false;
  const caps = info["presentation_save_capabilities"];
  return Array.isArray(caps) && caps.length === 1 && caps[0] === "presentation.save";
}
export const saveCloseAvailable = (info: unknown) => presentationSaveAvailable(info) && object(info) && info["work_close_contract"] === 1;

export type PresentationSaveReply =
  | { ok: true; status: "saved"; fileName: string; work: WorkingStateV2 }
  | { ok: true; status: "cancelled" }
  | { ok: false; status?: "failed" | "partial"; written?: boolean | null; error: { code: string; message: string } };

export function parsePresentationSave(raw: unknown, request: SaveRequest): PresentationSaveReply | null {
  if (!isSaveRequest(request)) return null;
  if (object(raw)) {
    if (exact(raw, ["ok", "status"]) && raw["ok"] === true && raw["status"] === "cancelled") return { ok: true, status: "cancelled" };
    if (raw["ok"] === false && errorDetail(raw["error"])) {
      if (exact(raw, ["ok", "error"]) || exact(raw, ["ok", "status", "written", "error"])
          && (raw["status"] === "failed" && raw["written"] === false || raw["status"] === "partial" && (raw["written"] === true || raw["written"] === null))) return raw as PresentationSaveReply;
    }
    if (raw["ok"] === true && raw["status"] === "saved" && exact(raw, ["ok", "status", "fileName", "work"])
        && opaque(raw["fileName"]) && isWorkingStateV2(raw["work"]) && raw["work"].sessionId === request.sessionId
        && raw["work"].revision > request.revision && raw["work"].projectRevision === request.projectRevision
        && raw["work"].presentation !== null && raw["work"].pendingImport === false
        && raw["work"].dirty.presentation === false
        && raw["work"].dirty.any === raw["work"].dirty.values) return raw as PresentationSaveReply;
  }
  return null;
}
export async function callPresentationSave(request: SaveRequest): Promise<PresentationSaveReply> {
  if (!presentationSaveAvailable(getVerifiedAppInfo()) || !isSaveRequest(request)) throw new Error("presentation_save_unavailable");
  const api = (globalThis as unknown as { pywebview?: { api?: { call?: (c: string, p: unknown) => Promise<unknown> } } }).pywebview?.api;
  if (!api?.call) throw new Error("binding_unavailable");
  const parsed = parsePresentationSave(await api.call("presentation.save", request), request);
  if (!parsed) throw new Error("Réponse incompatible : presentation.save");
  return parsed;
}
/** Presentation acknowledgement must never erase independent value changes. */
export function canAdoptPresentationSaveWork(current: WorkingStateV2, next: WorkingStateV2, request: SaveRequest): boolean {
  return canAdoptSaveWork(current, next, request)
    && JSON.stringify(next.presentation?.configuration) === JSON.stringify(current.presentation?.configuration)
    && JSON.stringify(next.draftValues) === JSON.stringify(current.draftValues)
    && next.dirty.values === current.dirty.values;
}
/** Capability consumers may reuse their unchanged lists, after the working identity has been checked separately. */
export function presentationIdentity(info: unknown): unknown {
  return workingProfileAvailable(info) && object(info) ? { ...info, read_only: true } : info;
}
export function isWorkingPresentation(raw: unknown): raw is WorkingPresentation {
  return isPresentationStructure(raw, false) && object(raw) && object(raw["model"]) && exact(raw["model"], ["schema", "version", "configurationId", "readOnly", "project", "installation", "prjatt", "definitions", "categories", "counts", "diagnostics", "conversionDiagnostics"]);
}
export function isWorkingState(raw: unknown): raw is WorkingState {
  if (!object(raw) || !exact(raw, ["revision", "source", "data", "draftValues", "pendingImport", "presentation", "dirty", "fileSaveAvailable", "prjtoolsAvailable"])) return false;
  if (!integer(raw["revision"]) || !object(raw["source"]) || !exact(raw["source"], ["app", "project_contract", "capabilities", "read_only", "selection", "project", "installation", "installationCandidates", "prjatt", "definitions", "data", "diagnostics"]) || !parseAimProjectSnapshot(raw["source"])) return false;
  if (!object(raw["data"]) || !exact(raw["data"], ["attributes"])) return false;
  // Structure-only validation of Python's effective attributes; no resolution or value computation.
  if (!parseAimProjectSnapshot({ ...raw["source"], data: raw["data"] }) || !Array.isArray(raw["data"]["attributes"]) || !raw["data"]["attributes"].every(a => object(a) && exact(a, ["number", "label", "definition", "valueState", "value"]))) return false;
  if (!object(raw["draftValues"]) || !Object.entries(raw["draftValues"]).every(([k, v]) => numberKey(k) && (v === null || typeof v === "string"))) return false;
  if (typeof raw["pendingImport"] !== "boolean" || raw["fileSaveAvailable"] !== false || raw["prjtoolsAvailable"] !== false) return false;
  if (raw["presentation"] !== null && !isWorkingPresentation(raw["presentation"])) return false;
  const dirty = raw["dirty"];
  return object(dirty) && exact(dirty, ["values", "presentation", "any"]) && ["values", "presentation", "any"].every(k => typeof dirty[k] === "boolean");
}
const failure = (raw: Record<string, unknown>) => raw["ok"] === false && Object.keys(raw).every(k => ["ok", "error", "report"].includes(k)) && object(raw["error"]) && exact(raw["error"], ["code", "message"]) && typeof raw["error"]["code"] === "string" && typeof raw["error"]["message"] === "string" && (!Object.hasOwn(raw, "report") || isReport(raw["report"]));
export function parseWorkingPresentation<C extends "presentation.update" | "presentation.import.prepare" | "presentation.import.apply" | "presentation.get">(command: C, raw: unknown): WorkingProfileResponses[C] | null {
  if (!object(raw)) return null;
  if (failure(raw)) return raw as WorkingProfileResponses[C];
  if (raw["ok"] !== true) return null;
  if (command === "presentation.import.prepare") {
    if (exact(raw, ["ok", "status"]) && raw["status"] === "cancelled") return raw as WorkingProfileResponses[C];
    return exact(raw, ["ok", "status", "token", "candidate"]) && raw["status"] === "prepared" && typeof raw["token"] === "string" && raw["token"].length > 0 && isWorkingPresentation(raw["candidate"]) && (!raw["candidate"].report || raw["candidate"].report.summary.errors === 0) ? raw as WorkingProfileResponses[C] : null;
  }
  if (command === "presentation.get" && raw["status"] === "empty") return exact(raw, ["ok", "status", "presentation"]) && raw["presentation"] === null ? raw as WorkingProfileResponses[C] : null;
  const status = {"presentation.update":"updated","presentation.import.apply":"applied","presentation.get":"current"};
  return raw["status"] === status[command as keyof typeof status] && exact(raw, ["ok", "status", "presentation"]) && isWorkingPresentation(raw["presentation"]) && (command !== "presentation.update" || raw["presentation"].report === null) ? raw as WorkingProfileResponses[C] : null;
}
export function parseWorking<C extends keyof WorkingResponses>(command: C, raw: unknown): WorkingResponses[C] | null {
  if (!object(raw)) return null;
  if (failure(raw)) return raw as WorkingResponses[C];
  if (raw["ok"] !== true) return null;
  if (command === "work.close") return exact(raw, ["ok", "status"]) && raw["status"] === "close_requested" ? raw as WorkingResponses[C] : null;
  if (command === "work.transition" && raw["status"] === "cancelled") return exact(raw, ["ok", "status", "data"]) && parseAimProjectSnapshot(raw["data"]) ? raw as WorkingResponses[C] : null;
  const statuses: Partial<Record<keyof WorkingResponses, string>> = { "work.get": "current", "work.value.set": "updated", "work.discard": "discarded", "work.transition": "transitioned" };
  if (raw["status"] !== statuses[command] || !isWorkingState(raw["work"]) || !Object.keys(raw).every(k => ["ok", "status", "work", "result"].includes(k))) return null;
  if (Object.hasOwn(raw, "result")) {
    const r = raw["result"];
    if (!object(r) || r["ok"] !== true) return null;
    if (Object.hasOwn(r, "data")) {
      if (!Object.keys(r).every(k => ["ok", "data", "status"].includes(k)) || !parseAimProjectSnapshot(r["data"]) || (Object.hasOwn(r, "status") && r["status"] !== "cancelled")) return null;
    } else if (!exact(r, ["ok", "status", "presentation"]) || r["status"] !== "applied" || !isWorkingPresentation(r["presentation"])) return null;
  }
  return raw as WorkingResponses[C];
}
export async function callWorking<C extends keyof WorkingRequests>(command: C, payload: WorkingRequests[C]): Promise<NegotiatedWorkingResponses[C]> {
  const info = getVerifiedAppInfo();
  if (!workingProfileAvailable(info)) throw new Error("working_profile_unavailable");
  const api = (globalThis as unknown as { pywebview?: { api?: { call?: (c: string, p: unknown) => Promise<unknown> } } }).pywebview?.api;
  if (!api?.call) throw new Error("binding_unavailable");
  const raw = await api.call(command, payload);
  const parsed = projectSaveAvailable(info) ? parseWorkingV2(command, raw) : parseWorking(command, raw);
  if (!parsed) throw new Error(`Réponse incompatible : ${command}`);
  return parsed;
}

const opaque = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
const tri = (v: unknown) => v === null || typeof v === "boolean";
export function isSaveRequest(v: unknown): v is SaveRequest {
  return object(v) && exact(v, ["sessionId", "revision", "projectRevision"]) && opaque(v["sessionId"]) && integer(v["revision"]) && integer(v["projectRevision"]);
}
export const sameSaveRequest = (a: SaveRequest, b: SaveRequest) => a.sessionId === b.sessionId && a.revision === b.revision && a.projectRevision === b.projectRevision;
export function canAdoptSaveWork(current: WorkingStateV2, next: WorkingStateV2, request: SaveRequest): boolean {
  return current.sessionId === request.sessionId && next.sessionId === current.sessionId && next.source.project?.path === current.source.project?.path && next.revision >= current.revision && next.projectRevision >= current.projectRevision;
}
export function isWorkingStateV2(raw: unknown): raw is WorkingStateV2 {
  if (!object(raw) || !exact(raw, ["revision", "source", "data", "draftValues", "pendingImport", "presentation", "dirty", "fileSaveAvailable", "prjtoolsAvailable", "sessionId", "projectRevision", "projectInstallation", "save"])) return false;
  const { sessionId, projectRevision, projectInstallation, save, ...base } = raw;
  if (!object(projectInstallation) || !exact(projectInstallation, ["status"]) || !["associated", "unassociated", "unknown"].includes(projectInstallation["status"] as string)) return false;
  if (!opaque(sessionId) || !integer(projectRevision) || typeof base["fileSaveAvailable"] !== "boolean" || typeof base["prjtoolsAvailable"] !== "boolean") return false;
  // Validate the unchanged nested projection using the unchanged V1 parser.
  if (!isWorkingState({ ...base, fileSaveAvailable: false, prjtoolsAvailable: false })) return false;
  return object(save) && exact(save, ["state", "operationId", "request", "blockedReasons"]) && typeof save["state"] === "string" && ["idle", "running", "recovery_required"].includes(save["state"]) && nullable(save["operationId"], opaque) && nullable(save["request"], isSaveRequest) && Array.isArray(save["blockedReasons"]) && save["blockedReasons"].every(opaque);
}
export function parseWorkingV2<C extends keyof WorkingResponses>(command: C, raw: unknown): WorkingResponsesV2[C] | null {
  if (!object(raw)) return null;
  if (!Object.hasOwn(raw, "work")) return parseWorking(command, raw) as WorkingResponsesV2[C] | null;
  if (!isWorkingStateV2(raw["work"])) return null;
  const { sessionId: _session, projectRevision: _project, projectInstallation: _installation, save: _save, ...base } = raw["work"];
  return parseWorking(command, { ...raw, work: { ...base, fileSaveAvailable: false, prjtoolsAvailable: false } }) ? raw as WorkingResponsesV2[C] : null;
}
const stages = ["validation", "preparation", "publication", "tool", "verification", "acknowledgement", "complete"];
const errorDetail = (v: unknown) => object(v) && exact(v, ["code", "message"]) && typeof v["code"] === "string" && typeof v["message"] === "string";
const protocolError = (v: Record<string, unknown>) => exact(v, ["ok", "error"]) && v["ok"] === false && errorDetail(v["error"]);
const fileEffects = (v: unknown) => object(v) && exact(v, ["written", "verified", "finalVerification", "sourceSHA256", "backupId"]) && tri(v["written"]) && tri(v["verified"]) && typeof v["finalVerification"] === "string" && ["not_attempted", "confirmed", "failed", "unknown"].includes(v["finalVerification"]) && nullable(v["sourceSHA256"], x => typeof x === "string" && /^[a-fA-F0-9]{64}$/.test(x)) && nullable(v["backupId"], opaque);
const toolEffects = (v: unknown) => object(v) && exact(v, ["required", "launched", "finished", "returnCode", "updateStatus", "diagnosticId"]) && tri(v["required"]) && tri(v["launched"]) && tri(v["finished"]) && nullable(v["returnCode"], x => typeof x === "number" && Number.isSafeInteger(x)) && typeof v["updateStatus"] === "string" && ["not_required", "unconfirmed"].includes(v["updateStatus"]) && nullable(v["diagnosticId"], opaque);
export function isSaveResult(v: unknown): v is SaveResult {
  if (!object(v) || !exact(v, ["ok", "status", "stage", "file", "tool", "acknowledged", "recoveryRequired", "error", "message"]) || typeof v["ok"] !== "boolean" || typeof v["stage"] !== "string" || !stages.includes(v["stage"]) || !fileEffects(v["file"]) || !toolEffects(v["tool"]) || typeof v["acknowledged"] !== "boolean" || typeof v["recoveryRequired"] !== "boolean" || !nullable(v["error"], errorDetail) || typeof v["message"] !== "string") return false;
  const r = v as SaveResult;
  if (r.tool.required === false && r.tool.updateStatus !== "not_required" || r.tool.required === true && r.tool.updateStatus !== "unconfirmed") return false;
  if (r.status === "saved") return r.ok && r.file.written === true && r.file.verified === true && r.file.finalVerification === "confirmed" && r.acknowledged && !r.recoveryRequired && r.error === null && (r.tool.required === false || r.tool.required === true && r.tool.launched === true && r.tool.finished === true && r.tool.returnCode === 0);
  if (r.status === "partial") return !r.ok && (r.file.written === true || r.file.written === null) && !r.acknowledged && r.recoveryRequired && r.error !== null;
  return r.status === "failed" && !r.ok && r.file.written === false && !r.acknowledged && r.error !== null && r.tool.launched === false;
}
export function parseProjectSave(command: "project.values.save", raw: unknown, request: SaveRequest): SaveAccepted | import("../contracts/AIM_PROJECT_MANAGER_CONTRACT").SaveProtocolError | null;
export function parseProjectSave(command: "project.values.save.status", raw: unknown, request: SaveRequest): SaveStatus | null;
export function parseProjectSave(command: "project.values.save" | "project.values.save.status", raw: unknown, request: SaveRequest): SaveAccepted | SaveStatus | null {
  if (!object(raw)) return null;
  if (protocolError(raw)) return raw as import("../contracts/AIM_PROJECT_MANAGER_CONTRACT").SaveProtocolError;
  if (raw["ok"] !== true || !isSaveRequest(raw["request"]) || !sameSaveRequest(request, raw["request"])) return null;
  if (command === "project.values.save") return exact(raw, ["ok", "status", "operationId", "request"]) && raw["status"] === "accepted" && opaque(raw["operationId"]) ? raw as SaveAccepted : null;
  if (raw["status"] === "not_found") return exact(raw, ["ok", "status", "request"]) ? raw as SaveStatus : null;
  if (!opaque(raw["operationId"])) return null;
  if (raw["status"] === "running") return exact(raw, ["ok", "status", "operationId", "request", "phase", "file", "tool"]) && typeof raw["phase"] === "string" && stages.includes(raw["phase"]) && fileEffects(raw["file"]) && toolEffects(raw["tool"]) ? raw as SaveStatus : null;
  return raw["status"] === "completed" && exact(raw, ["ok", "status", "operationId", "request", "result", "work"]) && isSaveResult(raw["result"]) && (raw["work"] === null || isWorkingStateV2(raw["work"]) && raw["work"].sessionId === request.sessionId) ? raw as SaveStatus : null;
}
export async function callProjectSave<C extends "project.values.save" | "project.values.save.status">(command: C, request: SaveRequest): Promise<C extends "project.values.save" ? SaveAccepted | import("../contracts/AIM_PROJECT_MANAGER_CONTRACT").SaveProtocolError : SaveStatus> {
  if (!projectSaveAvailable(getVerifiedAppInfo()) || !isSaveRequest(request)) throw new Error("project_save_profile_unavailable");
  const api = (globalThis as unknown as { pywebview?: { api?: { call?: (c: string, p: unknown) => Promise<unknown> } } }).pywebview?.api;
  if (!api?.call) throw new Error("binding_unavailable");
  const raw = await api.call(command, request);
  const parsed = command === "project.values.save" ? parseProjectSave(command, raw, request) : parseProjectSave("project.values.save.status", raw, request);
  if (!parsed) throw new Error(`Réponse incompatible : ${command}`);
  return parsed as C extends "project.values.save" ? SaveAccepted | import("../contracts/AIM_PROJECT_MANAGER_CONTRACT").SaveProtocolError : SaveStatus;
}
export function saveResultNotice(result: SaveResult): string {
  if (result.status === "saved") return result.tool.required ? "Fichier enregistré ; commande Allplan terminée, code 0. Valeurs dans Allplan non vérifiées." : "Fichier enregistré ; outil Allplan non requis pour ce projet externe.";
  if (result.file.written === true && result.file.verified === true && result.stage === "tool") return `Fichier enregistré ; mise à jour Allplan échouée ou non confirmée. ${result.message} Aucune relance automatique.`;
  if (result.file.written === true) return `Fichier publié, vérification incomplète ou en échec. ${result.message} Aucune relance automatique.`;
  return result.file.written === false ? result.message : `Résultat incertain ; écriture possible. ${result.message} Aucune relance automatique.`;
}