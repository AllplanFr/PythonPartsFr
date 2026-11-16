/** Generated from the unmodified Allplan 2.0.0-rc.1 schema. Do not edit manually. */

export type AllplanHostProtocol20Candidate1NotActivated = Request | Response | Event;
export type Request = BaseMessage & {
  kind?: "request";
  request_id: Id;
  command: Command;
  payload: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
};
export type Version = "2.0";
export type Id = string;
export type AppId = "smartcatalog" | "vob_editor" | "information_manager";
export type Command =
  | "host.handshake"
  | "host.capabilities"
  | "host.context"
  | "diagnostic.get"
  | "diagnostic.set"
  | "diagnostic.open_logs";
export type Response = BaseMessage & {
  kind?: "response";
  request_id: Id;
  command: Command;
  status: "success" | "cancelled" | "error";
  operation_id: null;
  result: unknown;
  error: unknown;
  [k: string]: unknown;
};
export type Event = BaseMessage & {
  kind?: "event";
  event_id: Id;
  event: "diagnostic.state";
  payload: DiagnosticState;
  [k: string]: unknown;
};

export interface BaseMessage {
  protocol_version: Version;
  kind: "request" | "response" | "event";
  session_id: Id;
  app_id: AppId;
  context_id: null;
  generation: null;
  [k: string]: unknown;
}
export interface DiagnosticState {
  enabled: boolean;
}
