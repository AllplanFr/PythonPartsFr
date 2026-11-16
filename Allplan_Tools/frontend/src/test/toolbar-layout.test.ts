import { describe, expect, it } from "vitest";
import { defaultMenuLayout, moveMenuItem, type MenuLayout } from "../lib/toolbar-layout";

const base = (): MenuLayout => ({ showTitles: false, groups: [
  { id: "view", label: "view", color: "brand", buttons: ["expand", "collapse"] },
  { id: "move", label: "move", color: "blue", buttons: ["up", "down"] },
] });
describe("toolbar layouts", () => {
  it("shows group titles in new and reset layouts", () => {
    expect(defaultMenuLayout(base().groups).showTitles).toBe(true);
  });
  it("moves groups without changing commands", () => {
    expect(moveMenuItem(base(), { group: "view" }).groups.map((g) => g.id)).toEqual(["move", "view"]);
  });
  it("transfers buttons and removes empty groups", () => {
    const first = moveMenuItem(base(), { group: "view", button: "expand" }, { group: "move", button: "down" });
    const result = moveMenuItem(first, { group: "view", button: "collapse" }, { group: "move" });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.buttons).toEqual(["up", "expand", "down", "collapse"]);
  });
  it("creates a group on a blank drop", () => {
    const result = moveMenuItem(base(), { group: "view", button: "expand" });
    expect(result.groups).toHaveLength(3);
    expect(result.groups[2]?.buttons).toEqual(["expand"]);
    expect(result.showTitles).toBe(false);
  });
  it("reorders within a group and leaves input untouched", () => {
    const input = base();
    const result = moveMenuItem(input, { group: "move", button: "down" }, { group: "move", button: "up" });
    expect(result.groups[1]?.buttons).toEqual(["down", "up"]);
    expect(input.groups[1]?.buttons).toEqual(["up", "down"]);
  });
});