import { describe, expect, it } from "vitest";
import REFUSED from "@/test/fixtures/aim-contract2/unrecognized.json";
import { parseAimProjectSnapshot, type AimDiagnostic } from "@/modules/information_manager/lib/aim-project-contract";
import { selectionReason } from "@/modules/information_manager/lib/aim-project";

const diagnostic = (code: string, message: string): AimDiagnostic => ({ code, message, severity: "error", path: null, line: null, attributeNumber: null, relatedPath: null });
const inventory = diagnostic("inventory_unavailable", "Inventaire synthétique inaccessible.");
const genericMessage = "Projet AIM non charge ; consulter les diagnostics.";
const neutralMessage = "Le projet n'a pas pu être sélectionné. Choisissez un autre projet ou consultez les détails techniques.";
function snapshot(diagnostics: AimDiagnostic[]) {
  const result = parseAimProjectSnapshot({ ...REFUSED, diagnostics });
  if (!result) throw new Error("Invalid synthetic snapshot");
  return result;
}

describe("AIM selection cause association", () => {
  it("uses the linked snapshot cause with the exact generic Python notice and unrelated inventory together", () => {
    const cause = diagnostic("project_outside_installation", "Le projet sélectionné est hors du PRJ de l’installation choisie.");
    const result = selectionReason("fr", "project_selection_required", snapshot([inventory, cause]), genericMessage);
    expect(result).toBe(cause.message);
    expect(result).not.toBe(genericMessage);
    expect(result).not.toBe(inventory.message);
  });
  it("keeps the exact neutral fallback for the generic notice without a relevant cause", () => {
    expect(selectionReason("fr", "project_selection_required", snapshot([]), genericMessage)).toBe(neutralMessage);
  });
  it("keeps the exact neutral fallback for inventory alone, with or without the generic notice", () => {
    expect(selectionReason("fr", "project_selection_required", snapshot([inventory]), genericMessage)).toBe(neutralMessage);
    expect(selectionReason("fr", "project_selection_required", snapshot([inventory]))).toBe(neutralMessage);
  });
  it("prioritizes the command's explicit cause over inventory and linked diagnostics", () => {
    const explicit = "Cause explicite synthétique de la sélection.";
    expect(selectionReason("fr", "project_selection_required", snapshot([inventory, diagnostic("project_outside_installation", "Autre cause.")]), explicit)).toBe(explicit);
  });
  it.each(["project_outside_installation", "installation_ambiguous"])("links %s to installation selection despite an earlier inventory error", (code) => {
    const cause = diagnostic(code, `Cause synthétique ${code}.`);
    expect(selectionReason("fr", "project_selection_required", snapshot([inventory, cause]))).toBe(cause.message);
  });
  it("matches a specific error code rather than the first global error", () => {
    const cause = diagnostic("specific_selection_error", "Cause synthétique précise.");
    expect(selectionReason("fr", cause.code, snapshot([inventory, cause]))).toBe(cause.message);
  });
  it("uses the same neutral fallback with no cause or only unrelated inventory diagnostics", () => {
    const neutral = selectionReason("fr", "unknown_selection_error");
    expect(selectionReason("fr", "project_selection_required", snapshot([inventory]))).toBe(neutral);
    expect(selectionReason("fr", "project_selection_required", snapshot([]), "project_selection_required")).toBe(neutral);
    expect(neutral).not.toBe(inventory.message);
  });
  it("does not infer an installation cause from a diagnostic on another selection status", () => {
    const s = snapshot([diagnostic("project_outside_installation", "Sans lien établi.")]);
    s.selection = "error";
    expect(selectionReason("fr", "project_selection_required", s)).toBe(selectionReason("fr", "unknown_selection_error"));
  });
});