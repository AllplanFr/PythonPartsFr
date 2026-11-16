import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "./synthetic-presentation.json";
import { isPresentation, type Configuration, type Presentation } from "@/modules/information_manager/lib/aim-presentation-contract";
import { OrganizedPresentationView, ValueDisplay, VALUE_UNSET } from "@/modules/information_manager/components/organized-presentation";
import { CATEGORY_HOVER_DELAY_MS } from "@/modules/information_manager/lib/organized-layout";
import { AimActionBar } from "@/modules/information_manager/components/aim-action-bar";
import { DEFAULT_SEARCH } from "@/modules/information_manager/lib/aim-interface";
import { DICTS } from "@/modules/information_manager/lib/i18n";
import { CustomToolbar } from "@/components/editor/CustomToolbar";

function sample(): Presentation {
  const raw: unknown = structuredClone(fixture.presentation);
  if (!isPresentation(raw)) throw new Error("Invalid synthetic fixture");
  const add = (c: { categories: Presentation["configuration"]["categories"] }) => {
    c.categories[0]!.groups.push({ id: "group-b", position: 2, title: "Group B", backgroundColor: "#eeeeee", expanded: true, rows: [] });
    c.categories.push({ id: "cat-2", position: 2, name: "Cat 2", icon: "", groups: [{ id: "group-c", position: 1, title: "Group C", backgroundColor: "#eeeeee", expanded: true, rows: [] }] });
  };
  add(raw.configuration); add(raw.model as unknown as Configuration);
  return raw;
}
const dt = () => ({ setData: vi.fn(), getData: vi.fn(), effectAllowed: "", dropEffect: "" });
const grip = (title: string) => document.querySelector(`[data-group-id="${title}"] [title="Déplacer le groupe"]`) as HTMLElement;
const cat = (id: string) => document.querySelector(`[data-category-id="${id}"]`) as HTMLElement;
const groupIds = (c: Configuration, id: string) => c.categories.find((x) => x.id === id)!.groups.map((g) => g.id);
beforeEach(() => { localStorage.clear(); globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("absent value shows 'Non renseigné', distinct from '0' and from an unchecked box; never a value", () => {
  render(<>
    <ValueDisplay valueState="unset" value={null} />
    <ValueDisplay valueState="set" value="0" />
    <ValueDisplay valueState="set" value="0" checkbox />
    <ValueDisplay valueState="unset" value={null} checkbox />
  </>);
  const cells = [...document.querySelectorAll("[data-value-state]")];
  expect(cells[0]!.textContent).toBe(VALUE_UNSET);
  expect(cells[1]!.textContent).toBe("0");
  expect(cells[2]!.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("false");
  expect(cells[2]!.textContent).not.toContain(VALUE_UNSET);
  expect(cells[3]!.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("mixed");
  expect(cells[3]!.textContent).toContain(VALUE_UNSET);
});

it("group drag within the category: dotted placeholder, then placed after the hovered group", () => {
  const change = vi.fn();
  render(<OrganizedPresentationView presentation={sample()} onConfigurationChange={change} />);
  fireEvent.dragStart(grip("synthetic-group"), { dataTransfer: dt() });
  const td = document.querySelector('[data-group-id="group-b"] td') as HTMLElement;
  fireEvent.dragOver(td, { dataTransfer: dt() });
  expect(document.querySelector("[data-group-placeholder] .drop-preview")).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
  fireEvent.drop(td, { dataTransfer: dt() });
  expect(groupIds(change.mock.calls[0]![0], fixture.presentation.configuration.categories[0]!.id)).toEqual(["group-b", "synthetic-group"]);
});

it("drop on a category makes the group its first group, with its rows; hover alone changes nothing", () => {
  const change = vi.fn(); const p = sample(); const rows = p.configuration.categories[0]!.groups[0]!.rows.map((r) => r.id);
  render(<OrganizedPresentationView presentation={p} onConfigurationChange={change} />);
  fireEvent.dragStart(grip("synthetic-group"), { dataTransfer: dt() });
  fireEvent.dragEnter(cat("cat-2"), { dataTransfer: dt() });
  fireEvent.dragOver(cat("cat-2"), { dataTransfer: dt() });
  expect(change).not.toHaveBeenCalled();
  fireEvent.drop(cat("cat-2"), { dataTransfer: dt() });
  const next: Configuration = change.mock.calls[0]![0];
  expect(groupIds(next, "cat-2")).toEqual(["synthetic-group", "group-c"]);
  expect(next.categories[1]!.groups[0]!.rows.map((r) => r.id)).toEqual(rows);
});

it(`category under a group drag is shown after ${CATEGORY_HOVER_DELAY_MS} ms; a quick pass does not switch`, () => {
  vi.useFakeTimers();
  const change = vi.fn();
  render(<OrganizedPresentationView presentation={sample()} onConfigurationChange={change} />);
  const pressed = () => screen.getByRole("button", { name: "Cat 2" }).getAttribute("aria-pressed");
  fireEvent.dragStart(grip("synthetic-group"), { dataTransfer: dt() });
  fireEvent.dragEnter(cat("cat-2"), { dataTransfer: dt() });
  act(() => { vi.advanceTimersByTime(CATEGORY_HOVER_DELAY_MS - 100); });
  fireEvent.dragLeave(cat("cat-2"), { relatedTarget: document.body, dataTransfer: dt() });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(pressed()).toBe("false");
  fireEvent.dragEnter(cat("cat-2"), { dataTransfer: dt() });
  act(() => { vi.advanceTimersByTime(CATEGORY_HOVER_DELAY_MS); });
  expect(pressed()).toBe("true");
  expect(change).not.toHaveBeenCalled();
});

it("drop cancels the pending category hover", () => {
  vi.useFakeTimers();
  render(<OrganizedPresentationView presentation={sample()} onConfigurationChange={() => {}} />);
  fireEvent.dragStart(grip("synthetic-group"), { dataTransfer: dt() });
  fireEvent.dragEnter(cat("cat-2"), { dataTransfer: dt() });
  fireEvent.dragOver(cat("cat-2"), { dataTransfer: dt() });
  fireEvent.drop(cat("cat-2"), { dataTransfer: dt() });
  act(() => { vi.advanceTimersByTime(CATEGORY_HOVER_DELAY_MS * 2); });
  expect(screen.getByRole("button", { name: "Cat 2" }).getAttribute("aria-pressed")).toBe("false");
});

it("placeholder is a real row inserted in the table, shifting following groups", () => {
  render(<OrganizedPresentationView presentation={sample()} />);
  fireEvent.dragStart(grip("synthetic-group"), { dataTransfer: dt() });
  fireEvent.dragOver(document.querySelector('[data-group-id="group-b"] td') as HTMLElement, { dataTransfer: dt() });
  const trs = [...document.querySelectorAll("tbody tr")];
  const ph = trs.findIndex((t) => t.hasAttribute("data-group-placeholder"));
  expect(ph).toBeGreaterThan(trs.findIndex((t) => t.getAttribute("data-group-id") === "group-b"));
});

it("drag end cancels the pending category hover", () => {
  vi.useFakeTimers();
  render(<OrganizedPresentationView presentation={sample()} />);
  fireEvent.dragStart(grip("synthetic-group"), { dataTransfer: dt() });
  fireEvent.dragEnter(cat("cat-2"), { dataTransfer: dt() });
  fireEvent.dragEnd(grip("synthetic-group"), { dataTransfer: dt() });
  act(() => { vi.advanceTimersByTime(CATEGORY_HOVER_DELAY_MS * 2); });
  expect(screen.getByRole("button", { name: "Cat 2" }).getAttribute("aria-pressed")).toBe("false");
});

it("AIM toolbar: selecting text in the search never arms a toolbar drag; the field stays usable", () => {
  const onQuery = vi.fn();
  const t = DICTS.fr as unknown as Parameters<typeof AimActionBar>[0]["text"];
  render(<AimActionBar lang="fr" text={t} buttons={{}} query="abc" onQuery={onQuery} options={DEFAULT_SEARCH} onOptions={() => {}} placeholder="Rechercher" />);
  const input = screen.getByPlaceholderText("Rechercher");
  const block = input.closest("[data-menu-block]") as HTMLElement;
  expect(block.getAttribute("draggable")).toBe("true");
  fireEvent.pointerDown(input);
  expect(block.getAttribute("draggable")).toBe("false");
  expect((input.closest("[data-menu-button]") as HTMLElement).getAttribute("draggable")).toBe("false");
  const e = fireEvent.dragStart(block, { dataTransfer: dt() });
  expect(e).toBe(false);
  fireEvent.change(input, { target: { value: "abcd" } });
  expect(onQuery).toHaveBeenCalledWith("abcd");
  fireEvent.pointerUp(input);
  expect(block.getAttribute("draggable")).toBe("true");
});

it("SmartCatalog/VOB toolbar shares the rule: a press in a field disables drag", () => {
  render(<CustomToolbar id="recette" initial={[{ id: "g", label: "search", color: "brand", buttons: ["s"] }]} buttons={{ s: <input aria-label="find" /> }} />);
  const input = screen.getByLabelText("find");
  const block = input.closest("[data-menu-block]") as HTMLElement;
  fireEvent.pointerDown(input);
  expect(block.getAttribute("draggable")).toBe("false");
  expect(fireEvent.dragStart(block, { dataTransfer: dt() })).toBe(false);
});
