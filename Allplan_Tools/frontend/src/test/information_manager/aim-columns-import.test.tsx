import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AimEditor } from "@/modules/information_manager/AimEditor";
import examples from "../fixtures/aim-complete/backend-examples.json";
import v1 from "../fixtures/aim-update/12-add-repeated-occurrence-updated.json";
import { parseAimProjectSnapshot } from "@/modules/information_manager/lib/aim-project-contract";

const host = vi.hoisted(() => ({ info: null as unknown }));
vi.mock("@/shared/transport/native-binding", async original => ({ ...await original<object>(), getVerifiedAppInfo: () => host.info }));
const flush = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); };
beforeEach(() => { localStorage.clear(); localStorage.setItem("information_manager:lang", "fr"); globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount(version: number, imported = true) {
  host.info = { ...examples.identityCompatibleFutureFrontend, ...(version === 1 ? { presentation_tree_contract: undefined } : {}) };
  const reply = version === 1 ? structuredClone(v1) : structuredClone(examples.calls.find(c => c.command === "presentation.get")?.response);
  if (!reply || !("presentation" in reply)) throw new Error("Missing imported fixture");
  const source = structuredClone(reply.presentation);
  const snapshot = structuredClone(examples.snapshot);
  const outside = structuredClone(snapshot.data.attributes[0]);
  if (!outside) throw new Error("Missing native attribute fixture");
  outside.number = "10"; outside.label = "Outside synthetic attribute";
  outside.definition.number = "10"; outside.definition.uid = "synthetic-10";
  outside.definition.label = outside.label;
  snapshot.data.attributes.push(outside);
  expect(parseAimProjectSnapshot(snapshot)).not.toBeNull();
  const call = vi.fn(async (command: string) => {
    if (command === "presentation.import.prepare") return { ok: true, status: "prepared", token: "11111111-1111-4111-8111-111111111111", candidate: reply.presentation };
    if (command === "presentation.import.apply") return { ok: true, status: "applied", presentation: reply.presentation };
    return examples.calls.find(c => c.command === command)?.response;
  });
  vi.stubGlobal("pywebview", { api: { get_initial_data: async () => structuredClone(snapshot), call } });
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  if (imported) {
  fireEvent.click(screen.getByRole("button", { name: "Importer une présentation" })); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Écraser" })); await flush();
  }
  return { call, source, reply };
}
async function toggle(name: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: "Colonnes" }), { key: "ArrowDown" }); await flush();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name })); await flush();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" }); await flush();
}
const labels = ["N°", "Titre", "Valeur", "Saisie", "Donnée"];
const cases = [
  { name: "input only hidden", toggles: ["Saisie"], visible: ["N°", "Titre", "Valeur", "Donnée"] },
  { name: "data only hidden", toggles: ["Donnée"], visible: ["N°", "Titre", "Valeur", "Saisie"] },
  { name: "both hidden", toggles: ["Saisie", "Donnée"], visible: ["N°", "Titre", "Valeur"] },
  { name: "both restored", toggles: ["Saisie", "Donnée", "Saisie", "Donnée"], visible: labels },
];
for (const version of [1, 2]) for (const scenario of cases) it(`imported V${version}: ${scenario.name} affects headers, every cell and spans without mutations`, async () => {
  const { call, source, reply } = await mount(version);
  const root = screen.getByLabelText("organized-presentation");
  const originalRows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]"));
  const originalCells = originalRows.map(row => Array.from(row.cells));
  const ids = originalRows.map(row => row.dataset["rowId"]);
  const first = originalRows[0]; if (!first) throw new Error("Missing row");
  fireEvent.focus(first);
  const beforeCalls = call.mock.calls.length;
  for (const label of scenario.toggles) await toggle(label);
  expect(within(root).getAllByRole("columnheader").map(e => e.textContent)).toEqual(scenario.visible);
  expect(screen.getByRole("button", { name: "Colonnes" })).toHaveTextContent(`${scenario.visible.length - 1}/4`);
  const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]"));
  expect(rows.map(row => row.dataset["rowId"])).toEqual(ids);
  rows.forEach((row, i) => {
    expect(row.cells.length).toBe(scenario.visible.length);
    labels.forEach((label, index) => {
      const cell = originalCells[i]?.[index]; if (!cell) throw new Error("Missing initial cell");
      if (!scenario.visible.includes(label)) expect(row.contains(cell)).toBe(false);
      else {
        const current = row.cells[scenario.visible.indexOf(label)];
        if (!current) throw new Error("Visible column has no cell");
        if (label !== "Valeur") {
          expect(current.textContent).toBe(cell.textContent);
          expect(current.querySelectorAll("svg").length).toBe(cell.querySelectorAll("svg").length);
        }
      }
    });
    const id = row.dataset["rowId"]; if (!id) throw new Error("Missing identity");
    expect(within(row).getByRole("button", { name: `Éditer ${id}` })).toBeEnabled();
    expect(within(row).getByRole("button", { name: `Supprimer ${id}` })).toBeEnabled();
    expect(row.cells[scenario.visible.indexOf("Valeur")]?.textContent).toContain(originalCells[i]?.[2]?.textContent ?? "missing");
  });
  expect(first).toHaveAttribute("aria-selected", "true");
  root.querySelectorAll<HTMLTableCellElement>("td[colspan]").forEach(cell => expect(cell.colSpan).toBe(scenario.visible.length));
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); await flush();
  expect(within(root).getAllByRole("columnheader").map(e => e.textContent)).toEqual(scenario.visible);
  const outsideRows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  expect(outsideRows.length).toBeGreaterThan(0);
  outsideRows.forEach(row => { expect(row.cells.length).toBe(scenario.visible.length); expect(within(row).getByRole("button", { name: /Déplacer vers/ })).toBeEnabled(); });
  expect(call.mock.calls.slice(beforeCalls)).toEqual([]);
  expect(reply.presentation).toEqual(source);
});
it.each(["N°", "Titre"])("imported V2 hides and restores %s cells as well as its header", async label => {
  const { call } = await mount(2);
  const root = screen.getByLabelText("organized-presentation");
  const before = call.mock.calls.length;
  const initialRows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]"));
  const index = label === "N°" ? 0 : 1;
  const original = initialRows.map(row => row.cells[index]);
  await toggle(label);
  expect(within(root).queryByRole("columnheader", { name: label })).toBeNull();
  initialRows.forEach((row, i) => { expect(row.cells.length).toBe(4); expect(row.contains(original[i] ?? null)).toBe(false); });
  root.querySelectorAll<HTMLTableCellElement>("td[colspan]").forEach(cell => expect(cell.colSpan).toBe(4));
  await toggle(label);
  expect(within(root).getByRole("columnheader", { name: label })).toBeVisible();
  initialRows.forEach((row, i) => { expect(row.cells.length).toBe(5); expect(row.cells[index]?.textContent).toBe(original[i]?.textContent); });
  expect(call.mock.calls.slice(before)).toEqual([]);
});
for (const scenario of cases) it(`initial native table: ${scenario.name} respects visibility without configuration or commands`, async () => {
  const { call } = await mount(1, false);
  const root = screen.getByLabelText("aim-contract-attributes");
  const before = call.mock.calls.length;
  for (const label of scenario.toggles) await toggle(label);
  expect(within(root).getAllByRole("columnheader").map(e => e.textContent)).toEqual(scenario.visible);
  const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("tbody tr"));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.cells.length).toBe(scenario.visible.length);
    const number = row.dataset["attrNumber"];
    expect(within(row).getByRole("button", { name: `Déplacer vers ${number}` })).toBeDisabled();
    expect(within(row).getByRole("button", { name: `Éditer ${number}` })).toBeDisabled();
    expect(within(row).getByRole("button", { name: `Supprimer ${number}` })).toBeDisabled();
    expect(within(row).getByRole("button", { name: `Déplacer vers ${number}` }).closest("td")).toBe(row.cells[scenario.visible.indexOf(scenario.visible.includes("Donnée") ? "Donnée" : "Valeur")]);
  }
  expect(screen.queryByRole("button", { name: /Définir comme non renseigné/ })).toBeNull();
  expect(call.mock.calls.slice(before)).toEqual([]);
});
