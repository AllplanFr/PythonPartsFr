import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { attributeTooltip, readCategoryIcon } from "@/modules/information_manager/lib/presentation-display";
import { AimMessageDialog } from "@/modules/information_manager/components/aim-message-dialog";
import { askChoice, useAppDialog } from "@/lib/app-dialog";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAppDialog.setState({ queue: [] }); });
it("uses only supplied tooltip fields, preserves zero/false/empty and omits missing values", () => {
  expect(attributeTooltip({ number: "7", value: null })).toBe("=N°|7");
  for (const value of ["", "0", "false"]) expect(attributeTooltip({ number: "7", value })).toContain(`=Valeur|${value}`);
  expect(attributeTooltip({ number: "7", definition: { label: "Python label" }, title: "Occurrence", widget: "entry", type: "STR", value: "0" }, { group: "Parent", category: "Category" })).toBe("Nom Allplan : Python label\n=N°|7\n=Titre|Occurrence\n=Saisie|Saisie libre\n=Donnée|STR\n=Groupe|Parent\n=Catégorie|Category\n=Valeur|0");
});
it("reads a local image as an embedded data URL, never a local path", async () => {
  const icon = await readCategoryIcon(new File(["image bytes"], "chosen.png", { type: "image/png" }));
  expect(icon).toBe("data:image/png;base64,aW1hZ2UgYnl0ZXM=");
});
it("rejects reading errors and incompatible file data rather than emitting an icon", async () => {
  await expect(readCategoryIcon(new File(["text"], "file.txt", { type: "text/plain" }))).rejects.toThrow("Image locale incompatible");
  vi.stubGlobal("FileReader", class { onerror?: () => void; readAsDataURL() { this.onerror?.(); } });
  await expect(readCategoryIcon(new File([], "bad.png"))).rejects.toThrow("Impossible de lire");
});
it("mounted AIM choice supports cancellation without accepting discard", async () => {
  render(<AimMessageDialog />);
  let answer: Promise<string | null> | undefined;
  act(() => { answer = askChoice("Abandonner les modifications ?", [{ value: "discard", label: "Abandonner les modifications" }]); });
  fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
  await expect(answer).resolves.toBeNull();
});
it("mounted AIM choice resolves explicit discard instead of leaving opening pending", async () => {
  render(<AimMessageDialog />);
  let answer: Promise<string | null> | undefined;
  act(() => { answer = askChoice("Ouvrir un autre projet ?", [{ value: "discard", label: "Abandonner" }]); });
  fireEvent.click(screen.getByRole("button", { name: "Abandonner" }));
  await expect(answer).resolves.toBe("discard");
});