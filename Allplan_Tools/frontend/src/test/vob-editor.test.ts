import { beforeEach, expect, it } from "vitest";
import { useVobEditor, vobHasChanges, commonVobValues } from "@/lib/vob-editor";
import { useCatalog } from "@/lib/catalog-store";
import { formatVobFormula, VOB_COLUMNS, VOB_METHODS, VOB_UNITS, DEFAULT_VOB_GROUP, defaultVobSearch, filterVobRules, filterVobValues, groupVobRules } from "@/lib/vob-view";

beforeEach(() => useVobEditor.setState({ rules: [], saved: [], past: [], future: [], selected: null, selectedIds: [], open: false }));
it("uses attribute 120 units and their stored enumeration indices", () => {
  expect(VOB_UNITS).toEqual([
    { value: "0", label: "m³", index: "0" },
    { value: "1", label: "m²", index: "1" },
    { value: "2", label: "m", index: "2" },
    { value: "3", label: "Pc", index: "3" },
    { value: "4", label: "kg", index: "4" },
  ]);
});
it("starts without demo VOB rules or files", () => {
  const fresh = useVobEditor.getInitialState();
  expect(fresh.rules).toEqual([]); expect(fresh.files).toEqual([]);
});
it("keeps edited rules when closing and reopening the VOB session", () => {
  const history = useCatalog.getState().past;
  useVobEditor.getState().add();
  const id = useVobEditor.getState().selected; if (!id) throw new Error("Missing new rule");
  useVobEditor.getState().update(id, { formula: "@223@*2", comment: "Concrete" });
  useVobEditor.getState().setOpen(false); useVobEditor.getState().setOpen(true);
  expect(useVobEditor.getState().rules[0]).toMatchObject({ formula: "@223@*2", comment: "Concrete" });
  expect(useCatalog.getState().past).toBe(history);
});
it("duplicates independently and restores deleted rules with undo", () => {
  useVobEditor.getState().add(); useVobEditor.getState().duplicate();
  const rules = useVobEditor.getState().rules;
  expect(rules).toHaveLength(2); expect(rules[0]?.id).not.toBe(rules[1]?.id);
  useVobEditor.getState().remove(true); expect(useVobEditor.getState().rules).toHaveLength(0);
  useVobEditor.getState().undo(); expect(useVobEditor.getState().rules).toEqual(rules);
  useVobEditor.getState().redo(); expect(useVobEditor.getState().rules).toHaveLength(0);
});
it("marks only the current session saved without clearing history", () => {
  useVobEditor.getState().add(); expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  useVobEditor.getState().saveSession(); expect(vobHasChanges(useVobEditor.getState())).toBe(false);
  expect(useVobEditor.getState().past).toHaveLength(1);
});
it.each(VOB_COLUMNS)("groups identical %s conditions without changing rules", (column) => {
  const base = { trade: "1", object: "2", unit: "m3", method: "01", formula: "@223@", comment: "Concrete" };
  const rules = [{ ...base, id: "a" }, { ...base, id: "b" }, { ...base, id: "c", [column]: "different" }];
  const groups = groupVobRules(rules, column);
  expect(groups).toHaveLength(2);
  expect(groups[0]?.rules.map((r) => r.id)).toEqual(["a", "b"]);
  expect(groups[1]?.rules.map((r) => r.id)).toEqual(["c"]);
  expect(rules.map((r) => r.id)).toEqual(["a", "b", "c"]);
});
it("offers the calculation method indices from the supplied reference", () => {
  expect(VOB_METHODS.map((m) => m.value)).toEqual(["-1", "01", "02", "03", "04", "05", "06", "13"]);
  expect(VOB_METHODS.find((m) => m.value === "03")?.fr).toBe("Sol");
  expect(VOB_METHODS.find((m) => m.value === "06")?.fr).toBe("Surface médiane");
});
it("keeps -1 as the unset calculation method", () => {
  useVobEditor.getState().add();
  const id = useVobEditor.getState().selected; if (!id) throw new Error("Missing rule");
  useVobEditor.getState().update(id, { method: "-1" });
  expect(useVobEditor.getState().rules[0]?.method).toBe("-1");
  expect(VOB_METHODS.filter((m) => m.value === "-1")).toHaveLength(1);
});
it("preserves negative operands while distinguishing comparison symbols", () => {
  expect(formatVobFormula("@229@<-2.5|@223@->0")).toBe("@229@< −2.5|@223@>0");
});
it("searches only checked columns with the selected matching mode and case", () => {
  const rules = [{ id: "a", trade: "", object: "Wall", unit: "m2", method: "", formula: "", comment: "Concrete" }];
  const options = { ...defaultVobSearch(), columns: ["object" as const], mode: "equals" as const, matchCase: true };
  const display = (r: typeof rules[number], key: keyof Omit<typeof rules[number], "id">) => r[key];
  expect(filterVobRules(rules, "Concrete", options, display)).toHaveLength(0);
  expect(filterVobRules(rules, "wall", options, display)).toHaveLength(0);
  expect(filterVobRules(rules, "Wall", options, display)).toHaveLength(1);
});
const scopes = [
  { id: "a", trade: "1", object: "Wall", unit: "m2", method: "01", formula: "", comment: "Concrete" },
  { id: "b", trade: "1", object: "Slab", unit: "m3", method: "04", formula: "", comment: "Concrete" },
  { id: "c", trade: "2", object: "Wall", unit: "m2", method: "02", formula: "", comment: "Brick" },
];
it("filters active rules including legacy lines with no explicit activation flag", () => {
  const rules = scopes.map((r, i) => i === 0 ? r : { ...r, enabled: i === 1 });
  expect(filterVobValues(rules, { enabled: ["active"] }).map((r) => r.id)).toEqual(["a", "b"]);
});
it("combines disabled state with field filters without changing source rules", () => {
  const rules = scopes.map((r, i) => ({ ...r, enabled: i === 1 }));
  expect(filterVobValues(rules, { enabled: ["inactive"], trade: ["1"] }).map((r) => r.id)).toEqual(["a"]);
  expect(rules.map((r) => r.enabled)).toEqual([false, true, false]);
});
it("shows both states when both or neither activation choices are selected", () => {
  const rules = scopes.slice(0, 2).map((r, i) => ({ ...r, enabled: i === 1 }));
  expect(filterVobValues(rules, { enabled: ["active", "inactive"] }).map((r) => r.id)).toEqual(["a", "b"]);
  expect(filterVobValues(rules, { enabled: [] }).map((r) => r.id)).toEqual(["a", "b"]);
});
it("defaults to a single trade grouping", () => {
  expect(DEFAULT_VOB_GROUP).toBe("trade");
  expect(groupVobRules(scopes, DEFAULT_VOB_GROUP).map((g) => g.value)).toEqual(["1", "2"]);
});
it("sorts trade groups by accented case-insensitive labels without changing rule or file order", () => {
  const base = { object: "1", unit: "2", method: "01", formula: "A", comment: "" };
  const rules = [
    { ...base, id: "z1", trade: "z" },
    { ...base, id: "e1", trade: "e" },
    { ...base, id: "a1", trade: "a" },
    { ...base, id: "z2", trade: "z" },
  ];
  const labels: Record<string, string> = { z: "Zinguerie", e: "électricité", a: "Agencement" };
  const groups = groupVobRules(rules, "trade", (rule) => labels[rule.trade] ?? rule.trade);
  expect(groups.map((g) => g.value)).toEqual(["a", "e", "z"]);
  expect(groups[2]?.rules.map((r) => r.id)).toEqual(["z1", "z2"]);
  expect(rules.map((r) => r.id)).toEqual(["z1", "e1", "a1", "z2"]);
});
it("does not alphabetically reorder other grouping levels", () => {
  const rules = scopes.slice(0, 2).map((rule, index) => ({ ...rule, object: index === 0 ? "Z" : "A" }));
  expect(groupVobRules(rules, "object", (rule, key) => rule[key]).map((g) => g.value)).toEqual(["Z", "A"]);
});
it("combines option 1 and option 4 as alternatives within a filter", () => {
  expect(filterVobValues(scopes, { method: ["01", "04"] }).map((r) => r.id)).toEqual(["a", "b"]);
});
it("combines field filters with search before grouping", () => {
  const filtered = filterVobValues(scopes, { trade: ["1", "2"], object: ["Wall"] });
  expect(filtered.map((r) => r.id)).toEqual(["a", "c"]);
  const searched = filterVobRules(filtered, "Concrete", defaultVobSearch(), (r, key) => r[key]);
  expect(groupVobRules(searched, "trade")[0]?.rules.map((r) => r.id)).toEqual(["a"]);
  expect(filterVobValues(scopes, { object: [] })).toHaveLength(3);
});
it("accepts PythonPart files without changing rules or catalog history and offers no creation action", () => {
  const history = useCatalog.getState().past;
  useVobEditor.getState().add();
  const rules = useVobEditor.getState().rules;
  const files = [{ id: "fr", name: "vob_fra.fra", path: "STD/vob_fra.fra" }];
  useVobEditor.getState().setFiles(files);
  expect(useVobEditor.getState().files).toEqual(files);
  expect(useVobEditor.getState().rules).toBe(rules);
  expect(useCatalog.getState().past).toBe(history);
  expect("newFile" in useVobEditor.getState()).toBe(false);
});

it("edits only the changed field across selected rules with one undo entry", () => {
  useVobEditor.setState({ rules: scopes });
  useVobEditor.getState().select("a");
  useVobEditor.getState().select("b", { toggle: true });
  useVobEditor.getState().updateMany(useVobEditor.getState().selectedIds, { method: "06" });
  expect(useVobEditor.getState().rules.map((r) => r.method)).toEqual(["06", "06", "02"]);
  expect(useVobEditor.getState().rules.map((r) => r.object)).toEqual(["Wall", "Slab", "Wall"]);
  expect(useVobEditor.getState().past).toHaveLength(1);
  useVobEditor.getState().undo();
  expect(useVobEditor.getState().rules).toEqual(scopes);
  expect(useVobEditor.getState().selectedIds).toEqual(["a", "b"]);
});
it("distinguishes common values from variable fields without changing data", () => {
  const result = commonVobValues(scopes.slice(0, 2));
  expect(result?.mixed.has("object")).toBe(true);
  expect(result?.mixed.has("method")).toBe(true);
  expect(result?.mixed.has("trade")).toBe(false);
  expect(result?.rule.trade).toBe("1");
});
it("selects a range in visible tree order", () => {
  useVobEditor.setState({ rules: scopes });
  useVobEditor.getState().select("c");
  useVobEditor.getState().select("b", { range: true, order: ["c", "a", "b"] });
  expect(useVobEditor.getState().selectedIds).toEqual(["c", "a", "b"]);
});
it("trims columns from the highest index first and keeps index 0 intact", async () => {
  const { fitVobColumns } = await import("@/lib/vob-view");
  expect(fitVobColumns([100, 100, 100], 400)).toEqual([100, 100, 100]);
  expect(fitVobColumns([100, 100, 100], 230)).toEqual([100, 80, 50]);
  expect(fitVobColumns([100, 100, 100], 120)).toEqual([100, 50, 50]);
});
