import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VOB_COLUMNS } from "@/lib/vob-view";
import type { VobRule } from "@/lib/vob-editor";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@/components/editor/VobRuleTree", () => ({ VOB_COLUMN_WIDTHS: {}, VobRuleTree: (props: unknown) => { capture(props); return null; } }));
import { VobRulePreview } from "@/components/editor/VobRulePreview";
afterEach(() => { cleanup(); capture.mockClear(); });

it("passes every rule and all six columns without editor filtering", () => {
  const rules: VobRule[] = Array.from({ length: 20 }, (_, i) => ({ id: String(i), trade: "12", object: "1", unit: "2", method: "02", formula: String(i), comment: "" }));
  render(<VobRulePreview rules={rules} groupBy="trade" columns={VOB_COLUMNS.map((key) => [key, key])} display={(r, key) => r[key]} displayIndex={() => ""} />);
  const props = capture.mock.calls.at(-1)?.[0];
  expect(props.rows).toEqual(rules);
  expect(props.rows).toHaveLength(20);
  expect(props.visible).toEqual(["trade", "object", "unit", "method", "formula"]);
  expect(props.onUpdate).toBeUndefined();
});
it("follows the editor grouping without changing its widths", () => {
  const view = render(<VobRulePreview rules={[]} groupBy="trade" columns={[]} display={() => ""} displayIndex={() => ""} />);
  view.rerender(<VobRulePreview rules={[]} groupBy="unit" columns={[]} display={() => ""} displayIndex={() => ""} />);
  expect(capture.mock.calls.at(-1)?.[0].groupBy).toBe("unit");
  expect(capture.mock.calls.at(-1)?.[0].savedWidths).toEqual({});
});