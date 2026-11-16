import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FallbackSort = "asc" | "desc" | "name" | "nameDesc";
export type AttrSort = FallbackSort | "custom";
export type OrderFavorite = { id: string; name: string; order: number[]; fallback: FallbackSort; folderId?: string | undefined };
export type OrderFolder = { id: string; name: string };
export function parseOrderFolders(raw: unknown): OrderFolder[] {
  if (!raw || typeof raw !== "object" || !("folders" in raw) || !Array.isArray(raw.folders)) return [];
  return raw.folders.flatMap((f: unknown) => {
    if (!f || typeof f !== "object" || !("id" in f) || !("name" in f) || typeof f.id !== "string" || typeof f.name !== "string") return [];
    return [{ id: f.id, name: f.name }];
  });
}
export const DEFAULT_ORDER = [120, 202, 209, 110, 118, 141, 231];
export const DEFAULT_FAVORITE: OrderFavorite = { id: "default", name: "Standard", order: DEFAULT_ORDER, fallback: "asc" };

/** Custom order first, then the attributes missing from it sorted by the fallback. */
export function applyCustomOrder(keys: number[], order: number[], fallback: FallbackSort, name: (n: number) => string): number[] {
  const known = order.filter((k) => keys.includes(k));
  return [...known, ...sortKeys(keys.filter((k) => !order.includes(k)), fallback, name)];
}

export function sortKeys(keys: number[], mode: FallbackSort, name: (n: number) => string): number[] {
  const k = [...keys];
  if (mode === "asc") k.sort((a, b) => a - b);
  if (mode === "desc") k.sort((a, b) => b - a);
  if (mode === "name") k.sort((a, b) => name(a).localeCompare(name(b)) || a - b);
  if (mode === "nameDesc") k.sort((a, b) => name(b).localeCompare(name(a)) || b - a);
  return k;
}

/** Writes a reordered visible list back into the custom order; absent attributes keep their slots. */
export function mergeVisibleOrder(order: number[], visible: number[]): number[] {
  const set = new Set(visible);
  let i = 0;
  const out = order.map((k) => (set.has(k) ? visible[i++]! : k));
  return [...out, ...visible.slice(i)];
}

const cleanOrder = (o: unknown[]) => [...new Set(o.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 99999 && n !== 207))];
const cleanFallback = (f: unknown): FallbackSort => (["asc", "desc", "name", "nameDesc"] as const).includes(f as FallbackSort) ? (f as FallbackSort) : "asc";

export function parseOrder(raw: unknown): { order: number[]; fallback: FallbackSort } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { order?: unknown; fallback?: unknown };
  if (!Array.isArray(r.order)) return null;
  return { order: cleanOrder(r.order), fallback: cleanFallback(r.fallback) };
}

/** Accepts a favorites file or a single legacy order file. */
export function parseOrderFavorites(raw: unknown): OrderFavorite[] | null {
  const r = raw as { favorites?: unknown };
  if (r && Array.isArray(r.favorites)) {
    const list = r.favorites.flatMap((f: any) => { const p = parseOrder(f); return p ? [{ id: typeof f.id === "string" ? f.id : crypto.randomUUID(), name: String(f.name ?? "Order"), ...(typeof f.folderId === "string" ? { folderId: f.folderId } : {}), ...p }] : []; });
    return list.length ? list : null;
  }
  const one = parseOrder(raw);
  return one ? [{ id: crypto.randomUUID(), name: "Import", ...one }] : null;
}

type State = {
  folders: OrderFolder[]; sort: AttrSort; favorites: OrderFavorite[]; active: string; order: number[]; fallback: FallbackSort;
  setSort: (s: AttrSort) => void;
  choose: (id: string) => void;
  saveAll: (favorites: OrderFavorite[], active: string, folders?: OrderFolder[]) => void;
  save: (order: number[], fallback: FallbackSort) => void;
};
const sync = (favorites: OrderFavorite[], active: string) => {
  const f = favorites.find((x) => x.id === active) ?? favorites[0] ?? DEFAULT_FAVORITE;
  return { favorites: favorites.length ? favorites : [DEFAULT_FAVORITE], active: f.id, order: f.order, fallback: f.fallback };
};

export const useAttrOrder = create(persist<State>((set, get) => ({
  folders: [], sort: "custom", favorites: [DEFAULT_FAVORITE], active: DEFAULT_FAVORITE.id, order: DEFAULT_ORDER, fallback: "asc",
  setSort: (sort) => set({ sort }),
  choose: (id) => set({ ...sync(get().favorites, id), sort: "custom" }),
  saveAll: (favorites, active, folders) => set({ ...sync(favorites.map((f) => ({ ...f, order: f.order.filter((n) => n !== 207) })), active), ...(folders ? { folders } : {}) }),
  /** Updates the active favorite (used by drag reordering in the details panel). */
  save: (order, fallback) => { const s = get(); set(sync(s.favorites.map((f) => f.id === s.active ? { ...f, order: order.filter((n) => n !== 207), fallback } : f), s.active)); },
}), {
  name: "smartcatalog-attr-order", version: 2,
  migrate: (old: any) => {
    const fav = { ...DEFAULT_FAVORITE, order: Array.isArray(old?.order) ? old.order : DEFAULT_ORDER, fallback: cleanFallback(old?.fallback) };
    return { sort: old?.sort ?? "custom", ...sync([fav], fav.id) } as State;
  },
}));
