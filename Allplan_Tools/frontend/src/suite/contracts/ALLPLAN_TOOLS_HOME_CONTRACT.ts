/** Test adapter contract. This is not a plugin identity or an AIM capability. */
export type PluginId = string;

export interface HomeContext {
  /** Forward unchanged, including the empty string for standalone mode. */
  year: string;
  verification: boolean;
  country: string;
}

export interface HomePlugin {
  id: PluginId;
  /** Shipped resources available; does not promise successful initialization. */
  available: boolean;
  reason: string | null;
  /** Optional local-host icon; invalid values use the presentation fallback. */
  iconUrl?: string | null;
}

export interface InstalledPlugin extends HomePlugin {
  name: string;
  description: string;
  installedVersion: string | null;
  lifecycle: "ready" | "construction";
  launchable: boolean;
  reasonCode: "construction" | "unavailable" | null;
}

export interface PluginInventoryInfo extends HomeInfo {
  plugin_inventory_contract: 1;
  plugins: InstalledPlugin[];
}

/** Only this disabled state is emitted in the current lot. No remote URL is configured. */
export type CatalogReply = { ok: true; data: {
  schema: "allplan-tools-catalog/1";
  status: "not_configured";
  entries: [];
  error: null;
} };

export type UpdateReply = { ok: false; error: {
  code: "unknown_plugin" | "catalog_not_configured";
  message: string;
} };

export interface HomeInfo {
  home_launch_contract: 1;
  context: HomeContext;
  plugins: HomePlugin[];
}

/** ok means the existing host launch service returned after process creation. */
export type LaunchReply = { ok: true } | { ok: false; error: string };

/** Acceptance of the request does not confirm window or runner termination. */
export type CloseHomeReply = { ok: true; status: "requested" } | { ok: false; error: string };

export function isCloseHomeReply(value: unknown): value is CloseHomeReply {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  return reply["ok"] === true
    ? reply["status"] === "requested"
    : reply["ok"] === false && typeof reply["error"] === "string" && reply["error"].trim().length > 0;
}

export interface AllplanToolsHomeApi {
  close_home?(): Promise<CloseHomeReply>;
  get_home_info(): Promise<HomeInfo>;
  get_catalog?(): Promise<CatalogReply>;
  update?(plugin_id: PluginId): Promise<UpdateReply>;
  launch(
    plugin_id: PluginId,
    year: string,
    verification: boolean,
    country: string,
  ): Promise<LaunchReply>;
}

export interface HomeWindow {
  pywebview?: {
    api?: Partial<AllplanToolsHomeApi>;
  };
}

/** First structural detection; then await get_home_info and validate its reply. */
export function detectHomeService(win: HomeWindow): boolean {
  const api = win.pywebview?.api;
  return typeof api?.get_home_info === "function" && typeof api.launch === "function";
}

/**
 * Validate untrusted bridge data without coercion.
 * The UI must not enable launch until both detection and validation succeed.
 */
export function isHomeInfo(value: unknown): value is HomeInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (obj["home_launch_contract"] !== 1 || !obj["context"] ||
      typeof obj["context"] !== "object" || Array.isArray(obj["context"]) ||
      !Array.isArray(obj["plugins"])) return false;
  const ctx = obj["context"] as Record<string, unknown>;
  if (typeof ctx["year"] !== "string" || typeof ctx["verification"] !== "boolean" ||
      typeof ctx["country"] !== "string") return false;
  const ids = new Set<string>();
  for (const item of obj["plugins"]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const plugin = item as Record<string, unknown>;
    if (typeof plugin["id"] !== "string" || !/^[a-z][a-z0-9_]*$/.test(plugin["id"]) ||
        ids.has(plugin["id"]) || typeof plugin["available"] !== "boolean" ||
        (plugin["reason"] !== null && typeof plugin["reason"] !== "string") ||
        (plugin["available"] ? plugin["reason"] !== null
          : typeof plugin["reason"] !== "string" || plugin["reason"].trim().length === 0)) return false;
    ids.add(plugin["id"]);
  }
  if ("plugin_inventory_contract" in obj) {
    if (obj["plugin_inventory_contract"] !== 1) return false;
    return obj["plugins"].every(validInstalledPlugin);
  }
  return true;
}

function validInstalledPlugin(value: unknown): value is InstalledPlugin {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plugin = value as Record<string, unknown>;
  const construction = plugin["lifecycle"] === "construction";
  return typeof plugin["name"] === "string" && plugin["name"].trim().length > 0 &&
    typeof plugin["description"] === "string" &&
    (plugin["installedVersion"] === null ||
      typeof plugin["installedVersion"] === "string" && plugin["installedVersion"].trim().length > 0) &&
    (construction || plugin["lifecycle"] === "ready") &&
    typeof plugin["launchable"] === "boolean" && plugin["available"] === plugin["launchable"] &&
    (construction
      ? plugin["launchable"] === false && plugin["reasonCode"] === "construction"
      : plugin["launchable"] ? plugin["reasonCode"] === null : plugin["reasonCode"] === "unavailable");
}

export function isPluginInventoryInfo(value: unknown): value is PluginInventoryInfo {
  return isHomeInfo(value) && "plugin_inventory_contract" in value &&
    value.plugin_inventory_contract === 1;
}

export function isLaunchReply(value: unknown): value is LaunchReply {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return obj["ok"] === true ||
    (obj["ok"] === false && typeof obj["error"] === "string" && obj["error"].length > 0);
}
