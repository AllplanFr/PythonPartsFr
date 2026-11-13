import { afterEach, describe, expect, it, vi } from "vitest";
import { displayVobTableReference, displayVobReference, vobDisplayOptions, vobUndefinedLabel, vobDisplayCode } from "@/lib/vob-reference-display";
import { parseVobReferences } from "@/lib/vob-references";
import { useVobEditor, type VobRule } from "@/lib/vob-editor";
import { connectVobHost, useVobHost, vobOpen, vobSave } from "@/lib/vob-bridge";
import { useAppDialog } from "@/lib/app-dialog";

afterEach(() => { delete window.pywebview; useAppDialog.setState({ queue: [] }); });
describe("VOB last targeted lot", () => {
  it.each(["trade", "object", "unit", "method"] as const)("hides only %s sentinel without changing saved values", (key) => {
    const rule: VobRule = { id: "a", trade: "-1", object: "-1", unit: "-1", method: "-1", formula: "A", comment: "" };
    useVobEditor.getState().load([rule], null);
    expect(displayVobTableReference({ kind: "none" }, key, rule[key], "fr")).toBe("");
    expect(displayVobTableReference({ kind: "none" }, key, "77", "fr")).toContain("référentiel indisponible");
    expect(vobDisplayCode(key, "77")).toBe("77"); // Index is rendered separately on the right.
    const metadata = { status: "available", sources: [{ scope: "ETC", path: "C:/Synthetic.xml", attributeNumber: null, language: "fr" }], diagnostics: [] };
    const state = parseVobReferences({ referenceContract: "vob-references/2", trades: [], objects: [], units: [], methods: [], metadata: { trades: metadata, objects: metadata, units: metadata, methods: metadata } });
    expect(displayVobTableReference(state, key, "77", "fr")).toBe("identifiant sans correspondance");
    expect(useVobEditor.getState().rules[0]?.[key]).toBe("-1");
    expect(useVobEditor.getState().saved[0]?.[key]).toBe("-1");
  });
  it.each([["fr", "<non défini>"], ["en", "<undefined>"]])("method -1 is contextual in %s, unit stays Default", (lang, label) => {
    expect(displayVobReference({ kind: "none" }, "method", "-1", lang)).toBe(label);
    expect(vobDisplayOptions({ kind: "none" }, "method", ["-1"], lang)[0]).toEqual({ value: "-1", label, index: "-1" });
    expect(displayVobReference({ kind: "none" }, "unit", "-1", lang)).toBe(lang === "fr" ? "Défaut" : "Default");
    expect(vobUndefinedLabel(lang)).toBe(label);
  });
  it("duplicates non-contiguous selection once, in order, selecting copies in one undo operation", () => {
    const rules: VobRule[] = ["a", "b", "c", "d"].map((id) => ({ id, trade: "0035", object: "007", unit: "-1", method: "02", formula: id, comment: id, enabled: id !== "c" }));
    useVobEditor.getState().load(rules, null, ["header"]);
    useVobEditor.getState().selectMany(["c", "a", "c"]);
    useVobEditor.getState().duplicate();
    const state = useVobEditor.getState();
    expect(state.rules.map((r) => r.formula)).toEqual(["a", "a", "b", "c", "c", "d"]);
    const copies = state.rules.filter((r) => state.selectedIds.includes(r.id));
    expect(copies.map((r) => r.formula)).toEqual(["a", "c"]);
    expect(new Set(state.rules.map((r) => r.id)).size).toBe(6);
    expect(state.selected).toBe(copies[0]?.id);
    expect(copies.map(({ id: _id, ...rest }) => rest)).toEqual([rules[0], rules[2]].map((r) => { if (!r) throw new Error("Missing original"); const { id: _id, ...rest } = r; return rest; }));
    expect(state.rules.filter((r) => ["a", "b", "c", "d"].includes(r.id))).toEqual(rules);
    expect(state.past).toHaveLength(1);
    expect(state.header).toEqual(["header"]);
    state.undo(); expect(useVobEditor.getState().rules).toEqual(rules);
    state.redo(); expect(useVobEditor.getState().rules).toEqual(state.rules);
  });
  it("updates recents immediately only from Python events after successful open/save-as, never builds a second list", async () => {
    const file = { id: "f", name: "new.fra", path: "C:/new.fra" };
    let outcome: "ok" | "cancel" | "error" = "ok";
    const call = vi.fn(async (command: string) => {
      if (command === "reference.load") return { ok: true as const, data: null };
      if (outcome === "cancel") return { ok: true as const, data: null };
      if (outcome === "error") return { ok: false as const, error: { code: "read_failed", message: "Synthetic failure" } };
      const path = command === "vob.save_as" ? "C:/copy.fra" : file.path;
      window.allplanHost?.receive("vob.recent_files", [path, "C:/old.fra"]);
      return { ok: true as const, data: command === "vob.open" ? { file, rules: [] } : { file: { ...file, path } } };
    });
    window.pywebview = { api: { get_app_info: async () => ({ app_id: "vob_editor" }), get_initial_data: async () => ({ recentFiles: ["C:/old.fra"] }), call } };
    const stop = connectVobHost();
    try {
      await vi.waitFor(() => expect(useVobHost.getState().recentFiles).toEqual(["C:/old.fra"]));
      await vobOpen(file.path); expect(useVobHost.getState().recentFiles).toEqual([file.path, "C:/old.fra"]);
      await vobSave(true); expect(useVobHost.getState().recentFiles).toEqual(["C:/copy.fra", "C:/old.fra"]);
      outcome = "cancel"; await vobOpen(); await vobSave(true);
      expect(useVobHost.getState().recentFiles).toEqual(["C:/copy.fra", "C:/old.fra"]);
      outcome = "error"; await vobOpen(); await vobSave(true);
      expect(useVobHost.getState().recentFiles).toEqual(["C:/copy.fra", "C:/old.fra"]);
      expect(call.mock.calls.every(([c]) => ["reference.load", "vob.open", "vob.save_as"].includes(c))).toBe(true);
    } finally { stop(); }
  });
});