import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import loaded from "../fixtures/aim-update/01-project-loaded.json";
import initialPresentation from "../fixtures/aim-update/10-initial-presentation.json";
import firstUpdated from "../fixtures/aim-update/11-add-first-occurrence-updated.json";
import repeatedUpdated from "../fixtures/aim-update/12-add-repeated-occurrence-updated.json";
import failures from "../fixtures/aim-update/14-update-failures.json";
import legacyInfo from "../fixtures/aim-update/20-host-identity-legacy.json";
import updateInfo from "../fixtures/aim-update/21-host-identity-update.json";
import { addOccurrence, isConfiguration, outsideAttributes, parseUpdate, presentationProfile, type Configuration, type Presentation } from "@/modules/information_manager/lib/aim-presentation-contract";
import { UPDATE_UNAVAILABLE } from "@/modules/information_manager/components/organized-presentation";

const host = vi.hoisted(() => ({ info: null as unknown }));
vi.mock("@/shared/transport/native-binding", async (original) => ({ ...(await original<object>()), getVerifiedAppInfo: () => host.info }));
const { AimEditor } = await import("@/modules/information_manager/AimEditor");

const flush = async () => { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); };
const ids = () => [...document.querySelectorAll("[data-row-id]")].map((r) => r.getAttribute("data-row-id"));
const outsideNumbers = () => [...document.querySelectorAll("[data-outside-number]")].map((r) => r.getAttribute("data-outside-number"));
type Reply = (payload: Record<string, unknown>) => unknown;

async function mount(info: unknown, updateReplies: Reply[]) {
  host.info = info;
  const call = vi.fn(async (command: string, payload: Record<string, unknown>) => {
    if (command === "presentation.import.prepare") return { ok: true, status: "prepared", token: "11111111-1111-4111-8111-111111111111", candidate: structuredClone(initialPresentation) };
    if (command === "presentation.import.apply") return { ok: true, status: "applied", presentation: structuredClone(initialPresentation) };
    if (command === "presentation.update") { const r = updateReplies.shift(); if (!r) throw new Error("unexpected update"); return r(payload); }
    throw new Error(command);
  });
  vi.stubGlobal("pywebview", { api: { get_initial_data: async () => structuredClone(loaded), call } });
  render(createElement(AimEditor, { hostEnabled: false, limitedHost: true })); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Importer une présentation" })); await flush();
  fireEvent.click(screen.getByRole("button", { name: /Écraser/ })); await flush();
  return call;
}
const updates = (call: ReturnType<typeof vi.fn>) => call.mock.calls.filter(([c]) => c === "presentation.update").map(([, p]) => p as Record<string, unknown>);
const rowsOf = (c: Configuration) => c.categories.flatMap((cat) => cat.groups.flatMap((g) => g.rows));
const openOutside = () => fireEvent.click(screen.getByRole("button", { name: "Hors présentation" }));
async function addFromOutside(number: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: `Ajouter une ligne ${number}` }), { key: "ArrowDown" }); await flush();
  fireEvent.click(screen.getByRole("menuitem", { name: "Synthetic group" })); await flush();
}

beforeEach(() => { localStorage.clear(); localStorage.setItem("information_manager:lang", "fr"); globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("capability profiles", () => {
  it("recognises exactly the five-capability and six-capability identities", () => {
    expect(presentationProfile(legacyInfo)).toBe("legacy-five");
    expect(presentationProfile(updateInfo)).toBe("update-six");
    const caps = updateInfo.presentation_capabilities;
    expect(presentationProfile({ ...updateInfo, presentation_capabilities: ["presentation.update", ...caps.slice(0, 5)] })).toBe("unrecognized");
    expect(presentationProfile({ ...updateInfo, presentation_capabilities: [...caps, "presentation.delete"] })).toBe("unrecognized");
    expect(presentationProfile({ ...updateInfo, read_only: false })).toBe("unrecognized");
    expect(presentationProfile({ ...updateInfo, id: "vob_editor" })).toBe("unrecognized");
  });
  it("accepts only a complete updated presentation with report null; failures carry no replacement", () => {
    expect(parseUpdate(firstUpdated).kind).toBe("updated");
    expect(parseUpdate({ ...firstUpdated, presentation: { ...firstUpdated.presentation, report: {} } }).kind).toBe("invalid");
    expect(parseUpdate({ ...failures.model_unavailable, presentation: firstUpdated.presentation }).kind).toBe("invalid");
    expect(parseUpdate(failures.model_unavailable)).toMatchObject({ kind: "failure", code: "model_unavailable" });
  });
  it("outside view excludes represented numbers; repeated occurrences get distinct IDs", () => {
    const config = (initialPresentation as Presentation).configuration;
    const attrs = loaded.data.attributes;
    expect(outsideAttributes(config, attrs).map((a) => a.number)).toEqual(["7"]);
    const one = addOccurrence(config, "group-a", attrs[0]!, () => "row-a")!;
    const two = addOccurrence(one, "group-a", attrs[0]!, (() => { const q = ["row-a", "row-b"]; return () => q.shift()!; })())!;
    expect(rowsOf(two).map((r) => [r.id, r.num, r.position])).toEqual([["row-a", 7, 1], ["row-b", 7, 2]]);
    expect(isConfiguration(two)).toBe(true);
    expect(outsideAttributes(two, attrs)).toEqual([]);
  });
});

describe("mounted organized editor with presentation.update", () => {
  it("adds a first then a repeated occurrence through update and displays Python's recomputed model", async () => {
    const call = await mount(updateInfo, [() => firstUpdated, () => repeatedUpdated]);
    openOutside(); expect(outsideNumbers()).toEqual(["7"]);
    expect(document.querySelector('[data-outside-number="7"] [data-value-state]')?.textContent).toBe("0");
    await addFromOutside("7");
    const [first] = updates(call);
    expect(Object.keys(first!)).toEqual(["configuration"]);
    const sent = first!["configuration"] as Configuration;
    expect(rowsOf(sent)).toMatchObject([{ num: 7, position: 1, widget: "entry", type: "STR", resetDefault: { state: "absent" } }]);
    expect(JSON.stringify(sent)).not.toMatch(/valueState|definition/);
    expect(outsideNumbers()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Toutes" }));
    expect(ids()).toEqual(["row-a"]);

    fireEvent.click(screen.getByRole("button", { name: "Ajouter une ligne" }));
    const dialog = screen.getByRole("form", { name: "Ajouter une ligne" });
    const choice = within(dialog).getAllByRole("combobox")[0];
    if (!choice) throw new Error("Missing attribute choice");
    fireEvent.change(choice, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("form").querySelector("button[type=submit]") ?? within(dialog).getByRole("button", { name: "Ajouter" })); await flush();
    const second = updates(call)[1]!["configuration"] as Configuration;
    const rows = rowsOf(second);
    expect(rows.map((r) => r.num)).toEqual([7, 7]);
    expect(rows[0]!.id).toBe("row-a"); expect(rows[1]!.id).not.toBe("row-a");
    expect(ids()).toEqual(["row-a", "row-b"]);
    expect([...document.querySelectorAll("[data-row-id] [data-value-state]")].map((e) => e.textContent)).toEqual(["0", "0"]);
  });

  it("failed update keeps the confirmed presentation and allows retry of the same draft", async () => {
    const call = await mount(updateInfo, [() => firstUpdated, () => failures.model_unavailable, () => ({ ...firstUpdated, presentation: { ...firstUpdated.presentation } })]);
    openOutside(); await addFromOutside("7");
    fireEvent.click(screen.getByRole("button", { name: "Toutes" })); expect(ids()).toEqual(["row-a"]);
    fireEvent.click(screen.getByRole("button", { name: /Tout replier.*Synthetic group/ })); await flush();
    const alert = screen.getByRole("alert", { name: "presentation-update" });
    expect(alert.textContent).toContain(failures.model_unavailable.error.message);
    expect(ids()).toEqual(["row-a"]);
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" })); await flush();
    const [, failed, retried] = updates(call);
    expect(retried).toEqual(failed);
    expect(screen.queryByRole("alert", { name: "presentation-update" })).toBeNull();
  });

  it("a move is submitted by ID and is not shown as confirmed when Python refuses it", async () => {
    const call = await mount(updateInfo, [() => firstUpdated, () => repeatedUpdated, () => failures.invalid_presentation]);
    openOutside(); await addFromOutside("7");
    fireEvent.click(screen.getByRole("button", { name: "Toutes" }));
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une ligne" }));
    const form = screen.getByRole("form", { name: "Ajouter une ligne" });
    const choice = within(form).getAllByRole("combobox")[0];
    if (!choice) throw new Error("Missing attribute choice");
    fireEvent.change(choice, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("form").querySelector("button[type=submit]") ?? within(form).getByRole("button", { name: "Ajouter" })); await flush();
    fireEvent.click(screen.getByRole("button", { name: "Descendre row-a" })); await flush();
    const moved = updates(call)[2]!["configuration"] as Configuration;
    expect(rowsOf(moved).map((r) => [r.id, r.position])).toEqual([["row-b", 1], ["row-a", 2]]);
    expect(ids()).toEqual(["row-a", "row-b"]);
    expect(screen.getByRole("alert", { name: "presentation-update" }).textContent).toContain(failures.invalid_presentation.error.message);
    fireEvent.click(screen.getByRole("button", { name: "Abandonner" }));
    expect(screen.queryByRole("alert", { name: "presentation-update" })).toBeNull();
  });

  it("legacy five-capability host keeps display but never sends update and explains why adding is unavailable", async () => {
    const call = await mount(legacyInfo, []);
    openOutside(); expect(outsideNumbers()).toEqual(["7"]);
    const add = screen.getByRole("button", { name: "Ajouter une ligne 7" });
    expect(add).toBeDisabled(); expect(add.getAttribute("title")).toBe(UPDATE_UNAVAILABLE);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une ligne" }));
    expect(screen.getByRole("dialog").textContent).toContain(UPDATE_UNAVAILABLE);
    expect(updates(call)).toEqual([]);
  });
});
