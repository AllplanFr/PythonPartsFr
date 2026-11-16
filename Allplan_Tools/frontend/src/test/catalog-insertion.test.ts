import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInsertion, useCatalog, type CatalogNode } from "@/lib/catalog-store";
import type { AttributeTemplate } from "@/lib/templates";

const original = useCatalog.getState();
function node(id: string, type: CatalogNode["type"], parentId: string | null, children?: string[]): CatalogNode {
  return { id, name: id, type, parentId, description: "", attrs: {}, children };
}
beforeEach(() => useCatalog.setState({ nodes: {
  folder: node("folder", "folder", null, ["group", "other"]),
  group: node("group", "group", "folder", ["a", "b", "link"]),
  other: node("other", "group", "folder", []),
  a: node("a", "component", "group"), b: node("b", "component", "group"), link: node("link", "link", "group"),
}, rootIds: ["folder"], selected: ["group"], past: [], future: [], dirty: false, insertionChoice: null }));
afterEach(() => useCatalog.setState(original));

describe("Shared menu and drop insertion", () => {
  it("adds a valid child at index zero", () => {
    useCatalog.getState().addNode("component");
    const s = useCatalog.getState();
    expect(s.nodes['group']?.children).toEqual([s.selected[0], "a", "b", "link"]);
  });
  it("adds a same-type component after the selected component without children", () => {
    useCatalog.getState().select("a"); useCatalog.getState().addNode("component");
    const s = useCatalog.getState();
    expect(s.nodes['group']?.children).toEqual(["a", s.selected[0], "b", "link"]);
    expect(s.nodes['a']?.children).toBeUndefined();
  });
  it("adds a same-type ouvrage as sibling, not into a distant ancestor", () => {
    useCatalog.getState().addNode("group"); const s = useCatalog.getState();
    expect(s.nodes['folder']?.children).toEqual(["group", s.selected[0], "other"]);
  });
  it("moves a component onto a component as its next sibling", () => {
    useCatalog.getState().select("b"); useCatalog.getState().moveOn("b", "link");
    expect(useCatalog.getState().nodes['group']?.children).toEqual(["a", "link", "b"]);
    expect(useCatalog.getState().nodes['link']?.children).toBeUndefined();
  });
  it("moves batches to first children preserving source order in one undo step", () => {
    useCatalog.setState({ selected: ["a", "b"] }); useCatalog.getState().moveOn("a", "other");
    expect(useCatalog.getState().nodes['other']?.children).toEqual(["a", "b"]);
    expect(useCatalog.getState().past).toHaveLength(1);
    useCatalog.getState().undo(); expect(useCatalog.getState().nodes['group']?.children).toEqual(["a", "b", "link"]);
  });
  it("inserts a component model beside a component", () => {
    const model: AttributeTemplate = { id: "model", name: "Model", type: "component", attrs: [], children: [] };
    const id = useCatalog.getState().insertTemplate(model, "a");
    expect(id).not.toBeNull(); expect(useCatalog.getState().nodes['group']?.children).toEqual(["a", id, "b", "link"]);
  });
  it("imports external components beside the target in order, preserving the source", () => {
    const source = { nodes: { f: node("f", "folder", null, ["g"]), g: node("g", "group", "f", ["x", "y"]), x: node("x", "component", "g"), y: node("y", "component", "g") }, rootIds: ["f"] };
    const before = JSON.stringify(source);
    const ids = useCatalog.getState().importExternal(source, ["x", "y"], "a");
    expect(ids).toHaveLength(2); expect(useCatalog.getState().nodes['group']?.children).toEqual(["a", ...ids, "b", "link"]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("pastes copied components as first children", () => {
    useCatalog.getState().select("a"); useCatalog.getState().copy(false); useCatalog.getState().select("group"); useCatalog.getState().paste();
    const s = useCatalog.getState(); expect(s.nodes['group']?.children).toEqual([s.selected[0], "a", "b", "link"]);
  });
  it("rejects moving an ancestor into its descendant without creating history", () => {
    useCatalog.getState().select("folder"); useCatalog.getState().moveOn("folder", "group"); expect(useCatalog.getState().past).toHaveLength(0);
  });
  it("adds a folder on an ouvrage after the ouvrage's parent folder", () => {
    useCatalog.setState({ rootIds: ["folder", "z"], nodes: { ...useCatalog.getState().nodes, z: node("z", "folder", null, []) } });
    useCatalog.getState().select("group"); useCatalog.getState().addNode("folder");
    const s = useCatalog.getState(); expect(s.rootIds).toEqual(["folder", s.selected[0], "z"]);
  });
  it("does not allow mixing folders and ouvrages", () => {
    const s = useCatalog.getState(); expect(resolveInsertion(s.nodes, s.rootIds, "folder", ["folder"], "child")).toBeNull();
  });
});

describe("Folder insertion choice", () => {
  beforeEach(() => useCatalog.setState({ nodes: { root: node("root", "folder", null, ["target", "end"]), target: node("target", "folder", "root", []), end: node("end", "folder", "root", []) }, rootIds: ["root"], selected: ["target"] }));
  it("waits for a choice without modifying catalog history", () => {
    useCatalog.getState().addNode("folder"); expect(useCatalog.getState().insertionChoice?.targetId).toBe("target");
    expect(useCatalog.getState().past).toHaveLength(0); useCatalog.getState().chooseInsertion(null);
    expect(Object.keys(useCatalog.getState().nodes)).toHaveLength(3);
  });
  it("adds a first child after choosing child", () => {
    useCatalog.getState().addNode("folder"); useCatalog.getState().chooseInsertion("child"); const s = useCatalog.getState();
    expect(s.nodes['target']?.children).toEqual(s.selected); expect(s.past).toHaveLength(1);
  });
  it("adds a sibling after choosing sibling", () => {
    useCatalog.getState().addNode("folder"); useCatalog.getState().chooseInsertion("sibling"); const s = useCatalog.getState();
    expect(s.nodes['root']?.children).toEqual(["target", s.selected[0], "end"]); expect(s.nodes['target']?.children).toEqual([]);
  });
  it("asks on a folder drop and applies the chosen location", () => {
    useCatalog.getState().select("end"); useCatalog.getState().moveOn("end", "target");
    expect(useCatalog.getState().insertionChoice).not.toBeNull(); useCatalog.getState().chooseInsertion("child");
    expect(useCatalog.getState().nodes['target']?.children).toEqual(["end"]);
  });
});