import { expect, it } from "vitest";
import { addPresentationBatch } from "@/modules/information_manager/lib/presentation-batch";
import { configurationRows, moveTreeSelection, type TreeConfiguration, type TreeRow } from "@/modules/information_manager/lib/presentation-tree";

const row = (id: string, position: number): TreeRow => ({ kind: "row", id, position, num: position, title: id, widget: "entry", type: "STR", resetDefault: { state: "absent" } });
const sample = (): TreeConfiguration => ({ schema: "aim-presentation-configuration", version: 2, configurationId: "batch", resetPolicy: { applyOn: "explicit_reset_only", checkboxWithoutDefault: "unchecked" }, categories: [{ id: "cat", position: 1, name: "Category", icon: "", children: [] }] });

it("adds all 75 source attributes in their relative order without mutating the source", () => {
  const source = sample();
  const attrs = Array.from({ length: 75 }, (_, i) => ({ number: String(i + 1), label: `Attribute ${i + 1}` }));
  const result = addPresentationBatch(source, "cat", attrs);
  expect(result && configurationRows(result).map(row => row.num)).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
  expect(configurationRows(source)).toHaveLength(0);
});
it("rejects an invalid destination without adding part of the selection", () => {
  const source = sample();
  expect(addPresentationBatch(source, "all", [{ number: "1", label: "One" }])).toBeNull();
  expect(configurationRows(source)).toHaveLength(0);
});
it("moves a group and selected independent row once, without duplicating its selected children", () => {
  const source = sample();
  source.categories[0]?.children.push({ kind: "group", id: "g", position: 1, title: "Group", backgroundColor: "#FFFFFF", expanded: true, rows: [row("child", 1)] }, row("independent", 2));
  source.categories.push({ id: "dest", position: 2, name: "Destination", icon: "", children: [] });
  const result = moveTreeSelection(source, { kind: "group", id: "g", target: "dest", end: true }, ["g", "child", "independent"]);
  expect(result.categories[1]?.children.map(item => item.id)).toEqual(["g", "independent"]);
  expect(configurationRows(result).map(item => item.id)).toEqual(["child", "independent"]);
  expect(source.categories[1]?.children).toHaveLength(0);
});