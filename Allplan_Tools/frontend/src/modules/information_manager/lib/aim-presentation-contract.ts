/**
 * AIM presentation contract 1 (Python migration of a legacy *.db or new-format JSON presentation).
 * Python selects, reads, converts and associates; the frontend only checks the structure of the messages
 * and displays them. No SQLite reading, no relation rebuilding, no merge by attribute number, no defaults applied.
 * Separate from the project contract 2 parser, whose definition/installation/definitions checks are reused.
 */
import {
  isAimDefinition,
  parseAimDefinitions,
  parseAimInstallation,
  type AimDefinitions,
  type AimInstallation,
} from "./aim-project-contract";

import type {
  AnyConfiguration,
  AnyPresentation,
  TreeConfiguration,
  TreeModel,
} from "./presentation-tree";
import { configurationRows, addTreeOccurrence } from "./presentation-tree";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const strOrNull = (v: unknown) => v === null || typeof v === "string";
const intOrNull = (v: unknown) => v === null || isInt(v);
const strArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const keys = (o: Record<string, unknown>, list: string[]) => list.every((k) => Object.hasOwn(o, k));
const SEVERITIES = ["info", "warning", "error"];
const NUMBER = /^(0|[1-9]\d*)$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export const AIM_PRESENTATION_CONTRACT = 1;
export const PRESENTATION_CAPABILITIES = [
  "presentation.import.prepare",
  "presentation.import.apply",
  "presentation.import.cancel",
  "presentation.get",
  "presentation.export",
] as const;
const exact = (v: unknown, list: readonly string[]) =>
  Array.isArray(v) && v.length === list.length && v.every((c, i) => c === list[i]);

/** Documented compatible extension: the five capabilities followed only by presentation.update in sixth position. */
export const PRESENTATION_UPDATE_CAPABILITIES = [
  ...PRESENTATION_CAPABILITIES,
  "presentation.update",
] as const;
export type PresentationCapabilityProfile = "legacy-five" | "update-six" | "unrecognized";

/** Exact identity: AIM 2 fields unchanged + presentation_contract 1 and exactly one of the two documented capability lists. */
export function presentationProfile(info: unknown): PresentationCapabilityProfile {
  if (!(
    isObj(info) &&
    info["id"] === "information_manager" &&
    info["protocol_version"] === 1 &&
    info["project_contract"] === 2 &&
    info["read_only"] === true &&
    exact(info["capabilities"], ["project.select"]) &&
    info["presentation_contract"] === AIM_PRESENTATION_CONTRACT
  ))
    return "unrecognized";
  if (exact(info["presentation_capabilities"], PRESENTATION_CAPABILITIES)) return "legacy-five";
  if (exact(info["presentation_capabilities"], PRESENTATION_UPDATE_CAPABILITIES))
    return "update-six";
  return "unrecognized";
}
export const presentationAvailable = (info: unknown) =>
  presentationProfile(info) !== "unrecognized";
export const presentationTreeAvailable = (info: unknown) =>
  presentationAvailable(info) && isObj(info) && info["presentation_tree_contract"] === 1;
export const presentationCanUpdate = (info: unknown) => presentationProfile(info) === "update-six";

export type ResetDefault =
  | { state: "absent" }
  | { state: "defined"; value: string | 0 | 1 }
  | { state: "unresolved"; issueId: string };
export type DateFormat = { pattern: string; syntax: "legacy_aim"; support: "unsupported" };
export type Widget = "entry" | "combo" | "list" | "checkbox";
export type RowType = "STR" | "FLOAT" | "INT" | "DATE" | "TIME" | "EMAIL" | "PHONE" | "URL";
type RowBase = {
  id: string;
  position: number;
  title: string;
  widget: Widget;
  type?: RowType;
  options?: string[];
  resetDefault: ResetDefault;
  dateFormat?: DateFormat;
};
export type RowConfig = RowBase & { num: number };
export type Group<R> = {
  id: string;
  position: number;
  title: string;
  backgroundColor: string;
  expanded: boolean;
  rows: R[];
};
export type Category<R> = {
  id: string;
  position: number;
  name: string;
  icon: string;
  groups: Group<R>[];
};
export type Configuration = {
  schema: "aim-presentation-configuration";
  version: 1;
  configurationId: string;
  resetPolicy: { applyOn: "explicit_reset_only"; checkboxWithoutDefault: "unchecked" };
  categories: Category<RowConfig>[];
};
export type PresentationDiagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  path: string | null;
  line: number | null;
  attributeNumber: string | null;
  relatedPath: string | null;
  lineIds: string[];
};
export type DisplayRow = RowBase & {
  number: string;
  definition: Record<string, unknown> | null;
  valueState: "set" | "unset" | "unavailable";
  value: string | null;
  diagnostics: string[];
};
export type Model = {
  schema: "aim-organized-presentation";
  version: 1;
  configurationId: string;
  /** Display type also renders validated WorkingPresentation; wire validators remain profile-specific. */
  readOnly: boolean;
  project: { path: string; name: string } | null;
  installation: AimInstallation | null;
  prjatt: {
    status: "not_loaded" | "read" | "missing" | "error";
    path: string | null;
    encodingHint: string | null;
    header: string | null;
  };
  definitions: AimDefinitions;
  categories: Category<DisplayRow>[];
  counts: {
    configurationLines: number;
    matchedDefinitions: number;
    missingDefinitions: number;
    set: number;
    unset: number;
    unavailable: number;
  };
  diagnostics: PresentationDiagnostic[];
  conversionDiagnostics: {
    code: string;
    severity: "info" | "warning" | "error";
    targetId: string | null;
    message: string;
  }[];
};
export type ReportIssue = {
  id: string;
  code: string;
  severity: "info" | "warning" | "error";
  targetId: string | null;
  status: "unresolved" | "known_limitation";
  message: string;
};
/** Conversion report: kept as received (opaque traces are never executed); only the displayed fields are typed. */
export type ConversionReport = {
  schema: "aim-presentation-conversion-report";
  version: 1;
  configurationId: string;
  source: {
    fileName: string;
    encoding: string;
    provenanceLimit: string;
    snapshotScope: string;
  } & Record<string, unknown>;
  issues: ReportIssue[];
  summary: {
    status: "converted" | "converted_with_limitations" | "requires_decisions" | "incomplete";
    categories: number;
    groups: number;
    rows: number;
    ignoredSeparators: number;
    unresolvedIssues: number;
    errors: number;
  };
} & Record<string, unknown>;
export type Presentation = {
  configuration: Configuration;
  report: ConversionReport | null;
  model: Model;
};

function resetDefault(v: unknown, checkbox: boolean): boolean {
  if (!isObj(v)) return false;
  const n = Object.keys(v).length;
  if (v["state"] === "absent") return n === 1;
  if (v["state"] === "unresolved") return n === 2 && nonEmpty(v["issueId"]);
  if (v["state"] !== "defined" || n !== 2) return false;
  return checkbox ? v["value"] === 0 || v["value"] === 1 : isStr(v["value"]);
}
const TYPES = ["STR", "FLOAT", "INT", "DATE", "TIME", "EMAIL", "PHONE", "URL"];
function rowBase(v: Record<string, unknown>): boolean {
  if (
    !keys(v, ["id", "position", "title", "widget", "resetDefault"]) ||
    !nonEmpty(v["id"]) ||
    !isInt(v["position"]) ||
    !isStr(v["title"])
  )
    return false;
  const w = v["widget"];
  if (!["entry", "combo", "list", "checkbox"].includes(w as string)) return false;
  if (w === "checkbox") {
    if (Object.hasOwn(v, "type")) return false;
  } else if (!TYPES.includes(v["type"] as string)) return false;
  if (w === "combo" && !["STR", "INT", "FLOAT"].includes(v["type"] as string)) return false;
  if (w === "list" && v["type"] !== "STR") return false;
  if (w === "combo" || w === "list") {
    if (!strArray(v["options"])) return false;
  } else if (Object.hasOwn(v, "options") && !strArray(v["options"])) return false;
  if (Object.hasOwn(v, "dateFormat")) {
    const d = v["dateFormat"];
    if (
      !isObj(d) ||
      !isStr(d["pattern"]) ||
      d["syntax"] !== "legacy_aim" ||
      d["support"] !== "unsupported"
    )
      return false;
  }
  return resetDefault(v["resetDefault"], w === "checkbox");
}
/** Only the fields declared by the contract; any other key is a structural error. */
const only = (o: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(o).every((k) => allowed.includes(k));
const ROW_BASE_KEYS = [
  "id",
  "position",
  "title",
  "widget",
  "type",
  "options",
  "resetDefault",
  "dateFormat",
];
const CONFIG_ROW_KEYS = [...ROW_BASE_KEYS, "num"];
const DISPLAY_ROW_KEYS = [
  ...ROW_BASE_KEYS,
  "number",
  "definition",
  "valueState",
  "value",
  "diagnostics",
];
const CATEGORY_KEYS = ["id", "position", "name", "icon", "groups"];
const GROUP_KEYS = ["id", "position", "title", "backgroundColor", "expanded", "rows"];
const configRow = (v: unknown) =>
  isObj(v) && only(v, CONFIG_ROW_KEYS) && rowBase(v) && isInt(v["num"]) && v["num"] >= 0;
function displayRow(v: unknown): boolean {
  if (
    !isObj(v) ||
    !only(v, DISPLAY_ROW_KEYS) ||
    !rowBase(v) ||
    !keys(v, ["number", "definition", "valueState", "value", "diagnostics"])
  )
    return false;
  const number = v["number"];
  if (!isStr(number) || !NUMBER.test(number)) return false;
  if (v["definition"] !== null && !isAimDefinition(v["definition"], number)) return false;
  const st = v["valueState"],
    val = v["value"];
  if (st === "set" ? !isStr(val) : st === "unset" || st === "unavailable" ? val !== null : true)
    return false;
  return strArray(v["diagnostics"]);
}
const contiguous = (list: Record<string, unknown>[]) =>
  list.every((x, i) => x["position"] === i + 1);
/** Categories/groups/rows with contiguous base-1 positions; collects ids for global uniqueness. */
function tree(v: unknown, row: (r: unknown) => boolean, ids: string[]): boolean {
  if (!Array.isArray(v) || !v.every(isObj) || !contiguous(v)) return false;
  for (const c of v) {
    if (
      !only(c, CATEGORY_KEYS) ||
      !keys(c, CATEGORY_KEYS) ||
      !nonEmpty(c["id"]) ||
      !isStr(c["name"]) ||
      !isStr(c["icon"])
    )
      return false;
    ids.push(c["id"]);
    const groups = c["groups"];
    if (!Array.isArray(groups) || !groups.every(isObj) || !contiguous(groups)) return false;
    for (const g of groups) {
      if (!only(g, GROUP_KEYS) || !keys(g, GROUP_KEYS) || !nonEmpty(g["id"]) || !isStr(g["title"]))
        return false;
      if (
        !isStr(g["backgroundColor"]) ||
        !COLOR.test(g["backgroundColor"]) ||
        typeof g["expanded"] !== "boolean"
      )
        return false;
      ids.push(g["id"]);
      const rows = g["rows"];
      if (
        !Array.isArray(rows) ||
        !rows.every(row) ||
        !contiguous(rows as Record<string, unknown>[])
      )
        return false;
      for (const r of rows as { id: string }[]) ids.push(r.id);
    }
  }
  return new Set(ids).size === ids.length;
}

/** V2 has a single ordered children sequence; no grouping, coercion or model reconstruction. */
function treeV2(v: unknown, validateRow: (v: unknown) => boolean): boolean {
  if (!Array.isArray(v) || !v.every(isObj) || !contiguous(v)) return false;
  const ids: string[] = [];
  const row = (r: unknown): boolean => {
    if (!isObj(r) || r["kind"] !== "row") return false;
    const { kind: _kind, ...base } = r;
    if (!validateRow(base)) return false;
    ids.push(base["id"] as string);
    return true;
  };
  for (const c of v) {
    if (
      !only(c, ["id", "position", "name", "icon", "children"]) ||
      !nonEmpty(c["id"]) ||
      ["all", "unlisted"].includes(c["id"]) ||
      !isStr(c["name"]) ||
      !isStr(c["icon"])
    )
      return false;
    ids.push(c["id"]);
    const children = c["children"];
    if (!Array.isArray(children) || !children.every(isObj) || !contiguous(children)) return false;
    for (const child of children) {
      if (child["kind"] === "row") {
        if (!row(child)) return false;
        continue;
      }
      if (
        child["kind"] !== "group" ||
        !only(child, [...GROUP_KEYS, "kind"]) ||
        !keys(child, GROUP_KEYS) ||
        !nonEmpty(child["id"]) ||
        !isStr(child["title"]) ||
        !isStr(child["backgroundColor"]) ||
        !COLOR.test(child["backgroundColor"]) ||
        typeof child["expanded"] !== "boolean"
      )
        return false;
      ids.push(child["id"]);
      if (
        !Array.isArray(child["rows"]) ||
        !child["rows"].every(isObj) ||
        !contiguous(child["rows"]) ||
        !child["rows"].every(row)
      )
        return false;
    }
  }
  return new Set(ids).size === ids.length;
}
function matchesTreeV2(c: TreeConfiguration, m: TreeModel): boolean {
  const row = (
    a: { id: string; position: number; num: number },
    b: { id: string; position: number; number: string },
  ) => a.id === b.id && a.position === b.position && String(a.num) === b.number;
  return (
    c.categories.length === m.categories.length &&
    c.categories.every((cat, i) => {
      const modelCat = m.categories[i];
      return (
        !!modelCat &&
        cat.id === modelCat.id &&
        cat.position === modelCat.position &&
        cat.children.length === modelCat.children.length &&
        cat.children.every((a, j) => {
          const b = modelCat.children[j];
          if (!b || a.kind !== b.kind || a.id !== b.id || a.position !== b.position) return false;
          if (a.kind === "row" && b.kind === "row") return row(a, b);
          return (
            a.kind === "group" &&
            b.kind === "group" &&
            a.rows.length === b.rows.length &&
            a.rows.every((r, k) => {
              const mr = b.rows[k];
              return !!mr && row(r, mr);
            })
          );
        })
      );
    })
  );
}

export function isAnyConfiguration(v: unknown): v is AnyConfiguration {
  if (
    !isObj(v) ||
    v["schema"] !== "aim-presentation-configuration" ||
    ![1, 2].includes(v["version"] as number) ||
    !nonEmpty(v["configurationId"])
  )
    return false;
  if (!only(v, ["schema", "version", "configurationId", "resetPolicy", "categories"])) return false;
  const rp = v["resetPolicy"];
  if (
    !isObj(rp) ||
    rp["applyOn"] !== "explicit_reset_only" ||
    rp["checkboxWithoutDefault"] !== "unchecked"
  )
    return false;
  return v["version"] === 2
    ? treeV2(v["categories"], configRow)
    : tree(v["categories"], configRow, []);
}
function diagnostic(v: unknown): boolean {
  return (
    isObj(v) &&
    keys(v, [
      "code",
      "severity",
      "message",
      "path",
      "line",
      "attributeNumber",
      "relatedPath",
      "lineIds",
    ]) &&
    isStr(v["code"]) &&
    SEVERITIES.includes(v["severity"] as string) &&
    isStr(v["message"]) &&
    strOrNull(v["path"]) &&
    intOrNull(v["line"]) &&
    strOrNull(v["attributeNumber"]) &&
    strOrNull(v["relatedPath"]) &&
    strArray(v["lineIds"])
  );
}
function model(v: unknown, readOnly = true): v is Model | TreeModel {
  if (
    !isObj(v) ||
    v["schema"] !== "aim-organized-presentation" ||
    ![1, 2].includes(v["version"] as number) ||
    !nonEmpty(v["configurationId"]) ||
    v["readOnly"] !== readOnly
  )
    return false;
  if (
    !keys(v, [
      "project",
      "installation",
      "prjatt",
      "definitions",
      "categories",
      "counts",
      "diagnostics",
      "conversionDiagnostics",
    ])
  )
    return false;
  const p = v["project"];
  if (p !== null && !(isObj(p) && isStr(p["path"]) && isStr(p["name"]))) return false;
  if (v["installation"] !== null && !parseAimInstallation(v["installation"])) return false;
  const pa = v["prjatt"];
  if (
    !isObj(pa) ||
    !["not_loaded", "read", "missing", "error"].includes(pa["status"] as string) ||
    !strOrNull(pa["path"]) ||
    !strOrNull(pa["encodingHint"]) ||
    !strOrNull(pa["header"])
  )
    return false;
  if (!parseAimDefinitions(v["definitions"])) return false;
  const c = v["counts"];
  if (
    !isObj(c) ||
    ![
      "configurationLines",
      "matchedDefinitions",
      "missingDefinitions",
      "set",
      "unset",
      "unavailable",
    ].every((k) => isInt(c[k]) && (c[k] as number) >= 0)
  )
    return false;
  if (!Array.isArray(v["diagnostics"]) || !v["diagnostics"].every(diagnostic)) return false;
  const cd = v["conversionDiagnostics"];
  if (
    !Array.isArray(cd) ||
    !cd.every(
      (d) =>
        isObj(d) &&
        isStr(d["code"]) &&
        SEVERITIES.includes(d["severity"] as string) &&
        strOrNull(d["targetId"]) &&
        isStr(d["message"]),
    )
  )
    return false;
  return v["version"] === 2
    ? treeV2(v["categories"], displayRow)
    : tree(v["categories"], displayRow, []);
}
const sourceRef = (v: unknown) => isObj(v) && isStr(v["table"]) && isInt(v["rowid"]);
export function isReport(v: unknown): v is ConversionReport {
  if (
    !isObj(v) ||
    v["schema"] !== "aim-presentation-conversion-report" ||
    v["version"] !== 1 ||
    !nonEmpty(v["configurationId"])
  )
    return false;
  const s = v["source"];
  if (
    !isObj(s) ||
    !isStr(s["fileName"]) ||
    !isStr(s["encoding"]) ||
    s["fileSha256"] !== null ||
    !isStr(s["provenanceLimit"]) ||
    !isStr(s["configurationSnapshotSha256"]) ||
    !isStr(s["snapshotScope"])
  )
    return false;
  const o = v["ordering"];
  if (
    !isObj(o) ||
    !isStr(o["categories"]) ||
    !isStr(o["groups"]) ||
    !isStr(o["rows"]) ||
    o["positionBase"] !== 1
  )
    return false;
  if (
    !Array.isArray(v["mappings"]) ||
    !v["mappings"].every(
      (m) => isObj(m) && nonEmpty(m["targetId"]) && sourceRef(m["source"]) && isObj(m["raw"]),
    )
  )
    return false;
  const d = v["discarded"];
  if (
    !isObj(d) ||
    !Array.isArray(d["formattingExpressions"]) ||
    !Array.isArray(d["separators"]) ||
    !isStr(d["textColors"])
  )
    return false;
  if (
    !Array.isArray(v["issues"]) ||
    !v["issues"].every(
      (i) =>
        isObj(i) &&
        nonEmpty(i["id"]) &&
        isStr(i["code"]) &&
        SEVERITIES.includes(i["severity"] as string) &&
        strOrNull(i["targetId"]) &&
        (i["source"] === null || sourceRef(i["source"])) &&
        ["unresolved", "known_limitation"].includes(i["status"] as string) &&
        isStr(i["message"]),
    )
  )
    return false;
  if (
    Object.hasOwn(v, "unmapped") &&
    !(
      Array.isArray(v["unmapped"]) &&
      v["unmapped"].every((u) => isObj(u) && sourceRef(u["source"]) && isObj(u["raw"]))
    )
  )
    return false;
  const sm = v["summary"];
  return (
    isObj(sm) &&
    ["converted", "converted_with_limitations", "requires_decisions", "incomplete"].includes(
      sm["status"] as string,
    ) &&
    ["categories", "groups", "rows", "ignoredSeparators", "unresolvedIssues", "errors"].every(
      (k) => isInt(sm[k]) && (sm[k] as number) >= 0,
    )
  );
}
/**
 * Message coherence only (nothing recomputed): the model mirrors the configuration tree —
 * same category/group/row ids, under the same parent, at the same positions, and number === String(num).
 */
export function modelMatchesConfiguration(c: AnyConfiguration, m: Model | TreeModel): boolean {
  if (c.version !== m.version) return false;
  if (c.version === 2 && m.version === 2) return matchesTreeV2(c, m);
  if (c.version !== 1 || m.version !== 1) return false;
  const same = <
    A extends { id: string; position: number },
    B extends { id: string; position: number },
  >(
    a: A[],
    b: B[],
    inner: (x: A, y: B) => boolean,
  ) =>
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return y !== undefined && x.id === y.id && x.position === y.position && inner(x, y);
    });
  return same(c.categories, m.categories, (cc, mc) =>
    same(cc.groups, mc.groups, (cg, mg) =>
      same(cg.rows, mg.rows, (cr, mr) => String(cr.num) === mr.number),
    ),
  );
}
export function isPresentationStructure(v: unknown, readOnly = true): boolean {
  if (
    !isObj(v) ||
    Object.keys(v).length !== 3 ||
    !keys(v, ["configuration", "report", "model"]) ||
    !isAnyConfiguration(v["configuration"]) ||
    !model(v["model"], readOnly)
  )
    return false;
  const id = v["configuration"].configurationId;
  if (v["model"].configurationId !== id) return false;
  if (!modelMatchesConfiguration(v["configuration"], v["model"])) return false;
  if (v["report"] === null) return true;
  return isReport(v["report"]) && v["report"].configurationId === id;
}
export const isAnyPresentation = (v: unknown): v is AnyPresentation => isPresentationStructure(v);

export type Failure = {
  kind: "failure";
  code: string;
  message: string;
  report: ConversionReport | null;
};
export type Invalid = { kind: "invalid" };
function failure(raw: Record<string, unknown>): Failure | Invalid {
  const e = raw["error"];
  if (raw["ok"] !== false || !isObj(e) || !nonEmpty(e["code"]) || !isStr(e["message"]))
    return { kind: "invalid" };
  if (Object.hasOwn(raw, "report") && !isReport(raw["report"])) return { kind: "invalid" };
  return {
    kind: "failure",
    code: e["code"],
    message: e["message"],
    report: (raw["report"] as ConversionReport | undefined) ?? null,
  };
}
const okWith = (raw: unknown, status: string, extra: string[]) =>
  isObj(raw) &&
  raw["ok"] === true &&
  raw["status"] === status &&
  Object.keys(raw).length === 2 + extra.length &&
  keys(raw, extra);

export type PrepareOutcome =
  | { kind: "prepared"; token: string; candidate: AnyPresentation }
  | { kind: "cancelled" }
  | Failure
  | Invalid;
export function parsePrepare(raw: unknown): PrepareOutcome {
  if (okWith(raw, "cancelled", [])) return { kind: "cancelled" };
  if (okWith(raw, "prepared", ["token", "candidate"])) {
    const r = raw as Record<string, unknown>;
    if (!nonEmpty(r["token"]) || !isAnyPresentation(r["candidate"])) return { kind: "invalid" };
    // A report with errors refuses the preparation: never applicable.
    if (r["candidate"].report && r["candidate"].report.summary.errors > 0)
      return { kind: "invalid" };
    return { kind: "prepared", token: r["token"], candidate: r["candidate"] };
  }
  return isObj(raw) ? failure(raw) : { kind: "invalid" };
}
export type ApplyOutcome = { kind: "applied"; presentation: AnyPresentation } | Failure | Invalid;
export function parseApply(raw: unknown): ApplyOutcome {
  if (okWith(raw, "applied", ["presentation"])) {
    const p = (raw as Record<string, unknown>)["presentation"];
    return isAnyPresentation(p) ? { kind: "applied", presentation: p } : { kind: "invalid" };
  }
  return isObj(raw) ? failure(raw) : { kind: "invalid" };
}
export type GetOutcome =
  { kind: "current"; presentation: AnyPresentation } | { kind: "empty" } | Failure | Invalid;
export function parseGet(raw: unknown): GetOutcome {
  if (
    okWith(raw, "empty", ["presentation"]) &&
    (raw as Record<string, unknown>)["presentation"] === null
  )
    return { kind: "empty" };
  if (okWith(raw, "current", ["presentation"])) {
    const p = (raw as Record<string, unknown>)["presentation"];
    return isAnyPresentation(p) ? { kind: "current", presentation: p } : { kind: "invalid" };
  }
  return isObj(raw) ? failure(raw) : { kind: "invalid" };
}
export type ExportOutcome =
  | { kind: "exported"; fileName: string; configurationId: string }
  | { kind: "cancelled" }
  | Failure
  | Invalid;
export function parseExport(raw: unknown, expectedId: string): ExportOutcome {
  if (okWith(raw, "cancelled", [])) return { kind: "cancelled" };
  if (okWith(raw, "exported", ["fileName", "configurationId"])) {
    const r = raw as Record<string, unknown>;
    // Wrong configurationId: not a confirmation of this export.
    return nonEmpty(r["fileName"]) && r["configurationId"] === expectedId
      ? { kind: "exported", fileName: r["fileName"], configurationId: expectedId }
      : { kind: "invalid" };
  }
  return isObj(raw) ? failure(raw) : { kind: "invalid" };
}

export type UpdateOutcome = { kind: "updated"; presentation: AnyPresentation } | Failure | Invalid;
/** presentation.update success carries the complete recomputed presentation with report null; failures carry no replacement. */
export function parseUpdate(raw: unknown): UpdateOutcome {
  if (okWith(raw, "updated", ["presentation"])) {
    const p = (raw as Record<string, unknown>)["presentation"];
    return isAnyPresentation(p) && p.report === null
      ? { kind: "updated", presentation: p }
      : { kind: "invalid" };
  }
  if (isObj(raw) && Object.hasOwn(raw, "presentation")) return { kind: "invalid" };
  return isObj(raw) ? failure(raw) : { kind: "invalid" };
}

/** Display filter only: resolved project attributes whose number appears in no row of the given configuration. */
export function outsideAttributes<A extends { number: string }>(
  configuration: AnyConfiguration | null,
  attributes: readonly A[],
): A[] {
  const used = new Set(
    configuration ? configurationRows(configuration).map((r) => String(r.num)) : [],
  );
  return attributes.filter((a) => !used.has(a.number));
}

/** New occurrence: fresh globally unique ID, explicit presentation settings, never a value or definition. */
export function addOccurrence(configuration: Configuration, groupId: string, attribute: {number:string;label:string}, newId?: () => string): Configuration | null;
export function addOccurrence(configuration: AnyConfiguration, groupId: string, attribute: {number:string;label:string}, newId?: () => string): AnyConfiguration | null;
export function addOccurrence(
  configuration: AnyConfiguration,
  groupId: string,
  attribute: { number: string; label: string },
  newId: () => string = () => crypto.randomUUID(),
): AnyConfiguration | null {
  if (configuration.version === 2)
    return addTreeOccurrence(configuration, groupId, attribute, newId);
  if (!NUMBER.test(attribute.number)) return null;
  const ids = new Set<string>();
  configuration.categories.forEach((c) => {
    ids.add(c.id);
    c.groups.forEach((g) => {
      ids.add(g.id);
      g.rows.forEach((r) => ids.add(r.id));
    });
  });
  let id = newId();
  while (ids.has(id)) id = newId();
  let found = false;
  const next = structuredClone(configuration);
  next.categories.forEach((c) =>
    c.groups.forEach((g) => {
      if (g.id !== groupId) return;
      found = true;
      g.rows.push({
        id,
        position: g.rows.length + 1,
        num: Number(attribute.number),
        title: attribute.label,
        widget: "entry",
        type: "STR",
        resetDefault: { state: "absent" },
      });
    }),
  );
  return found ? next : null;
}

export type FailureKind =
  "integration" | "incompatible" | "retry" | "conversion" | "stale" | "export" | "other";
export function failureKind(code: string): FailureKind {
  if (code === "invalid_payload" || code === "unknown_command") return "integration";
  if (["incompatible_database", "unsupported_format", "invalid_presentation"].includes(code))
    return "incompatible";
  if (["file_access", "source_read_error", "source_locked", "dialog_unavailable"].includes(code))
    return "retry";
  if (code === "conversion_failed") return "conversion";
  if (code === "stale_candidate" || code === "project_changed") return "stale";
  if (["protected_destination", "output_exists", "export_failed"].includes(code)) return "export";
  return "other";
}

export type PresentationCommand = (typeof PRESENTATION_UPDATE_CAPABILITIES)[number];
/** Native call through the verified pywebview binding; never HTTP, upload or File.path. */
export async function callPresentation(
  command: PresentationCommand,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const api = (
    globalThis as unknown as {
      pywebview?: { api?: { call?: (c: string, p: Record<string, unknown>) => Promise<unknown> } };
    }
  ).pywebview?.api;
  if (typeof api?.call !== "function") throw new Error("binding_unavailable");
  return api.call(command, payload);
}

export const isConfiguration = (v: unknown): v is Configuration =>
  isAnyConfiguration(v) && v.version === 1;
export const isPresentation = (v: unknown): v is Presentation =>
  isAnyPresentation(v) && v.configuration.version === 1 && v.model.version === 1;
