import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { VobEditorModule } from "../VobEditorModule";
import { ModuleGate } from "@/suite/ModuleGate";
import "../../../styles.css";

// Isolated static VOB entry for host-local loading: no SSR, no suite route tree, no site requests.
// Memory history keeps /vob-editor independent of the local file/origin path.
const root = createRootRoute();
const vob = createRoute({
  getParentRoute: () => root,
  path: "/vob-editor",
  component: () => <ModuleGate appId="vob_editor">{(access) => <VobEditorModule native={access.transport === "host_bridge"} />}</ModuleGate>,
});
const leave = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
const router = createRouter({ routeTree: root.addChildren([vob, leave]), history: createMemoryHistory({ initialEntries: ["/vob-editor"] }) });
const container = document.getElementById("root");
if (container) createRoot(container).render(<RouterProvider router={router} />);
