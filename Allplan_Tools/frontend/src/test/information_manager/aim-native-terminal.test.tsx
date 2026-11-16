import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LOADED from "@/test/fixtures/aim-contract2/loaded.json";
import CANCELLED from "@/test/fixtures/aim-contract2/cancelled.json";
import REFUSED from "@/test/fixtures/aim-contract2/unrecognized.json";
import READ_ERROR from "@/test/fixtures/aim-contract2/read_error.json";
import fixture from "./synthetic-presentation.json";
import { isPresentation, type Presentation } from "@/modules/information_manager/lib/aim-presentation-contract";

const INFO = { id: "information_manager", protocol_version: 1, project_contract: 2, read_only: true,
  capabilities: ["project.select"], presentation_contract: 1, project_manager_contract: 1,
  presentation_capabilities: ["presentation.import.prepare", "presentation.import.apply", "presentation.import.cancel", "presentation.get", "presentation.export"] };
vi.mock("@/shared/transport/native-binding", async (original) => ({ ...(await original<object>()), getVerifiedAppInfo: () => INFO }));
const { AimEditor } = await import("@/modules/information_manager/AimEditor");
const TOKEN = "11111111-1111-4111-8111-111111111111";
const flush = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const choose = () => screen.getByRole("button", { name: /Choisir un projet Allplan/ });
const values = () => [...document.querySelectorAll("[data-row-id] [data-value-state]")].map((n) => n.textContent);
const pending = () => {
  let complete: (v: unknown) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<unknown>((resolve) => { complete = resolve; });
  return { promise, complete };
};
let call: ReturnType<typeof vi.fn>;
let p: Presentation;
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  localStorage.clear(); localStorage.setItem("information_manager:lang", "fr");
  const raw: unknown = structuredClone(fixture.presentation);
  if (!isPresentation(raw)) throw new Error("Invalid synthetic fixture");
  p = raw;
  call = vi.fn(async (command: string) => {
    if (command === "project.source") return { ok: true, source: { status: "resolved", version: "2024", verificationVersion: false, reason: null } };
    if (command === "project.manager.list") return { ok: true, projects: [] };
    if (command === "presentation.import.prepare") return { ok: true, status: "prepared", token: TOKEN, candidate: p };
    if (command === "presentation.import.apply") return { ok: true, status: "applied", presentation: p };
    if (command === "presentation.import.cancel") return { ok: true, status: "cancelled" };
    throw new Error(command);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount(initial: unknown = LOADED, getter: () => unknown = () => initial) {
  vi.stubGlobal("pywebview", { api: { get_initial_data: getter, call } });
  render(createElement(AimEditor, { hostEnabled: false, limitedHost: true })); await flush();
}
async function menu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Information Manager/i }), { key: "ArrowDown" }); await flush();
}
async function openImport(entry: "general" | "secondary" | "toolbar") {
  if (entry === "toolbar") fireEvent.click(screen.getByRole("button", { name: /Importer une présentation/ }));
  else { await menu(); fireEvent.click(screen.getByRole("menuitem", { name: /Importer une présentation/ })); }
  await flush();
}
async function imported() {
  await mount(); await openImport("secondary");
    fireEvent.click(screen.getByRole("button", { name: /Écraser/ })); await flush();
}
function terminal() {
  expect(document.querySelector("[data-host-phase]")?.getAttribute("data-host-phase")).not.toBe("loading");
  expect(document.querySelector('[aria-label="project-status"]')?.getAttribute("data-project-status")).not.toBe("loading");
  expect(choose()).toBeEnabled();
}

describe("AIM contract 2 terminal lifecycle, synthetic host", () => {
  it("manager footer Quitter uses the existing read-only exit path without native close or mutation", async () => {
    await imported();
    const old = values();
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Gestionnaire de projets" })); await flush();
    const commands = call.mock.calls.length;
    const footer = document.querySelector("footer");
    if (!footer) throw new Error("Missing footer");
    const exit = within(footer).getAllByRole("button", { name: /^Quitter$/ }).at(-1);
    if (!exit) throw new Error("Missing native footer exit");
    fireEvent.click(exit); await flush();
    expect(call.mock.calls.length).toBe(commands);
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText(/Fermez la fenêtre avec sa croix/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gestionnaire de projets" })); await flush();
    expect(values()).toEqual(old);
    close.mockRestore();
  });
  it("manager return preserves imported values and search without rereading the active project", async () => {
    await imported();
    const old = values();
    const search = screen.getByRole("textbox", { name: "Recherche" });
    fireEvent.change(search, { target: { value: "séparateur" } });
    const getCount = call.mock.calls.filter(([c]) => c === "presentation.get").length;
    fireEvent.click(screen.getByRole("button", { name: "Gestionnaire de projets" })); await flush();
    expect(screen.queryByRole("textbox", { name: "Recherche" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gestionnaire de projets" })); await flush();
    expect(screen.getByRole("textbox", { name: "Recherche" })).toHaveValue("séparateur");
    fireEvent.change(screen.getByRole("textbox", { name: "Recherche" }), { target: { value: "" } });
    expect(values()).toEqual(old);
    expect(call.mock.calls.filter(([c]) => c === "presentation.get")).toHaveLength(getCount);
  });
  it("initial fallback counters follow the received attributes, not browser rows", async () => {
    const deferred = pending();
    await mount(null, () => deferred.promise);
    const all = screen.getByText("Toutes").closest("div.group\\/cat");
    expect(all?.textContent).not.toMatch(/Toutes\s*0$/);
    deferred.complete(LOADED); await flush();
    expect(document.querySelectorAll("[data-attr-number]")).toHaveLength(LOADED.data.attributes.length);
    expect(screen.getByText("Toutes").closest("div.group\\/cat")?.textContent).toContain(String(LOADED.data.attributes.length));
    expect(screen.getByText("Hors présentation").closest("div.group\\/cat")?.textContent).toContain(String(LOADED.data.attributes.length));
  });
  it.each([LOADED, CANCELLED, REFUSED, READ_ERROR])("initial validated snapshot ends the host loading state", async (s) => { await mount(s); terminal(); });
  it.each(["exception", "rejection"])("initial %s ends loading", async (kind) => {
    await mount(null, () => { if (kind === "exception") throw new Error("synthetic"); return Promise.reject(new Error("synthetic")); });
    terminal(); expect(document.querySelector('[aria-label="project-status"]')?.getAttribute("data-project-status")).toBe("read-error");
  });
  it.each([
    ["success", { ok: true, data: LOADED }, "loaded"],
    ["cancellation", { ok: true, data: CANCELLED }, "cancelled"],
    ["refusal", { ok: false, data: { ...REFUSED, diagnostics: [{ ...REFUSED.diagnostics[0], code: "inventory_unavailable", message: "Inventaire synthétique inaccessible." }, ...REFUSED.diagnostics] }, error: { code: "project_selection_required", message: "Projet AIM non charge ; consulter les diagnostics." } }, "installation-required"],
    ["read error", { ok: false, data: READ_ERROR, error: { code: "project_read_error" } }, "read-error"],
  ])("%s ends loading after get and never restores old values", async (_name, reply, state) => {
    await imported();
    const oldConfiguration = structuredClone(p.configuration);
    const unavailable = structuredClone(p);
    for (const c of unavailable.model.categories) for (const g of c.groups) for (const r of g.rows) { r.valueState = "unavailable"; r.value = null; }
    unavailable.model.counts.set = 0; unavailable.model.counts.unset = 0; unavailable.model.counts.unavailable = 4;
    const get = pending();
    call.mockImplementation(async (command: string) => command === "project.select" ? reply : command === "presentation.get" ? get.promise : command === "presentation.export" ? { ok: true, status: "cancelled" } : null);
    fireEvent.click(choose()); await flush();
    expect(values()).toEqual([]); expect(choose()).toBeDisabled();
    get.complete({ ok: true, status: "current", presentation: unavailable }); await flush();
    terminal(); expect(document.querySelector('[aria-label="project-status"]')?.getAttribute("data-project-status")).toBe(state);
    const status = screen.getByLabelText("project-status");
    expect(status.getAttribute("title")).toBe(status.textContent);
    expect(values()).toEqual(Array(4).fill("Indisponible"));
    await menu(); fireEvent.click(screen.getByRole("menuitem", { name: /^Exporter/ })); await flush();
    expect(call.mock.calls.some(([c]) => c === "presentation.export")).toBe(false);
    if (state === "installation-required") {
      expect(screen.getByLabelText("project-status").textContent).toContain("Projet hors du PRJ");
      expect(screen.getByLabelText("project-status").textContent).not.toContain("project_selection_required");
      expect(status.textContent).not.toContain("Projet AIM non charge ; consulter les diagnostics.");
      expect(status.textContent).not.toContain("Inventaire synthétique inaccessible.");
    }
    if (state === "cancelled") {
      expect(status.textContent).toContain("Sélection annulée : aucun projet");
      expect(status.textContent).not.toContain("Sélection refusée par Python");
    }
  });
  it.each(["exception", "rejection", "invalid"])("selection %s ends loading and hides previous values", async (kind) => {
    await imported();
    call.mockImplementation((command: string) => {
      if (command !== "project.select") throw new Error(command);
      if (kind === "exception") throw new Error("synthetic");
      return kind === "rejection" ? Promise.reject(new Error("synthetic")) : Promise.resolve({ ok: true });
    });
    fireEvent.click(choose()); await flush(); terminal(); expect(values()).toEqual([]);
    expect(document.querySelector('[aria-label="project-status"]')?.getAttribute("data-project-status")).toBe("read-error");
  });
  it("refusal without snapshot keeps the configuration and the existing values as specified by contract 2", async () => {
    await imported(); const old = values();
    call.mockResolvedValueOnce({ ok: false, error: { code: "invalid", message: "Sélection indisponible." } });
    fireEvent.click(choose()); await flush(); terminal(); expect(values()).toEqual(old);
    expect(call.mock.calls.filter(([c]) => c === "presentation.get")).toHaveLength(0);
  });
  it.each([true, false])("generic refusal with inventory first allows another selection (precise cause: %s)", async (hasCause) => {
    await mount();
    const inventory = { ...REFUSED.diagnostics[0], code: "inventory_unavailable", message: "Inventaire synthétique inaccessible." };
    const reply = { ok: false, error: { code: "project_selection_required", message: "Projet AIM non charge ; consulter les diagnostics." }, data: { ...REFUSED, diagnostics: [inventory, ...(hasCause ? REFUSED.diagnostics : [])] } };
    call.mockImplementation(async (command: string) => command === "project.select" ? (call.mock.calls.filter(([c]) => c === "project.select").length === 1 ? reply : { ok: true, data: LOADED }) : { ok: true, source: { status: "resolved", version: "2024", verificationVersion: false, reason: null } });
    fireEvent.click(choose()); await flush(); terminal();
    // Inventory survives snapshot replacement, but is not treated as the selection cause.
    const { selectionReason } = await import("@/modules/information_manager/lib/aim-project");
    const status = screen.getByLabelText("project-status");
    expect(status.textContent).not.toContain(inventory.message);
    expect(status.textContent).not.toContain("Projet AIM non charge ; consulter les diagnostics.");
    expect(status.getAttribute("title")).toBe(status.textContent);
    if (hasCause) expect(status.textContent).toContain(REFUSED.diagnostics[0]?.message);
    else expect(status.textContent).toContain(selectionReason("fr", "unknown_selection_error"));
    fireEvent.click(choose()); await flush(); terminal();
    expect(call.mock.calls.filter(([c]) => c === "project.select")).toHaveLength(2);
    expect(screen.getByLabelText("project-status").getAttribute("data-project-status")).toBe("loaded");
  });
  it("keeps a specific Python refusal message visible and retry available", async () => {
    await mount();
    const message = "Le projet sélectionné appartient à une installation non autorisée par ce lanceur.";
    call.mockResolvedValueOnce({ ok: false, error: { code: "project_selection_required", message }, data: REFUSED });
    fireEvent.click(choose()); await flush(); terminal();
    const status = screen.getByLabelText("project-status");
    expect(status.textContent).toContain(message);
    expect(status.getAttribute("title")).toBe(status.textContent);
  });
  it("successful Python fallback to the latest installation is shown as loaded, details collapsed, not on rows", async () => {
    await mount();
    const fallback = { ...REFUSED.diagnostics[0], severity: "warning", code: "installation_fallback_latest", message: "Repli synthétique sur la dernière installation." };
    const inventory = { ...REFUSED.diagnostics[0], severity: "error", code: "inventory_unavailable", message: "Inventaire synthétique inaccessible." };
    call.mockResolvedValueOnce({ ok: true, data: { ...LOADED, diagnostics: [fallback, inventory, ...LOADED.diagnostics] } });
    fireEvent.click(choose()); await flush(); terminal();
    const status = screen.getByLabelText("project-status");
    expect(status.getAttribute("data-project-status")).toBe("loaded");
    expect(status.textContent).not.toContain("Sélection refusée");
    expect(status.className).not.toContain("text-destructive");
    // Successful load: no technical details in normal navigation.
    expect(screen.queryByLabelText("project-technical-details")).toBeNull();
    for (const row of document.querySelectorAll("[data-row-id]")) expect(row.textContent).not.toContain(fallback.message);
  });
});

describe("real menu and toolbar share native import", () => {
  it.each(["general", "secondary", "toolbar"] as const)("%s preserves preview, cancellation and confirmed replacement", async (entry) => {
    await imported(); const old = values();
    const legacy = vi.spyOn(HTMLInputElement.prototype, "click");
    await openImport(entry);
    expect(call.mock.calls.filter(([c]) => c === "presentation.import.prepare")).toHaveLength(2);
    expect(legacy).not.toHaveBeenCalled(); expect(values()).toEqual(old);
    fireEvent.click(screen.getAllByRole("button", { name: "Annuler" }).at(-1) ?? screen.getByRole("dialog")); await flush();
    expect(call).toHaveBeenCalledWith("presentation.import.cancel", { token: TOKEN }); expect(values()).toEqual(old);
    await openImport(entry);
    expect(values()).toEqual(old);
    fireEvent.click(screen.getByRole("button", { name: /Écraser/ })); await flush();
    expect(call.mock.calls.filter(([c]) => c === "presentation.import.apply")).toHaveLength(2);
    expect(values()).toEqual(["", "", "0", " leading\nsynthetic|choice "]); legacy.mockRestore();
  });
});