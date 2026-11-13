import { create } from "zustand";
import { useVobEditor, vobHasChanges, type VobFile, type VobRule } from "./vob-editor";

export type VobProject = { name: string; path: string; version?: string };
export type VobBackup = { id: string; name: string; path: string; createdAt: string };
export type VobResourceContext = { version: string; source: string; versions?: string[] };
export const useVobResources = create<{
  context: VobResourceContext; backups: VobBackup[]; backupFile: string | null;
  backupsOpen: boolean; manager: boolean; busy: boolean; drafts: string[]; /** File picked in VOB & resources (preview/header target). */ picked: string | null; addedFiles: VobFile[]; favorites: string[]; addedProjects: VobProject[]; focusHeader: boolean;
}>(() => ({ picked: null, focusHeader: false, context: { version: "", source: "" }, backups: [], backupFile: null, backupsOpen: false, manager: false, busy: false, drafts: [], addedFiles: [], favorites: [], addedProjects: [] }));

export const vobPathKey = (path: string) => path.replace(/\\/g, "/").toLocaleLowerCase();
/** Allplan versions before 2022 are never offered, listed or classified. */
export const MIN_ALLPLAN_VERSION = 2022;
export const isSupportedAllplanVersion = (version?: string) => version === undefined || (/^\d{4}$/.test(version) && Number(version) >= MIN_ALLPLAN_VERSION);
export const supportedVobFiles = (files: VobFile[]) => files.filter((f) => isSupportedAllplanVersion(f.version));
export const isAllplanVobFile = (file: VobFile) => !!file.version && ["ETC", "STD", "PRJ"].includes((file.source ?? "").toUpperCase());
const directoryKey = (path: string) => vobPathKey(path).slice(0, vobPathKey(path).lastIndexOf("/"));
/** Only Python metadata or an already identified directory establishes Allplan membership. */
function classifyVobFile(file: VobFile, inventory: VobFile[]): VobFile {
  const known = inventory.find((f) => isAllplanVobFile(f) && vobPathKey(f.path) === vobPathKey(file.path))
    ?? inventory.find((f) => isAllplanVobFile(f) && directoryKey(f.path) === directoryKey(file.path));
  const version = file.version ?? known?.version;
  const source = file.source ?? known?.source;
  const projectName = file.projectName ?? known?.projectName;
  const projectPath = file.projectPath ?? known?.projectPath;
  return { ...file, ...(version ? { version } : {}), ...(source ? { source: source.toUpperCase() } : {}),
    ...(projectName ? { projectName } : {}), ...(projectPath ? { projectPath } : {}) };
}
export function vobFileHasChanges(path: string) {
  const state = useVobEditor.getState();
  return state.file && vobPathKey(state.file.path) === vobPathKey(path) ? vobHasChanges(state) : useVobResources.getState().drafts.some((draft) => vobPathKey(draft) === vobPathKey(path));
}
export function mergeVobFiles(files: VobFile[]) {
  files = supportedVobFiles(files);
  const added = supportedVobFiles(useVobResources.getState().addedFiles.map((f) => classifyVobFile(f, files)));
  useVobResources.setState({ addedFiles: added });
  const keys = new Set(added.map((f) => vobPathKey(f.path)));
  useVobEditor.getState().setFiles([...files.filter((f) => !keys.has(vobPathKey(f.path))), ...added]);
}
export function acceptAddedVobFiles(input: unknown): VobFile[] {
  if (!Array.isArray(input) || input.some((f) => !f || typeof f.id !== "string" || typeof f.name !== "string" || typeof f.path !== "string" || !/^(?:[a-z]:[\\/]|\/)/i.test(f.path))) throw new Error("Invalid VOB files: absolute paths required");
  const files: VobFile[] = input.map((f) => classifyVobFile({ id: f.id, name: f.name, path: f.path,
    ...(typeof f.version === "string" ? { version: f.version } : {}),
    ...(typeof f.source === "string" ? { source: f.source } : {}),
    ...(typeof f.projectName === "string" ? { projectName: f.projectName } : {}),
    ...(typeof f.projectPath === "string" ? { projectPath: f.projectPath } : {}) }, useVobEditor.getState().files));
  if (files.some((f) => !isSupportedAllplanVersion(f.version))) throw new Error("Allplan versions before 2022 are not supported");
  const unique = new Map(useVobResources.getState().addedFiles.map((f) => [vobPathKey(f.path), f]));
  files.forEach((f) => unique.set(vobPathKey(f.path), f));
  useVobResources.setState({ addedFiles: [...unique.values()] });
  mergeVobFiles(useVobEditor.getState().files);
  return files;
}
export const vobResourceSettings = () => ({ addedFiles: useVobResources.getState().addedFiles, favorites: useVobResources.getState().favorites, addedProjects: useVobResources.getState().addedProjects });
const ABS = /^(?:[a-z]:[\\/]|\/)/i;
/** Accepts a Python vob.projects.add reply; project files are merged into the inventory, never opened. */
export function acceptVobProject(input: unknown) {
  const data = input as { project?: VobProject; files?: unknown } | null;
  const project = data?.project;
  if (!project || typeof project.name !== "string" || typeof project.path !== "string" || !ABS.test(project.path)) throw new Error("Invalid VOB project: absolute path required");
  if (typeof project.version === "string" && !isSupportedAllplanVersion(project.version)) throw new Error(`Allplan ${project.version} is not supported (2022 or later required)`);
  const files = Array.isArray(data?.files) ? data.files as VobFile[] : [];
  if (!files.length || files.some((f) => !f || typeof f.id !== "string" || typeof f.name !== "string" || typeof f.path !== "string" || !ABS.test(f.path))) throw new Error("No VOB file found in this project");
  const key = vobPathKey(project.path);
  const tagged = supportedVobFiles(files.map((f) => classifyVobFile({ ...f, ...(f.version ?? project.version ? { version: f.version ?? project.version } : {}), source: f.source ?? "PRJ", projectName: f.projectName ?? project.name, projectPath: f.projectPath ?? project.path }, useVobEditor.getState().files)));
  if (!tagged.length) throw new Error("No VOB file for Allplan 2022 or later in this project");
  useVobResources.setState((s) => ({ addedProjects: [...s.addedProjects.filter((p) => vobPathKey(p.path) !== key), { name: project.name, path: project.path, ...(typeof project.version === "string" ? { version: project.version } : {}) }] }));
  const keys = new Set(tagged.map((f) => vobPathKey(f.path)));
  mergeVobFiles([...useVobEditor.getState().files.filter((f) => !keys.has(vobPathKey(f.path))), ...tagged]);
  return tagged;
}
/** Removes only the project reference and its listed files; nothing on disk is touched. */
export function removeVobProject(path: string) {
  const key = vobPathKey(path);
  useVobResources.setState((s) => ({ addedProjects: s.addedProjects.filter((p) => vobPathKey(p.path) !== key) }));
  useVobEditor.getState().setFiles(useVobEditor.getState().files.filter((f) => !f.projectPath || vobPathKey(f.projectPath) !== key));
}
/** Favorites are keyed by normalized full path so case/slash variants share one star. */
export const isVobFavorite = (path: string) => useVobResources.getState().favorites.includes(vobPathKey(path));
export function toggleVobFavorite(path: string) {
  const key = vobPathKey(path); const favs = useVobResources.getState().favorites;
  useVobResources.setState({ favorites: favs.includes(key) ? favs.filter((f) => f !== key) : [...favs, key] });
}
/** Removes a user-added file from the list only; the file on disk is never touched. */
export function removeAddedVobFile(path: string) {
  const key = vobPathKey(path);
  useVobResources.setState((s) => ({ addedFiles: s.addedFiles.filter((f) => vobPathKey(f.path) !== key) }));
  useVobEditor.getState().setFiles(useVobEditor.getState().files.filter((f) => vobPathKey(f.path) !== key));
}
export function applyVobResourceSettings(input: unknown) {
  if (!input || typeof input !== "object") return;
  const favs = (input as { favorites?: unknown }).favorites;
  if (Array.isArray(favs)) useVobResources.setState({ favorites: favs.filter((f): f is string => typeof f === "string").map(vobPathKey) });
  const projects = (input as { addedProjects?: unknown }).addedProjects;
  if (Array.isArray(projects)) useVobResources.setState({ addedProjects: projects.filter((p): p is VobProject => !!p && typeof p.name === "string" && typeof p.path === "string" && ABS.test(p.path) && (typeof p.version !== "string" || isSupportedAllplanVersion(p.version))) });
  const files = (input as { addedFiles?: unknown }).addedFiles;
  if (!Array.isArray(files)) return;
  // Validate before replacing the current settings.
  const previous = useVobResources.getState().addedFiles;
  try { useVobResources.setState({ addedFiles: [] }); acceptAddedVobFiles(files.filter((f) => !f || typeof f.version !== "string" || isSupportedAllplanVersion(f.version))); }
  catch { useVobResources.setState({ addedFiles: previous }); }
}

type Session = Pick<ReturnType<typeof useVobEditor.getState>, "rules" | "saved" | "header" | "savedHeader" | "selected" | "selectedIds" | "past" | "future" | "file">;
const sessions = new Map<string, Session>();
export function rememberVobSession() {
  const s = useVobEditor.getState(); if (!s.file?.path) return;
  sessions.set(s.file.path, { rules: s.rules, saved: s.saved, header: s.header, savedHeader: s.savedHeader, selected: s.selected, selectedIds: s.selectedIds, past: s.past, future: s.future, file: s.file });
  useVobResources.setState({ drafts: [...sessions].filter(([, v]) => vobHasChanges(v)).map(([path]) => path) });
}
export function resumeVobSession(path: string) {
  const session = sessions.get(path); if (!session) return false;
  useVobEditor.setState(session); return true;
}
export const peekVobSession = (path: string) => sessions.get(path)?.rules ?? null;
const syncDrafts = () => useVobResources.setState({ drafts: [...sessions].filter(([, v]) => vobHasChanges(v)).map(([path]) => path) });
const sessionHeaderAt = new Map<string, number>();
/** Edits the header of a non-opened file in its in-memory session (undoable per file); written when that file is saved. */
export function setVobSessionHeader(file: VobFile, rules: VobRule[], original: string[], header: string[], typing = true) {
  const old = sessions.get(file.path) ?? { rules, saved: rules, header: original, savedHeader: original, selected: null, selectedIds: [], past: [], future: [], file };
  if (JSON.stringify(old.header) === JSON.stringify(header)) return;
  const now = Date.now(), last = sessionHeaderAt.get(file.path) ?? 0, merge = typing && last && now - last < 1000 && old.past.length;
  sessions.set(file.path, { ...old, header, future: [], past: merge ? old.past : [...old.past, { rules: old.rules, selected: old.selected, selectedIds: old.selectedIds, header: old.header }].slice(-100) });
  sessionHeaderAt.set(file.path, typing ? now : 0); syncDrafts();
}
/** Undo/redo inside a non-opened file's session; returns the resulting header or null. */
export function stepVobSession(path: string, direction: "undo" | "redo") {
  const s = sessions.get(path); if (!s) return null; sessionHeaderAt.set(path, 0);
  const cur = { rules: s.rules, selected: s.selected, selectedIds: s.selectedIds, header: s.header };
  const target = direction === "undo" ? s.past.at(-1) : s.future[0]; if (!target) return null;
  sessions.set(path, { ...s, ...target, header: target.header ?? s.header, past: direction === "undo" ? s.past.slice(0, -1) : [...s.past, cur], future: direction === "undo" ? [cur, ...s.future] : s.future.slice(1) });
  syncDrafts(); return sessions.get(path)!.header;
}
export const peekVobSessionState = (path: string) => sessions.get(path) ?? null;
/** Marks the exact snapshot sent to Python as saved for a non-opened session. */
export function markVobSessionSaved(path: string, file: VobFile, rules: VobRule[], header: string[]) {
  const s = sessions.get(path); if (!s) return;
  sessions.delete(path);
  sessions.set(file.path, { ...s, saved: rules, savedHeader: header, file }); syncDrafts();
}
/** Every file with unsaved changes: the opened document first, then in-memory sessions. */
export function vobDirtyPaths() {
  const s = useVobEditor.getState(); const out: string[] = [];
  if (s.file && vobHasChanges(s)) out.push(s.file.path);
  for (const [path, v] of sessions) if (vobHasChanges(v) && !out.some((p) => vobPathKey(p) === vobPathKey(path)) && !(s.file && vobPathKey(s.file.path) === vobPathKey(path))) out.push(path);
  return out;
}
export const peekVobHeader = (path: string) => sessions.get(path)?.header ?? null;
export function clearVobSessions() { sessions.clear(); useVobResources.setState({ drafts: [] }); }