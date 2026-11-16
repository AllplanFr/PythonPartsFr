import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPresentation, modelMatchesConfiguration, parseApply, parseExport, parseGet, parsePrepare, presentationAvailable, type Presentation } from "@/modules/information_manager/lib/aim-presentation-contract";
import { OrganizedPresentationView, PresentationImportDialog } from "@/modules/information_manager/components/presentation-import";

// TEST FIXTURES ONLY — synthetic examples copied from AIM_LOVABLE_PRESENTATION_IMPORT.md.
const CANDIDATE = {
  configuration: {
    schema: "aim-presentation-configuration", version: 1, configurationId: "exemple",
    resetPolicy: { applyOn: "explicit_reset_only", checkboxWithoutDefault: "unchecked" },
    categories: [{ id: "category-1", position: 1, name: "Projet", icon: "historique.ico", groups: [{ id: "group-1", position: 1, title: "Informations", backgroundColor: "#eeeeee", expanded: true,
      rows: [{ id: "group-1-line-1", position: 1, num: 7, title: "Statut", widget: "checkbox", resetDefault: { state: "absent" } }] }] }],
  },
  report: null,
  model: {
    schema: "aim-organized-presentation", version: 1, configurationId: "exemple", readOnly: true, project: null, installation: null,
    prjatt: { status: "not_loaded", path: null, encodingHint: null, header: null }, definitions: { status: "not_loaded" },
    categories: [{ id: "category-1", position: 1, name: "Projet", icon: "historique.ico", groups: [{ id: "group-1", position: 1, title: "Informations", backgroundColor: "#eeeeee", expanded: true,
      rows: [{ id: "group-1-line-1", position: 1, number: "7", title: "Statut", widget: "checkbox", resetDefault: { state: "absent" }, definition: null, valueState: "unavailable", value: null, diagnostics: ["definition_missing"] }] }] }],
    counts: { configurationLines: 1, matchedDefinitions: 0, missingDefinitions: 1, set: 0, unset: 0, unavailable: 1 },
    diagnostics: [], conversionDiagnostics: [],
  },
};
const REPORT = {
  schema: "aim-presentation-conversion-report", version: 1, configurationId: "exemple",
  source: { fileName: "ancienne.db", encoding: "UTF-8", fileSha256: null, provenanceLimit: "x", configurationSnapshotSha256: "0".repeat(64), snapshotScope: "x" },
  ordering: { categories: "a", groups: "b", rows: "c", positionBase: 1 },
  mappings: [{ targetId: "category-1", source: { table: "INFOS_ONGLETS", rowid: 1 }, raw: { titre: "Projet" } }],
  discarded: { formattingExpressions: [], separators: [], textColors: "x" }, issues: [],
  summary: { status: "converted", categories: 1, groups: 1, rows: 1, ignoredSeparators: 0, unresolvedIssues: 0, errors: 0 },
};
const TOKEN = "11111111-1111-4111-8111-111111111111";
const INFO = { id: "information_manager", title: "t", protocol_version: 1, capabilities: ["project.select"], read_only: true, project_contract: 2, presentation_contract: 1,
  presentation_capabilities: ["presentation.import.prepare", "presentation.import.apply", "presentation.import.cancel", "presentation.get", "presentation.export"] };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const prepared = (c: unknown = CANDIDATE) => ({ ok: true, status: "prepared", token: TOKEN, candidate: clone(c) });
/** Two rows sharing number 7, with exact values "" and "0|a". */
const repeated = () => {
  const c = clone(CANDIDATE) as typeof CANDIDATE & { model: { categories: { groups: { rows: Record<string, unknown>[] }[] }[] }; configuration: { categories: { groups: { rows: Record<string, unknown>[] }[] }[] } };
  const cr = c.configuration.categories[0]!.groups[0]!.rows, mr = c.model.categories[0]!.groups[0]!.rows;
  cr.push({ ...cr[0], id: "group-1-line-2", position: 2 });
  mr[0] = { ...mr[0], valueState: "set", value: "" } as unknown as typeof mr[number];
  mr.push({ ...mr[0], id: "group-1-line-2", position: 2, value: "0|a" });
  return c;
};

describe("presentation contract 1 — identity and structure", () => {
  it("requires the exact identity and the five capabilities in order", () => {
    expect(presentationAvailable(INFO)).toBe(true);
    expect(presentationAvailable({ ...INFO, presentation_contract: 2 })).toBe(false);
    expect(presentationAvailable({ ...INFO, presentation_capabilities: [...INFO.presentation_capabilities].reverse() })).toBe(false);
    expect(presentationAvailable({ ...INFO, capabilities: ["project.select", "presentation.get"] })).toBe(false);
    expect(presentationAvailable(null)).toBe(false);
  });
  it("accepts the documented prepare/apply/get/export/cancel examples", () => {
    expect(parsePrepare(prepared()).kind).toBe("prepared");
    expect(parsePrepare(prepared({ ...CANDIDATE, report: REPORT })).kind).toBe("prepared");
    expect(parsePrepare({ ok: true, status: "cancelled" }).kind).toBe("cancelled");
    expect(parseApply({ ok: true, status: "applied", presentation: clone(CANDIDATE) }).kind).toBe("applied");
    expect(parseGet({ ok: true, status: "empty", presentation: null }).kind).toBe("empty");
    expect(parseExport({ ok: true, status: "exported", fileName: "presentation-aim.json", configurationId: "exemple" }, "exemple").kind).toBe("exported");
  });
  it("refuses a report with errors, mismatched ids, merged positions and an export for another configuration", () => {
    expect(parsePrepare(prepared({ ...CANDIDATE, report: { ...REPORT, summary: { ...REPORT.summary, errors: 1 } } })).kind).toBe("invalid");
    expect(isPresentation({ ...clone(CANDIDATE), model: { ...clone(CANDIDATE.model), configurationId: "autre" } })).toBe(false);
    const bad = repeated(); bad.model.categories[0]!.groups[0]!.rows[1]!.position = 3;
    expect(isPresentation(bad)).toBe(false);
    expect(parseExport({ ok: true, status: "exported", fileName: "f.json", configurationId: "autre" }, "exemple").kind).toBe("invalid");
    expect(parsePrepare({ ...prepared(), extra: 1 }).kind).toBe("invalid");
  });
  it("keeps conversion_failed reports and error codes", () => {
    const o = parsePrepare({ ok: false, error: { code: "conversion_failed", message: "m" }, report: { ...REPORT, summary: { ...REPORT.summary, errors: 2 } } });
    expect(o.kind === "failure" && o.code === "conversion_failed" && o.report?.summary.errors).toBe(2);
  });
  it("set imposes an exact string; unset/unavailable impose null", () => {
    const c = clone(CANDIDATE); (c.model.categories[0]!.groups[0]!.rows[0] as Record<string, unknown>)["valueState"] = "set";
    expect(isPresentation(c)).toBe(false);
    expect(isPresentation(repeated())).toBe(true);
  });
});

describe("presentation contract 1 — allowed fields and configuration/model coherence", () => {
  type Tree = { categories: { id: string; position: number; groups: { id: string; position: number; rows: Record<string, unknown>[] }[] }[] } & Record<string, unknown>;
  const base = () => clone(CANDIDATE) as unknown as { configuration: Tree; model: Tree; report: null };
  it("refuses undeclared fields in categories, groups and rows (configuration and model)", () => {
    const a = base(); (a.configuration.categories[0] as Record<string, unknown>)["color"] = "x"; expect(isPresentation(a)).toBe(false);
    const b = base(); (b.model.categories[0]!.groups[0] as Record<string, unknown>)["extra"] = 1; expect(isPresentation(b)).toBe(false);
    const c = base(); c.configuration.categories[0]!.groups[0]!.rows[0]!["number"] = "7"; expect(isPresentation(c)).toBe(false);
    const d = base(); d.model.categories[0]!.groups[0]!.rows[0]!["num"] = 7; expect(isPresentation(d)).toBe(false);
    const e = base(); e.model.categories[0]!.groups[0]!.rows[0]!["hint"] = "x"; expect(isPresentation(e)).toBe(false);
    expect(isPresentation({ configuration: clone(CANDIDATE.configuration), model: clone(CANDIDATE.model), rapport: null })).toBe(false);
  });
  it("refuses a model whose ids differ from the configuration", () => {
    const a = base(); a.model.categories[0]!.groups[0]!.rows[0]!["id"] = "autre-ligne"; expect(isPresentation(a)).toBe(false);
    const b = base(); b.model.categories[0]!.groups[0]!.id = "group-2"; expect(isPresentation(b)).toBe(false);
    const c = base(); c.model.categories[0]!.id = "category-2"; expect(isPresentation(c)).toBe(false);
  });
  it("refuses a row attached to another parent or at another position", () => {
    // Same ids overall, but line-2 moved under a second group in the model only.
    const r = repeated() as unknown as { configuration: Tree; model: Tree; report: null };
    const g = r.model.categories[0]!.groups[0]!;
    const moved = g.rows.pop()!; moved["position"] = 1;
    r.model.categories[0]!.groups.push({ ...g, id: "group-2", position: 2, rows: [moved] } as never);
    r.configuration.categories[0]!.groups.push({ ...r.configuration.categories[0]!.groups[0]!, id: "group-2", position: 2, rows: [] } as never);
    expect(isPresentation(r)).toBe(false);
    // Rows swapped in the model: positions stay contiguous but ids no longer match the configuration order.
    const s = repeated() as unknown as { configuration: Tree; model: Tree; report: null };
    const rows = s.model.categories[0]!.groups[0]!.rows;
    [rows[0]!["id"], rows[1]!["id"]] = [rows[1]!["id"], rows[0]!["id"]];
    expect(isPresentation(s)).toBe(false);
  });
  it("refuses num/number mismatch, accepts a coherent repeated number", () => {
    const a = base(); a.model.categories[0]!.groups[0]!.rows[0]!["number"] = "8"; expect(isPresentation(a)).toBe(false);
    expect(isPresentation(repeated())).toBe(true);
    const p = repeated() as unknown as Presentation;
    expect(modelMatchesConfiguration(p.configuration, p.model)).toBe(true);
  });
});

describe("organized view", () => {
  afterEach(cleanup);
  it("renders repeated numbers as two rows with exact values, no merge", () => {
    render(createElement(OrganizedPresentationView, { presentation: repeated() as unknown as Presentation }));
    const rows = [...document.querySelectorAll("[data-row-id]")];
    expect(rows.map((r) => r.getAttribute("data-row-id"))).toEqual(["group-1-line-1", "group-1-line-2"]);
    const vals = rows.map((r) => r.querySelector("[data-value-state]")!.textContent);
    expect(vals).toEqual(["", "0|a"]);
  });
});

describe("import dialog flow", () => {
  let call: ReturnType<typeof vi.fn>;
  let replies: Record<string, unknown[]>;
  const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
  beforeEach(() => {
    replies = {};
    call = vi.fn(async (c: string) => { const r = replies[c]?.shift(); if (r instanceof Error) throw r; return r; });
    (window as unknown as { pywebview: unknown }).pywebview = { api: { call } };
  });
  afterEach(() => { cleanup(); delete (window as unknown as { pywebview?: unknown }).pywebview; });
  const open = async (props: Partial<Parameters<typeof PresentationImportDialog>[0]> = {}) => {
    const onApplied = vi.fn(), onClose = vi.fn();
    render(createElement(PresentationImportDialog, { onApplied, onClose, ...props }));
    await flush();
    return { onApplied, onClose };
  };
  const btn = (n: RegExp) => screen.getByRole("button", { name: n });

  it("prepare sends exactly {}, no intermediate window, then only the overwrite confirmation", async () => {
    let resolvePrepare!: (r: unknown) => void;
    call.mockImplementationOnce((() => new Promise((r) => { resolvePrepare = r; })) as never);
    replies = { "presentation.import.apply": [{ ok: true, status: "applied", presentation: clone(CANDIDATE) }] };
    const onApplied = vi.fn(), onClose = vi.fn();
    render(createElement(PresentationImportDialog, { onApplied, onClose }));
    await flush();
    expect(call).toHaveBeenCalledWith("presentation.import.prepare", {});
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Sélection et conversion en cours/)).toBeNull();
    resolvePrepare(prepared()); await flush();
    const dialog = screen.getByRole("dialog", { name: "Voulez-vous vraiment écraser la présentation actuelle ?" });
    expect(dialog.textContent).toContain("Voulez-vous vraiment écraser la présentation actuelle ?");
    expect(screen.queryByText(/Export historique limité/)).toBeNull();
    expect(screen.queryByLabelText("import-summary")).toBeNull();
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(btn(/Écraser/)); await flush();
    expect(call).toHaveBeenCalledWith("presentation.import.apply", { token: TOKEN });
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
  it("Annuler cancels the token and keeps the current presentation", async () => {
    replies = { "presentation.import.prepare": [prepared()], "presentation.import.cancel": [{ ok: true, status: "cancelled" }] };
    const { onApplied, onClose } = await open();
    fireEvent.click(btn(/^Annuler$/)); await flush();
    expect(call).toHaveBeenCalledWith("presentation.import.cancel", { token: TOKEN });
    expect(onApplied).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalled();
  });
  it("project_changed on apply: nothing applied, re-prepare offered", async () => {
    replies = { "presentation.import.prepare": [prepared()], "presentation.import.apply": [{ ok: false, error: { code: "project_changed", message: "Le contexte projet a change" } }] };
    const { onApplied } = await open();
    fireEvent.click(btn(/Écraser/)); await flush();
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/relancez l'import|conservée/);
  });
  it("incompatible database or invalid response: error shown, no apply, no fallback", async () => {
    replies = { "presentation.import.prepare": [{ ok: false, error: { code: "incompatible_database", message: "Ce fichier n'est pas compatible." } }] };
    const { onApplied } = await open();
    expect(screen.getByRole("alert").textContent).toContain("présentation actuelle est conservée");
    expect(onApplied).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("lost apply acknowledgement: verifies through presentation.get", async () => {
    replies = { "presentation.import.prepare": [prepared()], "presentation.import.apply": [new Error("lost")], "presentation.get": [{ ok: true, status: "current", presentation: clone(CANDIDATE) }] };
    const { onApplied } = await open();
    fireEvent.click(btn(/Écraser/)); await flush();
    expect(call).toHaveBeenCalledWith("presentation.get", {});
    expect(onApplied).toHaveBeenCalledTimes(1);
  });
});
