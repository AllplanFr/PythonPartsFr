import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormulaFavoritesMenu } from "@/components/editor/FormulaFavoriteMenus";
import { useFormulaFavorites } from "@/lib/formula-favorites";
import { useCatalog } from "@/lib/catalog-store";
import { useVobEditor } from "@/lib/vob-editor";

afterEach(cleanup);
it("applies a favorite only to selected VOB formulas in one undo step", async () => {
  useCatalog.setState({ lang: "en" });
  const catalogNodes = useCatalog.getState().nodes;
  const catalogHistory = useCatalog.getState().past;
  useFormulaFavorites.setState({ folders: [], favorites: [{ id: "f", name: "Volume test", description: "", formula: "@223@", attribute: 267 }], pending: null });
  const base = { trade: "1", object: "62", unit: "1", method: "01", formula: "1", comment: "Keep" };
  useVobEditor.setState({ rules: ["a", "b", "c"].map((id) => ({ ...base, id })), selected: "a", selectedIds: ["a", "b"], past: [], future: [] });
  render(<FormulaFavoritesMenu onApply={(formula) => useVobEditor.getState().updateMany(["a", "b"], { formula })} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Formula favourites" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Volume test/ }));
  expect(useVobEditor.getState().rules.map((r) => r.formula)).toEqual(["@223@", "@223@", "1"]);
  expect(useVobEditor.getState().rules.map((r) => r.comment)).toEqual(["Keep", "Keep", "Keep"]);
  expect(useVobEditor.getState().past).toHaveLength(1);
  expect(useCatalog.getState().nodes).toBe(catalogNodes);
  expect(useCatalog.getState().past).toBe(catalogHistory);
  expect(useFormulaFavorites.getState().pending).toBeNull();
});