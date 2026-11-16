import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { VobRuleTree, VOB_COLUMN_WIDTHS } from "@/components/editor/VobRuleTree";

describe("VOB heading pointer moves", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const mount = () => {
    const onMoveColumn = vi.fn();
    const view = render(<VobRuleTree rows={[]} groupBy="trade" columns={[["trade", "Trade"], ["comment", "Comment"]]} visible={["trade", "comment"]} widths={VOB_COLUMN_WIDTHS} onResize={() => {}} onMoveColumn={onMoveColumn} closed={new Set()} onToggle={() => {}} selected={[]} onSelect={() => {}} display={() => ""} unset="<undefined>" />);
    const source = view.container.querySelector('[data-vob-header="comment"]');
    const target = view.container.querySelector('[data-vob-header="trade"]');
    if (!source || !target) throw new Error("Missing column heading");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => target) });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, right: 100, top: 0, bottom: 32, width: 100, height: 32, toJSON: () => ({}) });
    return { source, target, onMoveColumn };
  };
  it("moves from the heading margin without native drag events", () => {
    const { source, onMoveColumn } = mount();
    fireEvent.pointerDown(source, { button: 0, clientX: 203, clientY: 16 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 16 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 16 });
    expect(onMoveColumn).toHaveBeenCalledExactlyOnceWith("comment", "trade", false);
  });
  it("does not commit a cancelled pointer move", () => {
    const { source, onMoveColumn } = mount();
    fireEvent.pointerDown(source, { button: 0, clientX: 203, clientY: 16 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 16 });
    fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 16 });
    expect(onMoveColumn).not.toHaveBeenCalled();
  });
});