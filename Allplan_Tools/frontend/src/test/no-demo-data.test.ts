import { expect, it } from "vitest";
import { useCatalog } from "@/lib/catalog-store";
import { useCatalogRegistry } from "@/lib/catalog-registry";
import { useExternalLibraries } from "@/lib/external-libraries";
import { applySettings } from "@/lib/app-settings";

it("SmartCatalog starts with no demo catalogue, registered catalogues or library", () => {
  expect(useCatalog.getInitialState().rootIds).toEqual([]);
  expect(useCatalog.getInitialState().catalog).toMatchObject({ name: "", path: "", version: "", source: "" });
  expect(useCatalogRegistry.getInitialState().cats).toEqual([]);
  expect(useExternalLibraries.getInitialState().sources).toEqual([]);
});
it("drops the former demo library from saved settings but keeps user sources", () => {
  applySettings({ externalLibraries: { sources: [{ id: "external-example", demo: true }, { id: "mine", name: "Mine" }] } });
  expect(useExternalLibraries.getState().sources.map((s) => s.id)).toEqual(["mine"]);
});
