import {
  aimProjectContract,
  parseAimProjectSnapshot,
  type AimProjectSnapshot,
} from "./aim-project-contract";
import { workingProfileAvailable } from "./aim-working-contract";
import type { ProjectInstallation } from "../contracts/AIM_PROJECT_MANAGER_CONTRACT";
export type DefinitionSource =
  | { status: "resolved"; version: string; verificationVersion: boolean; reason: null }
  | {
      status: "unresolved";
      version: null;
      verificationVersion: null;
      reason: "definitions_not_loaded";
    };
export type ManagerEntry = {
  path: string;
  name: string;
  source: DefinitionSource;
  sourceFreshness: "last_read";
  projectInstallation?: ProjectInstallation;
};
export type PreviewRow = {
  kind: "row";
  id: string;
  number: string;
  title: string | null;
  value: string;
};
export type PreviewGroup = { kind: "group"; id: string; title: string; rows: PreviewRow[]; /** Only with project_manager_preview_color_contract === 1; exact #RRGGBB as received. */ backgroundColor?: string };
export type ManagerPreview = {
  project: { path: string; name: string };
  source: DefinitionSource;
  readOnly: true;
  valuesStatus: "read" | "missing";
  mode: "current_presentation" | "attributes_without_presentation";
  items: (PreviewRow | PreviewGroup)[];
  projectInstallation?: ProjectInstallation;
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const exact = (v: Record<string, unknown>, keys: string[]) =>
  keys.length === Object.keys(v).length && keys.every((k) => Object.hasOwn(v, k));
export const managerAvailable = (info: unknown) =>
  (aimProjectContract(info).recognized || workingProfileAvailable(info)) && obj(info) && info["project_manager_contract"] === 1;
export const assignmentAvailable = (info: unknown) => managerAvailable(info) && obj(info) && info["project_manager_assignment_contract"] === 1;
export async function managerProjectIsActive(info: unknown, path: string): Promise<boolean> {
  if (!managerAvailable(info) || !obj(info) || info["project_manager_active_contract"] !== 1) return false;
  const api = (globalThis as unknown as { pywebview?: { api?: { call?: (c: string, p: unknown) => Promise<unknown> } } }).pywebview?.api;
  if (!api?.call) throw new Error("Binding Python indisponible.");
  const raw = await api.call("project.manager.isActive", { path });
  if (obj(raw) && exact(raw, ["ok", "active"]) && raw["ok"] === true && typeof raw["active"] === "boolean") return raw["active"];
  throw new Error("Identité du projet actif non confirmée par Python.");
}
/** Strict integer marker: get_app_info().project_manager_preview_color_contract === 1. */
export const previewColorAvailable = (info: unknown) =>
  managerAvailable(info) && obj(info) && info["project_manager_preview_color_contract"] === 1;
export type ManagerParseOptions = { previewColor?: boolean; assignment?: boolean };
export function installationValid(v: unknown): v is ProjectInstallation {
  if (!obj(v)) return false;
  if (v["status"] === "unassociated") return exact(v, ["status"]);
  if (v["status"] === "unknown") return exact(v, ["status", "reason"]) && ["legacy_entry", "ambiguous", "association_unavailable", "no_installations"].includes(v["reason"] as string);
  return v["status"] === "associated" && exact(v, ["status", "version", "verificationVersion", "prjPath"]) && str(v["version"]) && typeof v["verificationVersion"] === "boolean" && str(v["prjPath"]);
}
export function sourceValid(v: unknown): v is DefinitionSource {
  return (
    obj(v) &&
    exact(v, ["status", "version", "verificationVersion", "reason"]) &&
    (v["status"] === "resolved"
      ? str(v["version"]) && typeof v["verificationVersion"] === "boolean" && v["reason"] === null
      : v["status"] === "unresolved" &&
        v["version"] === null &&
        v["verificationVersion"] === null &&
        v["reason"] === "definitions_not_loaded")
  );
}
const project = (v: unknown) =>
  obj(v) && exact(v, ["path", "name"]) && str(v["path"]) && v["path"].length > 0 && str(v["name"]);
const entry = (v: unknown, assignment = false): v is ManagerEntry =>
  obj(v) &&
  exact(v, ["path", "name", "source", "sourceFreshness", ...(assignment ? ["projectInstallation"] : [])]) &&
  (!assignment || installationValid(v["projectInstallation"])) &&
  str(v["path"]) &&
  v["path"].length > 0 &&
  str(v["name"]) &&
  sourceValid(v["source"]) &&
  v["sourceFreshness"] === "last_read";
function previewValid(v: unknown, color = false, assignment = false): v is ManagerPreview {
  if (
    !obj(v) ||
    !exact(v, ["project", "source", "readOnly", "valuesStatus", "mode", "items", ...(assignment ? ["projectInstallation"] : [])]) ||
    (assignment && !installationValid(v["projectInstallation"])) ||
    !project(v["project"]) ||
    !sourceValid(v["source"]) ||
    v["readOnly"] !== true ||
    !["read", "missing"].includes(v["valuesStatus"] as string) ||
    !["current_presentation", "attributes_without_presentation"].includes(v["mode"] as string) ||
    !Array.isArray(v["items"])
  )
    return false;
  const ids = new Set<string>();
  const id = (x: unknown) => {
    if (!str(x) || !x || ids.has(x)) return false;
    ids.add(x);
    return true;
  };
  const row = (r: unknown): boolean =>
    obj(r) &&
    exact(r, ["kind", "id", "number", "title", "value"]) &&
    r["kind"] === "row" &&
    id(r["id"]) &&
    str(r["number"]) &&
    /^(0|[1-9]\d*)$/.test(r["number"]) &&
    (r["title"] === null || str(r["title"])) &&
    str(r["value"]) &&
    r["value"] !== "";
  return v["items"].every(
    (x) =>
      obj(x) &&
      (x["kind"] === "row"
        ? row(x)
        : x["kind"] === "group" &&
          exact(x, color ? ["kind", "id", "title", "rows", "backgroundColor"] : ["kind", "id", "title", "rows"]) &&
          (!color || (str(x["backgroundColor"]) && /^#[0-9A-Fa-f]{6}$/.test(x["backgroundColor"]))) &&
          id(x["id"]) &&
          str(x["title"]) &&
          Array.isArray(x["rows"]) &&
          x["rows"].length > 0 &&
          x["rows"].every(row)),
  );
}
export type ManagerCommand =
  | "project.source"
  | "project.manager.list"
  | "project.manager.add"
  | "project.manager.preview"
  | "project.manager.open";
export type ManagerOutcome =
  | { kind: "source"; source: DefinitionSource }
  | { kind: "list"; projects: ManagerEntry[] }
  | { kind: "added"; project: ManagerEntry }
  | { kind: "cancelled" }
  | { kind: "preview"; preview: ManagerPreview }
  | { kind: "opened"; snapshot: AimProjectSnapshot }
  | { kind: "failure"; code: string; message: string }
  | { kind: "invalid" };
export function parseManager(command: ManagerCommand, raw: unknown, options: ManagerParseOptions = {}): ManagerOutcome {
  if (!obj(raw)) return { kind: "invalid" };
  if (
    raw["ok"] === false &&
    exact(raw, ["ok", "error"]) &&
    obj(raw["error"]) &&
    exact(raw["error"], ["code", "message"]) &&
    str(raw["error"]["code"]) &&
    str(raw["error"]["message"])
  )
    return { kind: "failure", code: raw["error"]["code"], message: raw["error"]["message"] };
  if (raw["ok"] !== true) return { kind: "invalid" };
  if (command === "project.source" && exact(raw, ["ok", "source"]) && sourceValid(raw["source"]))
    return { kind: "source", source: raw["source"] };
  if (
    command === "project.manager.list" &&
    exact(raw, ["ok", "projects"]) &&
    Array.isArray(raw["projects"]) &&
    raw["projects"].every(p => entry(p, options.assignment === true)) &&
    new Set(raw["projects"].map(p => p.path.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase())).size === raw["projects"].length
  )
    return { kind: "list", projects: raw["projects"] };
  if (command === "project.manager.add") {
    if (exact(raw, ["ok", "status"]) && raw["status"] === "cancelled") return { kind: "cancelled" };
    if (
      exact(raw, ["ok", "status", "project"]) &&
      raw["status"] === "added" &&
      entry(raw["project"], options.assignment === true)
    )
      return { kind: "added", project: raw["project"] };
  }
  if (
    command === "project.manager.preview" &&
    exact(raw, ["ok", "status", "preview"]) &&
    raw["status"] === "preview" &&
    previewValid(raw["preview"], options.previewColor === true, options.assignment === true)
  )
    return { kind: "preview", preview: raw["preview"] };
  if (command === "project.manager.open" && exact(raw, ["ok", "data"])) {
    const snapshot = parseAimProjectSnapshot(raw["data"]);
    if (snapshot) return { kind: "opened", snapshot };
  }
  return { kind: "invalid" };
}
export async function callManager(
  command: ManagerCommand,
  payload: Record<string, unknown> = {},
  options: ManagerParseOptions = {},
): Promise<ManagerOutcome> {
  const api = (
    globalThis as unknown as {
      pywebview?: { api?: { call?: (c: string, p: Record<string, unknown>) => Promise<unknown> } };
    }
  ).pywebview?.api;
  if (!api?.call) throw new Error("binding_unavailable");
  return parseManager(command, await api.call(command, payload), options);
}
