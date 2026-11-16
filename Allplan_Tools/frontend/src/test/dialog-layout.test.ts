import { beforeEach, describe, expect, it } from "vitest";
import { fitDialogFrame, readDialogFrame, saveDialogFrame } from "@/lib/dialog-layout";

describe("personal window layouts", () => {
  beforeEach(() => localStorage.clear());
  it("restores each window's position and size independently", () => {
    saveDialogFrame("attributes", { x: 32, y: 48, width: 900, height: 700 });
    saveDialogFrame("trades", { x: 100, y: 80, width: 550, height: 480 });
    expect(readDialogFrame("attributes")).toEqual({ x: 32, y: 48, width: 900, height: 700 });
    expect(readDialogFrame("trades")).toEqual({ x: 100, y: 80, width: 550, height: 480 });
    expect(readDialogFrame("objects")).toBeNull();
  });
  it("keeps restored windows inside a smaller application viewport", () => {
    expect(fitDialogFrame({ x: 800, y: 700, width: 900, height: 720 }, { width: 640, height: 480 })).toEqual({ x: 8, y: 8, width: 624, height: 464 });
  });
  it("ignores corrupt and non-numeric saved sizes", () => {
    localStorage.setItem("smartcatalog-dialog-layouts", '{"objects":{"x":0,"y":0,"width":"500","height":400}}');
    expect(readDialogFrame("objects")).toBeNull();
  });
});