/**
 * aim_legacy WebView2 adapter messages (ready/load/save/quit/pickIcon/project.result),
 * extracted unchanged from AIM 39011c34 src/lib/host-protocol.ts. RC1 2.0 models and
 * validators are not duplicated: the suite keeps one corpus in src/lib/host-protocol*.
 */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export type LegacyIncoming =
  | { type: "load"; data: unknown }
  | { type: "project.result"; requestId: string; ok: boolean; data: unknown; error: string }
  | { type: "icon"; category: string; path: string; data: string }
  | { type: "project"; name: string }
  | { type: "lang"; lang: unknown };

/** Parses legacy messages; `ok` must be strictly boolean (never truthiness). Unknown types return null. */
export function parseLegacyMessage(raw: unknown): LegacyIncoming | null {
  const m = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isObj(m) || typeof m["type"] !== "string") throw new Error("invalid_message");
  switch (m["type"]) {
    case "load": return { type: "load", data: m["data"] };
    case "project.result":
      if (typeof m["requestId"] !== "string" || typeof m["ok"] !== "boolean") throw new Error("invalid_message");
      return { type: "project.result", requestId: m["requestId"], ok: m["ok"], data: m["data"] ?? null, error: typeof m["error"] === "string" ? m["error"] : "" };
    case "icon": return { type: "icon", category: String(m["category"] ?? ""), path: String(m["path"] ?? ""), data: String(m["data"] ?? "") };
    case "project": return { type: "project", name: String(m["name"] ?? "").trim() };
    case "lang": return { type: "lang", lang: m["lang"] };
    default: return null;
  }
}

/** Legacy save has no acknowledgement: its outcome is always "sent, write unconfirmed". Never a confirmation. */
export type LegacySaveOutcome = "browser-only" | "sent-unconfirmed" | "send-failed";

/**
 * Limited pywebview binding of the current AIM plugin: only get_app_info and get_initial_data,
 * no call/save/quit/save.result/writer. The container is { app: "information_manager", data: {...} }.
 * A present initial_data.json does not mean Allplan data were read: only the supported content
 * (a `catalog` array, optional `attributes` array and `values` object) is applied.
 */
export type AimInitialContainer =
  | { kind: "valid"; data: Record<string, unknown> }
  | { kind: "absent" }
  | { kind: "invalid"; reason: "container" | "app" | "data" | "content" };

export function parseAimInitialContainer(raw: unknown): AimInitialContainer {
  if (raw === null || raw === undefined) return { kind: "absent" };
  if (!isObj(raw)) return { kind: "invalid", reason: "container" };
  if (raw["app"] !== "information_manager") return { kind: "invalid", reason: "app" };
  const data = raw["data"];
  if (data === undefined || data === null) return { kind: "absent" };
  if (!isObj(data)) return { kind: "invalid", reason: "data" };
  if (Object.keys(data).length === 0) return { kind: "absent" };
  if (!Array.isArray(data["catalog"])) return { kind: "invalid", reason: "content" };
  if (data["attributes"] !== undefined && !Array.isArray(data["attributes"])) return { kind: "invalid", reason: "content" };
  if (data["values"] !== undefined && !isObj(data["values"])) return { kind: "invalid", reason: "content" };
  return { kind: "valid", data };
}

/** Browser save notice in a window without native project save: never "project saved". */
export const browserOnlySaveNotice = (lang: string) => lang === "fr"
  ? "Enregistré dans ce navigateur uniquement — enregistrement du projet Allplan indisponible dans cette fenêtre"
  : "Saved in this browser only — Allplan project save unavailable in this window";

/**
 * Strict pre-validation of the limited-binding content before applyData. Nothing is coerced:
 * any rejection or ambiguity blocks the whole application, so the original data and the
 * browser rows are preserved and the rejects are reported instead of silently normalised.
 * Attribute numbers: JSON integers > 0, or canonical decimal strings ("7", never "0007" —
 * a leading-zero identity has no explicit mapping rule yet and is reported as ambiguous).
 */
export type AimContentIssue = { path: string; code: "number" | "ambiguous-number" | "duplicate" | "type" | "unknown-field" | "unmatched-value" | "unmatched-attribute" };
export type AimContentCheck = { ok: true; catalogEmpty: boolean } | { ok: false; issues: AimContentIssue[] };

const TOP_FIELDS = new Set(["version", "catalog", "attributes", "values", "projectName", "projectPath", "lang", "showName", "showColors", "groups", "groupColors", "sort", "categories", "groupCategories", "categoryIcons", "view", "collapsed", "window"]);
const CATALOG_FIELDS = new Set(["num", "name", "widget", "type", "options"]);
const ATTRIBUTE_FIELDS = new Set(["num", "title", "widget", "type", "options", "group", "category"]);
const CAT_WIDGETS = ["entry", "list"], ATTR_WIDGETS = ["entry", "combo", "list", "checkbox"], TYPES = ["STR", "INT", "FLOAT", "DATE", "TIME", "EMAIL", "PHONE", "URL"], CAT_TYPES = ["STR", "INT", "FLOAT", "DATE"];

/** Returns the attribute number, "ambiguous" for leading-zero strings, or null when not interpretable. */
export function aimAttributeNumber(raw: unknown): number | "ambiguous" | null {
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  if (/^0\d+$/.test(raw)) return "ambiguous";
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

export function validateAimContent(data: Record<string, unknown>): AimContentCheck {
  const issues: AimContentIssue[] = [];
  const push = (path: string, code: AimContentIssue["code"]) => issues.push({ path, code });
  for (const k of Object.keys(data)) if (!TOP_FIELDS.has(k)) push(k, "unknown-field");
  const nums = (list: unknown, name: string, fields: Set<string>, widgets: string[], extra: (o: Record<string, unknown>, p: string) => void) => {
    const seen = new Set<number>();
    if (!Array.isArray(list)) return seen;
    list.forEach((e, i) => {
      const p = `${name}[${i}]`;
      if (!isObj(e)) { push(p, "type"); return; }
      for (const k of Object.keys(e)) if (!fields.has(k)) push(`${p}.${k}`, "unknown-field");
      const n = aimAttributeNumber(e["num"]);
      if (n === "ambiguous") push(`${p}.num`, "ambiguous-number");
      else if (n === null) push(`${p}.num`, "number");
      else if (seen.has(n)) push(`${p}.num`, "duplicate");
      else seen.add(n);
      if (e["widget"] !== undefined && !widgets.includes(e["widget"] as string)) push(`${p}.widget`, "type");
      if (e["type"] !== undefined && !TYPES.includes(e["type"] as string)) push(`${p}.type`, "type");
      if (e["options"] !== undefined && !(Array.isArray(e["options"]) && e["options"].every((o) => typeof o === "string"))) push(`${p}.options`, "type");
      extra(e, p);
    });
    return seen;
  };
  const str = (o: Record<string, unknown>, p: string, k: string) => { if (o[k] !== undefined && typeof o[k] !== "string") push(`${p}.${k}`, "type"); };
  const catalog = nums(data["catalog"], "catalog", CATALOG_FIELDS, CAT_WIDGETS, (o, p) => { if (typeof o["name"] !== "string") push(`${p}.name`, "type"); if (o["type"] !== undefined && !CAT_TYPES.includes(o["type"] as string)) push(`${p}.type`, "type"); });
  const attrs = nums(data["attributes"], "attributes", ATTRIBUTE_FIELDS, ATTR_WIDGETS, (o, p) => { str(o, p, "title"); str(o, p, "group"); str(o, p, "category"); });
  for (const n of attrs) if (!catalog.has(n)) push(`attributes.num=${n}`, "unmatched-attribute");
  const values = data["values"];
  if (isObj(values)) for (const [k, v] of Object.entries(values)) {
    const n = aimAttributeNumber(k);
    if (n === "ambiguous") push(`values.${k}`, "ambiguous-number");
    else if (n === null) push(`values.${k}`, "number");
    else if (!catalog.has(n) && !attrs.has(n)) push(`values.${k}`, "unmatched-value");
    if (v !== null && !["string", "number", "boolean"].includes(typeof v)) push(`values.${k}`, "type");
  }
  return issues.length ? { ok: false, issues } : { ok: true, catalogEmpty: catalog.size === 0 };
}

/** Limited-binding outcome labels: absent host data ≠ confirmed empty catalog ≠ format error ≠ timeout. */
export type AimLimitedOutcome = "loading" | "absent" | "empty" | "invalid" | "timeout" | "error";
const LIMITED_TEXT: Record<"fr" | "en", Record<AimLimitedOutcome | "browserKept", string>> = {
  fr: { loading: "Chargement des données de l’hôte…", absent: "Données de l’hôte non fournies ou indisponibles", empty: "Référentiel vide confirmé par l’hôte", invalid: "Erreur de format des données de l’hôte", timeout: "L’hôte n’a pas répondu à temps (get_initial_data) — aucune donnée chargée ; rouvrez la fenêtre pour réessayer", error: "Échec de lecture des données de l’hôte", browserKept: "données du navigateur conservées" },
  en: { loading: "Loading host data…", absent: "Host data not provided or unavailable", empty: "Empty catalog confirmed by the host", invalid: "Host data format error", timeout: "The host did not answer in time (get_initial_data) — no data loaded; reopen the window to try again", error: "Failed to read host data", browserKept: "browser data kept" },
};
export function limitedOutcomeText(lang: string, outcome: AimLimitedOutcome, browserRows: number, issues = 0): string {
  const t = LIMITED_TEXT[lang === "fr" ? "fr" : "en"];
  const extra = outcome === "invalid" && issues ? ` (${issues} ${lang === "fr" ? "rejet(s)" : "rejection(s)"})` : "";
  return `${t[outcome]}${extra}${outcome !== "loading" && outcome !== "empty" && browserRows > 0 ? ` · ${t.browserKept}` : ""}`;
}
export const AIM_INITIAL_DATA_TIMEOUT_MS = 15000;
