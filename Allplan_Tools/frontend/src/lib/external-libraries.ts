import { create } from "zustand";
import { parseExternalCatalog, type ExternalCatalog } from "./external-catalog";
import type { CatalogNode } from "./catalog-store";

export interface ExternalLibrary {
  id: string; name: string; location: string; version: string; dataSource: string; defAttr: number;
  parentId?: string | null; kind?: "file" | "url"; icon?: string | undefined; favorite: boolean; demo?: boolean; data: ExternalCatalog;
}

export interface LibraryFolder { id: string; name: string; icon?: string | undefined; parentId: string | null }

interface State {
  folders: LibraryFolder[];
  addFolder: (parentId: string | null) => string;
  updateFolder: (id: string, patch: Partial<Pick<LibraryFolder, "name" | "icon">>) => void;
  removeFolder: (id: string) => void;
  open: boolean; sources: ExternalLibrary[]; active: string;
  setOpen: (open: boolean) => void;
  receive: (source: Omit<ExternalLibrary, "id" | "favorite">) => string;
  update: (id: string, patch: Partial<Pick<ExternalLibrary, "name" | "location" | "version" | "dataSource" | "defAttr" | "icon" | "favorite" | "parentId" | "kind">>) => void;
  remove: (id: string) => void;
  move: (id: string, direction: -1 | 1) => void;
}

/** Session sources: decoded data stays isolated from editable catalogue history. */
export const useExternalLibraries = create<State>((set) => ({
  folders: [],
  addFolder: (parentId) => { const id = crypto.randomUUID(); set((s) => ({ folders: [...s.folders, { id, name: "New folder", parentId }] })); return id; },
  updateFolder: (id, patch) => set((s) => ({ folders: s.folders.map((f) => f.id === id ? { ...f, ...patch } : f) })),
  removeFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id).map((f) => f.parentId === id ? { ...f, parentId: null } : f), sources: s.sources.map((f) => f.parentId === id ? { ...f, parentId: null } : f) })),
  open: false, active: "",
  sources: [],
  setOpen: (open) => set({ open }),
  receive: (source) => { const id = crypto.randomUUID(); set((s) => ({ sources: [...s.sources, { ...source, id, favorite: false }], active: id })); return id; },
  update: (id, patch) => set((s) => ({ sources: s.sources.map((source) => source.id === id ? { ...source, ...patch } : source) })),
  remove: (id) => set((s) => ({ sources: s.sources.filter((source) => source.id !== id), active: s.active === id ? s.sources.find((source) => source.id !== id)?.id ?? "" : s.active })),
  move: (id, direction) => set((s) => { const sources = [...s.sources]; const from = sources.findIndex((source) => source.id === id); const to = from + direction; const source = sources[from]; if (!source || to < 0 || to >= sources.length) return {}; sources.splice(from, 1); sources.splice(to, 0, source); return { sources }; }),
}));

export const dragExternal: { current: { data: ExternalCatalog; ids: string[] } | null } = { current: null };
export const dragExternalAttrs: { current: { data: ExternalCatalog; nodeIds: string[]; keys: number[] } | null } = { current: null };

/** Portable source list; validate the complete file before replacing session settings. */
export function parseLibraryList(input: unknown): { sources: ExternalLibrary[]; folders: LibraryFolder[] } | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value["sources"]) || !Array.isArray(value["folders"])) return null;
  const ids = new Set<string>();
  const folders: LibraryFolder[] = [];
  for (const raw of value["folders"]) {
    if (!raw || typeof raw.id !== "string" || ids.has(raw.id) || typeof raw.name !== "string" || !raw.name.trim() || (raw.parentId !== null && typeof raw.parentId !== "string")) return null;
    ids.add(raw.id); folders.push({ id: raw.id, name: raw.name, parentId: raw.parentId, icon: typeof raw.icon === "string" ? raw.icon : undefined });
  }
  for (const folder of folders) { const seen = new Set([folder.id]); let parent = folder.parentId; while (parent) { if (seen.has(parent)) return null; seen.add(parent); const f = folders.find((f) => f.id === parent); if (!f) return null; parent = f.parentId; } }
  const sources: ExternalLibrary[] = [];
  for (const raw of value["sources"]) {
    if (!raw || typeof raw.id !== "string" || ids.has(raw.id) || typeof raw.name !== "string" || !raw.name.trim() || typeof raw.location !== "string" || typeof raw.version !== "string" || typeof raw.dataSource !== "string" || !Number.isInteger(raw.defAttr) || raw.defAttr < 0 || raw.defAttr > 99999 || (raw.parentId && !folders.some((f) => f.id === raw.parentId))) return null;
    const data = parseExternalCatalog(raw.data); if (!data) return null;
    if (raw.kind === "url") { try { const url = new URL(raw.location); if (!["http:", "https:"].includes(url.protocol)) return null; } catch { return null; } }
    ids.add(raw.id); sources.push({ id: raw.id, name: raw.name, location: raw.location, version: raw.version, dataSource: raw.dataSource, defAttr: raw.defAttr, parentId: raw.parentId ?? null, kind: raw.kind === "url" ? "url" : "file", favorite: !!raw.favorite, icon: typeof raw.icon === "string" ? raw.icon : undefined, data });
  }
  return { sources, folders };
}
