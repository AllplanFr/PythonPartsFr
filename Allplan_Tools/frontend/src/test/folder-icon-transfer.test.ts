import { beforeEach, describe, expect, it } from "vitest";
import { useCatalog, type CatalogNode } from "../lib/catalog-store";

const folder = (id: string, icon?: string): CatalogNode => ({ id, type: "folder", name: id, description: "", parentId: null, attrs: {}, children: [], icon });

describe("folder icon information transfer", () => {
  beforeEach(() => {
    useCatalog.getState().load({ nodes: {
      source: folder("source", "data:image/png;base64,custom"),
      target: folder("target"),
      custom: folder("custom", "data:image/png;base64,other"),
      component: { ...folder("component"), type: "component" },
    }, rootIds: ["source", "target", "custom", "component"] });
  });

  it("copies without changing source, title, or structure; supports undo and redo", () => {
    const s = useCatalog.getState();
    expect(s.copyFolderIcon("source", "target")).toBe(true);
    expect(useCatalog.getState().nodes["target"]).toEqual({ ...folder("target"), icon: s.nodes["source"]?.icon });
    expect(useCatalog.getState().nodes["source"]).toEqual(s.nodes["source"]);
    s.undo();
    expect(useCatalog.getState().nodes["target"]?.icon).toBeUndefined();
    s.redo();
    expect(useCatalog.getState().nodes["target"]?.icon).toBe(s.nodes["source"]?.icon);
  });

  it("copies the default icon to reset a custom icon", () => {
    expect(useCatalog.getState().copyFolderIcon("target", "custom")).toBe(true);
    expect(useCatalog.getState().nodes["custom"]?.icon).toBeUndefined();
  });

  it("rejects non-folders, missing nodes, self drops, and identical icons", () => {
    const s = useCatalog.getState();
    expect(s.copyFolderIcon("source", "component")).toBe(false);
    expect(s.copyFolderIcon("component", "target")).toBe(false);
    expect(s.copyFolderIcon("missing", "target")).toBe(false);
    expect(s.copyFolderIcon("source", "source")).toBe(false);
    expect(s.past).toHaveLength(0);
    s.copyFolderIcon("source", "target");
    expect(s.copyFolderIcon("source", "target")).toBe(false);
    expect(useCatalog.getState().past).toHaveLength(1);
  });
});