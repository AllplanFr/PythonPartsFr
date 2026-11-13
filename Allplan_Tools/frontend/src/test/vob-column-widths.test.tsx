import { useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VobRuleTree, VOB_COLUMN_WIDTHS } from "@/components/editor/VobRuleTree";
import { fitVobColumns, type VobColumn } from "@/lib/vob-view";
import type { VobRule } from "@/lib/vob-editor";

const row: VobRule = { id: "a", trade: "Masonry", object: "Wall", unit: "1", method: "02", formula: "", comment: "" };
let resizeObserver: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resizeObserver = cb; } observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: (s: string) => ({ width: s.length * 8 }) } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness({ rows = [row], saved = {} }: { rows?: VobRule[]; saved?: Partial<Record<VobColumn, number>> }) {
  const [manual, setManual] = useState<Partial<Record<VobColumn, number>>>({});
  return <VobRuleTree rows={rows} columns={[["trade", "Trade"], ["object", "Object"]]} groupBy="trade" visible={["trade", "object"]} widths={VOB_COLUMN_WIDTHS} savedWidths={{ ...saved, ...manual }} onResize={(key, width) => setManual((old) => ({ ...old, [key]: width }))} selected={[]} closed={new Set()} onToggle={() => {}} onSelect={() => {}} display={(r, key) => r[key]} unset="<undefined>" />;
}
const grid = (view: ReturnType<typeof render>) => view.container.querySelector<HTMLElement>('[data-vob-header]')?.parentElement?.style.gridTemplateColumns;

it("preserves a dragged width after edits, filtering and panel resize", () => {
  const view = render(<Harness />);
  const handle = view.getByRole("separator", { name: "Trade" });
  fireEvent.pointerDown(handle, { clientX: 100 });
  fireEvent.pointerMove(window, { clientX: 200 });
  fireEvent.pointerUp(window);
  const chosen = grid(view);
  expect(chosen?.split(" ")[0]).toBe("240px");
  view.rerender(<Harness rows={[{ ...row, trade: "A very long changed reference" }]} />);
  expect(grid(view)?.split(" ")[0]).toBe("240px");
  view.rerender(<Harness rows={[]} />);
  act(() => resizeObserver?.());
  expect(grid(view)?.split(" ")[0]).toBe("240px");
});
it("uses restored widths without writing automatic fits back to settings", () => {
  const onResize = vi.fn();
  const view = render(<VobRuleTree rows={[row]} columns={[["trade", "Trade"]]} groupBy="trade" visible={["trade"]} widths={VOB_COLUMN_WIDTHS} savedWidths={{ trade: 333 }} onResize={onResize} selected={[]} closed={new Set()} onToggle={() => {}} onSelect={() => {}} display={(r, key) => r[key]} unset="<undefined>" />);
  act(() => window.dispatchEvent(new Event("vob-settings-loaded")));
  expect(grid(view)?.split(" ")[0]).toBe("333px");
  expect(onResize).not.toHaveBeenCalled();
});
it("never trims a saved column while fitting the remaining columns by priority", () => {
  expect(fitVobColumns([100, 100, 200], 300, 50, [false, false, true])).toEqual([100, 50, 200]);
});