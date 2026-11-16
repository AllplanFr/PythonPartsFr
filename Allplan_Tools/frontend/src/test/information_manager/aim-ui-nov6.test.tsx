import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import fixture from "./synthetic-presentation.json";
import examples from "../fixtures/aim-complete/backend-examples.json";
import { isPresentation, parseUpdate } from "@/modules/information_manager/lib/aim-presentation-contract";
import { OrganizedPresentationView } from "@/modules/information_manager/components/organized-presentation";
import { TreePresentationView } from "@/modules/information_manager/components/tree-presentation";
import { uniquePresentationName, validPresentationName } from "@/modules/information_manager/lib/presentation-ui";
import type { TreePresentation } from "@/modules/information_manager/lib/presentation-tree";

afterEach(cleanup);
const sample = () => { const p: unknown = structuredClone(fixture.presentation); if (!isPresentation(p)) throw new Error("fixture"); return p; };
it("default names never collide or become empty", () => {
  expect(uniquePresentationName("Nouvelle catégorie", ["Nouvelle catégorie", "Nouvelle catégorie 2"])).toBe("Nouvelle catégorie 3");
  expect(uniquePresentationName("Nouveau groupe", ["Nouveau groupe"])).toBe("Nouveau groupe 2");
  expect(validPresentationName("  ", [])).toBe(false);
  expect(validPresentationName(" groupe ", ["Groupe"])).toBe(false);
});
it("V1 aggregate drops make no configuration changes or valid preview", () => {
  const changes = vi.fn(); render(<OrganizedPresentationView presentation={sample()} onConfigurationChange={changes} />);
  const grip = document.querySelector('[data-group-id] [draggable]'); const target = document.querySelector('[data-group-id] td');
  if (!grip || !target) throw new Error("targets");
  const dataTransfer = { setData: vi.fn(), dropEffect: "move" };
  fireEvent.dragStart(grip, { dataTransfer }); fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer });
  expect(changes).not.toHaveBeenCalled(); expect(dataTransfer.dropEffect).toBe("none"); expect(document.querySelector(".drop-target")).toBeNull();
});
it("V1 group drag hides children transiently and cancel retains expansion and order", () => {
  const p = sample(); const before = structuredClone(p.configuration); const changes = vi.fn();
  render(<OrganizedPresentationView presentation={p} view="synthetic-category" onConfigurationChange={changes} />);
  const grip = document.querySelector('[data-group-id] [draggable]'); if (!grip) throw new Error("grip");
  expect(document.querySelectorAll("[data-row-id]")).toHaveLength(4);
  fireEvent.dragStart(grip, { dataTransfer: { setData: vi.fn() } }); expect(document.querySelectorAll("[data-row-id]")).toHaveLength(0);
  fireEvent.dragEnd(grip); expect(document.querySelectorAll("[data-row-id]")).toHaveLength(4);
  expect(changes).not.toHaveBeenCalled(); expect(p.configuration).toEqual(before);
});
it("V1 inline creation intent waits for its actual container and preserves default on empty rename", async () => {
  const p = sample(); const changes = vi.fn(); const started = vi.fn();
  const mounted = render(<OrganizedPresentationView presentation={p} view="new-cat" renameRequest={{ kind: "category", id: "new-cat" }} onRenameStarted={started} onConfigurationChange={changes} />);
  expect(started).not.toHaveBeenCalled();
  p.configuration.categories.push({ id: "new-cat", name: "Nouvelle catégorie", position: 2, icon: "", groups: [] });
  mounted.rerender(<OrganizedPresentationView presentation={p} view="new-cat" renameRequest={{ kind: "category", id: "new-cat" }} onRenameStarted={started} onConfigurationChange={changes} />);
  await act(async () => {});
  const input = screen.getByLabelText("Nom"); expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "" } }); fireEvent.keyDown(input, { key: "Enter" });
  expect(changes).not.toHaveBeenCalled(); expect(p.configuration.categories.at(-1)?.name).toBe("Nouvelle catégorie");
});
it("V1 matching group title remains with no matching child while unmatched headings disappear", () => {
  render(<OrganizedPresentationView presentation={sample()} query="Synthetic group" searchOptions={{ mode: "equals", matchCase: false, scope: "title" }} />);
  expect(document.querySelector("[data-group-id]")).not.toBeNull(); expect(document.querySelectorAll("[data-row-id]")).toHaveLength(0);
});
it("V2 invalid aggregate drops and temporary group hiding preserve exact configuration", () => {
  const wire = examples.calls.find(call => call.command === "presentation.update")?.response;
  const result = parseUpdate(structuredClone(wire)); if (result.kind !== "updated" || result.presentation.configuration.version !== 2) throw new Error("fixture");
  const p = result.presentation as TreePresentation; const before = structuredClone(p.configuration); const changes = vi.fn();
  render(<TreePresentationView presentation={p} onConfigurationChange={changes} />);
  const grip = document.querySelector('[data-group-id] [draggable]'); const target = document.querySelector('[data-row-id]'); if (!grip || !target) throw new Error("targets");
  const count = document.querySelectorAll("[data-row-id]").length; const dataTransfer = { setData: vi.fn(), dropEffect: "move" };
  fireEvent.dragStart(grip, { dataTransfer }); expect(document.querySelectorAll("[data-row-id]").length).toBeLessThan(count);
  fireEvent.dragOver(target, { dataTransfer }); fireEvent.drop(target, { dataTransfer });
  expect(changes).not.toHaveBeenCalled(); expect(document.querySelectorAll("[data-row-id]")).toHaveLength(count); expect(p.configuration).toEqual(before);
});