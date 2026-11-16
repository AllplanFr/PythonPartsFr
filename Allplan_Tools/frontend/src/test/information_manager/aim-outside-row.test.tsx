import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "./synthetic-presentation.json";
import examples from "../fixtures/aim-complete/backend-examples.json";
import { OrganizedPresentationView } from "@/modules/information_manager/components/organized-presentation";
import { TreePresentationView } from "@/modules/information_manager/components/tree-presentation";
import { isPresentation } from "@/modules/information_manager/lib/aim-presentation-contract";
import type { TreePresentation } from "@/modules/information_manager/lib/presentation-tree";
import type { ColumnKey } from "@/modules/information_manager/components/aim-columns";

beforeEach(() => { globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(cleanup);
const outside = [{ number: "10", label: "Unconfigured attribute", valueState: "set" as const, value: "source" }];
const flush = async () => { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); };
function mount(version: 1 | 2, busy = false, columns: ColumnKey[] = ["num", "title", "input", "data"]) {
  const add = vi.fn(), change = vi.fn();
  if (version === 1) {
    const p = structuredClone(fixture.presentation);
    if (!isPresentation(p)) throw new Error("invalid V1 fixture");
    render(<OrganizedPresentationView presentation={p} onAddOccurrence={add} onConfigurationChange={change} outside={outside} busy={busy} columns={columns} />);
    return { add, change, target: p.configuration.categories[0]?.groups[0]?.id, title: p.configuration.categories[0]?.groups[0]?.title, category: p.configuration.categories[0]?.name };
  }
  const p = structuredClone(examples.calls.find(c => c.command === "presentation.get")?.response) as { presentation: TreePresentation };
  render(<TreePresentationView presentation={p.presentation} onAddOccurrence={add} onConfigurationChange={change} outside={outside} busy={busy} columns={columns} />);
  const cat = p.presentation.configuration.categories[0];
  const group = cat?.children.find(c => c.kind === "group");
  return { add, change, target: group?.id, title: group?.kind === "group" ? group.title : undefined, category: cat?.name };
}

it.each([1, 2] as const)("V%s outside menu uses existing add-occurrence route, never value mutation or fake occurrence movement", async version => {
  const { add, change, target, title } = mount(version);
  if (!target || !title) throw new Error("missing destination");
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" }));
  const row = screen.getByText("Unconfigured attribute").closest("tr");
  if (!row) throw new Error("missing row");
  expect(row.querySelector('td[title="STR"] svg, span[title="STR"] svg')).not.toBeNull();
  expect(row.querySelector('td[title="Saisie libre"] svg')).not.toBeNull();
  expect(within(row).getByRole("button", { name: "Éditer 10" })).toBeDisabled();
  expect(within(row).getByRole("button", { name: "Supprimer 10" })).toBeDisabled();
  fireEvent.keyDown(within(row).getByRole("button", { name: "Déplacer vers 10" }), { key: "ArrowDown" }); await flush();
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(title) })); await flush();
  expect(add).toHaveBeenCalledExactlyOnceWith("10", target);
  expect(change).not.toHaveBeenCalled();
});

it.each([1, 2] as const)("V%s outside grip reaches existing group add route and cancellation sends nothing", async version => {
  const { add, change, target, category } = mount(version);
  if (!target || !category) throw new Error("missing destination");
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" }));
  const grip = screen.getByLabelText("Déplacer la ligne 10");
  const dt = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: "" };
  fireEvent.dragStart(grip, { dataTransfer: dt });
  expect(dt.setData).toHaveBeenCalledWith("application/x-aim-layout", "outside-10");
  fireEvent.dragEnd(grip, { dataTransfer: dt });
  expect(add).not.toHaveBeenCalled();
  fireEvent.dragStart(grip, { dataTransfer: dt });
  fireEvent.click(screen.getByRole("button", { name: category }));
  const destination = document.querySelector(`[data-group-id="${target}"] td`);
  if (!destination) throw new Error("missing group drop target");
  fireEvent.dragOver(destination, { dataTransfer: dt });
  fireEvent.drop(destination, { dataTransfer: dt });
  expect(add).toHaveBeenCalledExactlyOnceWith("10", target);
  expect(change).not.toHaveBeenCalled();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(document.querySelector("[data-aim-drag-ghost]")).toBeNull();
});

it.each([1, 2] as const)("V%s busy blocks outside grip and move; column masking retains actions", async version => {
  const { add } = mount(version, true, ["num", "title"]);
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" }));
  const grip = screen.getByLabelText("Déplacer la ligne 10");
  expect(grip).toHaveAttribute("draggable", "false");
  expect(screen.getByRole("button", { name: "Déplacer vers 10" })).toBeDisabled();
  expect(screen.queryByRole("columnheader", { name: "Donnée" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Saisie" })).toBeNull();
  expect(screen.getByRole("button", { name: "Éditer 10" }).closest("td")).toBe(grip.closest("tr")?.lastElementChild);
  fireEvent.dragStart(grip, { dataTransfer: { setData: vi.fn(), setDragImage: vi.fn() } });
  expect(add).not.toHaveBeenCalled();
});

it("V2 outside destination creation submits configuration and insertion together through the existing callback", async () => {
  const { add, change } = mount(2);
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Déplacer vers 10" }), { key: "ArrowDown" }); await flush();
  fireEvent.click(screen.getByRole("menuitem", { name: "Nouvelle catégorie…" })); await flush();
  fireEvent.change(screen.getByRole("dialog").querySelector("input") as HTMLInputElement, { target: { value: "New destination" } });
  fireEvent.click(screen.getByRole("button", { name: "Appliquer" })); await flush();
  expect(add).toHaveBeenCalledTimes(1);
  const [number, target, configuration] = add.mock.calls[0] ?? [];
  expect(number).toBe("10");
  expect(configuration.categories.at(-1)).toMatchObject({ id: target, name: "New destination", children: [] });
  expect(change).not.toHaveBeenCalled();
});
