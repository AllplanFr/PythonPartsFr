import { describe, expect, it } from "vitest";
import { applyCollapse, applyExpand } from "@/lib/tree-expand";

const nodes = {
  f: { id: "f", type: "folder", children: ["g"] },
  g: { id: "g", type: "group", children: ["c"] },
  c: { id: "c", type: "component" },
};

describe("tree expand presets", () => {
  it("expands folders only, keeping ouvrages closed", () => {
    expect(applyExpand(nodes, ["f"], {}, "folders", [])).toEqual({ f: true, g: false });
  });
  it("collapses all ouvrages but keeps folders open", () => {
    expect(applyCollapse(nodes, { f: true, g: true }, "groups", [])).toEqual({ f: true });
  });
  it("collapses only the children of the selection", () => {
    expect(applyCollapse(nodes, { f: true, g: true }, "selectionChildren", ["f"])).toEqual({ f: true });
  });
});
