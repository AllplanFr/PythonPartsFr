/** Generated from the unmodified Allplan 2.0.0-rc.1 schema. Do not edit manually. */

export type ProtocolModels =
  Bootstrap | Proposal | TransportValue | Capabilities | HandshakeResult | WriteReport | ProtocolError;
export type Bootstrap = {
  bootstrap_version: 1;
  app_id: AppId;
  session_id: Id;
  mode: "protocol" | "legacy";
  protocol_versions: string[];
  contract_release: string | null;
  transport:
    "pywebview_dispatch" | "webview2_host_object" | "webview2_post_message" | "pywebview_legacy" | "aim_legacy";
};
export type AppId = "smartcatalog" | "vob_editor" | "information_manager";
export type Id = string;
export type AttributeNumber = string;
export type TransportValue = {
  kind: "text" | "integer" | "real" | "boolean" | "date" | "time" | "enumeration" | "no_selection" | "unknown";
  raw: string | null;
  value: unknown;
};
export type Capability = {
  command: string;
  implementation: "implemented" | "not_implemented";
  availability: "available" | "unavailable" | "not_applicable";
  reason_code: string | null;
};
export type Capabilities = Capability[];
export type Capabilities1 = Capability[];
export type Generation = number;
export type WriteReport = {
  snapshot_id: Id;
  document_id: Id;
  submitted_document_revision: Id;
  saved_document_revision: null | Id;
  presentation_status: "not_requested" | "confirmed" | "failed" | "unconfirmed";
  confirmed_values: ConfirmedValue[];
  failed_attributes: {
    attribute_number: AttributeNumber;
    code: string;
    message: string;
  }[];
  unconfirmed_attribute_numbers: AttributeNumber[];
  verification: "none" | "readback" | "writer_acknowledgement";
};
export type TypedValue = {
  kind: "text" | "integer" | "real" | "boolean" | "date" | "time" | "enumeration" | "no_selection" | "unknown";
  raw: string | null;
  value: unknown;
};

export interface Proposal {
  key: null | AttributeNumber;
  label: string;
  generated_key: boolean;
  provenance: Provenance;
}
export interface Provenance {
  source: string;
  path: string | null;
  position: null | number;
}
export interface HandshakeResult {
  host_version: string;
  supported_versions: string[];
  negotiated_version: "2.0";
  contract_release: "2.0.0-rc.1";
  session_id: Id;
  app_id: AppId;
  capabilities: Capabilities1;
  context: Context;
  diagnostic: DiagnosticState;
  limits: Limits;
}
export interface Context {
  context_id: Id;
  generation: Generation;
  allplan_version: null | string;
  verification_version: boolean;
  country: null | string;
  allplan_language: null | string;
  application_language: string;
  paths: {
    ETC?: string;
    PRG?: string;
    STD?: string;
    PRJ?: string;
    USR?: string;
    TMP?: string;
  };
  project_path: string | null;
  catalog_user_path: string | null;
  origin: "standalone" | "allplan";
}
export interface DiagnosticState {
  enabled: boolean;
}
export interface Limits {
  max_message_bytes: number;
  max_pending_operations: number;
  operation_retention_seconds: number;
  operation_status_supported: boolean;
  timeouts: {
    control_ms: number;
    read_ms: number;
    write_ms: number;
    dialog_ms: null;
  };
}
export interface ConfirmedValue {
  attribute_number: AttributeNumber;
  value: TypedValue;
}
export interface ProtocolError {
  code:
    | "invalid_message"
    | "invalid_payload"
    | "unsupported_protocol"
    | "unknown_command"
    | "not_implemented"
    | "unsupported_operation"
    | "source_unavailable"
    | "configuration_error"
    | "access_denied"
    | "not_found"
    | "invalid_data"
    | "io_error"
    | "write_error"
    | "partial_write"
    | "revision_conflict"
    | "stale_context"
    | "timeout"
    | "operation_unknown"
    | "resource_limit"
    | "internal_error";
  message: string;
  retryable: boolean;
  details: {
    [k: string]: unknown;
  };
}
