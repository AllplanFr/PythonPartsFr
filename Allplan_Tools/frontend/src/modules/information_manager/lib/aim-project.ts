import type { Lang } from "./i18n";
import type { AimProjectSnapshot } from "./aim-project-contract";

/** Readable refusal reason; unknown technical codes are kept in the separate diagnostics area. */
export function selectionReason(lang: Lang, code: string, snapshot?: AimProjectSnapshot, message?: string): string {
  // Keep specific Python messages, but this known generic notice is not a cause.
  const commandMessage = message?.trim();
  if (commandMessage && commandMessage !== code && commandMessage !== "Projet AIM non charge ; consulter les diagnostics.") return message ?? commandMessage;
  if (snapshot) {
    // Only established selection causes are eligible; inventory errors stay in details.
    const relatedCodes = snapshot.selection === "installation_required" && (code === "project_selection_required" || code === "installation_required")
      ? ["installation_ambiguous", "project_outside_installation"]
      : [code];
    const reason = relatedCodes.map((related) => snapshot.diagnostics.find((d) => d.code === related && d.severity === "error" && d.message.trim())).find((d) => d !== undefined);
    if (reason) return reason.message;
  }
  if (code === "project_read_error") return projectText(lang, "read-error");
  return lang === "fr" ? "Le projet n'a pas pu être sélectionné. Choisissez un autre projet ou consultez les détails techniques." : "The project could not be selected. Choose another project or consult the technical details.";
}

/** Project lifecycle shown by AIM. A read error is never presented as missing data. */
export type AimProjectStatus = "none" | "loading" | "loaded" | "no-attributes" | "read-error" | "cancelled" | "installation-required" | "installation-ambiguous" | "config-invalid" | "definitions-unavailable";
type ProjectTextKey = AimProjectStatus | "choose" | "pending" | "selecting" | "selectRefused" | "defsNotLoaded" | "defsAvailable" | "defsPartial" | "defsUnavailable" | "unknownValues" | "diagnostics" | "readOnly" | "valueUnset" | "valueUnavailable" | "colState";

export type ProjectValues = { values: Record<number, string>; hasAttributesFile: boolean; ignored: number[] };

/**
 * Maps backend values (keyed by attribute number) onto the known catalog numbers only.
 * - matching is by number, never by the name stored in prjatt.dat;
 * - absent keys stay absent (unset), a literal "0" stays "0";
 * - unknown numbers are reported in `ignored`, no row is created for them;
 * - nothing is inherited from a previous project.
 * `values` missing or null means the project has no attributes file.
 */
export function projectValues(raw: unknown, knownNums: Iterable<number>): ProjectValues {
  if (raw === undefined || raw === null) return { values: {}, hasAttributesFile: false, ignored: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid-values");
  const known = new Set(knownNums);
  const values: Record<number, string> = {};
  const ignored: number[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) { ignored.push(Number.NaN); continue; }
    const num = Number(key);
    if (!known.has(num)) { ignored.push(num); continue; }
    if (value === undefined || value === null) continue;
    values[num] = String(value);
  }
  return { values, hasAttributesFile: true, ignored };
}

/** Value for one attribute after a project switch: the new project's value or unset. */
export function valueAfterSwitch(values: Record<number, string>, num: number): string {
  return Object.hasOwn(values, num) ? values[num]! : "";
}

const TEXT: Partial<Record<Lang, Record<ProjectTextKey, string>>> = {
  fr: { none: "Aucun projet", loading: "Chargement du projet…", loaded: "Projet chargé", "no-attributes": "Projet sans prjatt.dat : attributs non renseignés", "read-error": "Erreur de lecture du projet", choose: "Choisir un projet Allplan", pending: "Sélection native en attente du contrat Python", cancelled: "Sélection annulée : aucun projet", "installation-required": "Projet hors d’une installation Allplan connue : non chargé", "installation-ambiguous": "Plusieurs installations possibles : choisissez-la dans le lanceur, puis relancez", "config-invalid": "Configuration du projet (project.cfg) invalide : valeurs non lues", selecting: "Sélection du projet en cours…", selectRefused: "Sélection refusée par Python", defsNotLoaded: "Définitions non chargées", defsAvailable: "Définitions disponibles", defsPartial: "Définitions partielles (diagnostics)", defsUnavailable: "Définitions indisponibles", unknownValues: "valeur(s) sans définition", diagnostics: "diagnostic(s)", readOnly: "Lecture seule — aucun enregistrement dans le projet Allplan", "definitions-unavailable": "Projet reconnu, définitions indisponibles : aucun attribut affichable", valueUnset: "non renseigné", valueUnavailable: "indisponible", colState: "État" },
  en: { none: "No project", loading: "Loading project…", loaded: "Project loaded", "no-attributes": "Project without prjatt.dat: attributes not set", "read-error": "Project read error", choose: "Choose an Allplan project", pending: "Native selection awaiting the Python contract", cancelled: "Selection cancelled: no project", "installation-required": "Project outside a known Allplan installation: not loaded", "installation-ambiguous": "Several possible installations: choose it in the launcher, then relaunch", "config-invalid": "Invalid project configuration (project.cfg): values not read", selecting: "Selecting project…", selectRefused: "Selection refused by Python", defsNotLoaded: "Definitions not loaded", defsAvailable: "Definitions available", defsPartial: "Partial definitions (diagnostics)", defsUnavailable: "Definitions unavailable", unknownValues: "value(s) without definition", diagnostics: "diagnostic(s)", readOnly: "Read-only — nothing is saved to the Allplan project", "definitions-unavailable": "Project recognised, definitions unavailable: no attribute can be shown", valueUnset: "not set", valueUnavailable: "unavailable", colState: "State" },
  de: { none: "Kein Projekt", loading: "Projekt wird geladen…", loaded: "Projekt geladen", "no-attributes": "Projekt ohne prjatt.dat: Attribute nicht belegt", "read-error": "Lesefehler im Projekt", choose: "Allplan-Projekt wählen", pending: "Native Auswahl wartet auf den Python-Vertrag", cancelled: "Auswahl abgebrochen: kein Projekt", "installation-required": "Projekt außerhalb einer bekannten Allplan-Installation: nicht geladen", "installation-ambiguous": "Mehrere mögliche Installationen: im Launcher wählen und neu starten", "config-invalid": "Ungültige Projektkonfiguration (project.cfg): Werte nicht gelesen", selecting: "Projekt wird ausgewählt…", selectRefused: "Auswahl von Python abgelehnt", defsNotLoaded: "Definitionen nicht geladen", defsAvailable: "Definitionen verfügbar", defsPartial: "Teilweise Definitionen (Diagnosen)", defsUnavailable: "Definitionen nicht verfügbar", unknownValues: "Wert(e) ohne Definition", diagnostics: "Diagnose(n)", readOnly: "Nur lesen — nichts wird im Allplan-Projekt gespeichert", "definitions-unavailable": "Projekt erkannt, Definitionen nicht verfügbar: keine Attribute anzeigbar", valueUnset: "nicht belegt", valueUnavailable: "nicht verfügbar", colState: "Status" },
};
export function projectText(lang: Lang, key: ProjectTextKey): string {
  return (TEXT[lang] ?? TEXT.en)![key];
}
