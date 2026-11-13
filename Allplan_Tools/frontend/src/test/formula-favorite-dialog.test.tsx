import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormulaFavoriteDialog, FormulaApplyDialog } from "@/components/editor/FormulaFavoriteDialog";
import { useCatalog } from "@/lib/catalog-store";
import { useFormulaFavorites } from "@/lib/formula-favorites";
import { seedDemo } from "./fixtures/seed-demo";
seedDemo();
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useCatalog.setState({ lang: "en" });
  useFormulaFavorites.setState({ open: true, folders: [], favorites: [{ id: "f", name: "Volume", description: "", formula: "@223@", attribute: 267 }], selected: "f", pending: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
describe("formula manager", () => {
  it("saves the latest edit and closes immediately on Save", () => {
    render(<FormulaFavoriteDialog />);
    fireEvent.change(screen.getByRole("textbox", { name: "" }), { target: { value: "@223@*3" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(useFormulaFavorites.getState().open).toBe(false);
    cleanup();
    useFormulaFavorites.setState({ favorites: [] });
    useFormulaFavorites.getState().hydrate();
    expect(useFormulaFavorites.getState().favorites[0]?.formula).toBe("@223@*3");
  });
  it("keeps the manager open if settings cannot be saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Unavailable"); });
    render(<FormulaFavoriteDialog />);
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(useFormulaFavorites.getState().open).toBe(true);
  });
  it("cancelling application leaves existing formulas unchanged", () => {
    const id = Object.values(useCatalog.getState().nodes).find((n) => n.type === "component")?.id;
    if (!id) throw new Error("Missing component fixture");
    const before = { ...useCatalog.getState().nodes[id]?.attrs }; const past = useCatalog.getState().past.length;
    const favorite = useFormulaFavorites.getState().favorites[0]; if (!favorite) throw new Error("Missing favorite");
    useFormulaFavorites.setState({ pending: { favorite, nodeId: id } });
    render(<FormulaApplyDialog />);
    const close = screen.getAllByRole("button", { name: /^Close$/ })[1];
    if (!close) throw new Error("Missing close action");
    fireEvent.click(close);
    expect(useFormulaFavorites.getState().pending).toBeNull();
    expect(useCatalog.getState().nodes[id]?.attrs).toEqual(before);
    expect(useCatalog.getState().past).toHaveLength(past);
  });
  it("Enter applies the default preferred attribute and closes", () => {
    useCatalog.setState({ nodes: { c: { id: "c", name: "Concrete", description: "", type: "component", parentId: null, attrs: { 267: "@220@", 96: "@221@" } } }, past: [], future: [] });
    const favorite = useFormulaFavorites.getState().favorites[0]; if (!favorite) throw new Error("Missing favorite");
    useFormulaFavorites.getState().request(favorite, "c");
    render(<FormulaApplyDialog />);
    expect(screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
    fireEvent.keyDown(screen.getAllByRole("radio")[0] as HTMLElement, { key: "Enter" });
    expect(useCatalog.getState().nodes['c']?.attrs).toEqual({ 267: "@223@", 96: "@221@" });
    expect(useFormulaFavorites.getState().pending).toBeNull();
    expect(useCatalog.getState().past).toHaveLength(1);
  });
  it("choosing another option replaces the selection rather than accumulating targets", () => {
    useCatalog.setState({ nodes: { c: { id: "c", name: "Concrete", description: "", type: "component", parentId: null, attrs: { 267: "@220@", 96: "@221@" } } }, past: [], future: [] });
    const favorite = useFormulaFavorites.getState().favorites[0]; if (!favorite) throw new Error("Missing favorite");
    useFormulaFavorites.getState().request(favorite, "c");
    render(<FormulaApplyDialog />);
    const other = screen.getAllByRole("radio")[1]; if (!other) throw new Error("Missing alternative");
    fireEvent.click(other);
    fireEvent.keyDown(other, { key: "Enter" });
    expect(useCatalog.getState().nodes['c']?.attrs).toEqual({ 267: "@220@", 96: "@223@" });
    expect(useFormulaFavorites.getState().pending).toBeNull();
  });
});