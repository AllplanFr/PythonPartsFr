import { getVerifiedAppInfo } from "@/shared/transport/native-binding";
import { aimManagerMenuContract } from "./aim-project-contract";
import { managerAvailable } from "./aim-manager-contract";
import { workingProfileAvailable, object } from "./aim-working-contract";

export const managerMenuAvailable = (info: unknown) =>
  managerAvailable(info) && (aimManagerMenuContract(info) || (workingProfileAvailable(info) && object(info) && info["project_manager_menu_contract"] === 1));
export type ManagerMenuCommand =
  | "project.manager.favorites.list"
  | "project.manager.favorite.set"
  | "project.manager.folder.open"
  | "project.manager.remove";
export type ManagerMenuOutcome =
  | { kind: "favorites"; paths: string[] }
  | { kind: "updated"; path: string; favorite: boolean }
  | { kind: "folder-opened"; path: string }
  | { kind: "removed"; path: string }
  | { kind: "failure"; code: string; message: string }
  | { kind: "invalid" };
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const path = (v: unknown): v is string => typeof v === "string" && v.length > 0;
/** Windows identity comparison only; never resolves or constructs a native path. */
export const managerPathKey = (value: string) => value.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
function validPayload(command: ManagerMenuCommand, payload: Record<string, unknown>) {
  if (command === "project.manager.favorites.list") return exact(payload, []);
  return exact(payload, command === "project.manager.favorite.set" ? ["path", "favorite"] : ["path"])
    && path(payload["path"])
    && (command !== "project.manager.favorite.set" || typeof payload["favorite"] === "boolean");
}
export function parseManagerMenu(command: ManagerMenuCommand, raw: unknown): ManagerMenuOutcome {
  if (!obj(raw)) return { kind: "invalid" };
  if (raw["ok"] === false && exact(raw, ["ok", "error"]) && obj(raw["error"])
    && exact(raw["error"], ["code", "message"]) && typeof raw["error"]["message"] === "string") {
    const codes = ["invalid_payload", "project_not_added", "manager_unavailable",
      ...(command === "project.manager.folder.open" ? ["project_folder_unavailable", "unsupported_platform"] : [])];
    if (typeof raw["error"]["code"] === "string" && codes.includes(raw["error"]["code"]))
      return { kind: "failure", code: raw["error"]["code"], message: raw["error"]["message"] };
  }
  if (raw["ok"] !== true) return { kind: "invalid" };
  if (command === "project.manager.favorites.list" && exact(raw, ["ok", "paths"])
    && Array.isArray(raw["paths"]) && raw["paths"].every(path))
    return { kind: "favorites", paths: [...new Map(raw["paths"].map((p) => [managerPathKey(p), p])).values()] };
  if (command === "project.manager.favorite.set" && exact(raw, ["ok", "status", "path", "favorite"])
    && raw["status"] === "updated" && path(raw["path"]) && typeof raw["favorite"] === "boolean")
    return { kind: "updated", path: raw["path"], favorite: raw["favorite"] };
  if (exact(raw, ["ok", "status", "path"]) && path(raw["path"])) {
    if (command === "project.manager.folder.open" && raw["status"] === "opened")
      return { kind: "folder-opened", path: raw["path"] };
    if (command === "project.manager.remove" && raw["status"] === "removed")
      return { kind: "removed", path: raw["path"] };
  }
  return { kind: "invalid" };
}
export async function callManagerMenu(command: ManagerMenuCommand, payload: Record<string, unknown> = {}): Promise<ManagerMenuOutcome> {
  if (!managerMenuAvailable(getVerifiedAppInfo())) throw new Error("manager_menu_unavailable");
  if (!validPayload(command, payload)) return { kind: "invalid" };
  const api = (globalThis as unknown as {
    pywebview?: { api?: { call?: (c: string, p: Record<string, unknown>) => Promise<unknown> } };
  }).pywebview?.api;
  if (!api?.call) throw new Error("binding_unavailable");
  const result = parseManagerMenu(command, await api.call(command, payload));
  if (result.kind === "updated" || result.kind === "folder-opened" || result.kind === "removed") {
    if (typeof payload["path"] !== "string" || managerPathKey(payload["path"]) !== managerPathKey(result.path)
      || (result.kind === "updated" && result.favorite !== payload["favorite"])) return { kind: "invalid" };
  }
  return result;
}