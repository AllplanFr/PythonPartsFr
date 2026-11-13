import { beforeEach, describe, expect, it } from "vitest";
import { useCatalog } from "@/lib/catalog-store";
import { useCatalogRegistry, selectRegisteredCatalog, updateCurrentCatalog } from "@/lib/catalog-registry";
import { seedDemo } from "./fixtures/seed-demo";
seedDemo();

const initialCatalog = useCatalog.getState().catalog;
const initialCats = useCatalogRegistry.getState().cats;
beforeEach(() => {
  useCatalog.setState({ catalog: initialCatalog });
  useCatalogRegistry.setState({ cats: initialCats });
});

describe("catalog quick options", () => {
  it("changes default attribute to none in both active catalog and manager without changing content/history", () => {
    const { nodes, past, dirty } = useCatalog.getState();
    updateCurrentCatalog({ defAttr: 0 });
    expect(useCatalog.getState().catalog.defAttr).toBe(0);
    expect(useCatalogRegistry.getState().cats.find((cat) => cat.name === initialCatalog.name && cat.path === initialCatalog.path)?.defAttr).toBe(0);
    expect(useCatalog.getState().nodes).toBe(nodes);
    expect(useCatalog.getState().past).toBe(past);
    expect(useCatalog.getState().dirty).toBe(dirty);
  });
  it("changes the version and data path from quick options", () => {
    updateCurrentCatalog({ version: "2026", source: "D:\\Allplan\\Project" });
    expect(useCatalog.getState().catalog.version).toBe("2026");
    expect(useCatalog.getState().catalog.source).toBe("D:\\Allplan\\Project");
  });
  it("selects a registered catalog and rejects missing entries", () => {
    expect(selectRegisteredCatalog("c1")).toBe(true);
    expect(useCatalog.getState().catalog.name).toBe("CMI");
    expect(useCatalog.getState().catalog.version).toBe("2022");
    expect(selectRegisteredCatalog("c6")).toBe(false);
    expect(useCatalog.getState().catalog.name).toBe("CMI");
  });
});