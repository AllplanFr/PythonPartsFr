import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TemplateDialog } from "@/components/editor/TemplateDialog";
import { dragTemplate, useTemplates } from "@/lib/templates";

const initial = useTemplates.getState();
afterEach(() => { cleanup(); useTemplates.setState(initial, true); dragTemplate.current = null; vi.restoreAllMocks(); });

it("uses the previewed attribute position when dropping in a model gap", () => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useTemplates.setState({ models: [{ id: "gap-model", name: "Model", type: "component", attrs: [120, 202, 209].map((num) => ({ num, value: "", enabled: false })), children: [] }] });
  const { container } = render(<TemplateDialog />);
  const source = container.querySelector('[data-template-value="209"] [data-row-drag-grip]');
  const target = container.querySelector('[data-template-value="120"]');
  if (!source || !target?.parentElement) throw new Error("Missing model rows");
  const dataTransfer = { setData: vi.fn(), effectAllowed: "copy", dropEffect: "copy" };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.dragOver(target.parentElement, { dataTransfer });
  fireEvent.drop(target.parentElement, { dataTransfer });
  expect(useTemplates.getState().models[0]?.attrs.map((a) => a.num)).toEqual([209, 120, 202]);
});