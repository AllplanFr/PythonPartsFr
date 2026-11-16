import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as catalog from "@/modules/information_manager/lib/attribute-catalog";
// TEST FIXTURES ONLY — contract-2 snapshot and synthetic presentation from the contracts' examples.
import LOADED from "@/test/fixtures/aim-contract2/loaded.json";

const INFO = { id: "information_manager", title: "t", protocol_version: 1, capabilities: ["project.select"], read_only: true, project_contract: 2, presentation_contract: 1,
  presentation_capabilities: ["presentation.import.prepare", "presentation.import.apply", "presentation.import.cancel", "presentation.get", "presentation.export"] };
vi.mock("@/shared/transport/native-binding", async (orig) => ({ ...(await orig<object>()), getVerifiedAppInfo: () => INFO }));
// The suite dropdown is replaced by a plain button so the native import can be opened in jsdom.
vi.mock("@/modules/information_manager/components/suite-menu", async (orig) => ({ ...(await orig<object>()),
  SuiteMenu: ({ onImport }: { onImport?: () => void }) => createElement("button", { onClick: onImport }, "open-native-import"),
}));
const { AimEditor } = await import("@/modules/information_manager/AimEditor");

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const presentation = (value: string) => ({
  configuration: { schema: "aim-presentation-configuration", version: 1, configurationId: "exemple", resetPolicy: { applyOn: "explicit_reset_only", checkboxWithoutDefault: "unchecked" },
    categories: [{ id: "category-1", position: 1, name: "Projet", icon: "h.ico", groups: [{ id: "group-1", position: 1, title: "Infos", backgroundColor: "#eeeeee", expanded: true,
      rows: [{ id: "group-1-line-1", position: 1, num: 7, title: "Statut", widget: "entry", type: "STR", resetDefault: { state: "absent" } }] }] }] },
  report: null,
  model: { schema: "aim-organized-presentation", version: 1, configurationId: "exemple", readOnly: true, project: null, installation: null,
    prjatt: { status: "not_loaded", path: null, encodingHint: null, header: null }, definitions: { status: "not_loaded" },
    categories: [{ id: "category-1", position: 1, name: "Projet", icon: "h.ico", groups: [{ id: "group-1", position: 1, title: "Infos", backgroundColor: "#eeeeee", expanded: true,
      rows: [{ id: "group-1-line-1", position: 1, number: "7", title: "Statut", widget: "entry", type: "STR", resetDefault: { state: "absent" }, definition: null, valueState: "set", value, diagnostics: [] }] }] }],
    counts: { configurationLines: 1, matchedDefinitions: 0, missingDefinitions: 1, set: 1, unset: 0, unavailable: 0 }, diagnostics: [], conversionDiagnostics: [] },
});
let replies: Record<string, unknown[]>;
let call: ReturnType<typeof vi.fn>;
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const shown = () => [...document.querySelectorAll("[data-row-id] [data-value-state]")].map((e) => e.textContent);
const btn = (n: RegExp) => screen.getByRole("button", { name: n });

/** Mounts AIM, imports a presentation whose row shows "ANCIEN", then switches project. */
async function importThenSwitch(get: unknown) {
  replies = {
    "presentation.import.prepare": [{ ok: true, status: "prepared", token: "11111111-1111-4111-8111-111111111111", candidate: presentation("ANCIEN") }],
    "presentation.import.apply": [{ ok: true, status: "applied", presentation: presentation("ANCIEN") }],
    "project.select": [{ ok: true, data: clone(LOADED) }],
    "presentation.get": [get],
  };
  (window as unknown as { pywebview: unknown }).pywebview = { api: { get_initial_data: vi.fn(async () => clone(LOADED)), call } };
  render(createElement(AimEditor, { hostEnabled: false, limitedHost: true }));
  await flush();
  fireEvent.click(btn(/open-native-import/)); await flush();
    fireEvent.click(btn(/Écraser/)); await flush();
  expect(shown()).toEqual(["ANCIEN"]);
  fireEvent.click(btn(/Choisir un projet Allplan|Choose an Allplan project/)); await flush();
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  localStorage.clear(); catalog.setCatalog([]);
  call = vi.fn(async (c: string) => { const r = replies[c]?.shift(); if (r instanceof Error) throw r; return r; });
});
afterEach(() => { cleanup(); delete (window as unknown as { pywebview?: unknown }).pywebview; });

describe("organized presentation — project change", () => {
  it("current: displays the new Python model, never the old values", async () => {
    await importThenSwitch({ ok: true, status: "current", presentation: presentation("NOUVEAU") });
    expect(call).toHaveBeenCalledWith("presentation.get", {});
    expect(shown()).toEqual(["NOUVEAU"]);
  });
  it("empty: no organized model remains", async () => {
    await importThenSwitch({ ok: true, status: "empty", presentation: null });
    expect(shown()).toEqual([]);
    expect(screen.queryByText(/Impossible de récupérer/)).toBeNull();
  });
  it.each([
    ["transport error", new Error("lost")],
    ["invalid reply", { ok: true, status: "current", presentation: { nope: 1 } }],
    ["failure", { ok: false, error: { code: "source_read_error", message: "m" } }],
  ])("%s: explicit error, old values hidden, retry re-asks Python", async (_n, get) => {
    await importThenSwitch(get);
    expect(shown()).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("Impossible de récupérer la présentation organisée");
    replies["presentation.get"] = [{ ok: true, status: "current", presentation: presentation("NOUVEAU") }];
    fireEvent.click(btn(/Réessayer/)); await flush();
    expect(call.mock.calls.filter((c) => c[0] === "presentation.get")).toHaveLength(2);
    expect(shown()).toEqual(["NOUVEAU"]);
  });
});
