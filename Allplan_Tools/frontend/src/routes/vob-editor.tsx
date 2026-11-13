import { createFileRoute } from "@tanstack/react-router";
import { VobEditorModule } from "@/modules/vob_editor/VobEditorModule";
import { ModuleGate } from "@/suite/ModuleGate";

export const Route = createFileRoute("/vob-editor")({
  head: () => ({
    meta: [
      { title: "VOB Editor — Allplan calculation rules" },
      { name: "description", content: "Edit Allplan VOB calculation rules: trades, objects, units, methods and formulas." },
      { property: "og:title", content: "VOB Editor — Allplan calculation rules" },
      { property: "og:description", content: "Standalone editor for Allplan VOB calculation rule files." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VobEditorRoute,
});

function VobEditorRoute() {
  return <ModuleGate appId="vob_editor">{(access) => <VobEditorModule native={access.transport === "host_bridge"} />}</ModuleGate>;
}
