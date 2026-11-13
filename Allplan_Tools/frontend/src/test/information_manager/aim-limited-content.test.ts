import { describe, expect, it } from "vitest";
import { aimAttributeNumber, limitedOutcomeText, parseAimInitialContainer, validateAimContent } from "@/modules/information_manager/lib/aim-legacy";

describe("AIM limited binding: content validation before applyData", () => {
  const cat = [{ num: 7, name: "Name", widget: "entry", type: "STR" }];
  it("accepts a coherent catalog, rows and values", () => {
    expect(validateAimContent({ catalog: cat, attributes: [{ num: 7, title: "T", widget: "entry", type: "STR" }], values: { "7": "x" } })).toEqual({ ok: true, catalogEmpty: false });
  });
  it("catalog:[] is a confirmed empty catalog, distinct from absent data", () => {
    expect(validateAimContent({ catalog: [] })).toEqual({ ok: true, catalogEmpty: true });
    expect(parseAimInitialContainer({ app: "information_manager", data: {} })).toEqual({ kind: "absent" });
  });
  it("never normalises '0007' silently", () => {
    expect(aimAttributeNumber("0007")).toBe("ambiguous");
    expect(aimAttributeNumber("7")).toBe(7);
    expect(aimAttributeNumber(7.5)).toBeNull();
    const r = validateAimContent({ catalog: cat, values: { "0007": "x" } });
    expect(r).toEqual({ ok: false, issues: [{ path: "values.0007", code: "ambiguous-number" }] });
  });
  it("rejects duplicates, bad types, unknown fields and unmatched rows/values", () => {
    const r = validateAimContent({ catalog: [...cat, { num: 7, name: "dup" }], attributes: [{ num: 9, widget: "slider" }], values: { "8": {} }, extra: 1 });
    expect(r.ok).toBe(false);
    const codes = (r as { issues: { code: string }[] }).issues.map((i) => i.code).sort();
    expect(codes).toEqual(["duplicate", "type", "type", "unknown-field", "unmatched-attribute", "unmatched-value"].sort());
  });
  it("labels absent, empty, invalid and timeout differently and states that browser data are kept", () => {
    const labels = (["absent", "empty", "invalid", "timeout"] as const).map((o) => limitedOutcomeText("fr", o, 0));
    expect(new Set(labels).size).toBe(4);
    expect(limitedOutcomeText("fr", "timeout", 0)).not.toMatch(/vide/);
    expect(limitedOutcomeText("fr", "absent", 3)).toMatch(/navigateur conservées/);
  });
});
