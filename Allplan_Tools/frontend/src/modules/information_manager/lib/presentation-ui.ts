import { matchesSearch, type SearchOptions } from "./aim-interface";

/** UI names only; no native value or permission is inferred. */
export function uniquePresentationName(base: string, names: string[]): string {
  const used = new Set(names.map(name => name.trim().toLocaleLowerCase()));
  let name = base;
  for (let suffix = 2; used.has(name.toLocaleLowerCase()); suffix++) name = `${base} ${suffix}`;
  return name;
}
export function validPresentationName(name: string, siblings: string[]): boolean {
  const value = name.trim().toLocaleLowerCase();
  return !!value && !siblings.some(sibling => sibling.trim().toLocaleLowerCase() === value);
}
export function titleMatchesSearch(label: string, kind: "category" | "group", query: string, options: SearchOptions): boolean {
  return matchesSearch({ title: label, [kind]: label }, query, options);
}
export type InlinePresentationRename = { kind: "category" | "group"; id: string };