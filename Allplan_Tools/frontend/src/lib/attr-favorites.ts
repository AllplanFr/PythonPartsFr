import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FavKind = "group" | "component" | "formula";
export const FAV_KINDS: FavKind[] = ["group", "component", "formula"];
export const DEFAULT_FAVORITES: Record<FavKind, number[]> = {
  group: [120, 202, 209],
  component: [96, 120, 202, 209, 267],
  formula: [99, 220, 221, 222, 223, 229, 340, 341, 342, 343, 344],
};

/** Adds every number when at least one is missing from the list, otherwise removes them all. */
export function toggleFavorites(list: number[], nums: number[]): number[] {
  if (nums.every((n) => list.includes(n))) return list.filter((n) => !nums.includes(n));
  return [...list, ...nums.filter((n) => !list.includes(n))];
}

/** Accepts the exported shape; ignores unknown or invalid entries. */
export function parseFavorites(raw: unknown): Record<FavKind, number[]> | null {
  if (!raw || typeof raw !== "object") return null;
  const out = {} as Record<FavKind, number[]>;
  for (const k of FAV_KINDS) {
    const v = (raw as Record<string, unknown>)[k];
    out[k] = Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 99999))] : DEFAULT_FAVORITES[k];
  }
  return out;
}

export const isUserAttr = (n: number) => n >= 2000 && n <= 11999;
export const isImportAttr = (n: number) => n >= 55000 && n <= 99000;

type PickerRequest = { kind: "node" } | null;

export const useAttrFavorites = create(persist<{
  favs: Record<FavKind, number[]>;
  toggle: (kind: FavKind, nums: number[]) => void;
  setAll: (favs: Record<FavKind, number[]>) => void;
  add: (kind: FavKind, nums: number[]) => void;
  picker: PickerRequest;
  openPicker: (p: PickerRequest) => void;
}>((set) => ({
  favs: DEFAULT_FAVORITES,
  toggle: (kind, nums) => set((s) => ({ favs: { ...s.favs, [kind]: toggleFavorites(s.favs[kind], nums) } })),
  setAll: (favs) => set({ favs }),
  add: (kind, nums) => set((s) => ({ favs: { ...s.favs, [kind]: [...s.favs[kind], ...nums.filter((n) => !s.favs[kind].includes(n))] } })),
  picker: null,
  openPicker: (picker) => set({ picker }),
}), { name: "smartcatalog-attr-favorites", version: 2, migrate: () => ({ favs: DEFAULT_FAVORITES }) as never, partialize: (s) => ({ favs: s.favs }) as never }));

/** Attribute numbers being dragged out of the attribute picker (null when idle). */
export const dragNewAttrs: { current: number[] | null } = { current: null };
