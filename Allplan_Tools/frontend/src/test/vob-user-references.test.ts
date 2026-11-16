import { describe, expect, it } from "vitest";
import { parseVobReferences, resolveVobReference } from "@/lib/vob-references";
import { displayVobReference, vobDisplayOptions, vobDefaultLabel, vobUndefinedLabel } from "@/lib/vob-reference-display";

const user = { scope: "USER", label: "Correspondances d’affichage fournies par l’utilisateur", language: "fr", coverage: "specified_codes_only" };
const diagnostic = { code: "reference_coverage_limited", severity: "warning", message: "Catalogue limité", id: null, locations: [] };
const meta = { status: "available_with_diagnostics", sources: [user], diagnostics: [diagnostic] };
const payload = () => ({
  referenceContract: "vob-references/2",
  trades: [{ index: "0", name: "" }, { index: "1", name: "A" }, { index: "05", name: "B" }], objects: [],
  methods: [{ value: "01", name: "Volume" }, { value: "13", name: "?" }],
  units: [{ index: "00", name: "m³" }, { index: "01", name: "m²" }, { index: "02", name: "m" }, { index: "05", name: "geo" }],
  metadata: { trades: { status: "available", sources: [{ scope: "ETC", path: "C:/Synthetic/AttributeDefinitionCollectionAllplan_fr.xml", attributeNumber: "209", language: "fr" }], diagnostics: [] }, objects: { status: "unavailable", sources: [], diagnostics: [diagnostic] }, methods: meta, units: meta },
});
describe("USER reference extension", () => {
  it("accepts exact USER union and keeps its real French language", () => {
    const st = parseVobReferences(payload()); expect(st.kind).toBe("v2");
    if (st.kind !== "v2") throw new Error("Expected v2");
    expect(st.data.metadata.units.sources).toEqual([user]);
  });
  it.each([{ ...user, path: "fake" }, { ...user, attributeNumber: null }, { ...user, language: "" }, { ...user, label: "" }, { ...user, coverage: "all" }, { scope: "USER", language: "fr", label: "x" }])("rejects invalid USER source %j without legacy", (source) => {
    const raw = payload(); raw.metadata.units = { ...meta, sources: [source as typeof user] };
    expect(parseVobReferences(raw).kind).toBe("contract_error");
  });
  it("matches normalized method and trade codes without rewriting identifiers", () => {
    const st = parseVobReferences(payload());
    expect(resolveVobReference(st, "method", "1").kind).toBe("unique");
    expect(resolveVobReference(st, "method", "01").kind).toBe("unique");
    // Numeric leading zeros are ignored in all four categories.
    expect(resolveVobReference(st, "trade", "001").kind).toBe("unique");
    expect(resolveVobReference(st, "trade", "1").kind).toBe("unique");
  });
  it("keeps empty trade label as a unique match", () => {
    expect(resolveVobReference(parseVobReferences(payload()), "trade", "0")).toMatchObject({ kind: "unique", label: "", id: "0" });
    expect(vobDisplayOptions(parseVobReferences(payload()), "trade", [], "fr").find((o) => o.value === "0")?.label).toBe("[libellé vide]");
  });
  it("method 13 is unresolved in cells and options, never an invented definition", () => {
    const st = parseVobReferences(payload());
    expect(resolveVobReference(st, "method", "13")).toMatchObject({ kind: "unique", id: "13", label: "?" });
    expect(vobDisplayOptions(st, "method", [], "fr").find((o) => o.value === "13")?.label).toBe(displayVobReference(st, "method", "13", "fr", false, true));
  });
  it("sentinel value stays -1 in unit/method options only", () => {
    const st = parseVobReferences(payload());
    for (const key of ["unit", "method"] as const) expect(vobDisplayOptions(st, key, [], "de")[0]).toEqual({ value: "-1", label: key === "unit" ? vobDefaultLabel("de") : vobUndefinedLabel("de"), index: "-1" });
    expect(vobDisplayOptions(st, "trade", [], "fr").some((o) => o.value === "-1")).toBe(false);
    expect(resolveVobReference(st, "object", "-1")).toEqual({ kind: "sentinel" });
  });
  it("unknown and unavailable raw values remain selectable", () => {
    const st = parseVobReferences(payload());
    expect(vobDisplayOptions(st, "unit", ["77"], "fr").find((o) => o.value === "77")?.index).toBe("77");
    expect(resolveVobReference(st, "object", "0112")).toMatchObject({ kind: "unavailable", id: "0112" });
  });
  it("parsing leaves original business document and payload unchanged", () => {
    const raw = payload(); const before = structuredClone(raw);
    parseVobReferences(raw); expect(raw).toEqual(before);
  });
});