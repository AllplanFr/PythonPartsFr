import { HostError, isCommandUnavailable } from "./host-bridge";
import { askChoice } from "./app-dialog";
import { useCatalog } from "./catalog-store";

type Operation = "vob.save" | "vob.save_as";
type Confirmation = { confirmationId: string; operation: Operation; path: string };
const record = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw);
const text = (raw: unknown): raw is string => typeof raw === "string" && raw.trim().length > 0;
function parseConfirmation(raw: unknown, operation: Operation): Confirmation {
  if (!record(raw) || !text(raw["confirmationId"]) || raw["operation"] !== operation || !text(raw["path"])) {
    throw new HostError("bad-reply", "Invalid ETC write confirmation: expected confirmationId, matching operation and exact path");
  }
  return { confirmationId: raw["confirmationId"], operation, path: raw["path"] };
}

// One pending user decision at a time; this lock never stores an approval or a token.
let writing = false;
export async function runVobWrite<Snapshot, Reply>(options: {
  operation: Operation;
  capture: () => Snapshot | null;
  payload: (snapshot: Snapshot) => unknown;
  call: (command: string, payload: unknown, timeout?: number) => Promise<Reply | null>;
  isCurrent: () => boolean;
  onConfirmation?: (() => void) | undefined;
}): Promise<{ result: Reply; snapshot: Snapshot } | null> {
  if (writing || !options.isCurrent()) return null;
  writing = true;
  let operation = options.operation;
  try {
    while (options.isCurrent()) {
      if (isCommandUnavailable(operation)) return null;
      const snapshot = options.capture(); if (!snapshot) return null;
      try {
        const result = await options.call(operation, options.payload(snapshot), operation === "vob.save_as" ? 0 : undefined);
        return result !== null && options.isCurrent() ? { result, snapshot } : null;
      } catch (error) {
        if (!(error instanceof HostError) || error.code !== "write_confirmation_required") throw error;
        const confirmation = parseConfirmation(error.confirmation, operation);
        options.onConfirmation?.();
        // Never interpret message text, infer ETC membership, or resend a document with the token.
        const fr = useCatalog.getState().lang === "fr";
        const choice = options.isCurrent() ? await askChoice(
          `${fr ? "Ce fichier se trouve dans le dossier ETC d’Allplan.\nVoulez-vous remplacer ce fichier ?" : "This file is in Allplan’s ETC folder.\nDo you want to replace this file?"}\n\n${confirmation.path}`,
          [{ value: "replace", label: fr ? "Remplacer" : "Replace" }, { value: "save_as", label: fr ? "Enregistrer sous…" : "Save as…" }, { value: "cancel", label: fr ? "Annuler" : "Cancel" }], true,
        ) : "cancel";
        const accept = choice === "replace" && options.isCurrent();
        const result = await options.call("vob.write.confirm", { confirmationId: confirmation.confirmationId, accept });
        if (!accept) {
          if (result !== null) throw new HostError("bad-reply", "vob.write.confirm: cancellation must return null");
          if (choice !== "save_as" || !options.isCurrent()) return null;
          operation = "vob.save_as"; // Pending token was refused and acknowledged before a new picker.
          continue; // Capture the current modified document, not the earlier snapshot.
        }
        return result !== null && options.isCurrent() ? { result, snapshot } : null;
      }
    }
    return null;
  } finally { writing = false; }
}