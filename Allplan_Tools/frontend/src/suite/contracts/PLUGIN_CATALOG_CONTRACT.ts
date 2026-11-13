/** Next-lot contract only. The accepted local home is not changed by this file. */
export type CatalogStatus = "not_configured" | "available" | "unavailable";
export type CatalogSource = "none" | "embedded" | "cache" | "remote";
export type CatalogLifecycle = "ready" | "construction";
export type UpdateReason =
  | "catalog_not_configured" | "catalog_unavailable" | "informative_source"
  | "catalog_pending" | "catalog_superseded" | "not_installed" | "not_in_catalog"
  | "construction" | "installed_version_unknown" | "installed_version_invalid"
  | "no_releases" | "compatibility_unknown" | "incompatible"
  | "equal" | "older" | "no_release_url" | "release_url_rejected" | null;

export interface CatalogEntry {
  id: string;
  name: string;
  installed: boolean;
  installedVersion: string | null;
  installedLifecycle: CatalogLifecycle | null;
  inCatalog: boolean;
  latestKnownVersion: string | null;
  proposedVersion: string | null;
  catalogLifecycle: CatalogLifecycle | null;
  comparison: "unknown" | "equal" | "newer" | "older";
  compatibility: "unknown" | "compatible" | "incompatible";
  canUpdate: boolean;
  updateReason: UpdateReason;
}

export type CatalogReplyV2 =
  | { ok: true; data: {
    schema: "allplan-tools-catalog/2";
    requestId: number;
    superseded: boolean;
    status: CatalogStatus;
    source: CatalogSource;
    verifiedAt: string | null;
    lastAttemptAt: string | null;
    entries: CatalogEntry[];
    error: { code: "network_error" | "invalid_catalog" | "cache_error"; message: string } | null;
  } }
  | { ok: false; error: { code: "catalog_internal_error"; message: string } };

export type UpdateReplyV2 =
  | { ok: true; data: { id: string; version: string; status: "link_open_requested" } }
  | { ok: false; error: {
    code: "invalid_arguments" | "unknown_plugin" | "update_not_available"
      | "catalog_changed" | "link_open_failed" | "catalog_internal_error";
    message: string;
    reason: UpdateReason;
  } };

export interface PluginCatalogApiV2 {
  get_catalog(): Promise<CatalogReplyV2>;
  update(id: string): Promise<UpdateReplyV2>;
}
