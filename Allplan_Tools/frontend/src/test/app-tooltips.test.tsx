import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppTooltips } from "@/components/editor/AppTooltips";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("positions a tooltip once using stable layout dimensions rather than animated fractional bounds", () => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(110);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(34);
  let measurements = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "tooltip") {
      measurements++;
      return { left: 0, right: 110, top: 0, bottom: 34, width: 110 + measurements / 1000, height: 34, x: 0, y: 0, toJSON: () => ({}) };
    }
    return { left: window.innerWidth - 50, right: window.innerWidth - 2, top: 2, bottom: 30, width: 48, height: 28, x: window.innerWidth - 50, y: 2, toJSON: () => ({}) };
  });
  render(<><AppTooltips /><button title="Language">Language</button></>);
  fireEvent.mouseOver(screen.getByRole("button"));
  act(() => vi.advanceTimersByTime(350));
  const tooltip = screen.getByRole("tooltip");
  expect(tooltip.style.left).toBe(`${window.innerWidth - 118}px`);
  expect(tooltip.style.top).toBe("38px");
  expect(measurements).toBe(0);
});