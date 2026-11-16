import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { SmartCatalogApp } from "../SmartCatalogApp";
import { ModuleGate } from "@/suite/ModuleGate";
import "../../../styles.css";

// Isolated static SmartCatalog entry for host-local loading: no SSR, no suite route tree, no site requests.
const root = createRootRoute();
const sc = createRoute({
  getParentRoute: () => root,
  path: "/smartcatalog",
  component: () => <ModuleGate appId="smartcatalog">{() => <SmartCatalogApp />}</ModuleGate>,
});
const leave = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
const router = createRouter({ routeTree: root.addChildren([sc, leave]), history: createMemoryHistory({ initialEntries: ["/smartcatalog"] }) });
const container = document.getElementById("root");
if (container) createRoot(container).render(<RouterProvider router={router} />);
