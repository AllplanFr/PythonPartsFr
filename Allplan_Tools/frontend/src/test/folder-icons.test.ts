import { describe, expect, it } from "vitest";
import { recordFolderIcon } from "@/lib/folder-icons";

describe("personal folder icons", () => {
  it("deduplicates artwork and increases usage without mutating history", () => {
    const first = recordFolderIcon([], "image-a", "A", 1);
    const second = recordFolderIcon(first, "image-a", "Renamed", 2);
    expect(second).toEqual([{ src: "image-a", name: "A", uses: 2, lastUsed: 2 }]);
    expect(first[0]?.uses).toBe(1);
  });
  it("retains enough entries to select the ten recent and most used independently", () => {
    let entries = recordFolderIcon([], "favorite", "Favorite", 0);
    entries = recordFolderIcon(entries, "favorite", "Favorite", 1);
    for (let i = 0; i < 12; i++) entries = recordFolderIcon(entries, `icon-${i}`, `${i}`, i + 2);
    const recent = [...entries].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 10);
    const frequent = [...entries].sort((a, b) => b.uses - a.uses).slice(0, 10);
    expect(recent).toHaveLength(10);
    expect(recent.some((entry) => entry.src === "favorite")).toBe(false);
    expect(frequent[0]?.src).toBe("favorite");
  });
});