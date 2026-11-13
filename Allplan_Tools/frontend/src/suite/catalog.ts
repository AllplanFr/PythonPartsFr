/**
 * Declarative catalog of the suite's peer applications. Browser-safe and free of
 * business imports: the neutral home reads it without loading any module.
 */
export type SuiteAppId = "smartcatalog" | "vob_editor" | "information_manager";
export type SuiteRoute = "/smartcatalog" | "/vob-editor" | "/information-manager";
export type LegacyTransport = "host_bridge" | "aim_legacy";

export type SuiteModule = {
  appId: SuiteAppId;
  route: SuiteRoute;
  name: string;
  description: { fr: string; en: string };
  /** Normal (legacy) native transport of the module; RC1 2.0 is never active here. */
  legacyTransport: LegacyTransport;
};

export const SUITE_NAME = "Allplan Tools";

export const SUITE_MODULES: readonly SuiteModule[] = [
  { appId: "smartcatalog", route: "/smartcatalog", name: "SmartCatalog Editor", legacyTransport: "host_bridge",
    description: { fr: "Catalogues d’ouvrages, composants, liens et attributs Allplan.", en: "Allplan catalogs of items, components, links and attributes." } },
  { appId: "vob_editor", route: "/vob-editor", name: "VOB Editor", legacyTransport: "host_bridge",
    description: { fr: "Règles de calcul VOB : métiers, objets, unités, méthodes et formules.", en: "VOB calculation rules: trades, objects, units, methods and formulas." } },
  { appId: "information_manager", route: "/information-manager", name: "Information Manager", legacyTransport: "aim_legacy",
    description: { fr: "Présentation et valeurs des attributs du projet.", en: "Presentation and values of project attributes." } },
] as const;

export const suiteModule = (appId: SuiteAppId) => {
  const module = SUITE_MODULES.find((m) => m.appId === appId);
  if (!module) throw new Error(`Unknown application: ${appId}`);
  return module;
};

export const UPCOMING_MODULES = ["Trade Editor", "Layer Editor", "Attribute Editor"] as const;
