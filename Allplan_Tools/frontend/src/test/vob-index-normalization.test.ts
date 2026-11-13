import { describe, expect, it } from "vitest";
import { normalizeVobIndex, parseVobReferences, resolveVobReference, type RefKey } from "@/lib/vob-references";
import { displayVobReference, vobDisplayCode, vobDisplayOptions } from "@/lib/vob-reference-display";
import { useVobEditor, vobHasChanges } from "@/lib/vob-editor";

const meta = { status: "available", sources: [{ scope: "ETC", path: "C:/Synthetic.xml", attributeNumber: null, language: "fr" }], diagnostics: [] };
const payload = () => ({ referenceContract: "vob-references/2", trades: [{ index: "035", name: "Maçonnerie" }], objects: [{ num: "35", name: "Mur" }], units: [{ index: "01", name: "m²" }], methods: [{ value: "01", name: "Surface" }], metadata: { trades: meta, objects: meta, units: meta, methods: meta } });

describe("VOB common index normalization", () => {
  it.each([["0035", "35"], ["000", "0"], ["01", "1"], ["-1", "-1"], ["0A5", "0A5"], [" 01", " 01"], ["1.0", "1.0"]])("normalizes %s to %s textually", (raw, code) => {
    expect(normalizeVobIndex(raw)).toBe(code);
  });
  it.each<[RefKey, string, string]>([["trade", "0035", "Maçonnerie"], ["object", "0035", "Mur"], ["unit", "1", "m²"], ["method", "001", "Surface"]])("normalizes both sides for %s", (key, raw, label) => {
    expect(resolveVobReference(parseVobReferences(payload()), key, raw)).toMatchObject({ kind: "unique", id: raw, label });
    expect(vobDisplayCode(key, raw)).toBe(normalizeVobIndex(raw));
  });
  it("aggregates all object occurrences and distinct labels without first-choice resolution", () => {
    const raw = payload(); raw.objects = [{ num: "00112", name: "A" }, { num: "112", name: "B" }, { num: "0112", name: "A" }];
    const state = parseVobReferences(raw);
    expect(resolveVobReference(state, "object", "000112")).toMatchObject({ kind: "ambiguous", candidates: ["A", "B"] });
    expect(state.kind === "v2" && state.data.entries.objects).toHaveLength(3);
    expect(vobDisplayOptions(state, "object", [], "fr")).toEqual([{ value: "00112", label: "ambigu : A / B", index: "112" }]);
  });
  it("does not create ambiguity for repeated identical normalized labels", () => {
    const raw = payload(); raw.objects = [{ num: "0035", name: "Mur" }, { num: "35", name: "Mur" }];
    expect(resolveVobReference(parseVobReferences(raw), "object", "035")).toMatchObject({ kind: "unique", label: "Mur" });
  });
  it("matches a normalized Python diagnostic while preserving its raw id", () => {
    const raw = payload(); raw.objects = [{ num: "00112", name: "A" }, { num: "00112", name: "B" }];
    const diagnostic = { code: "reference_id_ambiguous", severity: "warning", message: "Collision", id: "0112", locations: [] };
    const input = { ...raw, metadata: { ...raw.metadata, objects: { ...meta, status: "available_with_diagnostics", diagnostics: [diagnostic] } } };
    const state = parseVobReferences(input);
    expect(state.kind).toBe("v2");
    expect(state.kind === "v2" && state.data.metadata.objects.diagnostics[0]?.id).toBe("0112");
    expect(resolveVobReference(state, "object", "112").kind).toBe("ambiguous");
  });
  it("keeps label and index separate in trade/object choices, including unknown codes", () => {
    const state = parseVobReferences(payload());
    expect(vobDisplayOptions(state, "trade", ["0035"], "fr")).toEqual([{ value: "035", label: "Maçonnerie", index: "35" }]);
    expect(vobDisplayOptions(state, "object", ["0035", "0099"], "fr")).toEqual([{ value: "35", label: "Mur", index: "35" }, { value: "0099", label: "identifiant sans correspondance", index: "99" }]);
    expect(displayVobReference(state, "object", "0099", "fr")).toBe("99 · identifiant sans correspondance");
  });
  it("leaves raw rules, saved snapshot, history and dirty state intact on reference load/display and unrelated edits", () => {
    const rule = { id: "raw", trade: "0035", object: "0035", unit: "01", method: "001", formula: "000+@0035@", comment: "file0035.dat" };
    useVobEditor.getState().load([rule], null, []);
    const before = useVobEditor.getState(); const raw = payload(); const copy = structuredClone(raw);
    const state = parseVobReferences(raw);
    for (const key of ["trade", "object", "unit", "method"] as const) { displayVobReference(state, key, rule[key], "fr"); vobDisplayOptions(state, key, [rule[key]], "fr"); }
    expect(raw).toEqual(copy); expect(useVobEditor.getState().rules).toBe(before.rules); expect(useVobEditor.getState().saved).toBe(before.saved);
    expect(useVobEditor.getState().past).toBe(before.past); expect(vobHasChanges(useVobEditor.getState())).toBe(false);
    useVobEditor.getState().updateMany(["raw"], { comment: "Changed" });
    expect(useVobEditor.getState().rules[0]).toEqual({ ...rule, comment: "Changed" });
  });
});