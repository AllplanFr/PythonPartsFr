import { describe, expect, it } from "vitest";
import { buildFolderDrafts } from "@/lib/folder-batch";
import { useCatalog } from "@/lib/catalog-store";

describe("Batch folder creation", () => {
  it("splits title and description on the separator", () => {
    expect(buildFolderDrafts("A | desc a\nB", 1, true, "|", "Folder")).toEqual([{ name: "A", description: "desc a" }, { name: "B", description: "" }]);
  });
  it("fills up to the requested number", () => {
    expect(buildFolderDrafts("", 3, true, "|", "Folder").map((d) => d.name)).toEqual(["Folder 1", "Folder 2", "Folder 3"]);
  });
  it("accepts tab-separated pasted lists", () => {
    expect(buildFolderDrafts("A\tx", 0, true, "\\t", "F")).toEqual([{ name: "A", description: "x" }]);
  });
  it("adds all folders with the icon in one undo step", () => {
    useCatalog.setState({ nodes: {}, rootIds: [], selected: [], past: [], future: [] });
    useCatalog.getState().addFolders([{ name: "A", description: "" }, { name: "B", description: "d" }], "icon.png");
    const s = useCatalog.getState();
    expect(s.rootIds.map((id) => s.nodes[id]?.name)).toEqual(["A", "B"]);
    expect(s.nodes[s.rootIds[1]!]?.icon).toBe("icon.png");
    expect(s.past).toHaveLength(1);
  });
});

describe("Batch ouvrage creation", () => {
  it("applies a model per row and keeps ouvrage codes unique", () => {
    useCatalog.setState({ nodes: { f: { id: "f", type: "folder", name: "f", description: "", parentId: null, attrs: {}, children: [] } }, rootIds: ["f"], selected: ["f"], past: [], future: [] });
    const model = { id: "m", name: "M", type: "group" as const, attrs: [{ num: 202, value: "m2", enabled: true }], children: [] };
    const ids = useCatalog.getState().addBatch("group", [{ name: "A", description: "", model }, { name: "A", description: "" }]);
    const s = useCatalog.getState();
    expect(ids.map((id) => s.nodes[id]?.name)).toEqual(["A", "A (2)"]);
    expect(s.nodes[ids[0]!]?.attrs[202]).toBe("m2");
    expect(s.past).toHaveLength(1);
  });
});
