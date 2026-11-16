import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as catalog from "@/modules/information_manager/lib/attribute-catalog";
import { aimProjectContract, parseRecentResponse, parseAimProjectSnapshot, parseSelectResponse, snapshotStatus } from "@/modules/information_manager/lib/aim-project-contract";
// TEST FIXTURES ONLY — contract-2 snapshots copied verbatim from AIM_PROJECT_READING.md, never runtime data.
import LOADED from "@/test/fixtures/aim-contract2/loaded.json";
import MISSING from "@/test/fixtures/aim-contract2/missing.json";
import READ_ERROR from "@/test/fixtures/aim-contract2/read_error.json";
import UNRECOGNIZED from "@/test/fixtures/aim-contract2/unrecognized.json";
import AMBIGUOUS from "@/test/fixtures/aim-contract2/ambiguous.json";
import DEFS_UNAVAILABLE from "@/test/fixtures/aim-contract2/definitions_unavailable.json";
import CANCELLED from "@/test/fixtures/aim-contract2/cancelled.json";

const APP_INFO = { id: "information_manager", title: "Allplan Information Manager — Gestion des informations", protocol_version: 1, capabilities: ["project.select"], read_only: true, project_contract: 2 };
let appInfo: unknown = APP_INFO;
vi.mock("@/shared/transport/native-binding", async (orig) => ({ ...(await orig<object>()), getVerifiedAppInfo: () => appInfo }));
const { AimEditor } = await import("@/modules/information_manager/AimEditor");

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ok = (data: unknown) => ({ ok: true, data });
const fail = (data: unknown, code: string) => ({ ok: false, data, error: { code, message: "Projet AIM non charge ; consulter les diagnostics." } });
const status = () => document.querySelector('[aria-label="project-status"]')?.getAttribute("data-project-status");
const rows = () => [...document.querySelectorAll("[data-attr-number]")].map((r) => ({ n: r.getAttribute("data-attr-number"), s: r.getAttribute("data-value-state"), v: r.querySelector("[data-value-state]")?.textContent ?? null }));
const button = () => screen.getByRole("button", { name: /Choisir un projet Allplan|Choose an Allplan project/ });
let call: ReturnType<typeof vi.fn>;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const mount = async (initial: unknown) => {
  (window as unknown as { pywebview: unknown }).pywebview = { api: { get_initial_data: vi.fn(async () => initial), call } };
  render(createElement(AimEditor, { hostEnabled: false, limitedHost: true }));
  await flush();
};
const select = async (reply: unknown) => { call.mockResolvedValueOnce(reply); await act(async () => { fireEvent.click(button()); await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  localStorage.clear(); catalog.setCatalog([]); appInfo = APP_INFO; call = vi.fn();
});
afterEach(() => { cleanup(); delete (window as unknown as { pywebview?: unknown }).pywebview; });

describe("AIM contract 2: identity", () => {
  it("exact identity is recognised with the select capability", () => {
    expect(aimProjectContract(APP_INFO)).toEqual({ recognized: true, readOnly: true, canSelect: true, history: false });
  });
  it.each([
    ["contract 1", { project_contract: 1 }], ["string contract", { project_contract: "2" }], ["boolean contract", { project_contract: true }],
    ["protocol 2", { protocol_version: 2 }], ["not read-only", { read_only: false }], ["extra capability", { capabilities: ["project.select", "x"] }],
    ["other id", { id: "vob_editor" }], ["missing contract", { project_contract: undefined }],
  ])("%s is incompatible", (_, over) => {
    expect(aimProjectContract({ ...APP_INFO, ...over }).recognized).toBe(false);
  });
});

describe("AIM contract 2: snapshot structure", () => {
  it("all documented snapshots are accepted", () => {
    for (const s of [LOADED, MISSING, READ_ERROR, UNRECOGNIZED, AMBIGUOUS, DEFS_UNAVAILABLE, CANCELLED]) expect(parseAimProjectSnapshot(s)).not.toBeNull();
  });
  it("statuses come from selection/prjatt/definitions/codes", () => {
    const st = (s: unknown) => snapshotStatus(parseAimProjectSnapshot(s)!);
    expect([st(LOADED), st(MISSING), st(READ_ERROR), st(UNRECOGNIZED), st(AMBIGUOUS), st(DEFS_UNAVAILABLE), st(CANCELLED)])
      .toEqual(["loaded", "no-attributes", "read-error", "installation-required", "installation-ambiguous", "definitions-unavailable", "cancelled"]);
  });
  it.each([
    ["contract-1 data shape", (s: any) => { s.data = { catalog: [], values: {} }; }],
    ["extra data key", (s: any) => { s.data.values = {}; }],
    ["wrong contract", (s: any) => { s.project_contract = 1; }],
    ["set with null value", (s: any) => { s.data.attributes[0].value = null; }],
    ["unset with value", (s: any) => { s.data.attributes[0].valueState = "unset"; }],
    ["unknown state", (s: any) => { s.data.attributes[0].valueState = "empty"; }],
    ["label mismatch", (s: any) => { s.data.attributes[0].definition.label = "Other"; }],
    ["group bit missing", (s: any) => { s.data.attributes[0].definition.group_mask = 1; }],
    ["omitted definition key", (s: any) => { delete s.data.attributes[0].definition.unit; }],
    ["diagnostic key missing", (s: any) => { s.diagnostics = [{ code: "x", severity: "info", message: "" }]; }],
    ["leading zero number", (s: any) => { s.data.attributes[0].number = "07"; s.data.attributes[0].definition.number = "07"; }],
  ])("rejects %s", (_, mutate) => {
    const s = clone(LOADED); mutate(s); expect(parseAimProjectSnapshot(s)).toBeNull();
  });
  it("envelopes: data replaces even when ok:false; refusal without data changes nothing", () => {
    expect(parseSelectResponse(fail(READ_ERROR, "project_read_error"))).toMatchObject({ kind: "snapshot", error: "project_read_error" });
    expect(parseSelectResponse({ ok: false, error: { code: "invalid", message: "" } })).toEqual({ kind: "refused", error: "invalid" });
    expect(parseSelectResponse(ok({ ...clone(LOADED), project_contract: 1 }))).toEqual({ kind: "invalid" });
  });
});

describe("AIM contract 2: editor display", () => {
  it("initial snapshot: rows shown as received, '0' kept, read-only, no browser catalog", async () => {
    await mount(LOADED);
    expect(status()).toBe("loaded");
    expect(rows()).toEqual([{ n: "7", s: "set", v: "0" }]);
    expect(document.querySelector("[data-attr-number] [data-value-state]")?.getAttribute("aria-readonly")).toBe("true");
    expect(document.querySelector("[data-attr-number] input")).toBeNull();
    // No "État" column at startup.
    expect(screen.queryByRole("columnheader", { name: /État|State|Status/ })).toBeNull();
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).not.toContain("État");
    expect(catalog.CATALOG).toEqual([]);
    expect(button()).toBeEnabled();
  });
  it("missing prjatt: unset rows, never '0'", async () => {
    await mount(MISSING);
    expect(status()).toBe("no-attributes");
    expect(rows()).toEqual([{ n: "7", s: "unset", v: "Non renseigné" }]);
  });
  it("project.select sends exactly {} and a read error replaces the previous values", async () => {
    await mount(LOADED);
    await select(fail(READ_ERROR, "project_read_error"));
    expect(call).toHaveBeenCalledWith("project.select", {});
    expect(call.mock.calls[0]?.[1]).toEqual({});
    expect(status()).toBe("read-error");
    expect(rows()).toEqual([{ n: "7", s: "unavailable", v: "Indisponible" }]);
  });
  it("cancellation during a change shows no project; nothing from the previous one", async () => {
    await mount(LOADED);
    await select(ok(CANCELLED));
    expect(status()).toBe("cancelled");
    expect(rows()).toEqual([]);
  });
  it.each([[UNRECOGNIZED, "installation-required"], [AMBIGUOUS, "installation-ambiguous"]])("installation_required snapshot replaces the model", async (snap, expected) => {
    await mount(LOADED);
    await select(fail(snap, "project_selection_required"));
    expect(status()).toBe(expected);
    expect(rows()).toEqual([]);
  });
  it("definitions unavailable is not an empty project", async () => {
    await mount(LOADED);
    await select(ok(DEFS_UNAVAILABLE));
    expect(status()).toBe("definitions-unavailable");
    expect(document.querySelector('[aria-label="project-definitions"]')?.getAttribute("data-definitions-status")).toBe("unavailable");
  });
  it("refusal without data keeps the current model", async () => {
    await mount(LOADED);
    await select({ ok: false, error: { code: "invalid", message: "project.select attend exactement {}." } });
    expect(status()).toBe("loaded");
    expect(rows()).toEqual([{ n: "7", s: "set", v: "0" }]);
  });
  it("transport error is not an empty success: previous values cleared, read error shown", async () => {
    await mount(LOADED);
    call.mockRejectedValueOnce(new Error("transport"));
    await act(async () => { fireEvent.click(button()); await Promise.resolve(); await Promise.resolve(); });
    expect(status()).toBe("read-error");
    expect(rows()).toEqual([]);
  });
  it("contract-1 initial snapshot is rejected, never adapted", async () => {
    await mount({ ...clone(LOADED), project_contract: 1, data: { catalog: [{ num: 7, name: "X" }], attributes: [], values: { "7": "a" } } });
    expect(status()).toBe("read-error");
    expect(rows()).toEqual([]);
  });
  it("contract 1 identity keeps the selection disabled", async () => {
    appInfo = { ...APP_INFO, project_contract: 1 };
    await mount(LOADED);
    expect(button()).toBeDisabled();
    expect(document.querySelector('[aria-label="aim-contract-attributes"]')).toBeNull();
  });
});

describe("AIM project history (project_history_contract 1)", () => {
  const HIST = { ...APP_INFO, project_history_contract: 1 };
  const RECENT = { ok: true, projects: [{ path: "C:\\Projets\\Bureau.prj", name: "Bureau.prj" }, { path: "C:\\Projets\\Maison.prj", name: "Maison.prj" }] };
  const openMenu = async () => { await act(async () => { fireEvent.keyDown(screen.getByRole("button", { name: /^(Projet|Project|Progetto|Projekt)$/ }), { key: "ArrowDown" }); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
  it("marker enables history while strict capabilities stay exactly ['project.select']", () => {
    expect(aimProjectContract(HIST)).toMatchObject({ recognized: true, history: true });
    expect(aimProjectContract({ ...HIST, project_history_contract: "1" }).history).toBe(false);
    expect(aimProjectContract({ ...HIST, capabilities: ["project.select", "project.recent"] }).recognized).toBe(false);
  });
  it("parses project.recent exactly", () => {
    expect(parseRecentResponse(RECENT)).toEqual({ kind: "list", projects: RECENT.projects });
    expect(parseRecentResponse({ ok: true, projects: [] })).toEqual({ kind: "list", projects: [] });
    expect(parseRecentResponse({ ok: false, error: { code: "history_unavailable", message: "Historique indisponible" } })).toEqual({ kind: "refused", code: "history_unavailable", message: "Historique indisponible" });
    expect(parseRecentResponse({ ok: true, projects: [{ path: 1, name: "x" }] }).kind).toBe("invalid");
  });
  it("recent entry opens with project.select {path}; refusal and cancellation keep the current project", async () => {
    appInfo = HIST;
    call = vi.fn(async (command: string) => command === "project.recent" ? RECENT : null);
    await mount(LOADED);
    await openMenu();
    expect(call).toHaveBeenCalledWith("project.recent", {});
    const item = await screen.findByRole("menuitem", { name: /Maison\.prj/ });
    call.mockImplementationOnce(async () => ({ ok: false, error: { code: "project_not_recent", message: "Projet absent de l’historique." } }));
    await act(async () => { fireEvent.click(item); await Promise.resolve(); await Promise.resolve(); });
    expect(call).toHaveBeenCalledWith("project.select", { path: "C:\\Projets\\Maison.prj" });
    expect(rows()).toEqual([{ n: "7", s: "set", v: "0" }]);
    expect(status()).toBe("loaded");
    await openMenu();
    call.mockImplementationOnce(async () => ({ ok: true, status: "cancelled", data: clone(MISSING) }));
    await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: /Bureau\.prj/ })); await Promise.resolve(); await Promise.resolve(); });
    expect(rows()).toEqual([{ n: "7", s: "set", v: "0" }]);
    expect(status()).toBe("loaded");
  });
  it("old host without marker: no recent request, native chooser kept", async () => {
    call = vi.fn(async () => RECENT);
    await mount(LOADED);
    await openMenu();
    expect(call).not.toHaveBeenCalledWith("project.recent", {});
    expect(screen.getAllByText(/Choisir un projet|Choose an Allplan project/).length).toBeGreaterThan(0);
  });
});
