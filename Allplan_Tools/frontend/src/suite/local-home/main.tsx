import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { ToolsHome } from "../ToolsHome";
import "../../styles.css";

// Isolated static entry: no generated suite route tree, SSR or plugin imports.
const root = createRootRoute();
const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <ToolsHome requireNative /> });
const router = createRouter({ routeTree: root.addChildren([home]) });
const container = document.getElementById("root");
if (container) createRoot(container).render(<RouterProvider router={router} />);