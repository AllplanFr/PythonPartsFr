import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreePanel } from "@/components/editor/TreePanel";
import { useCatalog, type CatalogNode } from "@/lib/catalog-store";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Catalog creation visibility", () => {
  it("reveals a new first child even with 100 existing siblings", () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const original = useCatalog.getState();
    const nodes: Record<string, CatalogNode> = {
      group: { id: "group", name: "WORK", type: "group", description: "", parentId: null, attrs: {}, children: [] },
    };
    for (let i = 0; i < 100; i++) {
      const id = `child-${i}`;
      nodes[id] = { id, name: id, type: "component", description: "", parentId: "group", attrs: {} };
      nodes['group']?.children?.push(id);
    }
    useCatalog.setState({ nodes, rootIds: ["group"], expanded: { group: true }, selected: ["group"], search: "", searchOpts: { ...original.searchOpts, errorsOnly: false } });
    const { container } = render(<TreePanel />);
    const scroller = container.querySelector<HTMLElement>(".overflow-auto");
    if (!scroller) throw new Error("Catalog scroller missing");
    Object.defineProperty(scroller, "clientHeight", { value: 200 });
    act(() => useCatalog.getState().addNode("component"));
    expect(scroller.scrollTop).toBe(32);
    expect(useCatalog.getState().nodes['group']?.children?.[0]).toBe(useCatalog.getState().selected[0]);
    expect(useCatalog.getState().selected[0]).not.toBe("group");
    cleanup();
    useCatalog.setState(original);
  });
});