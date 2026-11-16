import { create } from "zustand";
import { moveSelectionInOrder } from "./selection-order";
import { useCatalog, validateFormula, type CatalogNode } from "./catalog-store";

export const FORMULA_ATTRIBUTES = [267, 96, 76, 180] as const;
export type FormulaAttribute = typeof FORMULA_ATTRIBUTES[number];
export const isFormulaAttribute = (num: number): num is FormulaAttribute => FORMULA_ATTRIBUTES.some((n) => n === num);
export interface FormulaFavorite { id: string; name: string; description: string; formula: string; attribute: FormulaAttribute; folder?: string | undefined; icon?: string | undefined }
export interface FormulaFolder { id: string; name: string; icon?: string | undefined }
export interface FormulaChoice { attribute: FormulaAttribute; priority: 0 | 1 | 2 }
export function formulaChoices(node: CatalogNode | undefined, preferred: FormulaAttribute, reserved: number): FormulaChoice[] {
  if (!node || (node.type !== "group" && node.type !== "component")) return [];
  const choices: FormulaChoice[] = [];
  if (preferred !== reserved && node.attrs[preferred] !== undefined) choices.push({ attribute: preferred, priority: 0 });
  for (const attribute of FORMULA_ATTRIBUTES) {
    if (attribute !== preferred && attribute !== reserved && node.attrs[attribute] !== undefined) choices.push({ attribute, priority: 1 });
  }
  if (preferred !== reserved && node.attrs[preferred] === undefined) choices.push({ attribute: preferred, priority: 2 });
  return choices;
}
export const dragFormula: { current: FormulaFavorite | null } = { current: null };
const KEY = "smartcatalog-formula-settings";
export function parseFormulaFavorites(raw: unknown): FormulaFavorite[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const f = item as Record<string, unknown>;
    if (typeof f['id'] !== "string" || !f['id'] || ids.has(f['id']) || typeof f['name'] !== "string" || !f['name'].trim() || typeof f['description'] !== "string" || typeof f['formula'] !== "string" || typeof f['attribute'] !== "number" || !isFormulaAttribute(f['attribute']) || (f['icon'] !== undefined && typeof f['icon'] !== "string") || (f['folder'] !== undefined && typeof f['folder'] !== "string")) return null;
    ids.add(f['id']);
  }
  return raw as FormulaFavorite[];
}
interface FormulaSettings {
  favorites: FormulaFavorite[]; folders: FormulaFolder[]; open: boolean; selected: string | null;
  pending: { favorite: FormulaFavorite; nodeId: string; attribute?: FormulaAttribute | undefined } | null;
  hydrate: () => void; saveSettings: () => boolean; setOpen: (open: boolean) => void;
  create: (name: string, formula?: string, attribute?: FormulaAttribute) => string;
  update: (id: string, patch: Partial<Omit<FormulaFavorite, "id">>) => void;
  remove: (ids: string[]) => void; move: (ids: string[], dir: -1 | 1, edge?: boolean) => void;
  reorder: (ids: string[], before: string) => void;
  request: (favorite: FormulaFavorite, nodeId: string, attribute?: FormulaAttribute) => void;
}
export const useFormulaFavorites = create<FormulaSettings>((set, get) => ({
  favorites: [], folders: [], open: false, selected: null, pending: null,
  hydrate: () => { try { const raw = localStorage.getItem(KEY); if (raw) { const settings = parseFormulaSettings(JSON.parse(raw)); if (settings) set(settings); } } catch { /* Personal settings may be unavailable. */ } },
  saveSettings: () => { try { localStorage.setItem(KEY, JSON.stringify({ favorites: get().favorites, folders: get().folders })); return true; } catch { return false; } },
  setOpen: (open) => set({ open }),
  create: (name, formula = "", attribute = 267) => { const id = crypto.randomUUID(); set((s) => ({ favorites: [...s.favorites, { id, name, description: "", formula, attribute }], selected: id })); return id; },
  update: (id, patch) => { if (patch.attribute !== undefined && !isFormulaAttribute(patch.attribute)) return; set((s) => ({ favorites: s.favorites.map((f) => f.id === id ? { ...f, ...patch } : f) })); },
  remove: (ids) => set((s) => ({ favorites: s.favorites.filter((f) => !ids.includes(f.id)), selected: ids.includes(s.selected ?? "") ? null : s.selected })),
  move: (ids, dir, edge = false) => set((s) => {
    const parents = new Set(s.favorites.map((f) => f.folder));
    const partitions = new Map([...parents].map((folder) => [folder, moveSelectionInOrder(s.favorites.filter((f) => f.folder === folder), (f) => ids.includes(f.id), dir, edge)]));
    const positions = new Map<string | undefined, number>();
    return { favorites: s.favorites.map((f) => { const index = positions.get(f.folder) ?? 0; positions.set(f.folder, index + 1); return partitions.get(f.folder)?.[index] ?? f; }) };
  }),
  reorder: (ids, before) => set((s) => { if (ids.includes(before)) return s; const moving = s.favorites.filter((f) => ids.includes(f.id)), rest = s.favorites.filter((f) => !ids.includes(f.id)); const index = rest.findIndex((f) => f.id === before); rest.splice(index < 0 ? rest.length : index, 0, ...moving); return { favorites: rest }; }),
  request: (favorite, nodeId, attribute) => {
    const catalog = useCatalog.getState();
    const choices = formulaChoices(catalog.nodes[nodeId], favorite.attribute, catalog.catalog.defAttr);
    // A known attribute row is an explicit target; otherwise bypass only unambiguous choices.
    const target = attribute ?? (choices.length === 1 ? choices[0]?.attribute : undefined);
    if (target !== undefined && favorite.formula.trim() && !validateFormula(favorite.formula) && catalog.applyFormulaFavorite(nodeId, favorite.formula, [target])) {
      catalog.select(nodeId); set({ pending: null }); return;
    }
    set({ pending: { favorite: { ...favorite }, nodeId, attribute } });
  },
}));
export function parseFormulaSettings(raw: unknown): { favorites: FormulaFavorite[]; folders: FormulaFolder[] } | null {
  if (Array.isArray(raw)) { const favorites = parseFormulaFavorites(raw); return favorites ? { favorites, folders: [] } : null; }
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>; const favorites = parseFormulaFavorites(data['favorites']);
  const folders = data['folders'];
  if (!favorites || !Array.isArray(folders) || !folders.every((f) => f && typeof f.id === "string" && typeof f.name === "string" && f.name.trim() && (f.icon === undefined || typeof f.icon === "string")) || new Set(folders.map((f) => f.id)).size !== folders.length || favorites.some((f) => f.folder && !folders.some((d) => d.id === f.folder))) return null;
  return { favorites, folders };
}