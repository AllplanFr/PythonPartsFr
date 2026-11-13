import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./synthetic-presentation.json";
import { isPresentation, type Presentation } from "@/modules/information_manager/lib/aim-presentation-contract";
import { OrganizedPresentationView, PresentationImportDialog } from "@/modules/information_manager/components/presentation-import";
import * as catalog from "@/modules/information_manager/lib/attribute-catalog";

const INFO = {
  id: "information_manager", protocol_version: 1, project_contract: 2, read_only: true,
  capabilities: ["project.select"], presentation_contract: 1,
  presentation_capabilities: ["presentation.import.prepare", "presentation.import.apply",
    "presentation.import.cancel", "presentation.get", "presentation.export"],
};
vi.mock("@/shared/transport/native-binding", async (original) => ({
  ...(await original<object>()), getVerifiedAppInfo: () => INFO,
}));
const { AimEditor } = await import("@/modules/information_manager/AimEditor");
const TOKEN = "11111111-1111-4111-8111-111111111111";
const presentation = (): Presentation => {
  const value: unknown = structuredClone(fixture.presentation);
  if (!isPresentation(value)) throw new Error("Synthetic fixture violates presentation contract 1");
  return value;
};
const flush = async () => {
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
};
const shownValues = () => [...document.querySelectorAll("[data-row-id] [data-value-state]")]
  .map((node) => node.textContent);

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  URL.createObjectURL ??= () => "blob:synthetic";
  URL.revokeObjectURL ??= () => {};
  localStorage.clear();
  catalog.setCatalog([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Information Manager/i }), { key: "ArrowDown" });
  await flush();
}

async function importInEditor() {
  const p = presentation();
  const call = vi.fn(async (command: string) => {
    if (command === "presentation.import.prepare") return { ok: true, status: "prepared", token: TOKEN, candidate: p };
    if (command === "presentation.import.apply") return { ok: true, status: "applied", presentation: p };
    if (command === "presentation.export") return { ok: true, status: "exported", fileName: "synthetic.json", configurationId: p.configuration.configurationId };
    throw new Error(`Unexpected command: ${command}`);
  });
  vi.stubGlobal("pywebview", { api: { get_initial_data: vi.fn(async () => structuredClone(fixture.initial)), call } });
  render(createElement(AimEditor, { hostEnabled: false, limitedHost: true }));
  await flush();
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: /Import presentation|Importer une présentation/ }));
  await flush();
  expect(shownValues()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /Écraser/ }));
  await flush();
  return { p, call };
}

describe("AIM reprise: current mounted path, synthetic evidence only", () => {
  it("uses the real menu, prepare and apply, then mounts all occurrences and exact values", async () => {
    const { call } = await importInEditor();
    expect(call.mock.calls.map(([command]) => command)).toEqual([
      "presentation.import.prepare", "presentation.import.apply",
    ]);
    expect(shownValues()).toEqual(["", "", "0", " leading\nsynthetic|choice "]);
    // Normal navigation carries no technical details panel.
    expect(screen.queryByLabelText("project-technical-details")).toBeNull();
    expect(shownValues()).toEqual(["", "", "0", " leading\nsynthetic|choice "]);
  });
});

describe("AIM reprise: acceptance criteria (expected failures before Lovable fix)", () => {
  it("keeps global diagnostics behind a collapsed accessible control, not above every row by default", () => {
    render(createElement(OrganizedPresentationView, { presentation: presentation() }));
    const control = screen.getByLabelText("project-technical-details") as HTMLDetailsElement;
    expect(control.open).toBe(false);
    expect(shownValues()).toEqual(["", "", "0", " leading\nsynthetic|choice "]);
  });

  it("blocks file export from the real menu without requesting a native write", async () => {
    const { p, call } = await importInEditor();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Export/ }));
    await flush();
    expect(call.mock.calls.some(([c]) => c === "presentation.export")).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("does not commit a late apply response after the import dialog has unmounted", async () => {
    const p = presentation();
    let resolveApply!: (reply: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { resolveApply = resolve; });
    vi.stubGlobal("pywebview", { api: { call: vi.fn(async (command: string) => {
      if (command === "presentation.import.prepare") return { ok: true, status: "prepared", token: TOKEN, candidate: p };
      if (command === "presentation.import.apply") return pending;
      throw new Error(`Unexpected command: ${command}`);
    }) } });
    const onApplied = vi.fn(), onClose = vi.fn();
    const mounted = render(createElement(PresentationImportDialog, {
      onApplied, onClose,
    }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Écraser/ }));
    await flush();
    mounted.unmount();
    resolveApply({ ok: true, status: "applied", presentation: p });
    await flush();
    expect(onApplied).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("AIM reprise: export, reimport and late replies (Lovable additions)", () => {
  it("blocked menu export dispatches nothing and preserves exact native values", async () => {
    const { call } = await importInEditor();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Export/ })); await flush();
    expect(call.mock.calls.some(([c]) => c === "presentation.export")).toBe(false);
    expect(shownValues()).toEqual(["", "", "0", " leading\nsynthetic|choice "]);
  });

  it("reimport of the exported JSON goes through Python prepare/apply and keeps ids, order and occurrences", async () => {
    const { p, call } = await importInEditor();
    const ids = () => [...document.querySelectorAll("[data-row-id]")].map((n) => n.getAttribute("data-row-id"));
    const before = ids();
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Import presentation|Importer une présentation/ })); await flush();
    expect(screen.getByRole("dialog", { name: "Voulez-vous vraiment écraser la présentation actuelle ?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Écraser/ })); await flush();
    expect(call.mock.calls.filter(([c]) => c === "presentation.import.prepare")).toHaveLength(2);
    expect(call).toHaveBeenLastCalledWith("presentation.import.apply", { token: TOKEN });
    expect(ids()).toEqual(before); expect(new Set(before).size).toBe(4);
    expect(p.configuration.categories[0]!.groups[0]!.rows.map((r) => r.id)).toEqual(before);
  });

  it("closing during preparation ignores the late prepared reply and cancels its token", async () => {
    let resolvePrepare!: (reply: unknown) => void;
    const call = vi.fn((command: string) => command === "presentation.import.prepare" ? new Promise((r) => { resolvePrepare = r; }) : Promise.resolve({ ok: true, status: "cancelled" }));
    vi.stubGlobal("pywebview", { api: { call } });
    const onApplied = vi.fn(), onClose = vi.fn();
    const mounted = render(createElement(PresentationImportDialog, { onApplied, onClose }));
    await flush(); mounted.unmount();
    resolvePrepare({ ok: true, status: "prepared", token: TOKEN, candidate: presentation() }); await flush();
    expect(onClose).not.toHaveBeenCalled(); expect(onApplied).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith("presentation.import.cancel", { token: TOKEN });
  });

  it("cannot be dismissed while apply is pending", async () => {
    const p = presentation();
    let resolveApply!: (reply: unknown) => void;
    vi.stubGlobal("pywebview", { api: { call: vi.fn(async (command: string) => command === "presentation.import.prepare" ? { ok: true, status: "prepared", token: TOKEN, candidate: p } : new Promise((r) => { resolveApply = r; })) } });
    const onApplied = vi.fn(), onClose = vi.fn();
    render(createElement(PresentationImportDialog, { onApplied, onClose }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Écraser/ })); await flush();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); await flush();
    expect(onClose).not.toHaveBeenCalled();
    resolveApply({ ok: true, status: "applied", presentation: p }); await flush();
    expect(onApplied).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
  });
});
