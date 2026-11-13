// Wire types for the new backend extension. Reference only, not a frontend implementation.
import type { Configuration as ConfigurationV1, ConversionReport, Presentation as PresentationV1 } from "./aim-presentation-contract";
import type { AimAttributeRow, AimDefinitions, AimDiagnostic, AimInstallation } from "./aim-project-contract";

export type Failure = { ok: false; error: { code: string; message: string }; report?: ConversionReport };
export type ExtensionIdentity = {
  project_manager_contract?: 1; project_history_contract?: 1; presentation_tree_contract?: 0 | 1;
  project_manager_menu_contract?: 1;
  project_manager_preview_color_contract?: 1;
  presentation_export_contract?: 1;
};
// A separately authorized native profile. Never add this field to a legacy strict schema.
export type WorkingExtensionIdentity = ExtensionIdentity & { working_state_contract: 1 };
export type WorkingExportIdentity = WorkingExtensionIdentity & { presentation_export_contract: 1 };
export type ExportRequest = { configuration: ConfigurationV1 | ConfigurationV2 };
export type ExportResponse =
  | { ok: true; status: "exported"; fileName: string; configurationId: string }
  | { ok: true; status: "cancelled" }
  | Failure;
export type ExportErrorCode =
  | "file_write_forbidden" | "presentation_required" | "stale_presentation"
  | "invalid_payload" | "invalid_presentation" | "unsupported_presentation_version"
  | "dialog_unavailable" | "unsupported_format" | "protected_destination"
  | "output_exists" | "export_failed";
export type ProjectManagerAssignmentIdentity = ExtensionIdentity & {
  project_manager_assignment_contract: 1;
};
export type DefinitionSource =
  | { status: "resolved"; version: string; verificationVersion: boolean; reason: null }
  | { status: "unresolved"; version: null; verificationVersion: null; reason: "definitions_not_loaded" };
export type Project = { path: string; name: string };
export type ManagerEntry = Project & { source: DefinitionSource; sourceFreshness: "last_read" };
export type ProjectInstallation =
  | { status: "associated"; version: string; verificationVersion: boolean; prjPath: string }
  | { status: "unassociated" }
  | { status: "unknown";
      reason: "legacy_entry" | "ambiguous" | "association_unavailable" | "no_installations" };
export type AssignedManagerEntry = ManagerEntry & { projectInstallation: ProjectInstallation };
export type AssignedPreview<Colored extends boolean = false> =
  Preview<Colored> & { projectInstallation: ProjectInstallation };
export type PreviewRow = { kind: "row"; id: string; number: string; title: string | null; value: string };
export type PreviewGroup = { kind: "group"; id: string; title: string; rows: PreviewRow[] };
// Enabled only by project_manager_preview_color_contract === 1.
// Validate backgroundColor with /^#[0-9A-Fa-f]{6}$/; never infer or normalize it.
export type ColoredPreviewGroup = PreviewGroup & { backgroundColor: string };
export type Preview<Colored extends boolean = false> = {
  project: Project; source: DefinitionSource; readOnly: true;
  valuesStatus: "read" | "missing";
  mode: "current_presentation" | "attributes_without_presentation";
  items: (PreviewRow | (Colored extends true ? ColoredPreviewGroup : PreviewGroup))[];
};
export type WireProjectState = {
  app: "information_manager"; project_contract: 2; capabilities: ["project.select"];
  read_only: true; selection: "accepted" | "cancelled" | "required" | "error" | "installation_required";
  project: Project | null; installation: AimInstallation | null; installationCandidates: AimInstallation[];
  prjatt: { status: "not_loaded" | "read" | "missing" | "error"; path: string | null; encodingHint: string | null; header: string | null };
  definitions: AimDefinitions; data: { attributes: AimAttributeRow[] }; diagnostics: AimDiagnostic[];
};
export type ResetDefault = { state: "absent" } | { state: "defined"; value: string | 0 | 1 } | { state: "unresolved"; issueId: string };
type RowBase = {
  kind: "row"; id: string; position: number; num: number; title: string; resetDefault: ResetDefault;
  dateFormat?: { pattern: string; syntax: "legacy_aim"; support: "unsupported" };
};
export type RowV2 = RowBase & (
  | { widget: "entry"; type: "STR" | "FLOAT" | "INT" | "DATE" | "TIME" | "EMAIL" | "PHONE" | "URL" }
  | { widget: "combo"; type: "STR" | "FLOAT" | "INT"; options: string[] }
  | { widget: "list"; type: "STR"; options: string[] }
  | { widget: "checkbox" }
);
export type GroupV2 = { kind: "group"; id: string; position: number; title: string; backgroundColor: string; expanded: boolean; rows: RowV2[] };
export type CategoryV2 = { id: string; position: number; name: string; icon: string; children: (RowV2 | GroupV2)[] };
export type ConfigurationV2 = {
  schema: "aim-presentation-configuration"; version: 2; configurationId: string;
  resetPolicy: { applyOn: "explicit_reset_only"; checkboxWithoutDefault: "unchecked" };
  categories: CategoryV2[];
};
type ResolveRow<R> = R extends RowV2 ? Omit<R, "num"> & {
  number: string; definition: Record<string, unknown> | null; valueState: "set" | "unset" | "unavailable";
  value: string | null; diagnostics: string[];
} : never;
export type ModelRowV2 = ResolveRow<RowV2>;
export type ModelGroupV2 = Omit<GroupV2, "rows"> & { rows: ModelRowV2[] };
export type ModelV2 = {
  schema: "aim-organized-presentation"; version: 2; configurationId: string; readOnly: true;
  project: Project | null; installation: AimInstallation | null; prjatt: WireProjectState["prjatt"];
  definitions: WireProjectState["definitions"];
  categories: (Omit<CategoryV2, "children"> & { children: (ModelRowV2 | ModelGroupV2)[] })[];
  counts: { configurationLines: number; matchedDefinitions: number; missingDefinitions: number; set: number; unset: number; unavailable: number };
  diagnostics: (AimDiagnostic & { lineIds: string[] })[];
  conversionDiagnostics: { code: string; severity: string; targetId: string | null; message: string }[];
};
export type PresentationV2 = { configuration: ConfigurationV2; report: ConversionReport | null; model: ModelV2 };
export type Presentation = PresentationV1 | PresentationV2;
type EditablePresentation<P extends Presentation> = P extends { model: infer M }
  ? Omit<P, "model"> & { model: Omit<M, "readOnly"> & { readOnly: false } } : never;
export type WorkingPresentation = EditablePresentation<Presentation>;
export type WorkingState = {
  revision: number; source: WireProjectState; data: WireProjectState["data"];
  draftValues: Record<string, string | null>;
  pendingImport: boolean;
  presentation: WorkingPresentation | null;
  dirty: { values: boolean; presentation: boolean; any: boolean };
  fileSaveAvailable: false; prjtoolsAvailable: false;
};
// November 5 opt-in projection. Historical WorkingState and wire responses stay strict.
export type SaveRequest = { sessionId: string; revision: number; projectRevision: number };
export type WorkingStateV2 = Omit<WorkingState, "fileSaveAvailable" | "prjtoolsAvailable"> & {
  sessionId: string; projectRevision: number;
  projectInstallation: { status: "associated" | "unassociated" | "unknown" };
  fileSaveAvailable: boolean; prjtoolsAvailable: boolean;
  save: { state: "idle" | "running" | "recovery_required"; operationId: string | null; request: SaveRequest | null; blockedReasons: string[] };
};
export type ConfirmedWorkingState = WorkingState | WorkingStateV2;
type ProjectedReply<R> = R extends { work: WorkingState } ? Omit<R, "work"> & { work: WorkingStateV2 } : R;
export type WorkingResponsesV2 = { [C in keyof WorkingResponses]: ProjectedReply<WorkingResponses[C]> };
export type NegotiatedWorkingResponses = { [C in keyof WorkingResponses]: WorkingResponses[C] | WorkingResponsesV2[C] };
export type SaveStage = "validation" | "preparation" | "publication" | "tool" | "verification" | "acknowledgement" | "complete";
export type SaveFileEffects = { written: boolean | null; verified: boolean | null; finalVerification: "not_attempted" | "confirmed" | "failed" | "unknown"; sourceSHA256: string | null; backupId: string | null };
export type SaveToolEffects = { required: boolean | null; launched: boolean | null; finished: boolean | null; returnCode: number | null; updateStatus: "not_required" | "unconfirmed"; diagnosticId: string | null };
export type SaveResult = { ok: boolean; status: "saved" | "partial" | "failed"; stage: SaveStage; file: SaveFileEffects; tool: SaveToolEffects; acknowledged: boolean; recoveryRequired: boolean; error: { code: string; message: string } | null; message: string };
export type SaveProtocolError = { ok: false; error: { code: string; message: string } };
export type SaveAccepted = { ok: true; status: "accepted"; operationId: string; request: SaveRequest };
export type SaveStatus =
  | { ok: true; status: "running"; operationId: string; request: SaveRequest; phase: SaveStage; file: SaveFileEffects; tool: SaveToolEffects }
  | { ok: true; status: "completed"; operationId: string; request: SaveRequest; result: SaveResult; work: WorkingStateV2 | null }
  | { ok: true; status: "not_found"; request: SaveRequest }
  | SaveProtocolError;
export type WorkingRequests = {
  "work.get": Record<string, never>;
  "work.value.set": { revision: number; number: string; value: string | null };
  "work.discard": { revision: number };
  "work.close": { revision: number; discard: boolean };
  "work.transition": { revision: number; discard: boolean } & (
    | { command: "project.select"; payload: Record<string, never> | { path: string } }
    | { command: "project.manager.open"; payload: { path: string; discardPresentation: boolean } }
    | { command: "presentation.import.apply"; payload: { token: string } }
  );
};
export type WorkingReply = {
  ok: true; status: "current" | "updated" | "discarded" | "transitioned"; work: WorkingState;
  result?: ManagerResponses<true>["project.select"]
    | ManagerResponses<true>["project.manager.open"]
    | { ok: true; status: "applied"; presentation: WorkingPresentation };
} | { ok: true; status: "cancelled"; data: WireProjectState } | Failure;
export type WorkingResponses = {
  "work.get": WorkingReply; "work.value.set": WorkingReply; "work.discard": WorkingReply;
  "work.transition": WorkingReply;
  "work.close": { ok: true; status: "close_requested" } | Failure;
};
export type WorkingProfileResponses = Omit<ManagerResponses<true>,
  "presentation.update" | "presentation.import.prepare" | "presentation.import.apply" | "presentation.get" | "presentation.export"
> & WorkingResponses & {
  "presentation.update": { ok: true; status: "updated"; presentation: WorkingPresentation } | Failure;
  "presentation.import.prepare": { ok: true; status: "prepared"; token: string; candidate: WorkingPresentation }
    | { ok: true; status: "cancelled" } | Failure;
  "presentation.import.apply": { ok: true; status: "applied"; presentation: WorkingPresentation } | Failure;
  "presentation.get": { ok: true; status: "current"; presentation: WorkingPresentation }
    | { ok: true; status: "empty"; presentation: null } | Failure;
  "presentation.export": ExportResponse;
};
export type Requests = {
  "project.source": Record<string, never>;
  "project.recent": Record<string, never>;
  "project.select": Record<string, never> | { path: string };
  "project.manager.list": Record<string, never>;
  "project.manager.add": Record<string, never>;
  "project.manager.preview": { path: string };
  "project.manager.open": { path: string; discardPresentation: boolean };
  "project.manager.favorites.list": Record<string, never>;
  "project.manager.favorite.set": { path: string; favorite: boolean };
  "project.manager.folder.open": { path: string };
  "project.manager.remove": { path: string };
  "presentation.update": { configuration: ConfigurationV1 | ConfigurationV2 };
  "presentation.import.prepare": Record<string, never>;
  "presentation.import.apply": { token: string };
  "presentation.import.cancel": { token: string };
  "presentation.get": Record<string, never>;
  "presentation.export": ExportRequest;
};
export type ManagerResponses<Colored extends boolean = false> = {
  "project.source": { ok: true; source: DefinitionSource };
  "project.recent": { ok: true; projects: Project[] } | Failure;
  "project.select": { ok: true; status?: "cancelled"; data: WireProjectState } | Failure;
  "project.manager.list": { ok: true; projects: ManagerEntry[] } | Failure;
  "project.manager.add": { ok: true; status: "added"; project: ManagerEntry } | { ok: true; status: "cancelled" } | Failure;
  "project.manager.preview": { ok: true; status: "preview"; preview: Preview<Colored> } | Failure;
  "project.manager.open": { ok: true; data: WireProjectState } | Failure;
  "project.manager.favorites.list": { ok: true; paths: string[] } | Failure;
  "project.manager.favorite.set": { ok: true; status: "updated"; path: string; favorite: boolean } | Failure;
  "project.manager.folder.open": { ok: true; status: "opened"; path: string } | Failure;
  "project.manager.remove": { ok: true; status: "removed"; path: string } | Failure;
  "presentation.update": { ok: true; status: "updated"; presentation: Presentation } | Failure;
  "presentation.import.prepare": { ok: true; status: "prepared"; token: string; candidate: Presentation }
    | { ok: true; status: "cancelled" } | Failure;
  "presentation.import.apply": { ok: true; status: "applied"; presentation: Presentation } | Failure;
  "presentation.import.cancel": { ok: true; status: "cancelled" } | Failure;
  "presentation.get": { ok: true; status: "current"; presentation: Presentation }
    | { ok: true; status: "empty"; presentation: null } | Failure;
  "presentation.export": ExportResponse;
};
export type ProjectManagerAssignmentResponses<Colored extends boolean = false> =
  Omit<ManagerResponses<Colored>,
    "project.manager.list" | "project.manager.add" | "project.manager.preview"
  > & {
    "project.manager.list": { ok: true; projects: AssignedManagerEntry[] } | Failure;
    "project.manager.add": { ok: true; status: "added"; project: AssignedManagerEntry }
      | { ok: true; status: "cancelled" } | Failure;
    "project.manager.preview": {
      ok: true; status: "preview"; preview: AssignedPreview<Colored>
    } | Failure;
  };
