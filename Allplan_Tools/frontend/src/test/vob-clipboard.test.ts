import { describe, it, expect, beforeEach } from "vitest";
import { useVobEditor, type VobRule } from "@/lib/vob-editor";
import { parseMenuLayout, serializeMenuLayout } from "@/lib/toolbar-layout";

const rule = (id: string, formula: string): VobRule => ({ id, trade: "1", object: "2", unit: "3", method: "0", formula, comment: "" });

describe("VOB clipboard and reset", () => {
  beforeEach(() => useVobEditor.getState().load([rule("a", "A"), rule("b", "B")], null));

  it("pastes copied rules into another loaded file", () => {
    useVobEditor.getState().select("a"); useVobEditor.getState().copy();
    useVobEditor.getState().load([rule("x", "X")], { id: "f2", name: "f2", path: "C:/f2.dat" });
    useVobEditor.getState().select("x"); useVobEditor.getState().paste();
    expect(useVobEditor.getState().rules.map((r) => r.formula)).toEqual(["X", "A"]);
  });

  it("copies only the hovered rule independently of the selection", () => {
    const store = useVobEditor.getState(); store.selectMany(["a", "b"]); store.copy(["b"]);
    expect(useVobEditor.getState().clipboard.map((r) => r.formula)).toEqual(["B"]);
    expect(useVobEditor.getState().selectedIds).toEqual(["a", "b"]);
    expect(useVobEditor.getState().past).toHaveLength(0);
  });

  it("duplicates the hovered rule immediately after it and supports undo and redo", () => {
    const store = useVobEditor.getState(); store.select("a"); store.update("b", { enabled: false, comment: "B comment" });
    store.duplicate("b");
    const rules = useVobEditor.getState().rules;
    expect(rules.map((r) => r.formula)).toEqual(["A", "B", "B"]);
    expect(rules[2]?.id).not.toBe("b");
    expect(rules[2]).toMatchObject({ enabled: false, comment: "B comment" });
    store.undo(); expect(useVobEditor.getState().rules.map((r) => r.formula)).toEqual(["A", "B"]);
    store.redo(); expect(useVobEditor.getState().rules).toEqual(rules);
  });

  it("restores selected rule to its loaded values", () => {
    useVobEditor.getState().updateMany(["a"], { formula: "changed" });
    useVobEditor.getState().revert(["a"]);
    expect(useVobEditor.getState().rules[0]!.formula).toBe("A");
  });
});

describe("menu layout import", () => {
  it("round-trips an exported layout and rejects other files", () => {
    const layout = { groups: [{ id: "g", label: "edit", color: "brand", buttons: ["copy"] }], showTitles: false };
    expect(parseMenuLayout(JSON.parse(serializeMenuLayout("editor", layout)))).toEqual(layout);
    expect(parseMenuLayout({ groups: [] })).toBeNull();
  });
});
