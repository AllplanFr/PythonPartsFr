import type { CatalogEntry, CatalogReplyV2, UpdateReason, UpdateReplyV2 } from "./PLUGIN_CATALOG_CONTRACT";

/** Runtime validation of untrusted catalog /2 replies. Any deviation means "Update unavailable", never "À jour". */
const REASONS: ReadonlySet<string> = new Set([
  "catalog_not_configured", "catalog_unavailable", "informative_source", "catalog_pending", "catalog_superseded",
  "not_installed", "not_in_catalog", "construction", "installed_version_unknown", "installed_version_invalid",
  "no_releases", "compatibility_unknown", "incompatible", "equal", "older", "no_release_url", "release_url_rejected",
]);
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ID = /^[a-z][a-z0-9_]*$/;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const hasExactly = (o: Obj, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const optStr = (v: unknown) => v === null || nonEmpty(v);
const lifecycle = (v: unknown) => v === null || v === "ready" || v === "construction";
const date = (v: unknown) => v === null || typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
const reason = (v: unknown): v is UpdateReason => v === null || typeof v === "string" && REASONS.has(v);

const ENTRY_KEYS = ["id", "name", "installed", "installedVersion", "installedLifecycle", "inCatalog", "latestKnownVersion",
  "proposedVersion", "catalogLifecycle", "comparison", "compatibility", "canUpdate", "updateReason"];

function validEntry(v: unknown, d: Obj): v is CatalogEntry {
  if (!isObj(v) || !hasExactly(v, ENTRY_KEYS)) return false;
  if (typeof v["id"] !== "string" || !ID.test(v["id"]) || !nonEmpty(v["name"]) || typeof v["installed"] !== "boolean" ||
      !optStr(v["installedVersion"]) || !lifecycle(v["installedLifecycle"]) || typeof v["inCatalog"] !== "boolean" ||
      !optStr(v["latestKnownVersion"]) || !optStr(v["proposedVersion"]) || !lifecycle(v["catalogLifecycle"]) ||
      !["unknown", "equal", "newer", "older"].includes(v["comparison"] as string) ||
      !["unknown", "compatible", "incompatible"].includes(v["compatibility"] as string) ||
      typeof v["canUpdate"] !== "boolean" || !reason(v["updateReason"])) return false;
  if (v["canUpdate"] !== (v["updateReason"] === null)) return false;
  if (v["comparison"] !== "unknown" && (!v["installed"] || v["installedVersion"] === null || v["proposedVersion"] === null)) return false;
  if (v["canUpdate"] && !(d["status"] === "available" && d["source"] === "remote" && d["superseded"] === false && v["installed"] &&
      v["installedLifecycle"] === "ready" && v["inCatalog"] && v["comparison"] === "newer" && v["compatibility"] === "compatible" &&
      v["installedVersion"] !== null && v["proposedVersion"] !== null)) return false;
  if (d["superseded"] === true && v["updateReason"] !== "catalog_superseded") return false;
  if (!v["inCatalog"] && (v["latestKnownVersion"] !== null || v["proposedVersion"] !== null || v["catalogLifecycle"] !== null)) return false;
  if (!v["installed"] && v["installedVersion"] !== null) return false;
  return true;
}

export function isCatalogReplyV2(value: unknown): value is CatalogReplyV2 {
  if (!isObj(value)) return false;
  if (value["ok"] === false) {
    return hasExactly(value, ["ok", "error"]) && isObj(value["error"]) && hasExactly(value["error"], ["code", "message"]) &&
      value["error"]["code"] === "catalog_internal_error" && typeof value["error"]["message"] === "string";
  }
  if (value["ok"] !== true || !hasExactly(value, ["ok", "data"]) || !isObj(value["data"])) return false;
  const d = value["data"];
  if (!hasExactly(d, ["schema", "requestId", "superseded", "status", "source", "verifiedAt", "lastAttemptAt", "entries", "error"])) return false;
  if (d["schema"] !== "allplan-tools-catalog/2" || !Number.isSafeInteger(d["requestId"]) || (d["requestId"] as number) < 1 ||
      typeof d["superseded"] !== "boolean" || !["not_configured", "available", "unavailable"].includes(d["status"] as string) ||
      !["none", "embedded", "cache", "remote"].includes(d["source"] as string) || !date(d["verifiedAt"]) || !date(d["lastAttemptAt"]) ||
      !Array.isArray(d["entries"])) return false;
  if (d["error"] !== null && !(isObj(d["error"]) && hasExactly(d["error"], ["code", "message"]) &&
      ["network_error", "invalid_catalog", "cache_error"].includes(d["error"]["code"] as string) && typeof d["error"]["message"] === "string")) return false;
  if (d["status"] === "available" && (d["error"] !== null || d["source"] === "none")) return false;
  if (d["status"] === "not_configured" && (d["source"] !== "none" || d["verifiedAt"] !== null || d["lastAttemptAt"] !== null || d["error"] !== null)) return false;
  if (d["status"] === "unavailable" && (d["error"] === null || d["source"] === "remote")) return false;
  if (d["source"] === "remote" && (d["verifiedAt"] === null || d["lastAttemptAt"] === null)) return false;
  if (d["source"] === "cache" && d["verifiedAt"] === null) return false;
  if (d["source"] === "none" && d["verifiedAt"] !== null) return false;
  if (d["source"] === "embedded" && d["verifiedAt"] !== null) return false;
  const ids = new Set<string>();
  for (const e of d["entries"]) {
    if (!validEntry(e, d) || ids.has(e.id)) return false;
    ids.add(e.id);
  }
  return true;
}

const UPDATE_CODES = ["invalid_arguments", "unknown_plugin", "update_not_available", "catalog_changed", "link_open_failed", "catalog_internal_error"];

export function isUpdateReplyV2(value: unknown, id: string): value is UpdateReplyV2 {
  if (!isObj(value)) return false;
  if (value["ok"] === true) {
    return hasExactly(value, ["ok", "data"]) && isObj(value["data"]) && hasExactly(value["data"], ["id", "version", "status"]) &&
      value["data"]["id"] === id && nonEmpty(value["data"]["version"]) && value["data"]["status"] === "link_open_requested";
  }
  return value["ok"] === false && hasExactly(value, ["ok", "error"]) && isObj(value["error"]) &&
    hasExactly(value["error"], ["code", "message", "reason"]) && UPDATE_CODES.includes(value["error"]["code"] as string) &&
    typeof value["error"]["message"] === "string" && reason(value["error"]["reason"]);
}

/** "À jour" only from a current valid remote result, equal comparison and established compatibility. */
export function isUpToDate(d: { status: string; source: string; superseded: boolean }, e: CatalogEntry): boolean {
  return d["status"] === "available" && d["source"] === "remote" && !d["superseded"] && e.installed && e.inCatalog &&
    e.comparison === "equal" && e.compatibility === "compatible";
}
