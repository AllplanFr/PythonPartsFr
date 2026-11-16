import { afterEach, expect, it } from "vitest";
import { useVobEditor } from "@/lib/vob-editor";
import { useVobResources, vobFileHasChanges } from "@/lib/vob-resources";
const original = useVobEditor.getState();
afterEach(() => { useVobEditor.setState(original); useVobResources.setState({ drafts: [] }); });
it("reports edits to the open file immediately and clears them after save", () => {
  useVobEditor.getState().load([{ id: "a", trade: "12", object: "62", unit: "2", method: "02", formula: "1", comment: "" }], { id: "file", name: "vob_fra.dat", path: "C:/VOB/vob_fra.dat" });
  expect(vobFileHasChanges("c:/vob/vob_fra.dat")).toBe(false);
  useVobEditor.getState().update("a", { formula: "2" });
  expect(vobFileHasChanges("c:/vob/vob_fra.dat")).toBe(true);
  expect(useVobResources.getState().drafts).toEqual([]);
  useVobEditor.getState().saveSession();
  expect(vobFileHasChanges("c:/vob/vob_fra.dat")).toBe(false);
});