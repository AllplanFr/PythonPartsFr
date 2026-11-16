import { beforeEach, expect, it } from "vitest";
import { useVobEditor } from "@/lib/vob-editor";
import { clearVobSessions, setVobSessionHeader, stepVobSession, vobDirtyPaths } from "@/lib/vob-resources";
import { applyVobViewSettings, useVobViewSettings } from "@/lib/vob-view-settings";

beforeEach(() => { clearVobSessions(); useVobEditor.getState().load([], { id: "a", name: "a", path: "a" }, ["X"]); });
it("undoes and redoes header edits of the opened file", () => {
  const s = useVobEditor.getState(); s.setHeader(["Y"]); expect(useVobEditor.getState().header).toEqual(["Y"]);
  useVobEditor.getState().undo(); expect(useVobEditor.getState().header).toEqual(["X"]);
  useVobEditor.getState().redo(); expect(useVobEditor.getState().header).toEqual(["Y"]);
});
it("merges consecutive typing into one undo step", () => {
  useVobEditor.getState().setHeader(["X1"], { typing: true }); useVobEditor.getState().setHeader(["X12"], { typing: true });
  useVobEditor.getState().undo(); expect(useVobEditor.getState().header).toEqual(["X"]);
});
it("keeps a separate undo history for a non-opened file and lists every dirty file", () => {
  const b = { id: "b", name: "b", path: "b" }; setVobSessionHeader(b, [], ["O"], ["N"], false);
  useVobEditor.getState().setHeader(["Y"]); expect(vobDirtyPaths()).toEqual(["a", "b"]);
  expect(stepVobSession("b", "undo")).toEqual(["O"]); expect(vobDirtyPaths()).toEqual(["a"]);
});
it("restores the header splitter height from settings", () => {
  applyVobViewSettings({ headerHeight: 240 }); expect(useVobViewSettings.getState().headerHeight).toBe(240);
});
