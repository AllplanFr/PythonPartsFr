import { beforeEach, describe, expect, it } from "vitest";
import { useCatalog } from "../lib/catalog-store";
import { parseExternalCatalog } from "../lib/external-catalog";
import { parseLibraryList, useExternalLibraries } from "../lib/external-libraries";
import { seedDemo } from "./fixtures/seed-demo";
seedDemo();

const comp0 = Object.values(useCatalog.getState().nodes).find((n) => n.name === "130105E")!.id; useCatalog.setState({ selected: [comp0], anchor: comp0 });
const initial = useCatalog.getState();
const source = useExternalLibraries.getState().sources[0]?.data;
beforeEach(() => useCatalog.setState(initial, true));

describe("External libraries", () => {
  it("copies source data without modifying the read-only library and preserves attribute order", () => {
    if (!source) throw new Error("Missing source fixture");
    const data = structuredClone(source); const node = data.nodes["ext-window"];
    if (!node) throw new Error("Missing node");
    node.attrOrder = [267, 209, 202, 120];
    const before = JSON.stringify(data);
    const target = Object.values(initial.nodes).find((n) => n.type === "folder" && n.children?.some((id) => initial.nodes[id]?.type === "group"));
    if (!target) throw new Error("Missing destination");
    const ids = useCatalog.getState().importExternal(data, ["ext-window", "ext-window-pvc"], target.id);
    expect(ids).toHaveLength(1);
    expect(useCatalog.getState().nodes[ids[0] ?? ""]?.attrOrder).toEqual([267, 209, 202, 120]);
    expect(useCatalog.getState().nodes[ids[0] ?? ""]?.children).toHaveLength(2);
    expect(JSON.stringify(data)).toBe(before);
    expect(useCatalog.getState().past).toHaveLength(initial.past.length + 1);
    useCatalog.getState().undo(); expect(useCatalog.getState().nodes).toEqual(initial.nodes);
  });
  it("rejects incompatible destinations without partial imports", () => {
    if (!source) throw new Error("Missing source fixture");
    expect(useCatalog.getState().importExternal(source, ["ext-window"], initial.selected[0] ?? null)).toEqual([]);
    expect(useCatalog.getState().nodes).toBe(initial.nodes);
    expect(useCatalog.getState().past).toHaveLength(initial.past.length);
  });
  it("rejects cyclic or inconsistent formatted data", () => {
    if (!source) throw new Error("Missing source fixture");
    const invalid = structuredClone(source); const folder = invalid.nodes["ext-joinery"];
    if (!folder) throw new Error("Missing folder");
    folder.children?.push(folder.id);
    expect(parseExternalCatalog(invalid)).toBeNull();
  });
  it("rejects a component placed in a folder during conversion", () => {
    if (!source) throw new Error("Missing fixture");
    const data = structuredClone(source);
    const component = data.nodes["ext-window-pvc"];
    if (!component) throw new Error("Missing component");
    data.nodes["ext-window"]?.children?.splice(0, 1);
    component.parentId = "ext-joinery";
    data.nodes["ext-joinery"]?.children?.push(component.id);
    expect(parseExternalCatalog(data)).toBeNull();
    expect(useCatalog.getState().importExternal(data, [component.id], initial.selected[0] ?? null)).toEqual([]);
    expect(useCatalog.getState().past).toHaveLength(initial.past.length);
  });
  it("rejects children attached to a component", () => {
    if (!source) throw new Error("Missing fixture");
    const data = structuredClone(source);
    const component = data.nodes["ext-window-pvc"];
    if (!component) throw new Error("Missing component");
    component.children = ["ext-window-alu"];
    expect(parseExternalCatalog(data)).toBeNull();
  });
  it("copies selected attributes atomically and preserves existing values and the source", () => {
    if (!source) throw new Error("Missing fixture");
    const target = initial.selected[0]; if (!target) throw new Error("Missing target");
    const before = JSON.stringify(source);
    expect(useCatalog.getState().importExternalAttrs(source, ["ext-window-pvc"], [120, 202], target)).toBe(1);
    expect(useCatalog.getState().nodes[target]?.attrs[120]).toBe("0");
    expect(useCatalog.getState().nodes[target]?.attrs[202]).toBe("m3");
    expect(JSON.stringify(source)).toBe(before);
    expect(useCatalog.getState().past).toHaveLength(initial.past.length + 1);
    useCatalog.getState().undo(); expect(useCatalog.getState().nodes).toEqual(initial.nodes);
  });
  it("rejects extra attributes on folders without partial writes", () => {
    if (!source) throw new Error("Missing fixture");
    const folder = initial.rootIds[0]; if (!folder) throw new Error("Missing folder");
    expect(useCatalog.getState().importExternalAttrs(source, ["ext-window-pvc"], [207, 120], folder)).toBeNull();
    expect(useCatalog.getState().nodes).toBe(initial.nodes);
    expect(useCatalog.getState().past).toHaveLength(initial.past.length);
  });
  it("imports a portable list containing file and URL libraries in folders", () => {
    if (!source) throw new Error("Missing fixture");
    const base = { name: "Library", version: "2027", dataSource: "STD", defAttr: 83, favorite: false, parentId: "folder", data: source };
    const list = { folders: [{ id: "folder", name: "Libraries", parentId: null }], sources: [{ ...base, id: "file", kind: "file", location: "library.db" }, { ...base, id: "url", kind: "url", location: "https://example.com/library.json" }] };
    expect(parseLibraryList(list)?.sources.map((s) => s.kind)).toEqual(["file", "url"]);
    expect(parseLibraryList({ ...list, folders: [{ id: "folder", name: "Libraries", parentId: "folder" }] })).toBeNull();
    expect(parseLibraryList({ ...list, sources: [{ ...list.sources[1], location: "javascript:alert(1)" }] })).toBeNull();
  });
});