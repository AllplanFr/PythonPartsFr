import { describe, it, expect } from "vitest";
import { collectSettings, applySettings, SETTINGS_SECTIONS } from "@/lib/app-settings";
import { useToolbarLayouts } from "@/lib/toolbar-layout";
import { useCatalog } from "@/lib/catalog-store";
import { useVobViewSettings, defaultVobViewSettings } from "@/lib/vob-view-settings";

describe("app settings", () => {
  it("collects every dialog section with a version", () => {
    const s = collectSettings();
    expect(s.version).toBe(1);
    for (const k of Object.keys(SETTINGS_SECTIONS)) expect(k in s).toBe(true);
  });
  it("freeze presentation defaults to off and round-trips", () => {
    expect((collectSettings().toolbars as { frozen: boolean }).frozen).toBe(false);
    applySettings({ toolbars: { frozen: true }, general: { dark: true } });
    expect(useToolbarLayouts.getState().frozen).toBe(true);
    expect(useCatalog.getState().dark).toBe(true);
  });
  it("ignores invalid sections", () => {
    const before = collectSettings().attributeModels;
    applySettings({ attributeModels: "bad" });
    expect(collectSettings().attributeModels).toEqual(before);
  });
});

describe("VOB editor settings", () => {
  it("round-trips columns, grouping and splitter and ignores invalid values", () => {
    applySettings({ vobEditor: { visible: ["trade", "formula", "bad"], groupBy: "object", split: 40, widths: { comment: 200, bad: 5 } } });
    expect(collectSettings().vobEditor).toEqual({ order: ["trade", "object", "unit", "method", "formula", "comment"], visible: ["trade", "formula"], groupBy: "object", split: 40, widths: { comment: 200 }, headerHeight: 168 });
    applySettings({ vobEditor: { split: 99, groupBy: "nope" } });
    expect((collectSettings().vobEditor as { split: number }).split).toBe(40);
  });
  it("restores reordered columns through Python settings", () => {
    useVobViewSettings.getState().set(defaultVobViewSettings());
    useVobViewSettings.getState().moveColumn("comment", "trade", false);
    const saved = collectSettings(["vobEditor"]);
    expect((saved.vobEditor as { order: string[] }).order).toEqual(["comment", "trade", "object", "unit", "method", "formula"]);
    useVobViewSettings.getState().set(defaultVobViewSettings());
    applySettings(saved);
    expect(useVobViewSettings.getState().order).toEqual(["comment", "trade", "object", "unit", "method", "formula"]);
    useVobViewSettings.getState().set(defaultVobViewSettings());
  });
  it("retains hidden columns in their order and inserts moved columns after the target", () => {
    useVobViewSettings.getState().set({ ...defaultVobViewSettings(), visible: ["trade", "comment"] });
    useVobViewSettings.getState().moveColumn("trade", "comment", true);
    expect(useVobViewSettings.getState().order).toEqual(["object", "unit", "method", "formula", "comment", "trade"]);
    expect(useVobViewSettings.getState().visible).toEqual(["trade", "comment"]);
    useVobViewSettings.getState().set(defaultVobViewSettings());
  });
  it("normalizes duplicate and unknown columns, appending missing ones", () => {
    applySettings({ vobEditor: { order: ["comment", "comment", "bad", "trade"] } });
    expect(useVobViewSettings.getState().order).toEqual(["comment", "trade", "object", "unit", "method", "formula"]);
    useVobViewSettings.getState().set(defaultVobViewSettings());
    applySettings({ vobEditor: { visible: ["trade"] } });
    expect(useVobViewSettings.getState().order).toEqual(["trade", "object", "unit", "method", "formula", "comment"]);
    useVobViewSettings.getState().set(defaultVobViewSettings());
  });
});
