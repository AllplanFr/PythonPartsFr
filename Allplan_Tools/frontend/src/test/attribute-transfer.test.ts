import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCatalog, TITLE, type CatalogNode } from "../lib/catalog-store";

const node = (id: string, type: CatalogNode["type"], attrs: Record<number, string> = {}): CatalogNode => ({ id, type, name: id, description: `${id} description`, parentId: null, attrs });
describe("bulk attribute transfer", () => {
  beforeEach(() => {
    vi.stubGlobal("alert", vi.fn()); // legacy
    useCatalog.getState().load({ nodes: { source: node("source", "component", { 207: "text", 202: "m2", 203: "42", 209: "trade" }), target: node("target", "group"), folder: node("folder", "folder"), link: node("link", "link") }, rootIds: ["source", "target", "folder", "link"] });
  });
  it("copies a batch in one undo entry", () => {
    const s = useCatalog.getState();
    expect(s.transferAttrs("source", [202, 203], "target", false)).toBe(true);
    expect(useCatalog.getState().nodes["target"]?.attrs).toEqual({ 202: "m2", 203: "42" });
    expect(useCatalog.getState().nodes["source"]?.attrs[202]).toBe("m2");
    expect(useCatalog.getState().past).toHaveLength(1);
    s.undo();
    expect(useCatalog.getState().nodes["target"]?.attrs).toEqual({});
    s.redo();
    expect(useCatalog.getState().nodes["target"]?.attrs[203]).toBe("42");
  });
  it("moves extra attributes but preserves title and 207", () => {
    const s = useCatalog.getState();
    expect(s.transferAttrs("source", [TITLE, 207, 202, 203], "target", true)).toBe(true);
    expect(useCatalog.getState().nodes["source"]?.attrs).toEqual({ 207: "text", 209: "trade" });
    expect(useCatalog.getState().nodes["source"]?.name).toBe("source");
    expect(useCatalog.getState().nodes["target"]?.description).toBe("text");
    s.undo();
    expect(useCatalog.getState().nodes["source"]?.attrs[202]).toBe("m2");
  });
  it("rejects invalid batches without partial writes", () => {
    const s = useCatalog.getState();
    expect(s.transferAttrs("source", [207, 202], "folder", true)).toBe(false);
    expect(s.transferAttrs("source", [207], "link", false)).toBe(false);
    expect(s.transferAttrs("source", [202, 999], "target", true)).toBe(false);
    expect(useCatalog.getState().past).toHaveLength(0);
    expect(useCatalog.getState().nodes).toEqual(s.nodes);
  });
});