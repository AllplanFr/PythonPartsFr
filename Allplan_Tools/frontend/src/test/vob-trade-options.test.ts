import { describe, expect, it, vi } from "vitest";
import { parseVobReferences, resolveVobReference, vobTradeCode } from "@/lib/vob-references";
import { displayVobReference, vobDisplayOptions } from "@/lib/vob-reference-display";
import { VobCloseCoordinator } from "@/lib/vob-close";

const user = { scope: "USER", label: "Correspondances utilisateur", language: "fr", coverage: "specified_codes_only" };
const warn = { code: "reference_coverage_limited", severity: "warning", message: "Limité", id: null, locations: [] };
const etc = { scope: "ETC", path: "C:/Synthetic/fr.xml", attributeNumber: "209", language: "fr" };
const state = (trades: { index: string; name: string }[], tradeDiagnostics: object[] = []) => parseVobReferences({
  referenceContract: "vob-references/2", trades, objects: [{ num: "007", name: "Mur" }],
  methods: [{ value: "13", name: "?" }], units: [{ index: "01", name: "m²" }],
  metadata: { trades: { status: tradeDiagnostics.length ? "available_with_diagnostics" : "available", sources: [etc], diagnostics: tradeDiagnostics }, objects: { status: "available", sources: [etc], diagnostics: [] },
    methods: { status: "available_with_diagnostics", sources: [user], diagnostics: [warn] }, units: { status: "available_with_diagnostics", sources: [user], diagnostics: [warn] } },
});

describe("VOB trades: leading zeros and alphabetical options", () => {
  it("normalizes only purely numeric trade codes, textually", () => {
    expect(vobTradeCode("035")).toBe("35"); expect(vobTradeCode("000")).toBe("0"); expect(vobTradeCode("0")).toBe("0");
    expect(vobTradeCode("-1")).toBe("-1"); expect(vobTradeCode("0A5")).toBe("0A5"); expect(vobTradeCode("00000000000000000000123")).toBe("123");
  });
  it("matches numeric leading zeros across all reference categories", () => {
    const st = state([{ index: "35", name: "Maçonnerie" }]);
    expect(resolveVobReference(st, "trade", "035")).toMatchObject({ kind: "unique", label: "Maçonnerie" });
    expect(resolveVobReference(st, "object", "7").kind).toBe("unique");
    expect(resolveVobReference(st, "unit", "1").kind).toBe("unique");
  });
  it("reports a collision between 05 and 5 with different labels as ambiguous", () => {
    const st = state([{ index: "05", name: "A" }, { index: "5", name: "B" }]);
    expect(resolveVobReference(st, "trade", "5")).toMatchObject({ kind: "ambiguous", candidates: ["A", "B"] });
  });
  it("sorts trade options by displayed label, keeps exact source code as value and normalized code as index", () => {
    const st = state([{ index: "02", name: "Zinguerie" }, { index: "035", name: "béton" }, { index: "1", name: "Arase" }]);
    const options = vobDisplayOptions(st, "trade", ["0035"], "fr");
    expect(options.map((o) => o.label)).toEqual(["Arase", "béton", "Zinguerie"]);
    expect(options.find((o) => o.label === "béton")).toEqual({ value: "035", label: "béton", index: "35" });
  });
  it("drops user provenance from unit/method options but keeps it in cell text and method 13 warning", () => {
    const st = state([]);
    expect(vobDisplayOptions(st, "unit", [], "fr").find((o) => o.value === "01")?.label).toBe("m²");
    expect(vobDisplayOptions(st, "method", [], "fr").find((o) => o.value === "13")?.label).toContain("signification non établie");
    expect(vobDisplayOptions(st, "method", [], "fr").some((o) => o.label.includes("source utilisateur"))).toBe(false);
    expect(displayVobReference(st, "unit", "01", "fr")).toContain("source utilisateur");
  });
});

describe("VOB close: return to editing", () => {
  it("runs the stay action only after Python confirms the cancellation, never on authorize", async () => {
    const stayed = vi.fn();
    const call = vi.fn(async (command: string, payload: object) => ({ requestId: (payload as { requestId: string }).requestId, status: command.endsWith("authorize") ? "authorized" : "cancelled" }));
    const c = new VobCloseCoordinator({ call, ask: async () => false, blockLeave: async () => false, report: vi.fn(), stayed }); c.setEnabled(true);
    c.receive({ requestId: "h1", reason: "native_window_close" });
    await vi.waitFor(() => expect(stayed).toHaveBeenCalledTimes(1));
    expect(call).toHaveBeenCalledExactlyOnceWith("vob.close.cancel", { requestId: "h1" });
  });
  it("does not run the stay action when the cancellation reply is refused", async () => {
    const stayed = vi.fn(), report = vi.fn();
    const c = new VobCloseCoordinator({ call: async () => ({ requestId: "h1", status: "ignored", reason: "not_current_request" }), ask: async () => false, blockLeave: async () => false, report, stayed }); c.setEnabled(true);
    c.receive({ requestId: "h1", reason: "native_window_close" });
    await vi.waitFor(() => expect(report).toHaveBeenCalled());
    expect(stayed).not.toHaveBeenCalled();
  });
});
