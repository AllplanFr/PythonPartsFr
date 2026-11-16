import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import loaded from "../fixtures/aim-update/01-project-loaded.json";
import repeated from "../fixtures/aim-update/12-add-repeated-occurrence-updated.json";
import identity from "../fixtures/aim-update/21-host-identity-update.json";
import examples from "../fixtures/aim-complete/backend-examples.json";
import { AimEditor } from "@/modules/information_manager/AimEditor";
import { useAppDialog } from "@/lib/app-dialog";

const host = vi.hoisted(() => ({ info: null as unknown }));
vi.mock("@/shared/transport/native-binding", async original => ({ ...await original<object>(), getVerifiedAppInfo: () => host.info }));
const flush = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); }); };
beforeEach(() => { localStorage.clear(); localStorage.setItem("information_manager:lang", "fr"); globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAppDialog.setState({ queue: [] }); });

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
function withOutside(snapshot: Any) {
  const s = structuredClone(snapshot);
  const outside = structuredClone(s.data.attributes[0]);
  outside.number = "10"; outside.label = "Outside synthetic attribute"; outside.value = null; outside.valueState = "unset";
  outside.definition.number = "10"; outside.definition.uid = "synthetic-10"; outside.definition.label = outside.label;
  s.data.attributes.push(outside);
  return s;
}
function setRows(node: Any, number: string, value: string | null) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => setRows(n, number, value)); return; }
  if (node.number === number && "valueState" in node) { node.value = value; node.valueState = value === null ? "unset" : "set"; }
  Object.values(node).forEach(v => setRows(v, number, value));
}
async function mount(version: 1 | 2, readOnly = false, widget?: Record<string, Any>, confirmedValue?: string) {
  const base = version === 1 ? identity : examples.identityCompatibleFutureFrontend;
  host.info = { ...base, read_only: readOnly, working_state_contract: 1 };
  const source = withOutside(version === 1 ? loaded : examples.snapshot);
  const p: Any = structuredClone(version === 1 ? repeated.presentation : (examples.calls.find(c => c.command === "presentation.get")?.response as Any).presentation);
  if (widget) (function patch(n: Any) { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach(patch); return; } if (n.number === "7" && "widget" in n) { Object.assign(n, widget); if (widget["widget"] === "checkbox") delete n.type; } Object.values(n).forEach(patch); })(p.model);
  const w: Any = { revision: 0, source: structuredClone(source), data: structuredClone(source.data), draftValues: {}, pendingImport: false, presentation: { ...p, model: { ...p.model, readOnly: false } }, dirty: { values: false, presentation: false, any: false }, fileSaveAvailable: false, prjtoolsAvailable: false };
  if (confirmedValue !== undefined) { setRows(w.data, "7", confirmedValue); setRows(w.presentation.model, "7", confirmedValue); }
  const call = vi.fn(async (command: string, payload: Record<string, Any>) => {
    if (command === "work.get") return { ok: true, status: "current", work: structuredClone(w) };
    if (command === "work.value.set") {
      expect(payload["revision"]).toBe(w.revision);
      w.revision++; w.draftValues = { ...w.draftValues, [payload["number"]]: payload["value"] }; w.dirty = { values: true, presentation: false, any: true };
      setRows(w.data, payload["number"], payload["value"]); setRows(w.presentation.model, payload["number"], payload["value"]);
      return { ok: true, status: "updated", work: structuredClone(w) };
    }
    return examples.calls.find(c => c.command === command)?.response ?? { ok: false, error: { code: "unexpected", message: command } };
  });
  vi.stubGlobal("pywebview", { api: { get_initial_data: async () => structuredClone(source), call } });
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  return { call, w, configuration: structuredClone(w.presentation.configuration) };
}
const box = (n: string) => screen.getAllByRole("textbox", { name: `Modifier la valeur ${n}` })[0] as HTMLInputElement;
const mutations = (call: Any) => call.mock.calls.map((c: Any) => c[0]).filter((c: string) => !["work.get", "presentation.get", "project.source"].includes(c));

const noUnset = () => expect(screen.queryByRole("button", { name: /Définir comme non renseigné/ })).toBeNull();
const sets = (call: Any) => call.mock.calls.filter((c: Any) => c[0] === "work.value.set").map((c: Any) => c[1]);

it.each([1, 2] as const)("V%s Hors présentation: direct STR input, Enter sends one work.value.set, attribute stays outside", async version => {
  const { call, w, configuration } = await mount(version);
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); await flush();
  const cell = box("10");
  expect(cell.value).toBe("");
  fireEvent.change(cell, { target: { value: "Texte libre 12" } });
  fireEvent.keyDown(cell, { key: "Enter" }); fireEvent.blur(cell); await flush();
  expect(call.mock.calls.filter((c: Any) => c[0] === "work.value.set")).toEqual([["work.value.set", { revision: 0, number: "10", value: "Texte libre 12" }]]);
  expect(mutations(call)).toEqual(["work.value.set"]);
  expect(w.presentation.configuration).toEqual(configuration);
  expect(box("10").value).toBe("Texte libre 12");
  expect(w.source.data.attributes.find((a: Any) => a.number === "10").value).toBeNull();
});

it("null initial: focus/blur and Escape send nothing; typing then clearing sends exactly one \"\"", async () => {
  const { call } = await mount(1);
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); await flush();
  fireEvent.focus(box("10")); fireEvent.blur(box("10")); await flush();
  expect(mutations(call)).toEqual([]);
  fireEvent.change(box("10"), { target: { value: "abc" } }); fireEvent.keyDown(box("10"), { key: "Escape" }); fireEvent.blur(box("10")); await flush();
  expect(box("10").value).toBe("");
  noUnset();
  expect(mutations(call)).toEqual([]);
  fireEvent.change(box("10"), { target: { value: "x" } }); fireEvent.change(box("10"), { target: { value: "" } });
  fireEvent.keyDown(box("10"), { key: "Enter" }); fireEvent.blur(box("10")); await flush();
  expect(sets(call)).toEqual([{ revision: 0, number: "10", value: "" }]);
});

it("\"\" initial without net change sends nothing", async () => {
  const { call } = await mount(1);
  fireEvent.change(box("7"), { target: { value: "" } }); fireEvent.blur(box("7")); await flush();
  expect(sets(call)).toHaveLength(1);
  fireEvent.change(box("7"), { target: { value: "y" } }); fireEvent.change(box("7"), { target: { value: "" } }); fireEvent.blur(box("7")); await flush();
  expect(sets(call)).toEqual([{ revision: 0, number: "7", value: "" }]);
});

it("presentation rows reuse ValueEditor in place, without a value dialog", async () => {
  const { call } = await mount(1);
  const cell = box("7");
  expect(cell.value).toBe("0");
  fireEvent.change(cell, { target: { value: "0" } }); fireEvent.blur(cell); await flush();
  expect(mutations(call)).toEqual([]);
  fireEvent.change(cell, { target: { value: "Neu" } }); fireEvent.blur(cell); await flush();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(call).toHaveBeenCalledWith("work.value.set", { revision: 0, number: "7", value: "Neu" });
  expect(screen.getAllByRole("textbox", { name: "Modifier la valeur 7" }).map(e => (e as HTMLInputElement).value)).toEqual(["Neu", "Neu"]);
});

it("global read_only keeps every value cell locked", async () => {
  const { call } = await mount(1, true);
  expect(box("7")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); await flush();
  expect(box("10")).toBeDisabled();
  expect(mutations(call)).toEqual([]);
});


it("null, empty string and zero remain distinct without an unset action", async () => {
  const { call, w } = await mount(1);
  noUnset();
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); await flush();
  expect(w.data.attributes.find((a: Any) => a.number === "10").value).toBeNull();
  fireEvent.change(box("10"), { target: { value: "x" } }); fireEvent.change(box("10"), { target: { value: "" } }); fireEvent.blur(box("10")); await flush();
  fireEvent.change(box("10"), { target: { value: "0" } }); fireEvent.blur(box("10")); await flush();
  expect(sets(call).map((p: Any) => p.value)).toEqual(["", "0"]);
  expect(w.source.data.attributes.find((a: Any) => a.number === "10").value).toBeNull();
  noUnset();
});

it("stale_work keeps the draft, shows non-acceptance and does not retry", async () => {
  const { call } = await mount(1);
  const original = call.getMockImplementation()!;
  call.mockImplementation(async (c: string, p: Any) => c === "work.value.set" ? { ok: false, error: { code: "stale_work", message: "Révision périmée" } } : original(c, p));
  fireEvent.change(box("7"), { target: { value: "Neu" } }); fireEvent.blur(box("7")); await flush();
  expect(sets(call)).toHaveLength(1);
  expect(box("7").value).toBe("Neu");
  expect(screen.getAllByRole("alert").some(a => a.textContent?.includes("non acceptée"))).toBe(true);
});

it.each([
  ["list", { widget: "list", type: "STR", options: ["A", "B"] }, "combobox"],
  ["checkbox", { widget: "checkbox" }, "checkbox"],
] as const)("configured %s: removing unset leaves the control intact with Data hidden, without mutation", async (_n, widget, role) => {
  const { call } = await mount(1, false, { ...widget, value: "1" });
  fireEvent.keyDown(screen.getByRole("button", { name: "Colonnes" }), { key: "ArrowDown" }); await flush();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Donnée" })); await flush();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" }); await flush();
  expect(screen.queryByRole("columnheader", { name: "Donnée" })).toBeNull();
  expect(screen.getAllByRole(role, { name: "Modifier la valeur 7" }).length).toBeGreaterThan(0);
  noUnset();
  expect(sets(call)).toEqual([]);
});

it.each([null, "", "0"] as const)("Reset restores exact Python source %s, suppresses draft blur and hides after confirmation", async source => {
  const { call, w } = await mount(2);
  w.source.data.attributes.find((a: Any) => a.number === "10").value = source;
  w.source.data.attributes.find((a: Any) => a.number === "10").valueState = source === null ? "unset" : "set";
  setRows(w.data, "10", source);
  // Adopt the changed synthetic host source, not a mount-time reference.
  fireEvent.change(box("7"), { target: { value: "refresh" } }); fireEvent.blur(box("7")); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); await flush();
  expect(screen.queryByRole("button", { name: "Reset 10" })).toBeNull();
  fireEvent.change(box("10"), { target: { value: "changed" } }); fireEvent.blur(box("10")); await flush();
  const reset = screen.getByRole("button", { name: "Reset 10" });
  fireEvent.change(box("10"), { target: { value: "unsent draft" } });
  fireEvent.pointerDown(reset); fireEvent.blur(box("10"), { relatedTarget: reset }); fireEvent.click(reset); await flush();
  expect(sets(call).filter((p: Any) => p.number === "10").map((p: Any) => p.value)).toEqual(["changed", source]);
  expect(box("10").value).toBe(source ?? "");
  expect(screen.queryByRole("button", { name: "Reset 10" })).toBeNull();
  expect(box("10").closest("fieldset")?.querySelector("[data-reset-slot]")).not.toBeNull();
  expect(w.source.data.attributes.find((a: Any) => a.number === "10").value).toBe(source);
});

it("Reset disappears after a normal confirmed return to source", async () => {
  const { call } = await mount(1);
  fireEvent.change(box("7"), { target: { value: "changed" } }); fireEvent.blur(box("7")); await flush();
  expect(screen.getAllByRole("button", { name: "Reset 7" })).toHaveLength(2);
  fireEvent.change(box("7"), { target: { value: "0" } }); fireEvent.blur(box("7")); await flush();
  expect(screen.queryByRole("button", { name: "Reset 7" })).toBeNull();
  expect(sets(call).map((p: Any) => p.value)).toEqual(["changed", "0"]);
});

it("read_only locks Reset despite a confirmed value different from source", async () => {
  const { call } = await mount(1, true, undefined, "changed");
  const reset = screen.getAllByRole("button", { name: "Reset 7" })[0];
  if (!reset) throw new Error("Reset missing for changed confirmed value");
  expect(reset).toBeDisabled();
  fireEvent.click(reset); await flush();
  expect(sets(call)).toEqual([]);
});

it("in-flight Reset is locked and never sends a draft or a second mutation", async () => {
  const { call } = await mount(1);
  fireEvent.change(box("7"), { target: { value: "changed" } }); fireEvent.blur(box("7")); await flush();
  const original = call.getMockImplementation();
  if (!original) throw new Error("mock implementation missing");
  let complete: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  call.mockImplementation(async (c: string, p: Any) => { if (c === "work.value.set") await pending; return original(c, p); });
  const reset = screen.getAllByRole("button", { name: "Reset 7" })[0];
  if (!reset) throw new Error("Reset missing");
  fireEvent.click(reset); await flush();
  expect(reset).toBeDisabled();
  fireEvent.click(reset); await flush();
  expect(sets(call).map((p: Any) => p.value)).toEqual(["changed", "0"]);
  complete?.(); await flush();
  expect(screen.queryByRole("button", { name: "Reset 7" })).toBeNull();
});

it.each([1, 2] as const)("V%s visible Data hands STR help to disabled actions on hover and keyboard focus", async version => {
  const { call } = await mount(version);
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); await flush();
  const row = box("10").closest("tr");
  if (!row) throw new Error("outside row missing");
  const glyph = row.querySelector('td[title="STR"] svg, span[title="STR"] svg');
  if (!glyph) throw new Error("STR icon missing");
  const anchor = glyph.closest('[title="STR"]');
  if (!anchor) throw new Error("STR help anchor missing");
  for (const action of ["Éditer", "Supprimer"]) {
    const help = within(row).getByLabelText(`${action} 10 — Non disponible`);
    fireEvent.mouseOver(glyph);
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent(/^STR$/));
    fireEvent.mouseOut(glyph, { relatedTarget: help });
    fireEvent.mouseOver(help, { relatedTarget: glyph });
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Non disponible"));
    fireEvent.mouseOut(help, { relatedTarget: document.body });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseOver(glyph);
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent(/^STR$/));
    fireEvent.mouseOut(glyph, { relatedTarget: document.body });
    act(() => help.focus());
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Non disponible"));
    expect(help).toHaveFocus();
    expect(within(row).getByRole("button", { name: `${action} 10` })).toBeDisabled();
    act(() => help.blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
  }
  expect(mutations(call)).toEqual([]);
});

it.each([1, 2] as const)("V%s outside actions remain available in Value with Data hidden; disabled help works on focus", async version => {
  const { call } = await mount(version);
  fireEvent.click(screen.getByRole("button", { name: "Hors présentation" })); await flush();
  fireEvent.keyDown(screen.getByRole("button", { name: "Colonnes" }), { key: "ArrowDown" }); await flush();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Donnée" })); await flush();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" }); await flush();
  const row = box("10").closest("tr");
  if (!row) throw new Error("outside row missing");
  expect(within(row).getByRole("button", { name: "Éditer 10" })).toBeDisabled();
  expect(within(row).getByRole("button", { name: "Supprimer 10" })).toBeDisabled();
  const help = within(row).getByLabelText("Éditer 10 — Non disponible");
  // Let the menu finish restoring focus before exercising the user's next focus move.
  await waitFor(() => expect(screen.getByRole("button", { name: "Colonnes" })).toHaveFocus());
  act(() => help.focus());
  await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Non disponible"));
  expect(help).toHaveFocus();
  const move = within(row).getByRole("button", { name: "Déplacer vers 10" });
  expect(move.closest("td")).toBe(box("10").closest("td"));
  fireEvent.keyDown(move, { key: "ArrowDown" }); await flush();
  expect(screen.getByRole("menu")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" }); await flush();
  expect(mutations(call)).toEqual([]);
});
