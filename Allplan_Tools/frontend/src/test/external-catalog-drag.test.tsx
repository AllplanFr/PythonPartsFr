import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalLibraryDialog } from "@/components/editor/ExternalLibraryDialog";
import { TreePanel } from "@/components/editor/TreePanel";
import { useCatalog } from "@/lib/catalog-store";
import { dragExternal, useExternalLibraries } from "@/lib/external-libraries";
import { seedDemo } from "./fixtures/seed-demo";
seedDemo();

const comp0 = Object.values(useCatalog.getState().nodes).find((n) => n.name === "130105E")!.id; useCatalog.setState({ selected: [comp0], anchor: comp0 });
const original = useCatalog.getState();
const libraries = useExternalLibraries.getState();
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useCatalog.setState({ ...original, lang: "en" }, true);
  useExternalLibraries.setState(libraries, true);
});
afterEach(() => { cleanup(); dragExternal.current = null; useCatalog.setState(original, true); vi.unstubAllGlobals(); });

function setup() {
  const source = libraries.sources[0]?.data;
  if (!source) throw new Error("Missing source");
  const before = JSON.stringify(source);
  const view = render(<><TreePanel /><ExternalLibraryDialog /></>);
  const external = view.container.querySelector('[data-external-id="ext-window-pvc"]');
  const target = view.container.querySelector(`[data-catalog-id="${original.selected[0]}"]`);
  if (!external || !target) throw new Error("Missing drag rows");
  const dataTransfer = { setData: vi.fn(), dropEffect: "none", effectAllowed: "none" };
  fireEvent.dragStart(external, { dataTransfer });
  expect(dragExternal.current?.ids).toEqual(["ext-window-pvc"]);
  fireEvent.dragOver(target, { dataTransfer });
  return { ...view, source, before, target, dataTransfer };
}

describe("External catalog native drag", () => {
  it("copies a component from its row as a sibling after the target, without modifying the DB", () => {
    const { target, dataTransfer, source, before } = setup();
    fireEvent.drop(target, { dataTransfer });
    const id = useCatalog.getState().selected[0] ?? "";
    const targetNode = original.nodes[original.selected[0] ?? ""];
    const parent = useCatalog.getState().nodes[targetNode?.parentId ?? ""];
    expect(useCatalog.getState().nodes[id]?.name).toBe("EXT_PFN_PVC");
    expect(parent?.children?.[1]).toBe(id);
    expect(JSON.stringify(source)).toBe(before);
    expect(useCatalog.getState().past.length).toBe(original.past.length + 1);
  });
  it("accepts the drop in the opened insertion gap", () => {
    const { container, dataTransfer } = setup();
    const gap = container.querySelector(".catalog-drop-gap");
    if (!gap) throw new Error("Missing insertion gap");
    fireEvent.drop(gap.parentElement ?? gap, { dataTransfer });
    const id = useCatalog.getState().selected[0] ?? "";
    expect(useCatalog.getState().nodes[id]?.name).toBe("EXT_PFN_PVC");
  });
});