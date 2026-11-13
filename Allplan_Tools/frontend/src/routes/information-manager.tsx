import { createFileRoute } from "@tanstack/react-router";
import aimCss from "@/modules/information_manager/aim.css?url";
import { InformationManagerModule } from "@/modules/information_manager/InformationManagerModule";
import { ModuleGate } from "@/suite/ModuleGate";

export const Route = createFileRoute("/information-manager")({
  head: () => ({
    meta: [
      { title: "Allplan Information Manager — Gestion des informations" },
      { name: "description", content: "Éditez rapidement les attributs de vos projets : titre et valeur." },
      { property: "og:title", content: "Allplan Information Manager" },
      { property: "og:description", content: "Éditez rapidement les attributs de vos projets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    // AIM keeps its own presentation, loaded only on this route.
    links: [{ rel: "stylesheet", href: aimCss }],
  }),
  component: InformationManagerRoute,
});

function InformationManagerRoute() {
  return <ModuleGate appId="information_manager">{(access) => <InformationManagerModule hostEnabled={access.transport === "aim_legacy"} limitedHost={access.transport === "aim_pywebview_limited"} />}</ModuleGate>;
}
