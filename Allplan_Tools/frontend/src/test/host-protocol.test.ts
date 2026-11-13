import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fixtureJson from "../../docs/integration/protocol/2.0.0-rc.1/fixtures.json";
import manifest from "../../docs/integration/protocol/2.0.0-rc.1/manifest.json";
import { validateDefinition } from "@/lib/host-protocol-validation";
import { ACTIVE_PROTOCOL_MODE, CONTRACT_RELEASE, adaptVobReference, advanceBaseline, canCall, canonicalAttributeNumber, createResponseGate, dirtyAttributes, disjointReport, handshakeIdentity, inspectBootstrap, isLegacyReply, legacyEnumToValue, legacyTextOptions, makeRequest, matchesRequest, negotiate, parseCapabilities, parseStrictJson, reportMatchesSnapshot, validateResource, type Bootstrap, type ResponseEnvelope, type WriteReport, type SentSnapshot, type TransportValue } from "@/lib/host-protocol";

type Obj = Record<string, unknown>;
type Scenario =
  | { name: "snapshot-baseline-only"; snapshot: SentSnapshot; baseline_before: Record<string, TransportValue>; current: Record<string, TransportValue>; baseline_after: Record<string, TransportValue>; dirty_attribute_numbers: string[]; close_allowed: boolean }
  | { name: "legacy-send-is-not-confirmation"; confirmation: null; baseline_advance_allowed: boolean }
  | { name: "vob-leading-zeros"; original: Record<string, string>; roundtrip: Record<string, string> }
  | { name: "ambiguous-label"; options: { key: string; label: string }[]; legacy_value: string; expected: TransportValue }
  | { name: "text-options-no-position-keys"; legacy_options: string[]; expected_combo_keys: null[]; enum_conversion_allowed: boolean };
const fixtures = fixtureJson as unknown as {
  valid: { name: string; target: string; value: Obj }[];
  invalid: { name: string; base: string; remove?: string[]; set?: Obj }[];
  semantic_invalid: { name: string; base: string; rule: string; remove?: string[]; set?: Obj }[];
  invalid_json: { name: string; text: string }[];
  scenarios: Scenario[];
};
const bases = new Map(fixtures.valid.map(c => [c.name, c]));
function base(name: string) { const found = bases.get(name); if (!found) throw new Error(name); return found; }
function modify(value: unknown, test: { remove?: string[]; set?: object }) {
  const copy = structuredClone(value) as Obj;
  for (const key of test.remove ?? []) delete copy[key];
  for (const [path, value] of Object.entries(test.set ?? {})) {
    const keys = path.split("."); let parent = copy;
    for (const key of keys.slice(0, -1)) parent = parent[key] as Obj;
    const last = keys.at(-1); if (last) parent[last] = structuredClone(value);
  }
  return copy;
}
const bootstrap = base("bootstrap-protocol").value as Bootstrap;
const scenario = fixtures.scenarios[0];
if (!scenario || !("snapshot" in scenario)) throw new Error("Missing snapshot scenario");
const snapshot = scenario.snapshot;
const report = base("partial-write-report").value as WriteReport;

describe("official rc.1 fixtures (offline only)", () => {
  it.each(fixtures.valid)("valid $name", c => {
    expect(validateDefinition(c.target, c.value)).toEqual({ ok: true });
    if (["request", "response", "event"].includes(c.target)) expect(validateDefinition("root", c.value)).toEqual({ ok: true });
  });
  it.each(fixtures.invalid)("structural rejection $name", c => {
    const original = base(c.base);
    expect(validateDefinition(original.target, modify(original.value, c)).ok).toBe(false);
  });
  it.each(fixtures.invalid_json)("strict JSON rejection $name", c => expect(() => parseStrictJson(c.text)).toThrow());
  it.each(fixtures.semantic_invalid)("semantic rejection $name", c => {
    const original = base(c.base); const value = modify(original.value, c);
    expect(validateDefinition(original.target, value)).toEqual({ ok: true });
    let accepted: boolean;
    switch (c.rule) {
      case "session_correlation": {
        const message = value as ResponseEnvelope;
        const boot = { ...bootstrap, app_id: message.app_id };
        const gate = createResponseGate(boot);
        const req = makeRequest(boot, "diagnostic.set", { enabled: false });
        req.request_id = message.request_id; gate.track(req);
        accepted = gate.accept(message); break;
      }
      case "handshake_identity": accepted = handshakeIdentity(value as ResponseEnvelope, bootstrap); break;
      case "unique_capability": accepted = parseCapabilities((value["result"] as Obj)["capabilities"]) !== null; break;
      case "snapshot_confirmation": accepted = reportMatchesSnapshot(value as WriteReport, snapshot); break;
      case "disjoint_report": accepted = disjointReport(value as WriteReport, snapshot); break;
      default: throw new Error(`Untested semantic rule ${c.rule}`);
    }
    expect(accepted).toBe(false);
  });
  it.each(fixtures.scenarios)("scenario $name", c => {
    switch (c.name) {
      case "snapshot-baseline-only": {
        const after = advanceBaseline(c.baseline_before, c.snapshot, report);
        expect(after).toEqual(c.baseline_after);
        const dirty = dirtyAttributes(c.current, after);
        expect(dirty).toEqual(c.dirty_attribute_numbers);
        expect(dirty.length === 0).toBe(c.close_allowed); break;
      }
      case "legacy-send-is-not-confirmation": {
        const before = scenario.baseline_before;
        expect(advanceBaseline(before, snapshot, c.confirmation)).toEqual(before);
        expect(c.confirmation !== null).toBe(c.baseline_advance_allowed); break;
      }
      case "vob-leading-zeros": {
        const roundtrip = parseStrictJson(JSON.stringify(c.original));
        expect(roundtrip).toEqual(c.roundtrip);
        for (const [key, raw] of Object.entries(c.original)) expect(adaptVobReference([{ index: raw, name: key }], "index")?.[0]?.id).toBe(raw);
        break;
      }
      case "ambiguous-label": {
        const options = c.options.map((p, i) => ({ ...p, generated_key: false, provenance: { source: "legacy_v1", path: null, position: i + 1 } }));
        expect(legacyEnumToValue(c.legacy_value, options)).toEqual(c.expected); break;
      }
      case "text-options-no-position-keys": {
        const options = legacyTextOptions(c.legacy_options);
        expect(options.map(p => p.key)).toEqual(c.expected_combo_keys);
        expect(options.some(p => p.key !== null)).toBe(c.enum_conversion_allowed); break;
      }
      default: throw new Error("Untested scenario");
    }
  });
  it.each(Object.entries(manifest.sha256))("unaltered byte hash %s", (name, hash) => {
    const bytes = readFileSync(`docs/integration/protocol/2.0.0-rc.1/${name}`);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  });
});

describe("inactive boundary and extra protocol regressions", () => {
  it("does not infer a transport from an absent bootstrap", () => {
    const host = window.allplanHost; const launcher = window.allplanLauncher;
    expect(inspectBootstrap(undefined)).toBeNull();
    expect(inspectBootstrap(null)).toBeNull();
    expect(window.allplanHost).toBe(host);
    expect(window.allplanLauncher).toBe(launcher);
  });
  it.each(["vob.open", "vob.save", "catalog.open", "aim.values.write", "refresh", "host.refresh", "operation.status"])("rejects reserved business/control command %s even after a valid handshake", command => {
    const handshake = base("handshake-response").value["result"];
    expect(negotiate(handshake, bootstrap).ok).toBe(true);
    const request = { ...makeRequest(bootstrap, "host.context"), command };
    expect(validateDefinition("request", request).ok).toBe(false);
  });
  it("does not activate protocol or add active imports", () => {
    expect(ACTIVE_PROTOCOL_MODE).toBe("legacy_v1");
    expect(CONTRACT_RELEASE).toBe("2.0.0-rc.1");
    const bridge = readFileSync("src/lib/host-bridge.ts", "utf8");
    expect(bridge).not.toMatch(/from ["']\.\/host-protocol/);
    expect(bridge).not.toContain("api.dispatch(");
  });
  it("reads bootstrap without touching legacy globals or invoking bindings", () => {
    const host = window.allplanHost; const launcher = window.allplanLauncher;
    expect(inspectBootstrap(bootstrap)).toEqual(bootstrap);
    expect(inspectBootstrap({ ...bootstrap, bridge_version: 2 })).toBeNull();
    expect(window.allplanHost).toBe(host); expect(window.allplanLauncher).toBe(launcher);
  });
  it("rejects duplicate and expired final responses and isolates a reused request id", () => {
    const boot = { ...bootstrap, app_id: "vob_editor" as const };
    const gate = createResponseGate(boot);
    const req = makeRequest(boot, "diagnostic.set", { enabled: false });
    const res = { ...base("diagnostic-response").value, request_id: req.request_id } as ResponseEnvelope;
    expect(gate.track(req)).toBe(true);
    expect(gate.accept({ ...res, session_id: "session-old" })).toBe(false);
    expect(matchesRequest(req, res)).toBe(true);
    expect(gate.accept(res)).toBe(true); expect(gate.accept(res)).toBe(false);
    const late = makeRequest(boot, "diagnostic.set", { enabled: false });
    gate.track(late); gate.expire(late.request_id);
    expect(gate.accept({ ...res, request_id: late.request_id })).toBe(false);
  });
  it("requires bootstrap identity and unique capabilities during negotiation", () => {
    const result = base("handshake-response").value;
    if (!result["result"] || typeof result["result"] !== "object") throw new Error("result");
    const inner = result["result"] as Obj;
    expect(negotiate(inner, bootstrap).ok).toBe(true);
    expect(negotiate(inner, { ...bootstrap, session_id: "other" }).ok).toBe(false);
    expect(canCall(parseCapabilities(inner["capabilities"]), "aim.values.write")).toBe(false);
    expect(parseCapabilities([])).toEqual([]);
  });
  it("uses UTF8 size and nested strict JSON rather than character count", () => {
    expect(() => parseStrictJson('"é"', 3)).toThrow();
    expect(parseStrictJson('{"a":[{"b":1},{"b":2}],"c":"}"}')).toEqual({ a: [{ b: 1 }, { b: 2 }], c: "}" });
    expect(() => parseStrictJson('{"a":{"x":1,"x":2}}')).toThrow();
  });
  it("keeps resource unavailable distinct from empty", () => {
    expect(validateResource({ state: "unavailable", items: null, diagnostics: [] }).ok).toBe(true);
    expect(validateResource({ state: "unavailable", items: [], diagnostics: [] }).ok).toBe(false);
  });
  it("canonical numbers and unknown values do not round or substitute", () => {
    expect(canonicalAttributeNumber(207)).toBe("207");
    expect(canonicalAttributeNumber("0207")).toBeNull();
    expect(canonicalAttributeNumber(2 ** 60)).toBeNull();
    expect(legacyEnumToValue("unmapped", [])).toEqual({ kind: "unknown", raw: "unmapped", value: null });
  });
  it("legacy success is strictly boolean and permits null data", () => {
    expect(isLegacyReply({ ok: true, data: null })).toBe(true);
    expect(isLegacyReply({ ok: 1, data: null })).toBe(false);
  });
});
