import { createFileRoute } from "@tanstack/react-router";
import { SmartCatalogApp } from "@/modules/smartcatalog/SmartCatalogApp";
import { ModuleGate } from "@/suite/ModuleGate";

export const Route = createFileRoute("/smartcatalog")({
  head: () => ({
    meta: [
      { title: "SmartCatalog Editor — Allplan catalog editing" },
      { name: "description", content: "Edit hierarchical construction and BIM quantity-takeoff catalogs with formulas, attributes and drag-and-drop." },
      { property: "og:title", content: "SmartCatalog Editor" },
      { property: "og:description", content: "Hierarchical catalog editor for construction quantity takeoff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SmartCatalogRoute,
});

function SmartCatalogRoute() {
  return <ModuleGate appId="smartcatalog">{() => <SmartCatalogApp />}</ModuleGate>;
}
