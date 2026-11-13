import { describe, expect, it } from "vitest";
import { applyCustomOrder, mergeVisibleOrder, DEFAULT_ORDER } from "@/lib/attr-order";
const name = (n: number) => ({ 1: "b", 2: "a", 3: "c" } as Record<number, string>)[n] ?? "z";
describe("attribute order", () => {
  it("defaults", () => expect(DEFAULT_ORDER).toEqual([120, 202, 209, 110, 118, 141, 231]));
  it("custom first, others by fallback", () => {
    expect(applyCustomOrder([3, 209, 1, 120], [120, 202, 209], "asc", name)).toEqual([120, 209, 1, 3]);
    expect(applyCustomOrder([3, 2, 1, 120], [120], "name", name)).toEqual([120, 2, 1, 3]);
  });
  it("drag rewrites visible slots and keeps absent ones", () => {
    expect(mergeVisibleOrder([120, 202, 209, 110], [209, 120])).toEqual([209, 202, 120, 110]);
    expect(mergeVisibleOrder([120], [5, 120])).toEqual([5, 120]);
  });
});
describe("order favorites", () => {
  it("preserves folders and favorite membership on save and file roundtrip", async () => {
    const { useAttrOrder, parseOrderFavorites, parseOrderFolders } = await import("@/lib/attr-order");
    const favorites = [{ id: "nested", name: "Nested", folderId: "folder", order: [120, 209], fallback: "asc" as const }];
    const folders = [{ id: "folder", name: "My folder" }];
    useAttrOrder.getState().saveAll(favorites, "nested", folders);
    expect(useAttrOrder.getState().folders).toEqual(folders);
    expect(useAttrOrder.getState().favorites[0]?.folderId).toBe("folder");
    const file = JSON.parse(JSON.stringify({ favorites, folders }));
    expect(parseOrderFolders(file)).toEqual(folders);
    expect(parseOrderFavorites(file)).toEqual(favorites);
  });
  it("choosing a favorite applies its order", async () => {
    const { useAttrOrder } = await import("@/lib/attr-order");
    useAttrOrder.getState().saveAll([{ id: "a", name: "A", order: [1], fallback: "asc" }, { id: "b", name: "B", order: [9, 207, 3], fallback: "desc" }], "a");
    useAttrOrder.getState().choose("b");
    expect(useAttrOrder.getState().order).toEqual([9, 3]);
    expect(useAttrOrder.getState().fallback).toBe("desc");
    expect(useAttrOrder.getState().sort).toBe("custom");
  });
});
