import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, moveToolbarItem, parseLayout, toolbarGroups } from "@/modules/information_manager/lib/aim-interface";
import { normalizeTheme } from "@/modules/information_manager/lib/aim-theme";

describe("SmartCatalog ActionBar rules", () => {
  it("prohibits every group and command move while locked", () => {
    const locked = { ...DEFAULT_LAYOUT, locked: true };
    expect(moveToolbarItem(locked, { group: "view" }, { group: "add" })).toBe(locked);
    expect(moveToolbarItem(locked, { group: "view", button: "expand" }, { group: "add" })).toBe(locked);
  });
  it("moves groups before a target or to the blank end zone", () => {
    expect(toolbarGroups(moveToolbarItem(DEFAULT_LAYOUT, { group: "search" }, { group: "view" })).map((g) => g.id)).toEqual(["file", "search", "view", "add", "columns"]);
    expect(toolbarGroups(moveToolbarItem(DEFAULT_LAYOUT, { group: "view" })).at(-1)?.id).toBe("view");
  });
  it("reorders commands and transfers them without losing any action", () => {
    const next = moveToolbarItem(DEFAULT_LAYOUT, { group: "view", button: "expand" }, { group: "add", button: "group" });
    expect(toolbarGroups(next).find((g) => g.id === "view")?.buttons).toEqual(["collapse"]);
    expect(toolbarGroups(next).find((g) => g.id === "add")?.buttons).toEqual(["category", "expand", "group", "attribute"]);
    expect(parseLayout(next)).toEqual(next);
    expect(toolbarGroups(DEFAULT_LAYOUT)[1]?.buttons).toEqual(["expand", "collapse"]);
  });
  it("creates a separate toolbar group in the blank drop zone", () => {
    const next = moveToolbarItem(DEFAULT_LAYOUT, { group: "search", button: "search" });
    expect(toolbarGroups(next).at(-1)).toMatchObject({ label: "newGroup", color: "brand", buttons: ["search"] });
    expect(toolbarGroups(next).some((g) => g.id === "search")).toBe(false);
  });
  it("preserves toolbar titles and colors through import without altering old layouts", () => {
    const groups = toolbarGroups(DEFAULT_LAYOUT).map((g) => g.id === "add" ? { ...g, title: "Mes commandes", color: "#416596" } : g);
    expect(parseLayout({ ...DEFAULT_LAYOUT, groups }).groups?.[2]).toMatchObject({ title: "Mes commandes", color: "#416596" });
    expect(parseLayout(DEFAULT_LAYOUT)).toEqual(DEFAULT_LAYOUT);
  });
  it("replaces a removed Christmas preference with light and preserves standard themes", () => {
    expect(normalizeTheme("christmas")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
  });
  it("keeps File, View, Add, Columns and Search, and resets old five-module layouts", () => {
    expect(toolbarGroups(DEFAULT_LAYOUT).map((g) => g.id)).toEqual(["file", "view", "add", "columns", "search"]);
    expect(toolbarGroups(DEFAULT_LAYOUT).flatMap((g) => g.buttons)).not.toContain("manual");
    expect(() => parseLayout({ ...DEFAULT_LAYOUT, order: ["view", "add", "edit", "display", "search"] })).toThrow();
  });
});
import { insertAttribute } from "@/modules/information_manager/components/aim-columns";
describe("new attribute placement", () => {
  const rows = [{ num: 1, group: "A" }, { num: 2, group: "A" }, { num: 3 }];
  it("becomes first child of the selected group", () => { expect(insertAttribute(rows, { num: 9, group: "A" }, "A", null).map((r) => r.num)).toEqual([9, 1, 2, 3]); });
  it("goes right after the selected row", () => { expect(insertAttribute(rows, { num: 9, group: "A" }, null, 1).map((r) => r.num)).toEqual([1, 9, 2, 3]); });
  it("goes first in its container without selection", () => { expect(insertAttribute(rows, { num: 9 }, null, null).map((r) => r.num)).toEqual([1, 2, 9, 3]); });
});
describe("Import/Export presentation buttons", () => {
  it("puts Import then Export first in a File group", () => { expect(toolbarGroups(DEFAULT_LAYOUT)[0]).toMatchObject({ id: "file", buttons: ["import", "export"] }); });
  it("adds them to an older saved layout without losing its order or groups", () => {
    const old = { kind: "aim-menu-layout", version: 1, order: ["search", "view", "add", "columns"], showTitles: false, locked: true };
    expect(parseLayout(old)).toMatchObject({ order: ["file", "search", "view", "add", "columns"], showTitles: false, locked: true });
    const groups = [{ id: "view", label: "view", color: "brand", buttons: ["expand", "collapse", "category", "group", "attribute", "columns", "search"] }];
    expect(parseLayout({ ...old, groups }).groups?.map((g) => g.buttons)).toEqual([["import", "export"], groups[0]!.buttons]);
  });
});
