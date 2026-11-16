import { beforeEach, describe, expect, it } from "vitest";
import { ATTRIBUTE_CATALOG, useCatalog, type CatalogNode } from "@/lib/catalog-store";
import { FORMULA_ATTRIBUTES, formulaChoices, parseFormulaFavorites, parseFormulaSettings, useFormulaFavorites } from "@/lib/formula-favorites";

const node = (id: string, type: CatalogNode["type"], attrs: Record<number, string> = {}): CatalogNode => ({ id, type, name: id, description: "", parentId: null, attrs });
beforeEach(() => {
  useCatalog.setState({ nodes: { g: node("g", "group", { 267: "@223@", 96: "@220@", 202: "m3" }), c: node("c", "component"), f: node("f", "folder"), l: node("l", "link") }, rootIds: ["g", "c", "f", "l"], past: [], future: [], catalog: { name: "test", path: "", source: "", version: "2027", defAttr: 83 } });
  useFormulaFavorites.setState({ favorites: [], folders: [], pending: null, selected: null, open: false });
  localStorage.clear();
});
describe("formula favourites", () => {
  it.each([267, 96, 76, 180])("supports formula attribute %s", (num) => {
    expect(ATTRIBUTE_CATALOG.find((a) => a.num === num)?.control).toBe("formula");
    expect(useCatalog.getState().applyFormulaFavorite("c", "@223@*2", [num])).toBe(true);
    expect(useCatalog.getState().nodes['c']?.attrs[num]).toBe("@223@*2");
  });
  it("only supports the four requested attribute numbers", () => {
    expect(FORMULA_ATTRIBUTES).toEqual([267, 96, 76, 180]);
    expect(useCatalog.getState().applyFormulaFavorite("g", "@223@", [202])).toBe(false);
    expect(useCatalog.getState().past).toHaveLength(0);
  });
  it.each(["f", "l"])("rejects target %s", (id) => {
    expect(useCatalog.getState().applyFormulaFavorite(id, "@223@", [267])).toBe(false);
    expect(useCatalog.getState().nodes[id]?.attrs).toEqual({});
  });
  it("replacement and creation change only chosen numbers in one undo step", () => {
    expect(useCatalog.getState().applyFormulaFavorite("g", "@229@", [267, 76])).toBe(true);
    expect(useCatalog.getState().nodes['g']?.attrs).toEqual({ 267: "@229@", 76: "@229@", 96: "@220@", 202: "m3" });
    expect(useCatalog.getState().past).toHaveLength(1);
    useCatalog.getState().undo();
    expect(useCatalog.getState().nodes['g']?.attrs).toEqual({ 267: "@223@", 96: "@220@", 202: "m3" });
    useCatalog.getState().redo();
    expect(useCatalog.getState().nodes['g']?.attrs[76]).toBe("@229@");
  });
  it("creates the preferred attribute directly when it is the only choice", () => {
    useFormulaFavorites.getState().request({ id: "x", name: "Volume", description: "", attribute: 267, formula: "@223@" }, "c");
    expect(useCatalog.getState().nodes['c']?.attrs).toEqual({ 267: "@223@" });
    expect(useCatalog.getState().past).toHaveLength(1);
    expect(useFormulaFavorites.getState().pending).toBeNull();
  });
  it("priority 0 updates the preferred existing attribute before other formulas", () => {
    expect(formulaChoices(useCatalog.getState().nodes['g'], 267, 83)).toEqual([{ attribute: 267, priority: 0 }, { attribute: 96, priority: 1 }]);
  });
  it("priority 1 updates other existing formulas before priority 2 creates the preferred attribute", () => {
    expect(formulaChoices(useCatalog.getState().nodes['g'], 180, 83)).toEqual([{ attribute: 267, priority: 1 }, { attribute: 96, priority: 1 }, { attribute: 180, priority: 2 }]);
  });
  it("keeps ambiguous choices pending without modifying any formula", () => {
    useFormulaFavorites.getState().request({ id: "x", name: "Volume", description: "", attribute: 267, formula: "@229@" }, "g");
    expect(useFormulaFavorites.getState().pending?.nodeId).toBe("g");
    expect(useCatalog.getState().past).toHaveLength(0);
  });
  it("an explicit formula row applies only that attribute without showing a dialog", () => {
    useFormulaFavorites.getState().request({ id: "x", name: "Volume", description: "", attribute: 267, formula: "@229@" }, "g", 96);
    expect(useCatalog.getState().nodes['g']?.attrs[96]).toBe("@229@");
    expect(useCatalog.getState().nodes['g']?.attrs[267]).toBe("@223@");
    expect(useFormulaFavorites.getState().pending).toBeNull();
  });
  it("never proposes the reserved title attribute", () => {
    expect(formulaChoices(useCatalog.getState().nodes['g'], 267, 267)).toEqual([{ attribute: 96, priority: 1 }]);
  });
  it("saves and reloads formulas and folders without modifying catalog history", () => {
    const id = useFormulaFavorites.getState().create("Volume", "@223@", 267);
    useFormulaFavorites.setState({ folders: [{ id: "folder", name: "Quantities", icon: "data:image/png;base64,folder-icon" }] });
    useFormulaFavorites.getState().update(id, { folder: "folder" });
    expect(useFormulaFavorites.getState().saveSettings()).toBe(true);
    useFormulaFavorites.setState({ favorites: [], folders: [] });
    useFormulaFavorites.getState().hydrate();
    expect(useFormulaFavorites.getState().favorites[0]).toMatchObject({ name: "Volume", formula: "@223@", attribute: 267, folder: "folder" });
    expect(useFormulaFavorites.getState().folders).toEqual([{ id: "folder", name: "Quantities", icon: "data:image/png;base64,folder-icon" }]);
    expect(useCatalog.getState().past).toHaveLength(0);
  });
  it("import rejects unsupported attributes and dangling folder references", () => {
    const favorite = { id: "x", name: "Volume", description: "", formula: "@223@", attribute: 267 };
    expect(parseFormulaFavorites([{ ...favorite, attribute: 202 }])).toBeNull();
    expect(parseFormulaSettings({ favorites: [{ ...favorite, folder: "missing" }], folders: [] })).toBeNull();
    expect(parseFormulaSettings({ favorites: [favorite], folders: [] })?.favorites).toEqual([favorite]);
  });
  it("imports custom folder icons and remains compatible with folders without icons", () => {
    const folders = [{ id: "custom", name: "Custom", icon: "data:image/png;base64,folder-icon" }, { id: "default", name: "Default" }];
    expect(parseFormulaSettings(JSON.parse(JSON.stringify({ favorites: [], folders })))?.folders).toEqual(folders);
    expect(parseFormulaSettings({ favorites: [], folders: [{ id: "invalid", name: "Invalid", icon: 123 }] })).toBeNull();
  });
});