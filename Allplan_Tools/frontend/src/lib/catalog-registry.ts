import { create } from "zustand";
import { useCatalog, type CatalogInfo } from "./catalog-store";

export type Status = "ok" | "incomplete" | "missing";
export interface Cat { id: string; name: string; version: string; path: string; source: string; defAttr: number; status: Status; fav?: boolean; backup?: Cat | undefined }

export const ALLPLAN_VERSIONS = ["2022", "2023", "2024", "2025", "2026", "2027"];

export const useCatalogRegistry = create<{
  cats: Cat[];
  recentIds: string[];
  setCats: (update: Cat[] | ((cats: Cat[]) => Cat[])) => void;
}>((set) => ({
  cats: [],
  recentIds: [],
  setCats: (update) => set((state) => ({ cats: typeof update === "function" ? update(state.cats) : update })),
}));

export function matchesCatalog(entry: CatalogInfo, current: CatalogInfo): boolean {
  return entry.name === current.name && entry.path === current.path;
}

/** Updates the active settings and its registered entry, never the catalog tree/history. */
export function updateCurrentCatalog(patch: Partial<CatalogInfo>): void {
  const current = useCatalog.getState().catalog;
  useCatalogRegistry.getState().setCats((cats) => cats.map((entry) => matchesCatalog(entry, current) ? { ...entry, ...patch } : entry));
  useCatalog.getState().setCatalog({ ...current, ...patch });
}

export function selectRegisteredCatalog(id: string): boolean {
  const entry = useCatalogRegistry.getState().cats.find((cat) => cat.id === id);
  if (!entry || entry.status !== "ok") return false;
  useCatalogRegistry.setState((s) => ({ recentIds: [id, ...s.recentIds.filter((recent) => recent !== id)].slice(0, 10) }));
  useCatalog.getState().setCatalog({ name: entry.name, path: entry.path, version: entry.version, source: entry.source, defAttr: entry.defAttr });
  return true;
}
