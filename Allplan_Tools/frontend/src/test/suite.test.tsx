import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { SUITE_MODULES } from "@/suite/catalog";
import { detectNativeBinding, moduleAccess } from "@/shared/transport/native-binding";
import { shouldBlockLeave } from "@/suite/leave-guard";
import { aimStorage } from "@/modules/information_manager/lib/aim-storage";

describe("suite routes", () => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
  it.each(["/", "/smartcatalog", "/vob-editor", "/information-manager"])("opens %s directly", (path) => {
    expect(router.matchRoutes(path).at(-1)?.routeId).toBe(path);
    expect(router.matchRoutes(path).at(-1)?.routeId).not.toBe(rootRouteId);
  });
  it("declares the stable app ids and routes", () => {
    expect(SUITE_MODULES.map((m) => [m.appId, m.route])).toEqual([["smartcatalog", "/smartcatalog"], ["vob_editor", "/vob-editor"], ["information_manager", "/information-manager"]]);
  });
  it("home imports no module, store or bridge", () => {
    const source = readFileSync("src/routes/index.tsx", "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["@tanstack/react-router", "@/suite/catalog", "@/suite/ToolsHome"]);
    const home = readFileSync("src/suite/ToolsHome.tsx", "utf8") + readFileSync("src/suite/home-text.ts", "utf8");
    expect(home).not.toMatch(/from ["'][^"']*(catalog-store|host-bridge|modules\/|app-settings|lib\/i18n)/);
    expect(home).toContain("preload={false}");
    expect(readFileSync("src/suite/catalog.ts", "utf8")).not.toMatch(/^import (?!type)/m);
  });
});

describe("native window binding", () => {
  it("browser opens every module without native transport", () => {
    for (const m of SUITE_MODULES) expect(moduleAccess(m.appId, { kind: "browser" })).toEqual({ allowed: true, transport: "none" });
  });
  it("never changes the bound app id of a pywebview window", () => {
    const b = detectNativeBinding({ pywebview: {}, allplanLauncher: { appId: "vob_editor" }, chrome: { webview: {} } });
    expect(b).toEqual({ kind: "pywebview", appId: "vob_editor" });
    expect(moduleAccess("vob_editor", b, "vob_editor")).toEqual({ allowed: true, transport: "host_bridge" });
    expect(moduleAccess("smartcatalog", b, "smartcatalog")).toEqual({ allowed: false, reason: "other_application" });
    expect(moduleAccess("information_manager", b, "vob_editor")).toEqual({ allowed: false, reason: "other_application" });
  });
  it("a binding without verified identity is never allowed (no appId:null tolerance)", () => {
    for (const m of SUITE_MODULES) expect(moduleAccess(m.appId, { kind: "pywebview", appId: null })).toEqual({ allowed: false, reason: "missing_identity" });
  });
  it("AIM through pywebview only gets the limited binding", () => {
    expect(moduleAccess("information_manager", { kind: "pywebview", appId: null }, "information_manager")).toEqual({ allowed: true, transport: "aim_pywebview_limited" });
  });
  it("plain WebView2 cannot establish AIM legacy without verified identity", () => {
    const b = detectNativeBinding({ chrome: { webview: {} } });
    expect(moduleAccess("information_manager", b)).toEqual({ allowed: false, reason: "missing_identity" });
    expect(moduleAccess("smartcatalog", b).allowed).toBe(false);
    expect(moduleAccess("vob_editor", b).allowed).toBe(false);
  });
});

describe("leave guard", () => {
  const policy = (choice: "save" | "leave" | "stay" | null, save?: () => Promise<boolean>, dirty = () => true) => ({ isDirty: dirty, ask: vi.fn(async () => choice), ...(save ? { save } : {}) });
  it("does not ask when nothing changed", async () => {
    const p = policy("stay", undefined, () => false);
    expect(await shouldBlockLeave(p)).toBe(false);
    expect(p.ask).not.toHaveBeenCalled();
  });
  it("cancel stays, confirmed leave goes", async () => {
    expect(await shouldBlockLeave(policy(null))).toBe(true);
    expect(await shouldBlockLeave(policy("stay"))).toBe(true);
    expect(await shouldBlockLeave(policy("leave"))).toBe(false);
  });
  it("failed, throwing or uncertain saves block without retry", async () => {
    const failed = vi.fn(async () => false);
    expect(await shouldBlockLeave(policy("save", failed))).toBe(true);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(await shouldBlockLeave(policy("save", async () => { throw new Error("timeout"); }))).toBe(true);
  });
  it("a confirmed save leaves only when nothing is still dirty", async () => {
    let dirty = true;
    expect(await shouldBlockLeave(policy("save", async () => { dirty = false; return true; }, () => dirty))).toBe(false);
    expect(await shouldBlockLeave(policy("save", async () => true, () => true))).toBe(true);
  });
  it("Save is not offered as success when the module has no save", async () => {
    expect(await shouldBlockLeave(policy("save"))).toBe(true);
  });
});

describe("storage isolation", () => {
  it("namespaces AIM keys without touching historical keys", () => {
    localStorage.setItem("lang", "de");
    aimStorage.setItem("lang", "fr");
    expect(localStorage.getItem("information_manager:lang")).toBe("fr");
    expect(localStorage.getItem("lang")).toBe("de");
    localStorage.clear();
  });
});
