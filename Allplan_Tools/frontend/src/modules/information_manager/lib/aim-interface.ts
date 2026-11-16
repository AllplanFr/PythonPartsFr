import { additionalLanguages } from "./aim-extra-languages";
import type { Lang } from "@/modules/information_manager/lib/i18n";

const words = {
  fr: ["Affichage", "Ajouter", "Éditer", "Affichage", "Recherche", "Annuler", "Rétablir", "Gestionnaire de sauvegarde", "Importer une présentation", "Exporter une présentation", "Mode de recherche", "Contient", "Commence par", "Égal à", "Expression régulière", "Respecter la casse", "Personnaliser la barre", "Afficher les titres", "Bloquer le layout", "Importer le menu layout", "Exporter le menu layout", "Chemin du projet non reçu", "Ouvrir le dossier du projet", "Ouvrir prjattr.dat", "Créer une sauvegarde", "Restaurer", "Actualiser", "Nom", "Date", "Aucune sauvegarde", "Importer une sauvegarde", "Exporter une sauvegarde", "Restaurer cette version du projet ?", "Modifications non enregistrées", "Session à jour", "Le PythonPart ne répond pas à cette commande.", "Le fichier ne correspond pas à ce projet.", "Catégorie / Groupe", "Aucun", "Rechercher", "Tous les champs", "Numéro", "Nom Allplan", "Titre", "Valeur", "Groupe", "Catégorie", "Déverrouillez le layout pour déplacer les modules.", "Le chemin du projet doit être fourni par le PythonPart.", "Sauvegarde de sécurité"],
  en: ["View", "Add", "Edit", "Display", "Search", "Undo", "Redo", "Backup manager", "Import presentation", "Export presentation", "Search mode", "Contains", "Starts with", "Equals", "Regular expression", "Match case", "Customize toolbar", "Show module titles", "Lock layout", "Import menu layout", "Export menu layout", "Project path not received", "Open project folder", "Open prjattr.dat", "Create backup", "Restore", "Refresh", "Name", "Date", "No backups", "Import backup", "Export backup", "Restore this project version?", "Unsaved changes", "Session up to date", "The PythonPart did not respond to this command.", "This file belongs to another project.", "Category / Group", "None", "Search in", "All fields", "Number", "Allplan name", "Title", "Value", "Group", "Category", "Unlock the layout to move modules.", "The project path must be supplied by the PythonPart.", "Safety backup"],
  de: ["Ansicht", "Hinzufügen", "Bearbeiten", "Anzeige", "Suche", "Rückgängig", "Wiederholen", "Sicherungsmanager", "Darstellung importieren", "Darstellung exportieren", "Suchmodus", "Enthält", "Beginnt mit", "Gleich", "Regulärer Ausdruck", "Groß-/Kleinschreibung", "Symbolleiste anpassen", "Modultitel anzeigen", "Layout sperren", "Menülayout importieren", "Menülayout exportieren", "Projektpfad nicht empfangen", "Projektordner öffnen", "prjattr.dat öffnen", "Sicherung erstellen", "Wiederherstellen", "Aktualisieren", "Name", "Datum", "Keine Sicherungen", "Sicherung importieren", "Sicherung exportieren", "Diese Projektversion wiederherstellen?", "Ungespeicherte Änderungen", "Sitzung aktuell", "PythonPart antwortet nicht auf diesen Befehl.", "Die Datei gehört zu einem anderen Projekt.", "Kategorie / Gruppe", "Keine", "Suchen in", "Alle Felder", "Nummer", "Allplan-Name", "Titel", "Wert", "Gruppe", "Kategorie", "Layout entsperren, um Module zu verschieben.", "Der Projektpfad muss vom PythonPart bereitgestellt werden.", "Sicherheitssicherung"],
  it: ["Visualizza", "Aggiungi", "Modifica", "Visualizzazione", "Ricerca", "Annulla", "Ripristina", "Gestore backup", "Importa presentazione", "Esporta presentazione", "Modalità di ricerca", "Contiene", "Inizia con", "Uguale", "Espressione regolare", "Maiuscole/minuscole", "Personalizza barra", "Mostra titoli moduli", "Blocca layout", "Importa layout menu", "Esporta layout menu", "Percorso progetto non ricevuto", "Apri cartella progetto", "Apri prjattr.dat", "Crea backup", "Ripristina", "Aggiorna", "Nome", "Data", "Nessun backup", "Importa backup", "Esporta backup", "Ripristinare questa versione del progetto?", "Modifiche non salvate", "Sessione aggiornata", "Il PythonPart non risponde a questo comando.", "Il file appartiene a un altro progetto.", "Categoria / Gruppo", "Nessuno", "Cerca in", "Tutti i campi", "Numero", "Nome Allplan", "Titolo", "Valore", "Gruppo", "Categoria", "Sblocca il layout per spostare i moduli.", "Il percorso deve essere fornito dal PythonPart.", "Backup di sicurezza"],
  es: ["Vista", "Añadir", "Editar", "Visualización", "Buscar", "Deshacer", "Rehacer", "Gestor de copias", "Importar presentación", "Exportar presentación", "Modo de búsqueda", "Contiene", "Empieza por", "Igual", "Expresión regular", "Distinguir mayúsculas", "Personalizar barra", "Mostrar títulos", "Bloquear layout", "Importar layout del menú", "Exportar layout del menú", "Ruta del proyecto no recibida", "Abrir carpeta del proyecto", "Abrir prjattr.dat", "Crear copia", "Restaurar", "Actualizar", "Nombre", "Fecha", "Sin copias", "Importar copia", "Exportar copia", "¿Restaurar esta versión del proyecto?", "Cambios sin guardar", "Sesión al día", "El PythonPart no responde a este comando.", "El archivo pertenece a otro proyecto.", "Categoría / Grupo", "Ninguno", "Buscar en", "Todos los campos", "Número", "Nombre Allplan", "Título", "Valor", "Grupo", "Categoría", "Desbloquee el layout para mover módulos.", "El PythonPart debe proporcionar la ruta del proyecto.", "Copia de seguridad"],
  hr: additionalLanguages.hr.words,
  ro: additionalLanguages.ro.words,
  ru: additionalLanguages.ru.words,
  cs: additionalLanguages.cs.words,
  sl: additionalLanguages.sl.words,
  sk: additionalLanguages.sk.words,
} as const;
const keys = ["view", "add", "edit", "display", "search", "undo", "redo", "backups", "importPresentation", "exportPresentation", "searchMode", "contains", "starts", "equals", "regex", "matchCase", "customize", "showTitles", "locked", "importLayout", "exportLayout", "noPath", "openFolder", "openAttributes", "createBackup", "restore", "refresh", "name", "date", "noBackups", "importBackup", "exportBackup", "confirmRestore", "dirty", "clean", "hostError", "wrongProject", "destination", "none", "searchIn", "all", "num", "nameField", "title", "value", "group", "category", "unlockHint", "pathHint", "safety"] as const;
export type InterfaceText = Record<typeof keys[number], string>;
export function interfaceText(lang: Lang): InterfaceText {
  return Object.fromEntries(keys.map((key, i) => [key, words[lang][i]])) as InterfaceText;
}

export type SearchOptions = { mode: "contains" | "starts" | "equals" | "regex"; matchCase: boolean; scope: "all" | "num" | "name" | "title" | "value" | "group" | "category" };
export const DEFAULT_SEARCH: SearchOptions = { mode: "contains", matchCase: false, scope: "all" };
export function matchesSearch(fields: Record<string, string>, query: string, options: SearchOptions): boolean {
  if (!query) return true;
  const values = options.scope === "all" ? Object.values(fields) : [fields[options.scope] ?? ""];
  if (options.mode === "regex") {
    try { const pattern = new RegExp(query, options.matchCase ? "" : "i"); return values.some((v) => pattern.test(v)); } catch { return false; }
  }
  const needle = options.matchCase ? query : query.toLocaleLowerCase();
  return values.some((value) => {
    const haystack = options.matchCase ? value : value.toLocaleLowerCase();
    return options.mode === "equals" ? haystack === needle : options.mode === "starts" ? haystack.startsWith(needle) : haystack.includes(needle);
  });
}

export type ProjectBackup = { kind: "aim-project-backup"; version: 1; id: string; name: string; createdAt: string; projectPath: string; data: Record<string, unknown>; values: Record<string, string> };
export function makeBackup(name: string, projectPath: string, data: Record<string, unknown>, rows: { num: number; value?: string }[]): ProjectBackup {
  return { kind: "aim-project-backup", version: 1, id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), projectPath, data: structuredClone(data), values: Object.fromEntries(rows.map((r) => [String(r.num), String(r.value ?? "")])) };
}
export function parseBackup(input: unknown, projectPath: string): ProjectBackup {
  if (!input || typeof input !== "object") throw new Error("format");
  const b = input as Partial<ProjectBackup>;
  if (b.kind !== "aim-project-backup" || b.version !== 1 || !b.data || !Array.isArray(b.data['attributes']) || !b.values || typeof b.values !== "object" || Array.isArray(b.values) || typeof b.id !== "string" || typeof b.name !== "string" || typeof b.createdAt !== "string" || typeof b.projectPath !== "string" || Object.entries(b.values).some(([k, v]) => !/^\d+$/.test(k) || typeof v !== "string")) throw new Error("format");
  const normalize = (p: string) => p.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  // Ownership must be proven: an empty path on either side never bypasses the check.
  if (!projectPath || !b.projectPath || normalize(projectPath) !== normalize(b.projectPath)) throw new Error("wrongProject");
  return structuredClone(b) as ProjectBackup;
}

export type History<T> = { past: T[]; present: T; future: T[] };
export function recordHistory<T>(h: History<T>, next: T): History<T> {
  if (JSON.stringify(h.present) === JSON.stringify(next)) return h;
  return { past: [...h.past, h.present], present: next, future: [] };
}
export function travelHistory<T>(h: History<T>, direction: "undo" | "redo"): History<T> {
  if (direction === "undo") {
    const next = h.past.at(-1); if (next === undefined) return h;
    return { past: h.past.slice(0, -1), present: next, future: [h.present, ...h.future] };
  }
  const next = h.future[0]; if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

export const MODULES = ["file", "view", "add", "columns", "search"] as const;
const LEGACY_MODULES = ["view", "add", "columns", "search"];
export type ModuleId = typeof MODULES[number];
export const TOOLBAR_COMMANDS = {
  file: ["import", "export"], view: ["expand", "collapse"], add: ["category", "group", "attribute"], columns: ["columns"], search: ["search"],
} as const;
export const MENU_COLORS = ["brand", "blue", "green", "orange", "yellow"] as const;
export type ToolbarGroup = { id: string; label: ModuleId | "newGroup"; title?: string; color: string; buttons: string[] };
export type ToolbarLayout = { kind: "aim-menu-layout"; version: 1; order: ModuleId[]; showTitles: boolean; locked: boolean; groups?: ToolbarGroup[] };
export function defaultToolbarGroups(): ToolbarGroup[] {
  return MODULES.map((id) => ({ id, label: id, color: "brand", buttons: [...TOOLBAR_COMMANDS[id]] }));
}
export const DEFAULT_LAYOUT: ToolbarLayout = { kind: "aim-menu-layout", version: 1, order: [...MODULES], showTitles: true, locked: false };
export function toolbarGroups(layout: ToolbarLayout): ToolbarGroup[] {
  return layout.groups ?? layout.order.flatMap((id) => defaultToolbarGroups().filter((g) => g.id === id));
}
/** Older saved layouts had no File module: insert it first instead of discarding the user's layout. */
function migrateLayout(input: unknown): unknown {
  const l = input as Partial<ToolbarLayout> | null;
  if (!l || typeof l !== "object" || !Array.isArray(l.order) || l.order.includes("file") || l.order.length !== LEGACY_MODULES.length || !LEGACY_MODULES.every((m) => (l.order as string[]).includes(m))) return input;
  const next = structuredClone(l);
  next.order = ["file", ...(l.order as ModuleId[])];
  if (Array.isArray(next.groups) && !next.groups.some((g) => g?.buttons?.includes?.("import") || g?.buttons?.includes?.("export"))) next.groups = [{ id: "file", label: "file", color: "brand", buttons: ["import", "export"] }, ...next.groups];
  return next;
}
export function parseLayout(input: unknown): ToolbarLayout {
  const l = migrateLayout(input) as Partial<ToolbarLayout> | null;
  if (!l || l.kind !== "aim-menu-layout" || l.version !== 1 || !Array.isArray(l.order) || l.order.length !== MODULES.length || new Set(l.order).size !== MODULES.length || l.order.some((id) => !MODULES.includes(id)) || typeof l.showTitles !== "boolean" || typeof l.locked !== "boolean") throw new Error("layout");
  if (l.groups !== undefined) {
    if (!Array.isArray(l.groups) || !l.groups.length) throw new Error("layout");
    const commands = Object.values(TOOLBAR_COMMANDS).flat();
    const seen = new Set<string>(); const ids = new Set<string>();
    for (const g of l.groups) {
      if (!g || typeof g.id !== "string" || ids.has(g.id) || !(g.label === "newGroup" || MODULES.includes(g.label)) || (g.title !== undefined && typeof g.title !== "string") || !(MENU_COLORS.some((c) => c === g.color) || /^#[a-f0-9]{6}$/i.test(g.color)) || !Array.isArray(g.buttons) || !g.buttons.length) throw new Error("layout");
      ids.add(g.id);
      for (const b of g.buttons) { if (!commands.some((c) => c === b) || seen.has(b)) throw new Error("layout"); seen.add(b); }
    }
    if (seen.size !== commands.length) throw new Error("layout");
  }
  return structuredClone(l) as ToolbarLayout;
}
export function moveToolbarItem(layout: ToolbarLayout, source: { group: string; button?: string }, target?: { group: string; button?: string }): ToolbarLayout {
  if (layout.locked || (source.group === target?.group && source.button === target?.button)) return layout;
  const groups = toolbarGroups(layout).map((g) => ({ ...g, buttons: [...g.buttons] }));
  const from = groups.find((g) => g.id === source.group);
  if (!from) return layout;
  if (source.button) {
    if (!from.buttons.includes(source.button)) return layout;
    from.buttons = from.buttons.filter((b) => b !== source.button);
    const to = groups.find((g) => g.id === target?.group);
    if (to) { const i = target?.button ? to.buttons.indexOf(target.button) : -1; to.buttons.splice(i < 0 ? to.buttons.length : i, 0, source.button); }
    else groups.push({ id: crypto.randomUUID(), label: "newGroup", color: from.color, buttons: [source.button] });
  } else {
    groups.splice(groups.indexOf(from), 1);
    const i = groups.findIndex((g) => g.id === target?.group);
    groups.splice(i < 0 ? groups.length : i, 0, from);
  }
  return { ...layout, groups: groups.filter((g) => g.buttons.length) };
}
export function downloadJson(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}