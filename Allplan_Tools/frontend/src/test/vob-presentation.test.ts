import { expect, it } from "vitest";
import { vobUserResourcesFirst } from "@/lib/vob-presentation";

it("places user resources first without changing other groups or their internal entries", () => {
  const groups = [
    { key: "fav", entries: ["b", "a"] },
    { key: "2027", entries: ["PRJ", "STD", "ETC"] },
    { key: "2026", entries: ["z", "a"] },
    { key: "user", entries: ["second", "first"] },
  ];
  expect(vobUserResourcesFirst(groups)).toEqual([groups[3], groups[0], groups[1], groups[2]]);
  expect(groups.map((g) => g.key)).toEqual(["fav", "2027", "2026", "user"]);
  expect(vobUserResourcesFirst(groups)[0]?.entries).toEqual(["second", "first"]);
});