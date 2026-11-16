import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseVobReferences, resolveVobReference, vobReferenceOptions, type VobRefState } from "@/lib/vob-references";
import { useVobHost, vobLoadReferences } from "@/lib/vob-bridge";
import { useVobEditor } from "@/lib/vob-editor";

const diag = (code: string, id: string | null = null) => ({ code, severity: "error", message: "m", id, locations: [] });
const unavailable = (code = "x") => ({ status: "unavailable", sources: [], diagnostics: [diag(code)] });
const src = { scope: "STD", path: "C:\\std\\objekt.000", attributeNumber: null, language: null };
const v2 = (objects: { num: string; name: string }[], objMeta: object = { status: "available", sources: [src], diagnostics: [] }) => ({
  referenceContract: "vob-references/2", trades: [], objects, methods: [], units: [],
  metadata: { trades: unavailable(), objects: objMeta, methods: unavailable(), units: unavailable() },
});
const ambiguous = v2([{ num: "112", name: "Floor Level" }, { num: "112", name: "Geschossebene" }, { num: "112", name: "Livello piano" }],
  { status: "available_with_diagnostics", sources: [src], diagnostics: [{ ...diag("reference_id_ambiguous", "112"), severity: "warning" }] });

describe("vob-references/2", () => {
  it("objects available, other categories unavailable without static fallback", () => {
    const st = parseVobReferences(v2([{ num: "5", name: "Mur" }]));
    expect(st.kind).toBe("v2");
    expect(resolveVobReference(st, "trade", "3")).toEqual({ kind: "unavailable", id: "3", reason: "category" });
    expect(vobReferenceOptions(st, "method")).toEqual([]);
  });
  it("unique object keeps id; language null is not an established translation", () => {
    expect(resolveVobReference(parseVobReferences(v2([{ num: "5", name: "Mur" }])), "object", "5")).toEqual({ kind: "unique", id: "5", label: "Mur", languageEstablished: false });
  });
  it("unknown identifier in an available category", () => {
    expect(resolveVobReference(parseVobReferences(v2([{ num: "5", name: "Mur" }])), "object", "6")).toEqual({ kind: "unknown", id: "6" });
  });
  it("ambiguous 112 lists candidates without choosing one", () => {
    const st = parseVobReferences(ambiguous);
    expect(resolveVobReference(st, "object", "112")).toEqual({ kind: "ambiguous", id: "112", candidates: ["Floor Level", "Geschossebene", "Livello piano"] });
    expect(st.kind === "v2" && st.data.entries.objects).toHaveLength(3);
  });
  it("repeated identical occurrences are kept and not ambiguous", () => {
    const st = parseVobReferences(v2([{ num: "7", name: "Dalle" }, { num: "7", name: "Dalle" }]));
    expect(st.kind === "v2" && st.data.entries.objects).toHaveLength(2);
    expect(resolveVobReference(st, "object", "7").kind).toBe("unique");
  });
  it('"0112" and "112" resolve the same code, retaining raw ids', () => {
    const st = parseVobReferences(v2([{ num: "0112", name: "A" }]));
    expect(resolveVobReference(st, "object", "112").kind).toBe("unique");
    expect(resolveVobReference(st, "object", "0112").kind).toBe("unique");
  });
  it('"-1" is the sentinel regardless of status, and refused as an entry', () => {
    expect(resolveVobReference({ kind: "none" }, "method", "-1")).toEqual({ kind: "sentinel" });
    expect(parseVobReferences(v2([{ num: "-1", name: "x" }])).kind).toBe("contract_error");
  });
  it("legacy reply is legacy_unverified with ids as strings, labels not used", () => {
    const st = parseVobReferences({ trades: [{ index: 12, name: "Gros œuvre" }], objects: [], methods: [], units: [] });
    expect(st.kind).toBe("legacy_unverified");
    expect(st.kind === "legacy_unverified" && st.entries.trades[0]).toEqual({ id: "12", name: "Gros œuvre" });
    expect(resolveVobReference(st, "trade", "12")).toEqual({ kind: "unavailable", id: "12", reason: "legacy" });
  });
  it("inconsistent v2 replies are contract errors", () => {
    expect(parseVobReferences({ ...v2([]), referenceContract: "vob-references/3" }).kind).toBe("contract_error");
    expect(parseVobReferences({ referenceContract: "vob-references/2", trades: [], objects: [], methods: [], units: [] }).kind).toBe("contract_error");
    expect(parseVobReferences(v2([{ num: "1", name: "a" }], unavailable())).kind).toBe("contract_error");
    expect(parseVobReferences(v2([], { status: "unavailable", sources: [], diagnostics: [] })).kind).toBe("contract_error");
    expect(parseVobReferences(v2([{ num: "112", name: "a" }, { num: "112", name: "b" }], { status: "available", sources: [src], diagnostics: [] })).kind).toBe("contract_error");
    expect(parseVobReferences(v2([{ num: 5 as never, name: "a" }])).kind).toBe("contract_error");
    expect(parseVobReferences({ ...v2([]), extra: 1 }).kind).toBe("contract_error");
  });
});

describe("reference.load requests", () => {
  beforeEach(() => { useVobHost.setState({ references: { kind: "none" } }); });
  it("ok:false shows error, drops previous labels, out-of-order replies ignored, rules untouched", async () => {
    const pending: ((v: unknown) => void)[] = [];
    window.pywebview = { api: { call: (() => new Promise((res) => pending.push(res))) as never } as never };
    useVobEditor.getState().load([{ id: "r", trade: "1", object: "112", unit: "-1", method: "-1", formula: "", comment: "", enabled: true }], null, []);
    const before = useVobEditor.getState();
    const first = vobLoadReferences("fr"); const second = vobLoadReferences("de");
    expect(useVobHost.getState().references.kind).toBe("loading");
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!({ ok: false, error: { code: "unavailable_reference", message: "boom" } });
    await second;
    expect(useVobHost.getState().references).toEqual({ kind: "error", message: "boom" });
    pending[0]!({ ok: true, data: ambiguous }); await first; // stale
    expect(useVobHost.getState().references.kind).toBe("error");
    const after = useVobEditor.getState();
    expect(after.rules).toBe(before.rules); expect(after.saved).toBe(before.saved);
    const s: VobRefState = useVobHost.getState().references;
    expect(resolveVobReference(s, "object", "112").kind).toBe("unavailable");
  });
});
