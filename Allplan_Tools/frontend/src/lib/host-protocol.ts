/** Allplan 2.0.0-rc.1 preparation only; the active legacy bridge never imports this module. */
import { validateDefinition } from "./host-protocol-validation";
import type { Request, Response, Event } from "./host-protocol.generated";
import type { Bootstrap, Capability, Proposal, TransportValue, WriteReport, ProtocolError } from "./host-protocol-models.generated";
export type { Bootstrap, Capability, Proposal, TransportValue, WriteReport, ProtocolError };
export type RequestEnvelope = Request;
export type ResponseEnvelope = Response;
export type EventEnvelope = Event;
export const PROTOCOL_VERSION = "2.0";
export const CONTRACT_RELEASE = "2.0.0-rc.1";
export type ProtocolMode = "legacy_v1" | "v2";
export const ACTIVE_PROTOCOL_MODE: ProtocolMode = "legacy_v1";
export const PROTOCOL_APP_IDS = ["smartcatalog", "vob_editor", "information_manager"] as const;
export type ProtocolAppId = (typeof PROTOCOL_APP_IDS)[number];
export const TIMEOUTS_MS = { quick: 15000, read: 60000, write: 120000, dialog: 0 } as const;
export type ResourceState = "not_requested" | "loading" | "available" | "empty" | "available_with_diagnostics" | "unsupported" | "unavailable";
export type Resource<T> = { state: ResourceState; items: T[] | null; diagnostics: unknown[] };
type Check = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Check => ({ ok: false, reason });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const validateRequest = (v: unknown) => validateDefinition("request", v);
export const validateResponse = (v: unknown) => validateDefinition("response", v);
export const validateEvent = (v: unknown) => validateDefinition("event", v);
export const validateError = (v: unknown) => validateDefinition("error", v);
export const validateBootstrap = (v: unknown) => validateDefinition("bootstrap", v);
export const validateTransportValue = (v: unknown) => validateDefinition("typed_value", v);

/** Reads a descriptor only; never probes initial data, installs globals, or switches transports. */
export function inspectBootstrap(descriptor: unknown): Bootstrap | null {
  return validateBootstrap(descriptor).ok ? descriptor as Bootstrap : null;
}

/** Duplicate keys and nonfinite numbers are rejected before schema validation. UTF-8 bytes, not characters. */
export function parseStrictJson(text: string, maxBytes = 16777216): unknown {
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new SyntaxError("Message byte limit exceeded");
  const stack: { keys: Set<string>; array: boolean }[] = []; let i = 0; let expectKey = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '\"') j += text[j] === "\\" ? 2 : 1;
      const top = stack.at(-1);
      if (expectKey && top && !top.array) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key)) throw new SyntaxError(`Duplicate key: ${key}`);
        top.keys.add(key); expectKey = false;
      }
      i = j + 1; continue;
    }
    if (ch === "{") { stack.push({ keys: new Set(), array: false }); expectKey = true; }
    else if (ch === "[") { stack.push({ keys: new Set(), array: true }); expectKey = false; }
    else if (ch === "}" || ch === "]") { stack.pop(); expectKey = false; }
    else if (ch === ",") { const top = stack.at(-1); expectKey = !!top && !top.array; }
    i++;
  }
  return JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new SyntaxError("Nonfinite JSON number");
    return value;
  });
}

let seq = 0;
export function makeRequest(bootstrap: Bootstrap, command: Request["command"], payload: Record<string, unknown> = {}): RequestEnvelope {
  const request = { protocol_version: PROTOCOL_VERSION, kind: "request", session_id: bootstrap.session_id, request_id: `req-${Date.now().toString(36)}-${(++seq).toString(36)}`, app_id: bootstrap.app_id, command, context_id: null, generation: null, payload };
  if (!validateBootstrap(bootstrap).ok || bootstrap.mode !== "protocol" || !validateRequest(request).ok) throw new Error("Invalid rc.1 request or bootstrap");
  return request as RequestEnvelope;
}
export function matchesRequest(req: RequestEnvelope, res: ResponseEnvelope): boolean {
  return res.session_id === req.session_id && res.request_id === req.request_id && res.app_id === req.app_id && res.command === req.command && res.context_id === req.context_id && res.generation === req.generation;
}
export function handshakeIdentity(res: ResponseEnvelope, bootstrap: Bootstrap): boolean {
  const result = res.result;
  return res.session_id === bootstrap.session_id && res.app_id === bootstrap.app_id && isObj(result) && result["session_id"] === res.session_id && result["app_id"] === res.app_id;
}
export function createDeduper(limit = 512) {
  const seen = new Set<string>();
  return (sessionId: string, id: string) => {
    const key = JSON.stringify([sessionId, id]);
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > limit) { const first = seen.values().next().value; if (first !== undefined) seen.delete(first); }
    return true;
  };
}
/** Reject the old session BEFORE consulting pending request identifiers. */
export function createResponseGate(bootstrap: Bootstrap) {
  const pending = new Map<string, RequestEnvelope>(); const once = createDeduper();
  return {
    track(req: RequestEnvelope) { if (req.session_id !== bootstrap.session_id || req.app_id !== bootstrap.app_id || !validateRequest(req).ok) return false; pending.set(req.request_id, req); return true; },
    accept(res: ResponseEnvelope) {
      if (res.session_id !== bootstrap.session_id || !validateResponse(res).ok) return false;
      const req = pending.get(res.request_id);
      if (!req || !matchesRequest(req, res) || !once(res.session_id, res.request_id)) return false;
      pending.delete(res.request_id); return true;
    },
    expire(id: string) { pending.delete(id); },
  };
}
export function parseCapabilities(v: unknown): Capability[] | null {
  if (!validateDefinition("capabilities", v).ok) return null;
  const caps = v as Capability[];
  return new Set(caps.map(c => c.command)).size === caps.length ? caps : null;
}
export const canCall = (caps: Capability[] | null, command: string) => !!caps?.some(c => c.command === command && c.implementation === "implemented" && c.availability === "available");
export function negotiate(result: unknown, bootstrap: Bootstrap) {
  if (!validateDefinition("handshake_result", result).ok || !isObj(result) || result["session_id"] !== bootstrap.session_id || result["app_id"] !== bootstrap.app_id) return { ok: false as const, code: "invalid_payload" };
  const capabilities = parseCapabilities(result["capabilities"]);
  return capabilities ? { ok: true as const, version: PROTOCOL_VERSION, capabilities } : { ok: false as const, code: "invalid_payload" };
}
export function validateResource(v: unknown): Check {
  if (!isObj(v) || !Array.isArray(v["diagnostics"])) return fail("resource");
  if (["not_requested", "loading", "unsupported", "unavailable"].includes(String(v["state"]))) return v["items"] === null ? { ok: true } : fail("items must be null");
  if (v["state"] === "empty") return Array.isArray(v["items"]) && v["items"].length === 0 ? { ok: true } : fail("empty items");
  if (v["state"] === "available") return Array.isArray(v["items"]) && v["items"].length > 0 ? { ok: true } : fail("available items");
  if (v["state"] === "available_with_diagnostics") return Array.isArray(v["items"]) ? { ok: true } : fail("items");
  return fail("state");
}

/** Canonical attribute number: unsigned decimal string without leading zeros (except "0"). Not used for VOB raw ids. */
export function canonicalAttributeNumber(v: unknown): string | null {
  if (typeof v === "string") return /^(0|[1-9]\d*)$/.test(v) ? v : null;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return null; // out-of-range or non-integer legacy numbers are rejected, never rounded
}

export function validateProposal(p: unknown, enumeration: boolean): Check {
  if (!validateDefinition("proposal", p).ok || !isObj(p)) return fail("proposal");
  return (enumeration ? p["key"] !== null : p["key"] === null) ? { ok: true } : fail("key");
}

/** Legacy enum label → key only on a unique demonstrated match; otherwise unknown with raw preserved. */
export function legacyEnumToValue(raw: string, proposals: Proposal[]): TransportValue {
  const byKey = proposals.filter((p) => p["key"] === raw);
  if (byKey.length === 1) return { kind: "enumeration", raw, value: raw };
  const byLabel = proposals.filter((p) => p.label === raw && p["key"] !== null);
  return byLabel.length === 1 ? { kind: "enumeration", raw, value: byLabel[0]?.key ?? null } : { kind: "unknown", raw, value: null };
}

/** Legacy VOB references (index/num/value + name) → {id,label,provenance}; ids stay exact strings ("001" stays "001"). */
export function adaptVobReference(list: unknown, idKey: "index" | "num" | "value", source = "legacy_v1"): { id: string; label: string; provenance: { source: string; path: null; position: number } }[] | null {
  if (!Array.isArray(list)) return null;
  const out = []; let position = 0;
  for (const item of list) {
    position++;
    if (!isObj(item) || (typeof item[idKey] !== "string" && typeof item[idKey] !== "number") || typeof item["name"] !== "string") return null;
    out.push({ id: String(item[idKey]), label: item["name"], provenance: { source, path: null, position } });
  }
  return out;
}

/** Legacy reply envelope: ok must be strictly boolean; data:null is a valid success (e.g. settings.save). */
export function isLegacyReply(v: unknown): v is { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } } {
  return isObj(v) && (v["ok"] === true ? "data" in v : v["ok"] === false && isObj(v["error"]) && typeof v["error"]["code"] === "string");
}

export type SentSnapshot = { snapshot_id: string; document_id: string; document_revision: string; values: Record<string, TransportValue> };
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!isObj(a) || !isObj(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
};
export function reportMatchesSnapshot(report: WriteReport, snapshot: SentSnapshot) {
  return report.snapshot_id === snapshot.snapshot_id && report.document_id === snapshot.document_id && report.submitted_document_revision === snapshot.document_revision && report.confirmed_values.every(item => Object.hasOwn(snapshot.values, item.attribute_number) && equal(item.value, snapshot.values[item.attribute_number]));
}
export function disjointReport(report: WriteReport, snapshot: SentSnapshot) {
  const numbers = [...report.confirmed_values.map(i => i.attribute_number), ...report.failed_attributes.map(i => i.attribute_number), ...report.unconfirmed_attribute_numbers];
  return new Set(numbers).size === numbers.length && numbers.length === Object.keys(snapshot.values).length && numbers.every(n => Object.hasOwn(snapshot.values, n));
}
/** Only an explicit verified report advances a baseline; local send/export alone never does. */
export function advanceBaseline(baseline: Record<string, TransportValue>, snapshot: SentSnapshot, report: WriteReport | null) {
  if (!report || !validateDefinition("write_report", report).ok || !reportMatchesSnapshot(report, snapshot) || !disjointReport(report, snapshot)) return structuredClone(baseline);
  const next = structuredClone(baseline);
  for (const item of report.confirmed_values) { const value = snapshot.values[item.attribute_number]; if (value) next[item.attribute_number] = structuredClone(value); }
  return next;
}
export function dirtyAttributes(current: Record<string, TransportValue>, baseline: Record<string, TransportValue>) {
  return Object.keys(current).filter(n => !equal(current[n], baseline[n])).sort();
}
export function legacyTextOptions(options: string[]): Proposal[] {
  return options.map((label, index) => ({ key: null, label, generated_key: false, provenance: { source: "legacy_v1", path: null, position: index + 1 } }));
}
