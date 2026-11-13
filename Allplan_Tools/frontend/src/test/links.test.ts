import { beforeEach, describe, expect, it } from "vitest";
import { useCatalog, type CatalogNode } from "../lib/catalog-store";
import { linkStatus, linksTo } from "../lib/links";

const n = (id: string, type: CatalogNode["type"], parentId: string | null, children?: string[], name = id): CatalogNode => ({ id, type, name, description: "", parentId, attrs: {}, children });
describe("links", () => {
  beforeEach(() => useCatalog.getState().load({ nodes: {
    f: n("f", "folder", null, ["A", "B"]), A: n("A", "group", "f", ["c"]), B: n("B", "group", "f", []), c: n("c", "component", "A"),
  }, rootIds: ["f"] }));
  it("creates a link named after the ouvrage and renames it with the ouvrage", () => {
    const s = useCatalog.getState();
    const id = s.addLink("A", "B")!;
    expect(useCatalog.getState().nodes[id]?.name).toBe("A");
    useCatalog.getState().update("A", { name: "A2" });
    expect(useCatalog.getState().nodes[id]?.name).toBe("A2");
    expect(linksTo(useCatalog.getState().nodes, "A").map((l) => l.id)).toEqual([id]);
  });
  it("refuses self and circular links", () => {
    const s = useCatalog.getState();
    expect(s.addLink("A", "A")).toBeNull();
    s.addLink("A", "B");
    expect(useCatalog.getState().addLink("B", "A")).toBeNull();
  });
  it("flags dead links", () => {
    const id = useCatalog.getState().addLink("A", "B")!;
    useCatalog.getState().update(id, { name: "GONE" });
    expect(linkStatus(useCatalog.getState().nodes, useCatalog.getState().nodes[id]!)).toBe("dead");
  });
});
