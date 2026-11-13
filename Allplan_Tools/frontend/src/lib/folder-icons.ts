import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FolderIconEntry = { src: string; name: string; uses: number; lastUsed: number };

export function recordFolderIcon(entries: FolderIconEntry[], src: string, name: string, now = Date.now()): FolderIconEntry[] {
  const previous = entries.find((entry) => entry.src === src);
  return [...entries.filter((entry) => entry.src !== src), { src, name: previous?.name ?? name, uses: (previous?.uses ?? 0) + 1, lastUsed: now }];
}

/** Personal icon choices only; catalog changes still go through the catalog store. */
export const useFolderIcons = create(persist<{
  entries: FolderIconEntry[];
  record: (src: string, name: string) => void;
}>((set) => ({
  entries: [],
  record: (src, name) => set((state) => ({ entries: recordFolderIcon(state.entries, src, name) })),
}), { name: "smartcatalog-folder-icons", skipHydration: true }));