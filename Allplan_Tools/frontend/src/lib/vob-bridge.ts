import { create } from "zustand";
import { connectHost, onHostEvent, request as hostRequest, HostError, isCommandUnavailable, onUnavailableChange } from "./host-bridge";
import { useVobEditor, stripVobComment, type VobFile, type VobRule } from "./vob-editor";
import { showMessage, askChoice, askConfirmation } from "./app-dialog";
import { useCatalog } from "./catalog-store";
import { vobHasChanges } from "./vob-editor";
import { parseVobReferences, type VobRefState } from "./vob-references";
import { runVobWrite } from "./vob-write";
import { useVobResources, rememberVobSession, peekVobSessionState, markVobSessionSaved, vobPathKey, resumeVobSession, mergeVobFiles, acceptAddedVobFiles, acceptVobProject, isSupportedAllplanVersion, MIN_ALLPLAN_VERSION, type VobBackup, type VobResourceContext } from "./vob-resources";
/** Keeps only Allplan 2022+ in host context; an unsupported current version falls back to the newest supported one, or "" (unknown) — never an invented version. */
export function supportedVobContext(context: VobResourceContext): VobResourceContext {
  const versions = context.versions?.filter((v) => isSupportedAllplanVersion(v));
  const version = isSupportedAllplanVersion(context.version) ? context.version : [...(versions ?? [])].sort().at(-1) ?? "";
  return { ...context, version, ...(versions ? { versions } : {}) };
}
const supportedFile = (file?: VobFile | null) => !file || isSupportedAllplanVersion(file.version);
async function request<T = unknown>(command: string, payload: unknown = {}, timeout?: number): Promise<T> {
  const data = payload as { file?: VobFile; path?: string };
  const file = data.file ?? (data.path ? [useVobEditor.getState().file, ...useVobEditor.getState().files].find((f) => f?.path === data.path) : null);
  if (!supportedFile(file)) throw new HostError("unsupported-version", "Allplan 2022 or later is required");
  const result = await hostRequest<T>(command, payload, timeout);
  if (result && typeof result === "object" && "file" in result && !supportedFile((result as { file?: VobFile }).file)) throw new HostError("unsupported-version", "Allplan 2022 or later is required");
  return result;
}

/** Data exchanged with Python for the VOB editor (format v1). Values are raw file strings; "-1" = undefined. */
/** header: comment lines without "//"; rule.enabled false = Python wrote/reads the line prefixed with "//". */
export type VobDocument = { file?: VobFile | null; rules: Omit<VobRule, "id">[]; header?: string[] };
export type VobInitialData = { files?: VobFile[]; document?: VobDocument | null; settings?: { lang?: string; dark?: boolean }; context?: VobResourceContext; backups?: { filePath: string; files: VobBackup[] }; allplan?: { version?: unknown }; recentFiles?: unknown };

/** Native file dialogs (open without path, save as) wait for the user: no timeout. */
const toRules = (rules: Omit<VobRule, "id">[]): VobRule[] => rules.map((r, i) => ({
  id: `vob-${i}-${crypto.randomUUID()}`, trade: String(r.trade ?? "-1"), object: String(r.object ?? "-1"), unit: String(r.unit ?? "-1"),
  method: String(r.method ?? "-1"), formula: String(r.formula ?? ""), comment: String(r.comment ?? ""), enabled: r.enabled !== false,
}));
const toHeader = (lines: unknown) => Array.isArray(lines) ? lines.map((l) => stripVobComment(String(l ?? ""))) : [];
export const toVobPayload = (rules: VobRule[]): Omit<VobRule, "id">[] => rules.map(({ id: _id, ...rest }) => ({ ...rest, enabled: rest.enabled !== false }));

export function applyVobDocument(doc: VobDocument | null | undefined) {
  if (!doc || !supportedFile(doc.file)) return;
  useVobEditor.getState().load(toRules(doc.rules ?? []), doc.file ?? null, toHeader(doc.header));
}

/** Host state for the UI: unavailable commands and reference.load state (no static fallback). */
export const useVobHost = create<{ unavailable: Record<string, boolean>; references: VobRefState; dataVersion: string | null; recentFiles: string[] }>(() => ({ unavailable: {}, references: { kind: "none" } as VobRefState, dataVersion: null, recentFiles: [] }));
/** Python-owned history (max 10, newest first) mirrored as received; never persisted or reordered by the view. */
const toRecent = (raw: unknown) => Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && p !== "").slice(0, 10) : [];
const VOB_COMMANDS = ["vob.open", "vob.save", "vob.save_as", "reference.load", "vob.files.add", "vob.projects.add", "vob.file.reveal", "vob.file.open_external", "vob.preview", "vob.header.default"];
const syncUnavailable = () => useVobHost.setState({ unavailable: Object.fromEntries(VOB_COMMANDS.map((c) => [c, isCommandUnavailable(c)])) });

/** Shows host messages as-is; absence of Python never simulates a successful file operation. */
const report = (error: unknown) => {
  if (error instanceof HostError && error.code === "no-host") {
    showMessage(useCatalog.getState().lang === "fr" ? "Ouvrir et enregistrer un fichier VOB nécessite de lancer l’éditeur depuis l’application Python WebView. Aucun fichier n’a été ouvert ou enregistré dans cet aperçu." : "Opening and saving a VOB file requires launching the editor from the Python WebView application. No file has been opened or saved in this preview.");
    return false;
  }
  showMessage(error instanceof Error ? error.message : String(error), "info"); return false;
};

export async function vobOpen(path?: string) {
  if (isCommandUnavailable("vob.open")) return true;
  try { applyVobDocument(await request<VobDocument | null>("vob.open", { path: path ?? null }, path ? undefined : 0)); return true; } catch (e) { return report(e); }
}
/** Never marks the document saved without an ok:true reply. */
type WriteAttempt = { isCurrent?: (() => boolean) | undefined; onConfirmation?: (() => void) | undefined };
type WriteReply = { file: VobFile; header?: string[] };
let writeGeneration = 0;
export async function vobSave(saveAs = false, attempt: WriteAttempt = {}) {
  const s = useVobEditor.getState();
  const generation = writeGeneration;
  const isCurrent = () => generation === writeGeneration && (attempt.isCurrent?.() ?? true) && useVobEditor.getState().file?.path === s.file?.path;
  const command = saveAs || !s.file ? "vob.save_as" : "vob.save";
  if (isCommandUnavailable(command)) return false;
  try {
    const written = await runVobWrite<ReturnType<typeof useVobEditor.getState>, WriteReply>({ operation: command, capture: () => isCurrent() ? useVobEditor.getState() : null,
      payload: (snapshot) => ({ file: snapshot.file, rules: toVobPayload(snapshot.rules), header: snapshot.header } satisfies VobDocument),
      call: (c, p, timeout) => request<{ file: VobFile; header?: string[] } | null>(c, p, timeout), isCurrent, onConfirmation: attempt.onConfirmation });
    if (!written) return false;
    const { result, snapshot } = written;
    if (!result?.file || typeof result.file.path !== "string" || typeof result.file.name !== "string" || typeof result.file.id !== "string") throw new HostError("bad-reply", `Invalid reply for ${command}: expected { file: { id, name, path } }`);
    // Only the exact snapshot sent to Python was saved; edits made while awaiting it remain dirty.
    if (s.file) markVobSessionSaved(s.file.path, result.file, snapshot.rules, snapshot.header);
    useVobEditor.setState({ saved: snapshot.rules, savedHeader: snapshot.header, file: result.file });
    rememberVobSession();
    return true;
  } catch (e) {
    // A write timeout proves neither success nor absence of writing: keep the document dirty, never retry automatically.
    if (e instanceof HostError && e.code === "timeout") {
      showMessage(useCatalog.getState().lang === "fr" ? "Résultat de l’enregistrement incertain : Python n’a pas répondu à temps. Le fichier a pu être écrit. Vos modifications restent marquées non enregistrées ; vérifiez le fichier avant de réessayer." : "Save result uncertain: Python did not answer in time. The file may have been written. Your changes stay marked unsaved; check the file before trying again.", "info");
      return false;
    }
    return report(e);
  }
}

/** Saves one file: the opened document, or a non-opened in-memory session (e.g. header edited in VOB & resources). */
export async function vobSaveFile(path: string, saveAs = false, attempt: WriteAttempt = {}) {
  const active = useVobEditor.getState().file;
  if (active && vobPathKey(active.path) === vobPathKey(path)) return vobSave(saveAs, attempt);
  const generation = writeGeneration;
  const isCurrent = () => generation === writeGeneration && (attempt.isCurrent?.() ?? true) && !!peekVobSessionState(path);
  const command = saveAs ? "vob.save_as" : "vob.save";
  const session = peekVobSessionState(path); if (!session?.file || isCommandUnavailable(command)) return false;
  try {
    const written = await runVobWrite<typeof session, WriteReply>({ operation: command, capture: () => peekVobSessionState(path),
      payload: (snapshot) => ({ file: snapshot.file, rules: toVobPayload(snapshot.rules), header: snapshot.header } satisfies VobDocument),
      call: (c, p, timeout) => request<{ file: VobFile; header?: string[] } | null>(c, p, timeout), isCurrent, onConfirmation: attempt.onConfirmation });
    if (!written) return false;
    const { result, snapshot } = written;
    if (!result?.file || typeof result.file.path !== "string" || typeof result.file.name !== "string" || typeof result.file.id !== "string") throw new HostError("bad-reply", "Invalid reply for vob.save: expected { file: { id, name, path } }");
    // Baseline = the snapshot captured before await; later edits of that session stay dirty.
    markVobSessionSaved(path, result.file, snapshot.rules, snapshot.header); return true;
  } catch (e) {
    // Inactive session timeout: uncertain outcome for that file only; active document untouched, no automatic retry.
    if (e instanceof HostError && e.code === "timeout") {
      const name = session.file.name || path;
      showMessage(useCatalog.getState().lang === "fr" ? `Résultat de l’enregistrement incertain pour « ${name} » (${path}) : Python n’a pas répondu à temps. Ce fichier a pu être écrit ; il reste marqué non enregistré. Le document ouvert n’a pas été modifié. Vérifiez ce fichier avant de réessayer.` : `Save result uncertain for "${name}" (${path}): Python did not answer in time. This file may have been written; it stays marked unsaved. The open document was not changed. Check this file before trying again.`, "info");
      return false;
    }
    return report(e);
  }
}
/** Saves the given files one after another; stops at the first failure. */
export async function vobSaveFiles(paths: string[], closeAttempt?: () => boolean) {
  for (const path of paths) {
    if (closeAttempt && !closeAttempt()) return false;
    let confirmedFlow = false;
    const attempt = { isCurrent: closeAttempt, onConfirmation: () => { confirmedFlow = true; } };
    if (await vobSaveFile(path, false, attempt)) continue;
    if (confirmedFlow) return false; // ETC cancellation/failure is final: no second recovery dialog.
    // Close-only, explicit recovery; do not infer ETC policy from a generic bridge error,
    // and never retry the refused write on its original path.
    if (!closeAttempt?.() || isCommandUnavailable("vob.save_as")) return false;
    const fr = useCatalog.getState().lang === "fr";
    const choice = await askChoice(fr ? `L’enregistrement de « ${path} » n’a pas été confirmé. Enregistrer sous un autre fichier ou retourner en édition ?` : `Saving “${path}” was not confirmed. Save as another file or return to editing?`, [
      { value: "save_as", label: fr ? "Enregistrer sous…" : "Save as…" },
      { value: "stay", label: fr ? "Retourner en édition" : "Return to editing" },
    ]);
    if (choice !== "save_as" || !closeAttempt() || !(await vobSaveFile(path, true, attempt))) return false;
  }
  if (closeAttempt && !closeAttempt()) return false;
  return true;
}

/** File selection is serialized; cancelled/failed saves never replace the active document. */
export async function vobSwitch(path?: string) {
  if (useVobResources.getState().busy) return false;
  const s = useVobEditor.getState(); if (path && path === s.file?.path) return true;
  useVobResources.setState({ busy: true });
  try {
    if (vobHasChanges(s)) {
      const fr = useCatalog.getState().lang === "fr";
      const choice = await askChoice(fr ? `Enregistrer les modifications de « ${s.file?.name ?? "VOB"} » avant de changer de fichier ?` : `Save changes to “${s.file?.name ?? "VOB"}” before switching files?`, [
        { value: "save", label: fr ? "Enregistrer" : "Save" }, { value: "keep", label: fr ? "Garder en mémoire" : "Keep in memory" },
      ]);
      if (!choice || (choice === "save" && (!(await vobSave()) || vobHasChanges(useVobEditor.getState())))) return false;
    }
    rememberVobSession();
    if (path && resumeVobSession(path)) return true;
    if (isCommandUnavailable("vob.open")) return false;
    const doc = await request<VobDocument | null>("vob.open", { path: path ?? null }, path ? undefined : 0);
    if (!doc) return false;
    applyVobDocument(doc); rememberVobSession(); return true;
  } catch (error) { return report(error); }
  finally { useVobResources.setState({ busy: false }); }
}

/** Native picker or absolute dropped paths; Python validates existing files, never creates them. */
export async function vobAddFiles(paths?: string[]) {
  if (useVobResources.getState().busy || isCommandUnavailable("vob.files.add")) return false;
  if (paths && (!paths.length || paths.some((p) => !/^(?:[a-z]:[\\/]|\/)/i.test(p)))) return report(new Error(useCatalog.getState().lang === "fr" ? "Le chemin complet du fichier est nécessaire. Utilisez le bouton Ajouter un fichier." : "The full file path is required. Use Add file."));
  useVobResources.setState({ busy: true });
  try {
    const data = await request<{ files: VobFile[] } | null>("vob.files.add", { paths: paths ?? null, multiple: !paths }, paths ? undefined : 0);
    if (!data) return false;
    acceptAddedVobFiles(data.files); return true;
  } catch (error) { return report(error); }
  finally { useVobResources.setState({ busy: false }); }
}

/** User picks one project folder; Python inventories only that folder (never all of PRJ). */
export async function vobAddProject(path?: string) {
  if (useVobResources.getState().busy || isCommandUnavailable("vob.projects.add")) return false;
  useVobResources.setState({ busy: true });
  try {
    const data = await request<unknown>("vob.projects.add", { path: path ?? null, multiple: !path }, path ? undefined : 0);
    if (!data) return false;
    // Multi-selection reply: { projects: [{ project, files }] }; single reply kept for compatibility.
    const many = (data as { projects?: unknown }).projects;
    if (Array.isArray(many)) { const errors: string[] = []; for (const p of many) { try { acceptVobProject(p); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); } } if (errors.length) report(new Error(errors.join("\n"))); return errors.length < many.length; }
    acceptVobProject(data); return true;
  } catch (error) { return report(error); }
  finally { useVobResources.setState({ busy: false }); }
}

/** Python scans every valid Allplan version (allVersions) and tags each file with its version. */
export async function vobListFiles(context = useVobResources.getState().context) {
  context = supportedVobContext(context);
  try {
    const data = await request<{ files: VobFile[]; context?: VobResourceContext }>("vob.files.list", { version: context.version, source: context.source, allVersions: true, minVersion: MIN_ALLPLAN_VERSION, projects: useVobResources.getState().addedProjects.map((p) => p.path) });
    if (!Array.isArray(data?.files)) throw new HostError("bad-reply", "vob.files.list: expected files array");
    mergeVobFiles(data.files); useVobResources.setState({ context: supportedVobContext(data.context ?? context) });
  } catch (error) { report(error); }
}

/** Explorer reveal / default-application open, both executed by Python on an existing file. */
export async function vobRevealFile(path: string, mode: "folder" | "file") {
  const command = mode === "folder" ? "vob.file.reveal" : "vob.file.open_external";
  if (isCommandUnavailable(command)) return false;
  try { await request(command, { path }); return true; } catch (error) { return report(error); }
}

export async function vobListBackups() {
  const file = useVobEditor.getState().file;
  useVobResources.setState({ backups: [], backupFile: file?.path ?? null });
  if (!file) return;
  try {
    const data = await request<{ filePath: string; files: VobBackup[] }>("vob.backups.list", { file });
    if (data?.filePath === useVobEditor.getState().file?.path && Array.isArray(data.files)) useVobResources.setState({ backups: data.files, backupFile: data.filePath });
  } catch (error) { report(error); }
}
export async function vobRestoreBackup(backup: VobBackup) {
  const file = useVobEditor.getState().file; if (!file || useVobResources.getState().backupFile !== file.path) return false;
  const fr = useCatalog.getState().lang === "fr";
  if (!(await askConfirmation(fr ? `Restaurer « ${backup.name} » ? Le fichier VOB actuel sera remplacé. Les modifications actuelles restent en mémoire jusqu’à la fermeture.` : `Restore “${backup.name}”? The current VOB file will be replaced. Current edits remain in memory until closure.`))) return false;
  rememberVobSession();
  try {
    const document = await request<VobDocument>("vob.backups.restore", { file, backup });
    if (!document?.file || !Array.isArray(document.rules)) throw new HostError("bad-reply", "vob.backups.restore: expected document");
    applyVobDocument(document); await vobListBackups(); return true;
  } catch (error) { return report(error); }
}
export async function vobCreateBackup() {
  const s = useVobEditor.getState(); if (!s.file) return;
  try { await request("vob.backups.create", { file: s.file, rules: toVobPayload(s.rules) }); await vobListBackups(); }
  catch (error) { report(error); }
}
/** Local request token: only the latest reference.load invocation may update state (no requestId in the contract). */
let referenceToken = 0;
/** Receiving references never touches rules, dirty state or saving. */
export async function vobLoadReferences(lang: string, signal?: AbortSignal) {
  const token = ++referenceToken;
  const current = () => token === referenceToken && !signal?.aborted;
  if (isCommandUnavailable("reference.load") || signal?.aborted) { if (current()) useVobHost.setState({ references: { kind: "none" } }); return; }
  useVobHost.setState({ references: { kind: "loading" } }); // previous results are never shown as the current request's
  try {
    const data = await request<unknown>("reference.load", { lang });
    if (!current()) return;
    useVobHost.setState({ references: parseVobReferences(data) });
  }
  catch (e) {
    if (!current()) return;
    if (e instanceof HostError && ["no-host", "unknown_command", "unavailable"].includes(e.code)) { useVobHost.setState({ references: { kind: "none" } }); return; }
    useVobHost.setState({ references: { kind: "error", message: e instanceof Error ? e.message : String(e) } });
    report(e);
  }
}

export function connectVobHost(onSettings?: (s: NonNullable<VobInitialData["settings"]>) => void, lang?: string, onIdentified?: (info: unknown) => void) {
  const off = [
    onUnavailableChange(syncUnavailable),
    onHostEvent("vob.recent_files", (paths) => { if (Array.isArray(paths) && paths.every((path) => typeof path === "string")) useVobHost.setState({ recentFiles: toRecent(paths) }); }),
    onHostEvent("vob.files", (files) => { if (Array.isArray(files)) mergeVobFiles(files as VobFile[]); }),
    onHostEvent("vob.files.dropped", (data) => { const paths = (data as { paths?: unknown } | null)?.paths; if (Array.isArray(paths) && paths.every((p) => typeof p === "string")) void vobAddFiles(paths); }),
    onHostEvent("vob.document", (doc) => applyVobDocument(doc as VobDocument)),
    onHostEvent("vob.context", (context) => { if (context && typeof (context as VobResourceContext).version === "string") { useVobResources.setState({ context: supportedVobContext(context as VobResourceContext) }); } }),
    onHostEvent("vob.backups", (raw) => { const data = raw as { filePath: string; files: VobBackup[] }; if (data?.filePath === useVobEditor.getState().file?.path && Array.isArray(data.files)) useVobResources.setState({ backups: data.files, backupFile: data.filePath }); }),
    onHostEvent("error", (err) => { const m = (err as { message?: unknown } | null)?.message; if (m) showMessage(String(m), "info"); }),
  ];
  useVobHost.setState({ dataVersion: null, recentFiles: [] });
  syncUnavailable();
  const connection = new AbortController();
  const stop = connectHost("vob_editor", (raw, info) => {
    onIdentified?.(info);
    const data = (raw ?? {}) as VobInitialData;
    if (data.files) mergeVobFiles(data.files);
    if (data.context) useVobResources.setState({ context: supportedVobContext(data.context) });
    const version = data.allplan?.version;
    useVobHost.setState({ dataVersion: typeof version === "string" && version.trim() ? version : null, recentFiles: toRecent(data.recentFiles) });
    applyVobDocument(data.document);
    if (data.backups && data.backups.filePath === useVobEditor.getState().file?.path) useVobResources.setState({ backups: data.backups.files, backupFile: data.backups.filePath });
    if (data.settings && onSettings) onSettings(data.settings);
    void vobLoadReferences(data.settings?.lang ?? lang ?? "en", connection.signal);
  });
  return () => { writeGeneration += 1; connection.abort(); stop(); off.forEach((f) => f()); };
}

/** Display-only index padding; reference names are rendered separately. */
export const VOB_PAD = { trade: 3, object: 4, unit: 2, method: 2 } as const;
export const sameVobIndex = (a: string, b: string) => a === b || (a.trim() !== "" && b.trim() !== "" && Number(a) === Number(b));
export function formatVobIndex(key: keyof typeof VOB_PAD, raw: string) {
  return /^\d+$/.test(raw) ? raw.padStart(VOB_PAD[key], "0") : raw;
}

/** Read-only preview of a file without opening it: Python reads the file, nothing is loaded into the editor. */
export async function vobPreview(path: string): Promise<VobRule[] | null> { return (await vobPreviewDocument(path))?.rules ?? null; }
/** English fallback of Allplan's default header, used only when Python cannot supply it. */
export const VOB_DEFAULT_HEADER = ["COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN", "MODULE=Lists, quantity takeoff", "TITLE=VOB-compliant quantity takeoff", "COUNTRY=FRA", "LANGUAGE=independent", "description:", "1st entry  -> trade identifier", "2nd entry  -> component (-1 == default)", "3rd entry  -> billing type (0 = m3 / 1 = m2 / 2 = m / -1 = default)", "4th entry  -> calculation method (-1=default, 1=Volume, 2=Base, 3=Floor, 4=Ceiling, 5=Sides, 6=Median surface)", "5th entry  -> billing criterion", "================================================================"];
/** Python returns the default header (English) for the file's country; lines without "//". */
export async function vobDefaultHeader(file = useVobEditor.getState().file): Promise<string[]> {
  if (isCommandUnavailable("vob.header.default")) return VOB_DEFAULT_HEADER;
  try { const data = await request<{ header?: unknown }>("vob.header.default", { file }); const lines = toHeader(data?.header); return lines.length ? lines : VOB_DEFAULT_HEADER; }
  catch (e) { if (e instanceof HostError && e.code === "no-host") return VOB_DEFAULT_HEADER; report(e); return VOB_DEFAULT_HEADER; }
}
export async function vobPreviewDocument(path: string): Promise<{ rules: VobRule[]; header: string[] } | null> {
  if (isCommandUnavailable("vob.preview")) return null;
  try { const doc = await request<VobDocument | null>("vob.preview", { path }); return doc ? { rules: toRules(doc.rules ?? []), header: toHeader(doc.header) } : null; }
  catch (error) { if (!(error instanceof HostError && error.code === "no-host")) report(error); return null; }
}
