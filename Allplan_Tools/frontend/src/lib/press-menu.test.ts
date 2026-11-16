import { afterEach, describe, expect, it, vi } from "vitest";
import { createPressMenu } from "./press-menu";

afterEach(() => vi.useRealTimers());
describe("held model menu", () => {
  it("keeps a short click as the normal action", () => {
    vi.useFakeTimers(); const open = vi.fn(); const press = createPressMenu(open);
    press.start(); vi.advanceTimersByTime(100); press.cancel();
    expect(press.click()).toBe(true); vi.runAllTimers(); expect(open).not.toHaveBeenCalled();
  });
  it("opens on hold without also performing the normal action", () => {
    vi.useFakeTimers(); const open = vi.fn(); const press = createPressMenu(open);
    press.start(); vi.advanceTimersByTime(450);
    expect(open).toHaveBeenCalledTimes(1); press.cancel(); expect(press.click()).toBe(false);
    press.start(); press.cancel(); expect(press.click()).toBe(true);
  });
  it("cancels during toolbar dragging", () => {
    vi.useFakeTimers(); const open = vi.fn(); const press = createPressMenu(open);
    press.start(); press.drag(); vi.runAllTimers();
    expect(open).not.toHaveBeenCalled(); expect(press.click()).toBe(false);
  });
});