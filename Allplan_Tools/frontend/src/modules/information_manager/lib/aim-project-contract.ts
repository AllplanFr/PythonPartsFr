/**
 * AIM project contract 2 (Python reader, read-only).
 * Python resolves installation, sources, definitions and values and sends data.attributes[]
 * already associated. The frontend only checks the message structure and displays it:
 * no catalog/values merge, no Allplan file parsing, no browser restoration of project data.
 * Structural validation here is not business validation of Allplan data.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string) => Object.hasOwn(o, k);
const isStr = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown) => v === null || typeof v === "string";
const intOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isInteger(v));
const boolOrNull = (v: unknown) => v === null || typeof v === "boolean";
const strArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const keys = (o: Record<string, unknown>, list: string[]) => list.every((k) => has(o, k));

export const AIM_PROJECT_CONTRACT = 2;
/** Contract connected to the editor. Contract 1 has no compatibility layer. */
export const AIM_CONNECTED_CONTRACT: number | null = AIM_PROJECT_CONTRACT;
const APP = "information_manager";
const CAPS = ["project.select"];
const exactCaps = (v: unknown) => Array.isArray(v) && v.length === CAPS.length && v.every((c, i) => c === CAPS[i]);

export type AimContractInfo = { recognized: boolean; readOnly: boolean; canSelect: boolean; /** get_app_info().project_history_contract === 1: project.recent + project.select {path}. Strict capabilities unchanged. */ history: boolean };

/** Exact identity: id, protocol_version 1, project_contract 2 (integers), read_only true, capabilities ["project.select"]. */
export function aimProjectContract(info: unknown): AimContractInfo {
  const recognized = AIM_CONNECTED_CONTRACT !== null && isObj(info) && info["id"] === APP && info["protocol_version"] === 1
    && info["project_contract"] === AIM_CONNECTED_CONTRACT && info["read_only"] === true && exactCaps(info["capabilities"]);
  return { recognized, readOnly: true, canSelect: recognized, history: recognized && isObj(info) && info["project_history_contract"] === 1 };
}
/** Independent menu extension; old identity results and capability lists stay unchanged. */
export const aimManagerMenuContract = (info: unknown) =>
  aimProjectContract(info).recognized && isObj(info) && info["project_manager_menu_contract"] === 1;

export type AimSelection = "accepted" | "cancelled" | "required" | "error" | "installation_required";
export type AimValueState = "set" | "unset" | "unavailable";
export type AimDiagnostic = { code: string; severity: "info" | "warning" | "error"; message: string; path: string | null; line: number | null; attributeNumber: string | null; relatedPath: string | null };
export type AimInstallation = { version: string; verificationVersion: boolean; allplanLanguage: string | null; paths: Record<string, string> };
export type AimDefinitions =
  | { status: "not_loaded" }
  | { status: "unavailable"; reason: "project_config_invalid" }
  | { status: "available" | "available_with_diagnostics" | "unavailable"; attr: "PRJ" | "STD"; language: string | null; source: string; systemFiles: string[]; customFiles: string[]; priority: string; groupMask: 65536 };
export type AimAttributeRow = { number: string; label: string; definition: Record<string, unknown>; valueState: AimValueState; value: string | null };
export type AimProjectSnapshot = {
  readOnly: true;
  selection: AimSelection;
  project: { path: string; name: string } | null;
  installation: AimInstallation | null;
  installationCandidates: AimInstallation[];
  prjatt: { status: "not_loaded" | "missing" | "read" | "error"; path: string | null; encodingHint: string | null; header: string | null };
  definitions: AimDefinitions;
  attributes: AimAttributeRow[];
  diagnostics: AimDiagnostic[];
};

const SELECTIONS: AimSelection[] = ["accepted", "cancelled", "required", "error", "installation_required"];
const PRJATT = ["not_loaded", "missing", "read", "error"];
const DATATYPES = ["C", "R", "I", "D", "E"];
const DECIMAL = /^-?\d+(\.\d+)?$/;
const NUMBER = /^(0|[1-9]\d*)$/;

function installation(v: unknown): AimInstallation | null {
  if (!isObj(v) || !keys(v, ["version", "verificationVersion", "allplanLanguage", "paths"])) return null;
  if (!isStr(v["version"]) || typeof v["verificationVersion"] !== "boolean" || !strOrNull(v["allplanLanguage"]) || !isObj(v["paths"])) return null;
  const paths = v["paths"];
  if (!Object.values(paths).every(isStr)) return null;
  return { version: v["version"], verificationVersion: v["verificationVersion"], allplanLanguage: v["allplanLanguage"] as string | null, paths: { ...(paths as Record<string, string>) } };
}
function diagnostic(v: unknown): AimDiagnostic | null {
  if (!isObj(v) || !keys(v, ["code", "severity", "message", "path", "line", "attributeNumber", "relatedPath"])) return null;
  if (!isStr(v["code"]) || !["info", "warning", "error"].includes(v["severity"] as string) || !isStr(v["message"])) return null;
  if (!strOrNull(v["path"]) || !intOrNull(v["line"]) || !strOrNull(v["attributeNumber"]) || !strOrNull(v["relatedPath"])) return null;
  return v as unknown as AimDiagnostic;
}
function provenance(v: unknown) { return isObj(v) && keys(v, ["path", "source", "position"]) && isStr(v["path"]) && isStr(v["source"]) && intOrNull(v["position"]); }
function property(v: unknown): boolean {
  return isObj(v) && keys(v, ["name", "text", "children"]) && isStr(v["name"]) && strOrNull(v["text"]) && Array.isArray(v["children"]) && v["children"].every(property);
}
function definitions(v: unknown): AimDefinitions | null {
  if (!isObj(v)) return null;
  const n = Object.keys(v).length;
  if (v["status"] === "not_loaded" && n === 1) return { status: "not_loaded" };
  if (v["status"] === "unavailable" && n === 2 && v["reason"] === "project_config_invalid") return { status: "unavailable", reason: "project_config_invalid" };
  if (!["available", "available_with_diagnostics", "unavailable"].includes(v["status"] as string)) return null;
  if (!keys(v, ["attr", "language", "source", "systemFiles", "customFiles", "priority", "groupMask"])) return null;
  if ((v["attr"] !== "PRJ" && v["attr"] !== "STD") || !strOrNull(v["language"]) || !isStr(v["source"]) || !strArray(v["systemFiles"]) || !strArray(v["customFiles"])) return null;
  if (v["priority"] !== "first_valid_etc_then_custom_plain_preferred" || v["groupMask"] !== 65536) return null;
  return v as unknown as AimDefinitions;
}
function definition(v: unknown, number: string, label: string): boolean {
  if (!isObj(v) || !keys(v, ["number", "uid", "label", "datatype", "group_mask", "unit", "minimum", "maximum", "modify", "visible", "control", "propositions", "formulas", "properties", "provenance"])) return false;
  if (v["number"] !== number || v["label"] !== label || !isStr(v["uid"]) || !DATATYPES.includes(v["datatype"] as string)) return false;
  const mask = v["group_mask"];
  if (typeof mask !== "number" || !Number.isInteger(mask) || mask < 0 || (Math.floor(mask / 65536) % 2) !== 1) return false;
  if (!strOrNull(v["unit"]) || !strOrNull(v["control"]) || !boolOrNull(v["modify"]) || !boolOrNull(v["visible"])) return false;
  for (const k of ["minimum", "maximum"]) if (v[k] !== null && !(isStr(v[k]) && DECIMAL.test(v[k] as string))) return false;
  if (!strArray(v["formulas"]) || !Array.isArray(v["properties"]) || !v["properties"].every(property) || !provenance(v["provenance"])) return false;
  return Array.isArray(v["propositions"]) && v["propositions"].every((p) => isObj(p) && keys(p, ["index", "text", "provenance", "generated_index"]) && intOrNull(p["index"]) && isStr(p["text"]) && isObj(p["provenance"]) && typeof p["generated_index"] === "boolean");
}
function attribute(v: unknown): AimAttributeRow | null {
  if (!isObj(v) || !keys(v, ["number", "label", "definition", "valueState", "value"])) return null;
  const { number, label, valueState, value } = v;
  if (!isStr(number) || !NUMBER.test(number) || !isStr(label) || !definition(v["definition"], number, label)) return null;
  if (valueState === "set" ? !isStr(value) : valueState === "unset" || valueState === "unavailable" ? value !== null : true) return null;
  return { number, label, definition: v["definition"] as Record<string, unknown>, valueState: valueState as AimValueState, value: value as string | null };
}

/** True when the raw object claims to be a contract-2 snapshot. */
export const isAimProjectSnapshot = (raw: unknown) => isObj(raw) && raw["app"] === APP && raw["project_contract"] === AIM_PROJECT_CONTRACT;

/** Strict structural check. Any doubt returns null: the caller shows a read error, never an empty project. */
export function parseAimProjectSnapshot(raw: unknown): AimProjectSnapshot | null {
  if (!isAimProjectSnapshot(raw) || !isObj(raw)) return null;
  if (!keys(raw, ["capabilities", "read_only", "selection", "project", "installation", "installationCandidates", "prjatt", "definitions", "data", "diagnostics"])) return null;
  if (!exactCaps(raw["capabilities"]) || raw["read_only"] !== true || !SELECTIONS.includes(raw["selection"] as AimSelection)) return null;
  const p = raw["project"];
  if (p !== null && !(isObj(p) && isStr(p["path"]) && isStr(p["name"]))) return null;
  const inst = raw["installation"] === null ? null : installation(raw["installation"]);
  if (raw["installation"] !== null && !inst) return null;
  if (!Array.isArray(raw["installationCandidates"])) return null;
  const candidates = raw["installationCandidates"].map(installation);
  if (candidates.some((c) => !c)) return null;
  const pa = raw["prjatt"];
  if (!isObj(pa) || !keys(pa, ["status", "path", "encodingHint", "header"]) || !PRJATT.includes(pa["status"] as string) || !strOrNull(pa["path"]) || !strOrNull(pa["encodingHint"]) || !strOrNull(pa["header"])) return null;
  const defs = definitions(raw["definitions"]);
  if (!defs) return null;
  const data = raw["data"];
  if (!isObj(data) || Object.keys(data).length !== 1 || !Array.isArray(data["attributes"])) return null;
  const attributes = data["attributes"].map(attribute);
  if (attributes.some((a) => !a) || new Set(attributes.map((a) => a!.number)).size !== attributes.length) return null;
  if (!Array.isArray(raw["diagnostics"])) return null;
  const diagnostics = raw["diagnostics"].map(diagnostic);
  if (diagnostics.some((d) => !d)) return null;
  return {
    readOnly: true, selection: raw["selection"] as AimSelection,
    project: p === null ? null : { path: (p as { path: string })["path"], name: (p as { name: string })["name"] },
    installation: inst, installationCandidates: candidates as AimInstallation[],
    prjatt: pa as AimProjectSnapshot["prjatt"], definitions: defs,
    attributes: attributes as AimAttributeRow[], diagnostics: diagnostics as AimDiagnostic[],
  };
}

export type AimSnapshotStatus = "none" | "cancelled" | "loaded" | "no-attributes" | "read-error" | "installation-required" | "installation-ambiguous" | "config-invalid" | "definitions-unavailable";

/** Displayed project state read from selection / prjatt / definitions / diagnostic codes, never from messages. */
export function snapshotStatus(s: AimProjectSnapshot): AimSnapshotStatus {
  const code = (c: string) => s.diagnostics.some((d) => d.code === c);
  switch (s.selection) {
    case "required": return "none";
    case "cancelled": return "cancelled";
    case "installation_required": return code("installation_ambiguous") ? "installation-ambiguous" : "installation-required";
    case "error": return s.definitions.status === "unavailable" && "reason" in s.definitions ? "config-invalid" : "read-error";
    case "accepted":
      if (s.prjatt.status === "error") return "read-error";
      if (s.definitions.status === "unavailable") return "definitions-unavailable";
      return s.prjatt.status === "missing" ? "no-attributes" : "loaded";
  }
}

export type AimDefinitionsState = "not-loaded" | "available" | "partial" | "unavailable";
export function definitionsState(s: AimProjectSnapshot): AimDefinitionsState {
  switch (s.definitions.status) {
    case "available": return "available";
    case "available_with_diagnostics": return "partial";
    case "unavailable": return "unavailable";
    default: return "not-loaded";
  }
}

export type AimSelectOutcome =
  | { kind: "snapshot"; snapshot: AimProjectSnapshot; error: string | null }
  | { kind: "refused"; error: string }
  | { kind: "invalid" };

/** project.select reply: any reply with data replaces the whole model (even ok:false); a refusal without data changes nothing. */
export function parseSelectResponse(raw: unknown): AimSelectOutcome {
  if (!isObj(raw) || typeof raw["ok"] !== "boolean") return { kind: "invalid" };
  const e = raw["error"];
  const error = isObj(e) && isStr(e["code"]) ? e["code"] : null;
  if (has(raw, "data")) {
    const snapshot = parseAimProjectSnapshot(raw["data"]);
    if (!snapshot) return { kind: "invalid" };
    if (!raw["ok"] && !error) return { kind: "invalid" };
    return { kind: "snapshot", snapshot, error: raw["ok"] ? null : error };
  }
  if (raw["ok"] === false && error) return { kind: "refused", error };
  return { kind: "invalid" };
}

/** Contract-2 definition structure (shared with the presentation contract); number must match, label is the definition's own. */
export const isAimDefinition = (v: unknown, number: string) => isObj(v) && isStr(v["label"]) && definition(v, number, v["label"]);
/** Contract-2 installation structure, shared with the presentation contract. */
export const parseAimInstallation = installation;
/** Contract-2 definitions state, shared with the presentation contract. */
export const parseAimDefinitions = definitions;

export type AimRecentProject = { path: string; name: string };
export type AimRecentOutcome = { kind: "list"; projects: AimRecentProject[] } | { kind: "refused"; code: string; message: string } | { kind: "invalid" };
/** project.recent reply (project_history_contract 1): {ok:true,projects:[{path,name}]} or {ok:false,error:{code,message}}. Entries are kept exactly as returned. */
export function parseRecentResponse(raw: unknown): AimRecentOutcome {
  if (!isObj(raw) || typeof raw["ok"] !== "boolean") return { kind: "invalid" };
  if (raw["ok"] === false) {
    const e = raw["error"];
    if (keys(raw, ["ok", "error"]) && isObj(e) && isStr(e["code"]) && isStr(e["message"])) return { kind: "refused", code: e["code"], message: e["message"] };
    return { kind: "invalid" };
  }
  const list = raw["projects"];
  if (!keys(raw, ["ok", "projects"]) || !Array.isArray(list)) return { kind: "invalid" };
  if (!list.every((p) => isObj(p) && keys(p, ["path", "name"]) && isStr(p["path"]) && isStr(p["name"]))) return { kind: "invalid" };
  return { kind: "list", projects: list.map((p) => ({ path: (p as AimRecentProject).path, name: (p as AimRecentProject).name })) };
}
/** Cancellation with a current state: {ok:true,status:"cancelled",data:unchanged} leaves project and presentation as they are. */
export const isSelectCancelled = (raw: unknown) => isObj(raw) && raw["ok"] === true && raw["status"] === "cancelled";
