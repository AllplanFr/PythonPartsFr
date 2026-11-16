import { createFileRoute } from "@tanstack/react-router";
import { SUITE_NAME } from "@/suite/catalog";
import { ToolsHome } from "@/suite/ToolsHome";

/** Neutral launcher: presentation and declarative catalog only, no business initialization. */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${SUITE_NAME} — Applications Allplan` },
      { name: "description", content: "Allplan Tools : SmartCatalog Editor, VOB Editor et Information Manager." },
      { property: "og:title", content: SUITE_NAME },
      { property: "og:description", content: "Trois applications Allplan réunies : catalogues, règles VOB et informations projet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ToolsHome,
});
