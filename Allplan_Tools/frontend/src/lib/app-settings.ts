/**
 * Central settings registry: every persistent personal setting of every dialog,
 * collected into one versioned document exchanged with the Python host
 * (settings.load at start, settings.save debounced on change).
 */
import { connectHost, isHosted, request, type HostAppId } from "./host-bridge";
import { useCatalog } from "./catalog-store";
import { useAttrFavorites, parseFavorites } from "./attr-favorites";
import { useAttrOrder, parseOrderFavorites, parseOrderFolders } from "./attr-order";
import { useFolderIcons } from "./folder-icons";
import { useFormulaFavorites, parseFormulaSettings } from "./formula-favorites";
import { useTemplates, parseTemplates } from "./templates";
import { useToolbarLayouts, toolbarSettings, applyToolbarSettings } from "./toolbar-layout";
import { useExternalLibraries } from "./external-libraries";
import { useTextureLibrary } from "./texture-library";
import { useVobViewSettings, vobViewSettings, applyVobViewSettings } from "./vob-view-settings";
import { useVobResources, vobResourceSettings, applyVobResourceSettings } from "./vob-resources";

export const SETTINGS_VERSION = 1;
const DIALOG_KEY = "smartcatalog-dialog-layouts";
const arr = (v: unknown) => Array.isArray(v) ? v : null;

/** Section name -> [read, write]. Section names are the contract with Python. */
export const SETTINGS_SECTIONS = {
  general: [() => ({ lang: useCatalog.getState().lang, dark: useCatalog.getState().dark }), (v: unknown) => {
    const d = (v ?? {}) as { lang?: unknown; dark?: unknown };
    if (typeof d.lang === "string") useCatalog.getState().setLang(d.lang as never);
    if (typeof d.dark === "boolean") useCatalog.getState().setDark(d.dark);
  }],
  toolbars: [toolbarSettings, applyToolbarSettings],
  dialogs: [() => { try { return JSON.parse(localStorage.getItem(DIALOG_KEY) ?? "{}"); } catch { return {}; } },
    (v: unknown) => { if (v && typeof v === "object") localStorage.setItem(DIALOG_KEY, JSON.stringify(v)); }],
  attributeFavorites: [() => useAttrFavorites.getState().favs, (v: unknown) => { const favs = parseFavorites(v); if (favs) useAttrFavorites.getState().setAll(favs); }],
  attributeOrder: [() => { const s = useAttrOrder.getState(); return { sort: s.sort, active: s.active, favorites: s.favorites, folders: s.folders }; }, (v: unknown) => {
    const d = (v ?? {}) as { sort?: unknown; active?: unknown; favorites?: unknown; folders?: unknown };
    const favorites = parseOrderFavorites(d.favorites);
    if (favorites) useAttrOrder.getState().saveAll(favorites, typeof d.active === "string" ? d.active : favorites[0]!.id, parseOrderFolders(d.folders));
    if (d.sort === "asc" || d.sort === "desc" || d.sort === "custom" || typeof d.sort === "string") useAttrOrder.getState().setSort(d.sort as never);
  }],
  formulaFavorites: [() => ({ favorites: useFormulaFavorites.getState().favorites, folders: useFormulaFavorites.getState().folders }),
    (v: unknown) => { const s = parseFormulaSettings(v); if (s) useFormulaFavorites.setState(s); }],
  attributeModels: [() => useTemplates.getState().models, (v: unknown) => { const m = parseTemplates(v); if (m) useTemplates.setState({ models: m }); }],
  folderIcons: [() => useFolderIcons.getState().entries, (v: unknown) => { const e = arr(v); if (e) useFolderIcons.setState({ entries: e }); }],
  externalLibraries: [() => { const s = useExternalLibraries.getState(); return { sources: s.sources, folders: s.folders, active: s.active }; }, (v: unknown) => {
    const d = (v ?? {}) as { sources?: unknown; folders?: unknown; active?: unknown };
    // Former built-in demo library (flagged demo:true) is dropped; user sources are kept.
    const sources = arr(d.sources)?.filter((x) => !(x && typeof x === "object" && (x as { demo?: unknown }).demo === true)) ?? null, folders = arr(d.folders);
    useExternalLibraries.setState({ ...(sources ? { sources } : {}), ...(folders ? { folders } : {}), ...(typeof d.active === "string" ? { active: d.active } : {}) });
  }],
  vobEditor: [vobViewSettings, applyVobViewSettings],
  vobResources: [vobResourceSettings, applyVobResourceSettings],
  textures: [() => useTextureLibrary.getState().entries, (v: unknown) => { const e = arr(v); if (e) useTextureLibrary.setState({ entries: e }); }],
} as const satisfies Record<string, readonly [() => unknown, (v: unknown) => void]>;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;
export type AppSettings = { version: number } & { [K in SettingsSection]?: unknown };

/** Sections each host app accepts; the VOB backend rejects any other section. */
export const APP_SECTIONS: Partial<Record<HostAppId, SettingsSection[]>> = { vob_editor: ["general", "toolbars", "dialogs", "formulaFavorites", "vobEditor", "vobResources"] };
export function collectSettings(sections?: SettingsSection[]): AppSettings {
  const out: AppSettings = { version: SETTINGS_VERSION };
  for (const [k, [read]] of Object.entries(SETTINGS_SECTIONS)) if (!sections || sections.includes(k as SettingsSection)) out[k as SettingsSection] = read();
  return out;
}
/** Applies known sections only (restricted to `sections` when given); unknown or invalid sections are ignored. */
export function applySettings(input: unknown, sections?: SettingsSection[]) {
  if (!input || typeof input !== "object") return;
  for (const [k, [, write]] of Object.entries(SETTINGS_SECTIONS)) {
    if (sections && !sections.includes(k as SettingsSection)) continue;
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) try { write(v); } catch { /* keep current values */ }
  }
}

const STORES = [useCatalog, useAttrFavorites, useAttrOrder, useFolderIcons, useFormulaFavorites, useTemplates, useToolbarLayouts, useExternalLibraries, useTextureLibrary, useVobViewSettings, useVobResources] as const;

/** Loads settings from Python, then saves them (debounced) whenever they change. */
export function connectSettings(appId: HostAppId, delay = 800) {
  let timer: ReturnType<typeof setTimeout> | undefined, last = "", ready = false;
  const sections = APP_SECTIONS[appId];
  const flush = () => { if (!ready || !isHosted()) return; const s = collectSettings(sections), json = JSON.stringify(s); if (json === last) return; last = json; void request("settings.save", s).catch(() => { last = ""; }); };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(flush, delay); };
  const unsubs = STORES.map((store) => (store as { subscribe: (fn: () => void) => () => void }).subscribe(schedule));
  window.addEventListener("smartcatalog-dialog-layout", schedule);
  const stop = connectHost(appId, async () => {
    try { applySettings(await request("settings.load", { app_id: appId }), sections); } catch { /* defaults */ }
    last = JSON.stringify(collectSettings(sections)); ready = true;
  });
  return () => { stop(); clearTimeout(timer); unsubs.forEach((u) => u()); window.removeEventListener("smartcatalog-dialog-layout", schedule); };
}
