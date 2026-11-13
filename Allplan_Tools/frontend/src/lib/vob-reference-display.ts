import { CATEGORY, resolveVobReference, vobReferenceOptions, normalizeVobIndex, type RefKey, type VobRefState } from "./vob-references";

const defaults: Record<string, string> = { fr: "Défaut", en: "Default", de: "Standard", it: "Predefinito", es: "Predeterminado", hr: "Zadano", ro: "Implicit", ru: "По умолчанию", cs: "Výchozí", sl: "Privzeto", sk: "Predvolené" };
export const vobDefaultLabel = (lang: string) => defaults[lang] ?? defaults["en"] ?? "Default";
const undefinedLabels: Record<string, string> = { fr: "<non défini>", en: "<undefined>", de: "<nicht definiert>", it: "<non definito>", es: "<no definido>", hr: "<nedefinirano>", ro: "<nedefinit>", ru: "<не определено>", cs: "<nedefinováno>", sl: "<nedoločeno>", sk: "<nedefinované>" };
export const vobUndefinedLabel = (lang: string) => undefinedLabels[lang] ?? "<undefined>";

/** Table-only presentation: hide sentinels, not unknown codes or reference failures. */
export const displayVobTableReference = (state: VobRefState, key: RefKey, raw: string, lang: string) => raw === "-1" ? "" : displayVobReference(state, key, raw, lang, false, true);

/** Shared cell/option presentation. Source labels are never translated or normalized. */
export function displayVobReference(state: VobRefState, key: RefKey, raw: string, lang: string, provenanceShown = true, separateIndex = false): string {
  const fr = lang === "fr";
  const text = (a: string, b: string) => fr ? a : b;
  const r = resolveVobReference(state, key, raw);
  if (r.kind === "empty") return "";
  if (r.kind === "sentinel") return key === "unit" ? vobDefaultLabel(lang) : vobUndefinedLabel(lang);
  if (r.kind === "unique") {
    const sources = state.kind === "v2" ? state.data.metadata[CATEGORY[key]].sources : [];
    const user = sources.filter((source) => source.scope === "USER");
    const provenance = provenanceShown && user.length ? ` · ${text("source utilisateur", "user source")} (${[...new Set(user.map((source) => source.language))].join(" / ")})` : "";
    const unresolved = key === "method" && normalizeVobIndex(raw) === "13" ? ` · ${separateIndex ? "" : `${normalizeVobIndex(raw)} · `}${text("signification non établie", "meaning not established")}` : "";
    return `${r.label || text("[libellé vide]", "[empty label]")}${unresolved}${provenance}`;
  }
  const note = r.kind === "ambiguous" ? text(`ambigu : ${r.candidates.join(" / ")}`, `ambiguous: ${r.candidates.join(" / ")}`)
    : r.kind === "unknown" ? text("identifiant sans correspondance", "identifier without match")
    : r.reason === "legacy" ? text("disponibilité non attestée — ancien contrat", "availability not attested — legacy contract")
    : r.reason === "loading" ? text("chargement du référentiel…", "loading reference…")
    : r.reason === "error" ? text("erreur du référentiel", "reference error") : text("référentiel indisponible", "reference unavailable");
  return `${separateIndex ? "" : `${normalizeVobIndex(raw)} · `}${note}`;
}

/** Shown indices share the same normalization; key restricts use to VOB categories. */
export const vobDisplayCode = (_key: RefKey, raw: string) => normalizeVobIndex(raw);

/** Dropdown options omit source provenance (kept in the reference status details); trades sort by displayed label. */
export function vobDisplayOptions(state: VobRefState, key: RefKey, rawValues: string[], lang: string) {
  const known = vobReferenceOptions(state, key);
  const codes = known.map((entry) => entry.code);
  const extra = [...new Set(rawValues)].filter((raw) => raw !== "" && raw !== "-1" && !codes.includes(vobDisplayCode(key, raw))).sort();
  const options = [...known.map((entry) => entry.id), ...extra].map((value) => ({ value, label: displayVobReference(state, key, value, lang, false, true), index: vobDisplayCode(key, value) }));
  if (key === "trade") options.sort((a, b) => a.label.localeCompare(b.label, lang, { sensitivity: "base", numeric: true }) || a.index.localeCompare(b.index, lang, { numeric: true }));
  return [...(key === "unit" || key === "method" ? [{ value: "-1", label: key === "unit" ? vobDefaultLabel(lang) : vobUndefinedLabel(lang), index: "-1" }] : []), ...options];
}

/** VOB-only construction-trade terminology; source labels remain untouched. */
const tradeLabels: Record<string, string> = { fr: "Métier", en: "Trade", de: "Gewerk", it: "Categoria di lavori", es: "Oficio", hr: "Vrsta radova", ro: "Categorie de lucrări", ru: "Вид строительных работ", cs: "Stavební řemeslo", sl: "Vrsta gradbenih del", sk: "Stavebné remeslo" };
export const vobTradeLabel = (lang: string) => tradeLabels[lang] ?? "Trade";
