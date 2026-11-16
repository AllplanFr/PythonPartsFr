import { beforeEach, expect, it } from "vitest";
import { useVobEditor, vobHasChanges, stripVobComment } from "@/lib/vob-editor";
import { applyVobDocument, toVobPayload } from "@/lib/vob-bridge";

const rule = { trade: "12", object: "1", unit: "1", method: "02", formula: "", comment: "" };
beforeEach(() => applyVobDocument({ file: null, rules: [rule, { ...rule, enabled: false }], header: ["//COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN"] }));

it("reads lines Python marked with // as disabled and writes the flag back", () => {
  const s = useVobEditor.getState();
  expect(s.rules.map((r) => r.enabled)).toEqual([true, false]);
  expect(toVobPayload(s.rules).map((r) => r.enabled)).toEqual([true, false]);
});
it("toggles activation as one undoable edit", () => {
  const id = useVobEditor.getState().rules[0]!.id;
  useVobEditor.getState().toggleEnabled([id]);
  expect(useVobEditor.getState().rules[0]!.enabled).toBe(false);
  useVobEditor.getState().undo();
  expect(useVobEditor.getState().rules[0]!.enabled).toBe(true);
});
it("shows header comments without the leading //, and header edits are unsaved changes", () => {
  expect(useVobEditor.getState().header).toEqual(["COMPANY=NEMETSCHEK", "PRODUCT=ALLPLAN"]);
  expect(stripVobComment("// ====")).toBe("====");
  useVobEditor.getState().setHeader(["TITLE=x"]);
  expect(vobHasChanges(useVobEditor.getState())).toBe(true);
  useVobEditor.getState().saveSession();
  expect(vobHasChanges(useVobEditor.getState())).toBe(false);
});
