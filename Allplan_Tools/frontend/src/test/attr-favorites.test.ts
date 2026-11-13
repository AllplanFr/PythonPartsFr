import { describe, expect, it } from "vitest";
import { DEFAULT_FAVORITES, toggleFavorites, isUserAttr, isImportAttr } from "@/lib/attr-favorites";

describe("attribute favorites", () => {
  it("ouvrage defaults", () => expect(DEFAULT_FAVORITES.group).toEqual([120, 202, 209]));
  it("component defaults", () => expect(DEFAULT_FAVORITES.component).toEqual([96, 120, 202, 209, 267]));
  it("formula defaults", () => expect(DEFAULT_FAVORITES.formula).toEqual([99, 220, 221, 222, 223, 229, 340, 341, 342, 343, 344]));
  it("toggle adds missing then removes", () => {
    expect(toggleFavorites([1], [1, 2])).toEqual([1, 2]);
    expect(toggleFavorites([1, 2], [1, 2])).toEqual([]);
  });
  it("user range 2000-11999", () => { expect(isUserAttr(2000)).toBe(true); expect(isUserAttr(11999)).toBe(true); expect(isUserAttr(12000)).toBe(false); });
  it("import between 55000 and 99000", () => { expect(isImportAttr(54999)).toBe(false); expect(isImportAttr(55000)).toBe(true); expect(isImportAttr(99000)).toBe(true); expect(isImportAttr(99001)).toBe(false); });
});
