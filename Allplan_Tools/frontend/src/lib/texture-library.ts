import { create } from "zustand";
import { shortImagePath } from "./fill-attributes";

export type TextureEntry = { path: string; surf: boolean; uses: number; lastUsed: number };
// Session media are not catalog data or authoritative PythonPart settings.
export const textureFiles = new Map<string, File>();
export function recordTexture(entries: TextureEntry[], path: string, surf: boolean, now = Date.now()): TextureEntry[] {
  const previous = entries.find((e) => e.path === path && e.surf === surf);
  return [...entries.filter((e) => e.path !== path || e.surf !== surf), { path, surf, uses: (previous?.uses ?? 0) + 1, lastUsed: now }];
}
export function textureChoices(entries: TextureEntry[], surf: boolean, frequent = false) {
  return entries.filter((e) => e.surf === surf).sort((a, b) => frequent ? b.uses - a.uses || b.lastUsed - a.lastUsed : b.lastUsed - a.lastUsed).slice(0, 10);
}
export function designRelativeFilePath(path: string): string | null {
  const normalized = path.replace(/\//g, "\\");
  if (!/(?:^|\\)design\\/i.test(normalized)) return null;
  return shortImagePath(normalized.replace(/^design\\/i, ""));
}
export const useTextureLibrary = create<{ entries: TextureEntry[]; record: (path: string, surf: boolean) => void }>((set) => ({
  entries: [], record: (path, surf) => set((s) => ({ entries: recordTexture(s.entries, path, surf) })),
}));