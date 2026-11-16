/**
 * Consumer of the reference.load reply (contract vob-references/2, plus explicit legacy handling).
 * Pure functions only: validation never mutates rules, and raw identifiers are preserved; matching uses normalized textual indices.
 */
export type RefKey = "trade" | "object" | "unit" | "method";
export type RefCategory = "trades" | "objects" | "methods" | "units";
export type RefStatus = "available" | "available_with_diagnostics" | "unavailable";
export type RefSource = { scope: "STD" | "ETC" | "PRJ"; path: string; attributeNumber: string | null; language: string | null }
  | { scope: "USER"; label: string; language: string; coverage: "specified_codes_only" };
export type RefDiagnostic = { code: string; severity: "info" | "warning" | "error"; message: string; id: string | null; locations: { path: string; line: number | null }[] };
export type RefMeta = { status: RefStatus; sources: RefSource[]; diagnostics: RefDiagnostic[] };
export type RefEntry = { id: string; name: string };
export type VobReferencesV2 = { referenceContract: "vob-references/2"; entries: Record<RefCategory, RefEntry[]>; metadata: Record<RefCategory, RefMeta> };

/** Frontend-only states; legacy_unverified is never requested from or written back to Python. */
export type VobRefState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "v2"; data: VobReferencesV2 }
  | { kind: "legacy_unverified"; entries: Record<RefCategory, RefEntry[]> }
  | { kind: "contract_error"; message: string }
  | { kind: "error"; message: string };

export const CATEGORY: Record<RefKey, RefCategory> = { trade: "trades", object: "objects", unit: "units", method: "methods" };
const ID_FIELD: Record<RefCategory, string> = { trades: "index", objects: "num", methods: "value", units: "index" };
const CATS: RefCategory[] = ["trades", "objects", "methods", "units"];

class ContractError extends Error {}
const fail = (m: string): never => { throw new ContractError(m); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { [k: string]: any };
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (o: Loose, keys: string[], where: string) => {
  for (const k of keys) if (!(k in o)) fail(`${where}: champ « ${k} » manquant`);
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${where}: champ inattendu « ${k} »`);
};
const str = (v: unknown, where: string, min = 0) => (typeof v === "string" && v.length >= min ? v : fail(`${where}: chaîne attendue`));
const strOrNull = (v: unknown, where: string, min = 0) => (v === null ? null : str(v, where, min));

function parseEntries(cat: RefCategory, raw: unknown): RefEntry[] {
  if (!Array.isArray(raw)) fail(`${cat}: tableau attendu`);
  const field = ID_FIELD[cat];
  return (raw as unknown[]).map((e, i) => {
    const where = `${cat}[${i}]`;
    if (!isObj(e)) fail(`${where}: objet attendu`);
    const o = e as Loose;
    exactKeys(o, [field, "name"], where);
    const id = str(o[field], `${where}.${field}`, 1);
    if (id === "-1") fail(`${where}: "-1" est réservé à la sentinelle`);
    return { id, name: str(o["name"], `${where}.name`) };
  });
}
function parseMeta(cat: RefCategory, raw: unknown): RefMeta {
  const where = `metadata.${cat}`;
  if (!isObj(raw)) fail(`${where}: objet attendu`);
  const o = raw as Loose;
  exactKeys(o, ["status", "sources", "diagnostics"], where);
  const status = o["status"] as RefStatus;
  if (status !== "available" && status !== "available_with_diagnostics" && status !== "unavailable") fail(`${where}.status inconnu`);
  if (!Array.isArray(o["sources"]) || !Array.isArray(o["diagnostics"])) fail(`${where}: sources/diagnostics doivent être des tableaux`);
  const sources = (o["sources"] as unknown[]).map((s, i) => {
    const w = `${where}.sources[${i}]`; if (!isObj(s)) fail(`${w}: objet attendu`);
    const so = s as Loose;
    if (so["scope"] === "USER") {
      exactKeys(so, ["scope", "label", "language", "coverage"], w);
      if (so["coverage"] !== "specified_codes_only") fail(`${w}.coverage invalide`);
      return { scope: "USER", label: str(so["label"], `${w}.label`, 1), language: str(so["language"], `${w}.language`, 1), coverage: "specified_codes_only" } as RefSource;
    }
    exactKeys(so, ["scope", "path", "attributeNumber", "language"], w);
    if (so["scope"] !== "STD" && so["scope"] !== "ETC" && so["scope"] !== "PRJ") fail(`${w}.scope inconnu`);
    return { scope: so["scope"], path: str(so["path"], `${w}.path`, 1), attributeNumber: strOrNull(so["attributeNumber"], `${w}.attributeNumber`), language: strOrNull(so["language"], `${w}.language`) } as RefSource;
  });
  const diagnostics = (o["diagnostics"] as unknown[]).map((d, i) => {
    const w = `${where}.diagnostics[${i}]`; if (!isObj(d)) fail(`${w}: objet attendu`);
    const dO = d as Loose; exactKeys(dO, ["code", "severity", "message", "id", "locations"], w);
    if (dO["severity"] !== "info" && dO["severity"] !== "warning" && dO["severity"] !== "error") fail(`${w}.severity inconnue`);
    if (!Array.isArray(dO["locations"])) fail(`${w}.locations: tableau attendu`);
    const locations = (dO["locations"] as unknown[]).map((l, j) => {
      const lw = `${w}.locations[${j}]`; if (!isObj(l)) fail(`${lw}: objet attendu`);
      const lo = l as Loose; exactKeys(lo, ["path", "line"], lw);
      if (lo["line"] !== null && !(Number.isInteger(lo["line"]) && (lo["line"] as number) >= 1)) fail(`${lw}.line invalide`);
      return { path: str(lo["path"], `${lw}.path`, 1), line: lo["line"] as number | null };
    });
    return { code: str(dO["code"], `${w}.code`, 1), severity: dO["severity"], message: str(dO["message"], `${w}.message`, 1), id: strOrNull(dO["id"], `${w}.id`, 1), locations } as RefDiagnostic;
  });
  return { status, sources, diagnostics };
}

/** Distinct labels per identifier (exact text); repeated identical occurrences are not an ambiguity. */
export function labelsById(entries: RefEntry[]) {
  const map = new Map<string, string[]>();
  for (const e of entries) { const l = map.get(e.id) ?? []; if (!l.includes(e.name)) l.push(e.name); map.set(e.id, l); }
  return map;
}

function checkInvariants(cat: RefCategory, entries: RefEntry[], meta: RefMeta) {
  if (meta.status === "available" && meta.diagnostics.length) fail(`${cat}: « available » sans diagnostic exigé`);
  if (meta.status === "available_with_diagnostics" && !meta.diagnostics.length) fail(`${cat}: « available_with_diagnostics » sans diagnostic`);
  if (meta.status !== "unavailable" && !meta.sources.length) fail(`${cat}: disponible sans source`);
  if (meta.status === "unavailable") {
    if (entries.length) fail(`${cat}: indisponible mais tableau non vide`);
    if (!meta.diagnostics.length) fail(`${cat}: indisponible sans diagnostic explicite`);
  }
  for (const [id, labels] of labelsById(entries)) {
    if (labels.length > 1 && !meta.diagnostics.some((d) => d.code === "reference_id_ambiguous" && d.id !== null && normalizeVobIndex(d.id) === normalizeVobIndex(id))) fail(`${cat}: identifiant « ${normalizeVobIndex(id)} » ambigu sans diagnostic reference_id_ambiguous`);
  }
}

/** Converts a reply payload into a frontend state. Never mutates the input. */
export function parseVobReferences(data: unknown): VobRefState {
  try {
    if (!isObj(data)) fail("réponse : objet attendu");
    const o = data as Loose;
    if (!("referenceContract" in o) && !("metadata" in o)) {
      exactKeys(o, CATS, "ancienne réponse");
      const entries = {} as Record<RefCategory, RefEntry[]>;
      for (const cat of CATS) {
        if (!Array.isArray(o[cat])) fail(`ancienne réponse ${cat}: tableau attendu`);
        const field = ID_FIELD[cat];
        // Inspection only: historic numeric identifiers become strings; lost zeros are not reconstructed.
        entries[cat] = (o[cat] as unknown[]).map((e, i) => {
          const eo = isObj(e) ? e : fail(`ancienne réponse ${cat}[${i}]: objet attendu`);
          const id = eo[field]; if (typeof id !== "string" && !(typeof id === "number" && Number.isFinite(id))) fail(`ancienne réponse ${cat}[${i}].${field} invalide`);
          return { id: String(id), name: typeof eo["name"] === "string" ? eo["name"] : fail(`ancienne réponse ${cat}[${i}].name invalide`) };
        });
      }
      return { kind: "legacy_unverified", entries };
    }
    if (o["referenceContract"] !== "vob-references/2") fail(`version de contrat inconnue : ${JSON.stringify(o["referenceContract"] ?? null)}`);
    exactKeys(o, ["referenceContract", ...CATS, "metadata"], "réponse v2");
    const metaRaw = isObj(o["metadata"]) ? o["metadata"] : fail("metadata: objet attendu");
    exactKeys(metaRaw, CATS, "metadata");
    const entries = {} as Record<RefCategory, RefEntry[]>; const metadata = {} as Record<RefCategory, RefMeta>;
    for (const cat of CATS) { entries[cat] = parseEntries(cat, o[cat]); metadata[cat] = parseMeta(cat, metaRaw[cat]); checkInvariants(cat, entries[cat], metadata[cat]); }
    return { kind: "v2", data: { referenceContract: "vob-references/2", entries, metadata } };
  } catch (e) {
    if (e instanceof ContractError) return { kind: "contract_error", message: e.message };
    throw e;
  }
}

export type RefResolution =
  | { kind: "sentinel" }
  | { kind: "empty" }
  | { kind: "unique"; id: string; label: string; languageEstablished: boolean }
  | { kind: "ambiguous"; id: string; candidates: string[] }
  | { kind: "unknown"; id: string }
  | { kind: "unavailable"; id: string; reason: "category" | "legacy" | "loading" | "none" | "error" };

export function resolveVobReference(state: VobRefState, key: RefKey, raw: string): RefResolution {
  if (raw === "-1") return { kind: "sentinel" };
  if (raw === "") return { kind: "empty" };
  if (state.kind === "legacy_unverified") return { kind: "unavailable", id: raw, reason: "legacy" };
  if (state.kind === "loading" || state.kind === "none") return { kind: "unavailable", id: raw, reason: state.kind };
  if (state.kind !== "v2") return { kind: "unavailable", id: raw, reason: "error" };
  const cat = CATEGORY[key]; const meta = state.data.metadata[cat];
  if (meta.status === "unavailable") return { kind: "unavailable", id: raw, reason: "category" };
  // Normalize both sides without modifying raw entries or rule values.
  const labels = indexLabels(state.data.entries[cat]).get(normalizeVobIndex(raw))?.labels;
  if (!labels) return { kind: "unknown", id: raw };
  if (labels.length > 1) return { kind: "ambiguous", id: raw, candidates: labels };
  return { kind: "unique", id: raw, label: labels[0] ?? "", languageEstablished: meta.sources.some((s) => s.language !== null) };
}

/** All VOB indices: textual normalization only; never rewrite stored values. */
export const normalizeVobIndex = (code: string): string => /^[0-9]+$/.test(code) ? code.replace(/^0+/, "") || "0" : code;
/** Compatibility alias; all categories now use the same normalizer. */
export const vobTradeCode = normalizeVobIndex;
/** Distinct labels per normalized code; id retains the first raw source identifier. */
function indexLabels(entries: RefEntry[]) {
  const map = new Map<string, { id: string; labels: string[] }>();
  for (const e of entries) { const code = normalizeVobIndex(e.id); const item = map.get(code) ?? { id: e.id, labels: [] }; if (!item.labels.includes(e.name)) item.labels.push(e.name); map.set(code, item); }
  return map;
}

/** Options offered for a category: only source entries of an available v2 category, never a static catalog. */
export function vobReferenceOptions(state: VobRefState, key: RefKey) {
  if (state.kind !== "v2" || state.data.metadata[CATEGORY[key]].status === "unavailable") return [];
  return [...indexLabels(state.data.entries[CATEGORY[key]])].map(([code, { id, labels }]) => ({ id, labels, code }));
}
