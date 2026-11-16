import { presentationAvailable, parseExport, type ExportOutcome } from "./aim-presentation-contract";
import { object, presentationIdentity } from "./aim-working-contract";

export const EXPORT_UNAVAILABLE = "Export JSON indisponible : l’hôte Python n’autorise pas encore ce frontend.";
export const EXPORT_SYNC_TIMEOUT_MS = 15000;

/** Independent opt-in, never an addition to the historical mandatory identity fields. */
export function presentationExportAvailable(info: unknown): boolean {
  return object(info) && info["presentation_export_contract"] === 1 && presentationAvailable(presentationIdentity(info));
}

/** Bound only synchronization, not Python's user-controlled native save dialog. */
export async function waitForPresentationSync(task: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Synchronisation non terminée : aucun export envoyé. Réessayez après sa confirmation.")), EXPORT_SYNC_TIMEOUT_MS);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function exportNotice(outcome: ExportOutcome): string {
  if (outcome.kind === "exported") return `Copie de la présentation exportée : ${outcome.fileName}`;
  if (outcome.kind === "cancelled") return "";
  if (outcome.kind === "invalid") return "Export non confirmé : réponse Python incompatible.";
  const context = outcome.code === "stale_presentation"
    ? "La présentation affichée n'est pas synchronisée. "
    : outcome.code === "presentation_required" ? "Aucune présentation active. " : "";
  return context + outcome.message;
}

export { parseExport };