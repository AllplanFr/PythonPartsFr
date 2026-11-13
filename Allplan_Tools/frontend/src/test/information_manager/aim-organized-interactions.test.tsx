import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "./synthetic-presentation.json";
import { isPresentation, isConfiguration, type Presentation } from "@/modules/information_manager/lib/aim-presentation-contract";
import { OrganizedPresentationView } from "@/modules/information_manager/components/organized-presentation";
import { ColumnsMenu } from "@/modules/information_manager/components/aim-columns";
import { moveLayout } from "@/modules/information_manager/lib/organized-layout";
import { useState } from "react";
const INFO = { id: "information_manager", protocol_version: 1, project_contract: 2, read_only: true, capabilities: ["project.select"], presentation_contract: 1, presentation_capabilities: ["presentation.import.prepare", "presentation.import.apply", "presentation.import.cancel", "presentation.get", "presentation.export"] };
vi.mock("@/shared/transport/native-binding", async (original) => ({ ...(await original<object>()), getVerifiedAppInfo: () => INFO }));
const { AimEditor } = await import("@/modules/information_manager/AimEditor");
function sample() {
  const raw: unknown = structuredClone(fixture.presentation);
  if (!isPresentation(raw)) throw new Error("Invalid synthetic fixture");
  const category = raw.configuration.categories[0]; const modelCategory = raw.model.categories[0];
  if (!category || !modelCategory) throw new Error("Missing synthetic category");
  category.groups.push({ id: "empty-group", position: 2, title: "Second synthetic group", backgroundColor: "#eeeeee", expanded: true, rows: [] });
  modelCategory.groups.push({ id: "empty-group", position: 2, title: "Second synthetic group", backgroundColor: "#eeeeee", expanded: true, rows: [] });
  raw.configuration.categories.push({ id: "second-category", position: 2, name: "Second synthetic category", icon: "", groups: [] });
  raw.model.categories.push({ id: "second-category", position: 2, name: "Second synthetic category", icon: "", groups: [] });
  return raw;
}
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const ids = () => [...document.querySelectorAll("[data-row-id]")].map((r) => r.getAttribute("data-row-id"));
const values = () => [...document.querySelectorAll("[data-row-id] [data-value-state]")].map((r) => r.textContent);
beforeEach(() => { localStorage.clear(); localStorage.setItem("information_manager:lang", "fr"); globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("column menu really changes organized headers and cells", async () => {
  const p = sample();
  function Screen() { const [columns, setColumns] = useState<("num" | "title" | "input" | "data")[]>(["num", "title"]); return <><ColumnsMenu label="Colonnes" value={columns} onChange={setColumns} options={[["num", "N°"], ["title", "Titre"], ["input", "Saisie"], ["data", "Donnée"]]} /><OrganizedPresentationView presentation={p} columns={columns} /></>; }
  render(<Screen />);
  expect(screen.queryByRole("columnheader", { name: "Saisie" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("button", { name: "Colonnes" }), { key: "ArrowDown" }); await flush();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Saisie" })); await flush();
  expect(screen.getByRole("columnheader", { name: "Saisie", hidden: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Titre" })); await flush();
  expect(screen.queryByRole("columnheader", { name: "Titre" })).toBeNull();
  expect(values()).toEqual(["", "", "0", " leading\nsynthetic|choice "]);
});
it("group selection does not collapse it; collapse and row focus are separate", () => {
  render(<OrganizedPresentationView presentation={sample()} />);
  fireEvent.click(screen.getByRole("button", { name: "Synthetic group" }));
  expect(document.querySelector('[data-group-id="synthetic-group"]')).toHaveAttribute("aria-selected", "true");
  expect(ids()).toHaveLength(4);
  fireEvent.focus(document.querySelector('[data-row-id="synthetic-row-3"]') as HTMLElement);
  expect(document.querySelector('[data-row-id="synthetic-row-3"]')).toHaveAttribute("aria-selected", "true");
  expect(document.querySelector('[data-group-id="synthetic-group"]')).toHaveAttribute("aria-selected", "false");
  fireEvent.click(screen.getByRole("button", { name: /Tout replier.*Synthetic group/ })); expect(ids()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /Tout déplier.*Synthetic group/ })); expect(ids()).toHaveLength(4);
});
it("moves repeated-number occurrences by ID, never changes Python rows, and preserves contiguous positions", () => {
  const p = sample(); const before = structuredClone(p.model); const changes = vi.fn();
  render(<OrganizedPresentationView presentation={p} onConfigurationChange={changes} />);
  expect(screen.queryByRole("button", { name: "Descendre synthetic-row-1" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Monter synthetic-row-1" })).toBeNull();
  const row = document.querySelector('[data-row-id="synthetic-row-1"]');
  if (!row) throw new Error("Missing row");
  fireEvent.keyDown(row, { altKey: true, key: "ArrowDown" });
  expect(ids()).toEqual(["synthetic-row-2", "synthetic-row-1", "synthetic-row-3", "synthetic-row-4"]);
  expect(p.model).toEqual(before); expect(values()).toEqual(["", "", "0", " leading\nsynthetic|choice "]);
  const config = changes.mock.calls[0]?.[0]; expect(isConfiguration(config)).toBe(true);
  expect(config.categories[0].groups[0].rows.map((r: { num: number }) => r.num)).toEqual([7, 7, 8, 9]);
});
it("row drop moves to another group and group drop to another category without model reconstruction", () => {
  const p = sample(); const changes = vi.fn(); render(<OrganizedPresentationView presentation={p} onConfigurationChange={changes} />);
  fireEvent.click(screen.getByRole("button", { name: "Synthetic category" }));
  const dataTransfer = { setData: vi.fn(), effectAllowed: "move" };
  const row = document.querySelector('[data-row-id="synthetic-row-3"]'); const group = document.querySelector('[data-group-id="empty-group"] td');
  if (!row || !group) throw new Error("Missing rendered targets");
  fireEvent.dragStart(row.querySelector("[draggable]") as HTMLElement, { dataTransfer }); fireEvent.dragOver(group, { dataTransfer }); fireEvent.drop(group, { dataTransfer });
  expect(within(group.closest("tbody") as HTMLElement).getAllByText("0")).toHaveLength(1);
  let config = changes.mock.calls.at(-1)?.[0]; expect(config.categories[0].groups[1].rows.map((r: { id: string }) => r.id)).toEqual(["synthetic-row-3"]);
  expect(isConfiguration(config)).toBe(true);
  fireEvent.dragStart(document.querySelector('[data-group-id="empty-group"] [draggable]') as HTMLElement, { dataTransfer });
  const category = screen.getByRole("button", { name: "Second synthetic category" }); fireEvent.dragOver(category, { dataTransfer }); fireEvent.drop(category, { dataTransfer });
  config = changes.mock.calls.at(-1)?.[0]; expect(config.categories[1].groups[0].id).toBe("empty-group"); expect(isConfiguration(config)).toBe(true);
  expect(p.model.categories[0]?.groups[1]?.rows).toEqual([]);
});
it("All and category views filter actual content, Outside reports missing contract data, search affects rows", () => {
  const p = sample(); const mounted = render(<OrganizedPresentationView presentation={p} />);
  expect(ids()).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Second synthetic category" })); expect(ids()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Toutes" })); expect(ids()).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); expect(ids()).toEqual([]); expect(screen.getByRole("status").textContent).toContain("Aucun projet chargé");
  fireEvent.click(screen.getByRole("button", { name: "Toutes" }));
  mounted.rerender(<OrganizedPresentationView presentation={p} query="Synthetic row 3" />); expect(ids()).toEqual(["synthetic-row-3"]);
});
it("one closed technical panel contains all diagnostics, not row content; blocking read error stays visible", () => {
  const p = sample(); p.model.prjatt.status = "error";
  render(<OrganizedPresentationView presentation={p} technicalDetails="synthetic-snapshot-diagnostic" />);
  const panel = screen.getByLabelText("project-technical-details") as HTMLDetailsElement; expect(panel.open).toBe(false);
  expect(within(panel).getByText("synthetic-snapshot-diagnostic")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Erreur de lecture");
  expect(within(screen.getByLabelText("global-diagnostics")).getAllByRole("listitem")).toHaveLength(68);
  for (const row of document.querySelectorAll("[data-row-id]")) expect(row.textContent).not.toContain("synthetic-snapshot-diagnostic");
});
it("configuration rejects no-op self/unknown moves and conserves all occurrence IDs", () => {
  const p = sample(); expect(moveLayout(p.configuration, { kind: "row", id: "synthetic-row-1", target: "missing" })).toBe(p.configuration);
  const next = moveLayout(p.configuration, { kind: "group", id: "empty-group", target: "synthetic-category", before: "synthetic-group" });
  expect(next.categories[0]?.groups.map((g) => g.id)).toEqual(["empty-group", "synthetic-group"]);
  expect(isConfiguration(next)).toBe(true); expect(p.configuration.categories[0]?.groups[0]?.id).toBe("synthetic-group");
});
it("real editor retains footer selection and presentation actions but blocks disk save and export", async () => {
  const p = sample(); const call = vi.fn(async (command: string, payload: Record<string, unknown>) => {
    if (command === "presentation.import.prepare") return { ok: true, status: "prepared", token: "11111111-1111-4111-8111-111111111111", candidate: p };
    if (command === "presentation.import.apply") return { ok: true, status: "applied", presentation: p };
    if (command === "presentation.export") return { ok: true, status: "exported", fileName: "synthetic.json", configurationId: (payload["configuration"] as Presentation["configuration"]).configurationId };
    throw new Error(command);
  });
  vi.stubGlobal("pywebview", { api: { get_initial_data: async () => structuredClone(fixture.initial), call } });
  render(createElement(AimEditor, { hostEnabled: false, limitedHost: true })); await flush();
  const choose = screen.getByRole("button", { name: /Choisir un projet Allplan/ }); expect(choose.closest('[data-menu-block]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Importer une présentation" })); await flush();
  fireEvent.click(screen.getByRole("button", { name: /Écraser/ })); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Tout replier" })); expect(ids()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Tout déplier" })); expect(ids()).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Ajouter un groupe" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Ajouter une ligne" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Ajouter une catégorie" })); fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "New synthetic category" } }); fireEvent.keyDown(screen.getByLabelText("Nom"), { key: "Enter" });
  expect(screen.getByRole("button", { name: "New synthetic category" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ajouter un groupe" }));
  const groupName = screen.getByLabelText("Nom du groupe");
  expect(groupName).toHaveFocus(); expect(groupName).toHaveValue("Nouveau groupe");
  fireEvent.change(groupName, { target: { value: "My new group" } }); fireEvent.keyDown(groupName, { key: "Enter" });
  expect(screen.getByRole("button", { name: "My new group" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ajouter une ligne" })); expect(screen.getByRole("dialog").textContent).toContain("Mise a jour en memoire indisponible"); fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annuler" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Enregistrer" })[0] as HTMLElement); await flush();
  expect(screen.getAllByRole("button", { name: "Enregistrer" })[0]).toBeDisabled();
  expect(call.mock.calls.some(([c]) => c === "presentation.export")).toBe(false);
  expect(p.model.categories).toHaveLength(2);
});

it("category rename and confirmed deletion preserve occurrence IDs, repetitions and Python values", () => {
  const p = sample(); const before = structuredClone(p.model); const changes = vi.fn();
  render(<OrganizedPresentationView presentation={p} onConfigurationChange={changes} />);
  fireEvent.click(screen.getByRole("button", { name: "Catégorie — Synthetic category" }));
  fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Renamed category" } });
  fireEvent.keyDown(screen.getByLabelText("Nom"), { key: "Enter" });
  const renamed = changes.mock.calls.at(-1)?.[0] as Presentation["configuration"];
  expect(renamed.categories[0]?.id).toBe("synthetic-category");
  expect(renamed.categories[0]?.name).toBe("Renamed category");
  expect(renamed.categories[0]?.groups[0]?.rows.map((r) => [r.id, r.num, r.position])).toEqual(p.configuration.categories[0]?.groups[0]?.rows.map((r) => [r.id, r.num, r.position]));
  fireEvent.click(screen.getByRole("button", { name: /Supprimer la catégorie.*Second synthetic category/ }));
  fireEvent.submit(screen.getByRole("dialog"));
  const removed = changes.mock.calls.at(-1)?.[0] as Presentation["configuration"];
  expect(removed.categories.map((c) => [c.id, c.position])).toEqual([["synthetic-category", 1]]);
  expect(isConfiguration(removed)).toBe(true);
  expect(p.model).toEqual(before);
  expect(ids()).toEqual(["synthetic-row-1", "synthetic-row-2", "synthetic-row-3", "synthetic-row-4"]);
  expect(values()).toEqual(["", "", "0", " leading\nsynthetic|choice "]);
});

it("removing a populated category deletes its own occurrences without transfer", () => {
  const p = sample(); const changes = vi.fn();
  render(<OrganizedPresentationView presentation={p} onConfigurationChange={changes} />);
  fireEvent.click(screen.getByRole("button", { name: /Supprimer la catégorie.*Synthetic category$/ }));
  fireEvent.submit(screen.getByRole("dialog"));
  const next = changes.mock.calls.at(-1)?.[0] as Presentation["configuration"];
  expect(next.categories.map((c) => c.id)).toEqual(["second-category"]);
  expect(next.categories[0]?.groups).toEqual([]);
  expect(p.configuration.categories[0]?.groups[0]?.rows).toHaveLength(4);
  expect(isConfiguration(next)).toBe(true);
});
