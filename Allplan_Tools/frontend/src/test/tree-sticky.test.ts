import { describe, expect, it } from "vitest";
import { stickyParents } from "@/lib/tree-sticky";
import type { CatalogNode } from "@/lib/catalog-store";
const make = (id: string, type: CatalogNode["type"], parentId: string | null): CatalogNode => ({ id, type, parentId, name: id, description: "", attrs: {} });
const nodes = { root: make("root", "folder", null), folder: make("folder", "folder", "root"), group: make("group", "group", "folder"), a: make("a", "component", "group"), b: make("b", "component", "group"), other: make("other", "group", "folder"), c: make("c", "component", "other") };
const rows = Object.values(nodes).map((node) => ({ id: node.id, depth: node.type === "component" ? 3 : node.type === "group" ? 2 : node.id === "root" ? 0 : 1 }));
const indices = new Map(rows.map((row, i) => [row.id, i]));
const at = (top: number, gap = -1) => stickyParents(rows, nodes, indices, top, 32, gap).map((r) => r.id);
describe("sticky catalog parents", () => {
  it("shows nothing at the start", () => expect(at(0)).toEqual([]));
  it("shows direct parent up to nearest folder, not higher folders", () => expect(at(96)).toEqual(["folder", "group"]));
  it("changes context at the next ouvrage", () => expect(at(160)).toEqual(["folder"]));
  it("shows the next component's parents", () => expect(at(192)).toEqual(["folder", "other"]));
  it("respects the inserted drag preview gap", () => expect(at(192, 4)).toEqual(["folder"]));
  it("handles an empty tree", () => expect(stickyParents([], nodes, new Map(), 64, 32)).toEqual([]));
});
