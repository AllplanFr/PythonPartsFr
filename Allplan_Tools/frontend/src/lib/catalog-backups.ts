import { create } from "zustand";
import { useCatalog, type CatalogInfo } from "./catalog-store";
import { parseExternalCatalog, type ExternalCatalog } from "./external-catalog";

export interface CatalogBackup {
  id: string;
  name: string;
  createdAt: string;
  catalog: CatalogInfo;
  content: ExternalCatalog;
}

/** Session preparation only. PythonPart will supply and persist the backup inventory. */
export const useCatalogBackups = create<{
  backups: CatalogBackup[];
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({ backups: [], open: false, setOpen: (open) => set({ open }) }));

export function createCatalogBackup(name?: string): CatalogBackup {
  const state = useCatalog.getState();
  const backup: CatalogBackup = {
    id: crypto.randomUUID(), name: name?.trim() || state.catalog.name,
    createdAt: new Date().toISOString(), catalog: { ...state.catalog },
    content: structuredClone({ nodes: state.nodes, rootIds: state.rootIds }),
  };
  useCatalogBackups.setState((s) => ({ backups: [backup, ...s.backups] }));
  return backup;
}

/** Confirmation must be supplied by the caller; no destructive mutation without it. */
export function restoreCatalogBackup(id: string, confirmed: boolean): boolean {
  if (!confirmed) return false;
  const backup = useCatalogBackups.getState().backups.find((b) => b.id === id);
  if (!backup) return false;
  createCatalogBackup();
  const state = useCatalog.getState();
  state.load(structuredClone(backup.content));
  state.setCatalog({ ...backup.catalog });
  useCatalog.setState({ dirty: true, view: "editor", search: "", anchor: null, clipboard: null, attrClip: null, renaming: null });
  return true;
}

export function removeCatalogBackup(id: string, confirmed: boolean): boolean {
  if (!confirmed || !useCatalogBackups.getState().backups.some((b) => b.id === id)) return false;
  useCatalogBackups.setState((s) => ({ backups: s.backups.filter((b) => b.id !== id) }));
  return true;
}

export function importCatalogBackup(input: unknown): CatalogBackup | null {
  if (!input || typeof input !== "object") return null;
  const data = input as Record<string, unknown>;
  const content = parseExternalCatalog(data["content"] ?? data, Number.MAX_SAFE_INTEGER);
  if (!content) return null;
  const current = useCatalog.getState().catalog;
  const raw = data["catalog"];
  let catalog = { ...current };
  if (raw && typeof raw === "object") {
    const c = raw as Record<string, unknown>;
    if (!["name", "path", "version", "source"].every((k) => typeof c[k] === "string") || !Number.isInteger(c["defAttr"])) return null;
    catalog = { name: String(c["name"]), path: String(c["path"]), version: String(c["version"]), source: String(c["source"]), defAttr: Number(c["defAttr"]) };
  }
  const backup: CatalogBackup = { id: crypto.randomUUID(), name: typeof data["name"] === "string" ? data["name"] : catalog.name, createdAt: typeof data["createdAt"] === "string" && Number.isFinite(Date.parse(data["createdAt"])) ? data["createdAt"] : new Date().toISOString(), catalog, content };
  useCatalogBackups.setState((s) => ({ backups: [backup, ...s.backups] }));
  return backup;
}
/** Automatic backups are written by the PythonPart; the UI only lists them and asks for a restore. */
export function backupFileName(b: CatalogBackup): string {
  return (b as CatalogBackup & { fileName?: string }).fileName ?? `${b.name.replace(/[<>:"/\\|?*]/g, "_")}-${b.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.bak`;
}

type Bridge = { postMessage: (msg: unknown) => void };
/** Sends a restore signal to the PythonPart, which applies it and sends back the new catalog data. */
export function requestBackupRestore(backup: CatalogBackup): boolean {
  const bridge = (globalThis as { chrome?: { webview?: Bridge } }).chrome?.webview;
  if (!bridge) return false;
  bridge.postMessage({ type: "backup.restore", id: backup.id, fileName: backupFileName(backup), createdAt: backup.createdAt });
  return true;
}
