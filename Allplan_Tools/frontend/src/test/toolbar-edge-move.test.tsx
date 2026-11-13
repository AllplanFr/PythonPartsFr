import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Ribbon } from "@/components/editor/Chrome";
import { TemplateDialog } from "@/components/editor/TemplateDialog";
import { useCatalog, type CatalogNode } from "@/lib/catalog-store";
import { useTemplates, type AttributeTemplate } from "@/lib/templates";

const ids = ["a", "b", "c", "d", "e"];
const models: AttributeTemplate[] = ids.map((id) => ({ id, name: id, type: "component", attrs: [120, 202, 209, 96, 267].map((num) => ({ num, value: "", enabled: false })), children: [] }));
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  const nodes = Object.fromEntries(ids.map((id): [string, CatalogNode] => [id, { id, name: id, type: "folder", parentId: null, description: "", attrs: {}, children: [] }]));
  useCatalog.getState().load({ nodes, rootIds: ids });
  useCatalog.setState({ selected: ["d", "b"], lang: "en" });
  useTemplates.setState({ models: structuredClone(models), open: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe("toolbar edge moves", () => {
  it("Ctrl+Up moves every selected catalog item first in sibling order, in one undo step", () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByTitle("Move up"), { ctrlKey: true });
    expect(useCatalog.getState().rootIds).toEqual(["b", "d", "a", "c", "e"]);
    expect(useCatalog.getState().past).toHaveLength(1);
    act(() => useCatalog.getState().undo());
    expect(useCatalog.getState().rootIds).toEqual(ids);
  });
  it("Ctrl+Down moves every selected catalog item last in sibling order", () => {
    render(<Ribbon />);
    fireEvent.click(screen.getByTitle("Move down"), { ctrlKey: true });
    expect(useCatalog.getState().rootIds).toEqual(["a", "c", "e", "b", "d"]);
  });
  it.each([[-1, "Move up", ["c", "a", "b", "d", "e"]], [1, "Move down", ["a", "b", "d", "e", "c"]]] as const)("Ctrl model move %s reaches the edge", (_dir, label, expected) => {
    render(<TemplateDialog />);
    fireEvent.click(screen.getByText("c", { selector: "span" }));
    fireEvent.click(screen.getByRole("button", { name: label }), { ctrlKey: true });
    expect(useTemplates.getState().models.map((m) => m.id)).toEqual(expected);
  });
  it.each([["Move up", [202, 96, 120, 209, 267]], ["Move down", [120, 209, 267, 202, 96]]] as const)("Ctrl %s moves selected model attributes together", (label, expected) => {
    const { container } = render(<TemplateDialog />);
    const first = container.querySelector('[data-template-value="202"]');
    const second = container.querySelector('[data-template-value="96"]');
    if (!first || !second) throw new Error("Attribute rows missing");
    fireEvent.click(first);
    fireEvent.click(second, { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: label }), { ctrlKey: true });
    expect(useTemplates.getState().models[0]?.attrs.map((a) => a.num)).toEqual(expected);
  });
  it("saves settings and closes on Save", () => {
    render(<TemplateDialog />);
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(useTemplates.getState().open).toBe(false);
    expect(JSON.parse(localStorage.getItem("smartcatalog-model-settings") ?? "null")).toEqual(models);
  });
  it("keeps the manager open if saving fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
    render(<TemplateDialog />);
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(useTemplates.getState().open).toBe(true);
  });
});
