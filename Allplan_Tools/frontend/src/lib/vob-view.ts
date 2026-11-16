import { ATTRIBUTE_BY_NUMBER, makeTester, validateFormula } from "./catalog-store";
import type { VobRule } from "./vob-editor";

export type VobColumn = keyof Omit<VobRule, "id" | "enabled">;
export const VOB_COLUMNS: VobColumn[] = ["trade", "object", "unit", "method", "formula", "comment"];
export const DEFAULT_VOB_GROUP: VobColumn = "trade";
export const VOB_UNITS = (ATTRIBUTE_BY_NUMBER.get(120)?.options ?? []).map((label, index) => ({ value: String(index), label, index: String(index) }));
export type VobValueFilters = Partial<Record<VobColumn, string[]>> & { enabled?: ("active" | "inactive")[] };
export function filterVobValues(rules: VobRule[], filters: VobValueFilters) {
  return rules.filter((rule) => (!filters.enabled?.length || filters.enabled.includes(rule.enabled === false ? "inactive" : "active")) && VOB_COLUMNS.every((column) => !filters[column]?.length || filters[column]?.includes(rule[column])));
}
export const VOB_METHODS = [
  { value: "-1", fr: "<undefined>", en: "<undefined>" },
  { value: "01", fr: "Volume", en: "Volume" },
  { value: "02", fr: "Surface", en: "Surface" },
  { value: "03", fr: "Sol", en: "Floor" },
  { value: "04", fr: "Plafond", en: "Ceiling" },
  { value: "05", fr: "Surface latérale", en: "Lateral surface" },
  { value: "06", fr: "Surface médiane", en: "Median surface" },
  { value: "13", fr: "?", en: "?" },
];
export type VobSearchOptions = { columns: VobColumn[]; mode: "contains" | "starts" | "equals" | "regex"; matchCase: boolean; errorsOnly: boolean };
/** Keep negative operands intact: '<-2.5' is less than negative 2.5, not an arrow. */
export function formatVobFormula(value: string) {
  return value.replace(/<-(?=\d|\.)/g, "< −").replace(/<-(?!\d|\.)/g, "<").replace(/->/g, ">");
}
export const defaultVobSearch = (): VobSearchOptions => ({ columns: [...VOB_COLUMNS], mode: "contains", matchCase: false, errorsOnly: false });
export function filterVobRules(rules: VobRule[], query: string, options: VobSearchOptions, display: (r: VobRule, key: VobColumn) => string) {
  const test = makeTester(query.trim(), { ...options, scope: "all", types: [], attrNum: 0 });
  return rules.filter((r) => (!options.errorsOnly || !!validateFormula(r.formula)) && (!query.trim() || options.columns.some((key) => test(display(r, key)) || test(r[key]))));
}
export function groupVobRules(rules: VobRule[], column: VobColumn, display?: (r: VobRule, key: VobColumn) => string) {
  const groups = new Map<string, VobRule[]>();
  for (const rule of rules) { const key = rule[column]; const group = groups.get(key); if (group) group.push(rule); else groups.set(key, [rule]); }
  const result = [...groups].map(([value, rules]) => ({ value, rules }));
  if (column === "trade" && display) {
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    result.sort((a, b) => collator.compare(a.rules[0] ? display(a.rules[0], column) : a.value, b.rules[0] ? display(b.rules[0], column) : b.value));
  }
  return result;
}/** Fit natural widths into the available space; the last column (highest index) is trimmed first, index 0 is never trimmed. */
export function fitVobColumns(natural: number[], available: number, min = 50, fixed: boolean[] = []) {
  const widths = [...natural]; let excess = widths.reduce((a, b) => a + b, 0) - available;
  for (let i = widths.length - 1; i >= 1 && excess > 0; i--) { if (fixed[i]) continue; const cut = Math.min(excess, Math.max(0, (widths[i] ?? 0) - min)); widths[i] = (widths[i] ?? 0) - cut; excess -= cut; }
  return widths;
}
