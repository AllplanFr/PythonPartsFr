import { beforeEach, describe, expect, it } from "vitest";
import { useCatalog } from "@/lib/catalog-store";
import { createCatalogBackup, importCatalogBackup, removeCatalogBackup, restoreCatalogBackup, useCatalogBackups } from "@/lib/catalog-backups";
import { seedDemo } from "./fixtures/seed-demo";
seedDemo();
const initial = structuredClone({ nodes: useCatalog.getState().nodes, rootIds: useCatalog.getState().rootIds });
const catalog = { ...useCatalog.getState().catalog };
beforeEach(() => { useCatalog.getState().load(structuredClone(initial)); useCatalog.setState({ catalog: { ...catalog } }); useCatalogBackups.setState({ backups: [], open: false }); });
describe("catalog backups", () => {
  it("requires confirmation before replacing catalog content", () => {
    const backup = createCatalogBackup(); const id = initial.rootIds[0]; if (!id) throw new Error("Missing sample root");
    useCatalog.getState().update(id, { description: "Changed after backup" });
    expect(restoreCatalogBackup(backup.id, false)).toBe(false); expect(useCatalog.getState().nodes[id]?.description).toBe("Changed after backup");
    expect(restoreCatalogBackup(backup.id, true)).toBe(true); expect(useCatalog.getState().nodes[id]?.description).toBe(initial.nodes[id]?.description); expect(useCatalog.getState().dirty).toBe(true);
  });
  it("keeps the replaced catalog as a safety backup", () => {
    const backup = createCatalogBackup(); const id = initial.rootIds[0]; if (!id) throw new Error("Missing sample root");
    useCatalog.getState().update(id, { description: "Safety content" }); restoreCatalogBackup(backup.id, true);
    expect(useCatalogBackups.getState().backups[0]?.content.nodes[id]?.description).toBe("Safety content"); expect(useCatalogBackups.getState().backups).toHaveLength(2);
  });
  it("requires confirmation before deleting a backup", () => {
    const backup = createCatalogBackup(); expect(removeCatalogBackup(backup.id, false)).toBe(false); expect(useCatalogBackups.getState().backups).toHaveLength(1);
    expect(removeCatalogBackup(backup.id, true)).toBe(true); expect(useCatalogBackups.getState().backups).toHaveLength(0);
  });
  it("rejects malformed imports without changing the catalog or inventory", () => {
    const nodes = useCatalog.getState().nodes; expect(importCatalogBackup({ nodes: { bad: {} }, rootIds: ["bad"] })).toBeNull(); expect(useCatalogBackups.getState().backups).toHaveLength(0); expect(useCatalog.getState().nodes).toBe(nodes);
  });
  it("round-trips backup metadata and content without auto-restoring it", () => {
    const backup = createCatalogBackup(); const imported = importCatalogBackup(JSON.parse(JSON.stringify(backup)));
    expect(imported?.catalog).toEqual(catalog); expect(imported?.content.rootIds).toEqual(initial.rootIds); expect(imported?.id).not.toBe(backup.id);
  });
});
