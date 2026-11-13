import { act, fireEvent, render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolsHome } from "@/suite/ToolsHome";
import { isCatalogReplyV2, isUpdateReplyV2 } from "@/suite/contracts/plugin-catalog-validate";

vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
// Fictitious identities and versions only; no real URL, network or link opening.
const plugin = (id: string, o: Record<string, unknown> = {}) => ({ id, name: `Nom ${id}`, description: "Local", installedVersion: "1.2.0",
  lifecycle: "ready", launchable: true, available: true, reason: null, reasonCode: null, ...o });
const inv = (plugins: unknown[]) => ({ home_launch_contract: 1, plugin_inventory_contract: 1, context: { year: "2026", verification: true, country: "fr" }, plugins });
const entry = (id: string, o: Record<string, unknown> = {}) => ({ id, name: `Catalogue ${id}`, installed: true, installedVersion: "1.2.0",
  installedLifecycle: "ready", inCatalog: true, latestKnownVersion: "3.0.0", proposedVersion: "1.3.0", catalogLifecycle: "ready",
  comparison: "newer", compatibility: "compatible", canUpdate: true, updateReason: null, ...o });
const cat = (entries: unknown[], o: Record<string, unknown> = {}) => ({ ok: true, data: { schema: "allplan-tools-catalog/2", requestId: 2,
  superseded: false, status: "available", source: "remote", verifiedAt: "2026-11-10T15:00:00.000Z", lastAttemptAt: "2026-11-10T14:59:59.800Z",
  entries, error: null, ...o } });
const setHost = (api: unknown) => Object.defineProperty(window, "pywebview", { configurable: true, value: { api } });
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "pywebview"); });

async function mount(api: Record<string, unknown>, plugins: unknown[] = [plugin("example_tool")]) {
  const launch = vi.fn().mockResolvedValue({ ok: true });
  setHost({ get_home_info: vi.fn().mockResolvedValue(inv(plugins)), launch, ...api });
  render(<ToolsHome requireNative />);
  await screen.findByRole("button", { name: /^Nom example_tool/ });
  return { launch };
}
const updateBtn = () => screen.queryByRole("button", { name: /^Update / });

describe("catalog /2 validators", () => {
  it("accepts the consolidated examples and rejects /1, missing fields and inconsistent Update", () => {
    expect(isCatalogReplyV2(cat([entry("example_tool")]))).toBe(true);
    expect(isCatalogReplyV2({ ok: false, error: { code: "catalog_internal_error", message: "x" } })).toBe(true);
    expect(isCatalogReplyV2({ ok: true, data: { schema: "allplan-tools-catalog/1", status: "not_configured", entries: [], error: null } })).toBe(false);
    const missing = cat([]); delete (missing.data as Record<string, unknown>)["lastAttemptAt"];
    expect(isCatalogReplyV2(missing)).toBe(false);
    expect(isCatalogReplyV2(cat([entry("example_tool")], { source: "cache" }))).toBe(false);
    expect(isCatalogReplyV2(cat([], { status: "unavailable" }))).toBe(false);
    expect(isCatalogReplyV2(cat([], { verifiedAt: "2026-11-10T15:00:00Z" }))).toBe(false);
    expect(isCatalogReplyV2(cat([entry("a"), entry("a")]))).toBe(false);
  });
  it("validates Update replies against the requested id", () => {
    expect(isUpdateReplyV2({ ok: true, data: { id: "example_tool", version: "1.3.0", status: "link_open_requested" } }, "example_tool")).toBe(true);
    expect(isUpdateReplyV2({ ok: true, data: { id: "other", version: "1.3.0", status: "link_open_requested" } }, "example_tool")).toBe(false);
    expect(isUpdateReplyV2({ ok: false, error: { code: "update_not_available", message: "m", reason: "catalog_pending" } }, "x")).toBe(true);
    expect(isUpdateReplyV2({ ok: false, error: { code: "catalog_not_configured", message: "m" } }, "x")).toBe(false);
  });
  it.each([
    ["available with an error", { error: { code: "network_error", message: "x" } }],
    ["available without a source", { source: "none", verifiedAt: null, lastAttemptAt: null }],
    ["not configured with a remote source", { status: "not_configured" }],
    ["not configured with a verification date", { status: "not_configured", source: "none", lastAttemptAt: null }],
    ["not configured with an attempt date", { status: "not_configured", source: "none", verifiedAt: null }],
    ["not configured with an error", { status: "not_configured", source: "none", verifiedAt: null, lastAttemptAt: null, error: { code: "network_error", message: "x" } }],
    ["unavailable without an error", { status: "unavailable", source: "none", verifiedAt: null }],
    ["unavailable claiming a remote result", { status: "unavailable", error: { code: "network_error", message: "x" } }],
    ["remote without verification", { verifiedAt: null }],
    ["remote without an attempt", { lastAttemptAt: null }],
    ["embedded claiming remote verification", { source: "embedded", lastAttemptAt: null }],
    ["cache without original verification", { source: "cache", verifiedAt: null, lastAttemptAt: null }],
  ])("rejects inconsistent envelope: %s", (_name, overrides) => {
    expect(isCatalogReplyV2(cat([], overrides))).toBe(false);
  });
  it.each([
    ["not configured", { status: "not_configured", source: "none", verifiedAt: null, lastAttemptAt: null }],
    ["available cache without a new attempt", { source: "cache", lastAttemptAt: null }],
    ["available embedded", { source: "embedded", verifiedAt: null, lastAttemptAt: null }],
    ["failed attempt retaining cache", { status: "unavailable", source: "cache", error: { code: "network_error", message: "x" } }],
    ["failed attempt retaining embedded", { status: "unavailable", source: "embedded", verifiedAt: null, error: { code: "invalid_catalog", message: "x" } }],
    ["failed attempt without prior data", { status: "unavailable", source: "none", verifiedAt: null, error: { code: "network_error", message: "x" } }],
  ])("preserves permitted informative envelope: %s", (_name, overrides) => {
    expect(isCatalogReplyV2(cat([], overrides))).toBe(true);
    expect(isCatalogReplyV2(cat([entry("example_tool")], overrides))).toBe(false);
  });
  it.each([
    ["missing installed version", { installedVersion: null }],
    ["not installed", { installed: false, installedVersion: null, installedLifecycle: null }],
    ["installed construction", { installedLifecycle: "construction" }],
    ["missing installed lifecycle", { installedLifecycle: null }],
    ["not in catalog", { inCatalog: false }],
    ["missing proposal", { proposedVersion: null }],
    ["equal comparison", { comparison: "equal" }],
    ["unknown compatibility", { compatibility: "unknown" }],
    ["non-null Update reason", { updateReason: "no_release_url" }],
  ])("rejects inconsistent Update entry: %s", (_name, overrides) => {
    expect(isCatalogReplyV2(cat([entry("example_tool", overrides)]))).toBe(false);
  });
  it("rejects established comparisons without an installed version even without Update", () => {
    expect(isCatalogReplyV2(cat([entry("example_tool", { installedVersion: null, comparison: "equal", canUpdate: false, updateReason: "equal" })]))).toBe(false);
  });
});

describe("catalog /2 presentation", () => {
  it("old host: missing methods, /1 or invalid reply give no Update and launch still works", async () => {
    for (const api of [{}, { get_catalog: vi.fn().mockResolvedValue({ ok: true, data: { schema: "allplan-tools-catalog/1", status: "not_configured", entries: [], error: null } }), update: vi.fn() },
      { get_catalog: vi.fn().mockResolvedValue({ junk: 1 }), update: vi.fn() }, { get_catalog: vi.fn().mockRejectedValue(new Error("boom")), update: vi.fn() }]) {
      const { launch } = await mount(api);
      await waitFor(() => expect(screen.queryByText("Consultation du catalogue…")).toBeNull());
      expect(updateBtn()).toBeNull();
      expect(screen.queryByText(/À jour/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /^Nom example_tool/ }));
      await waitFor(() => expect(launch).toHaveBeenCalledWith("example_tool", "2026", true, "fr"));
      cleanup(); Reflect.deleteProperty(window, "pywebview");
    }
  });
  it("keeps the installed name/version, separates latest known from proposal, Update is a separate button", async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, data: { id: "example_tool", version: "1.3.0", status: "link_open_requested" } });
    const { launch } = await mount({ get_catalog: vi.fn().mockResolvedValue(cat([entry("example_tool")])), update });
    const btn = await screen.findByRole("button", { name: "Update Nom example_tool" });
    const launchBtn = screen.getByRole("button", { name: /^Nom example_tool/ });
    expect(launchBtn.contains(btn)).toBe(false);
    expect(screen.queryByText(/Catalogue example_tool/)).toBeNull();
    expect(screen.getByText("Version 1.2.0")).toBeInTheDocument();
    expect(screen.getByText("Dernière version connue : 3.0.0")).toBeInTheDocument();
    expect(screen.getByText("Version compatible proposée : 1.3.0")).toBeInTheDocument();
    fireEvent.click(btn);
    await screen.findByText("Demande d’ouverture du lien envoyée.");
    expect(update).toHaveBeenCalledWith("example_tool");
    expect(launch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Mis à jour/i)).toBeNull();
  });
  it("rejects available remote with network error without enabling Update or blocking local launch", async () => {
    const { launch } = await mount({ get_catalog: vi.fn().mockResolvedValue(cat([entry("example_tool")], { error: { code: "network_error", message: "x" } })), update: vi.fn() });
    await waitFor(() => expect(screen.queryByText("Consultation du catalogue…")).toBeNull());
    expect(updateBtn()).toBeNull();
    expect(screen.queryByText(/À jour/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Nom example_tool/ }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("example_tool", "2026", true, "fr"));
  });
  it("Update refusal and transport error are shown without success", async () => {
    const update = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: "catalog_changed", message: "Proposition devenue invalide.", reason: null } })
      .mockRejectedValueOnce(new Error("pont"));
    await mount({ get_catalog: vi.fn().mockResolvedValue(cat([entry("example_tool")])), update });
    fireEvent.click(await screen.findByRole("button", { name: "Update Nom example_tool" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Proposition devenue invalide.");
    fireEvent.click(screen.getByRole("button", { name: "Update Nom example_tool" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/état de la demande inconnu : pont/));
    expect(screen.queryByText("Demande d’ouverture du lien envoyée.")).toBeNull();
  });
  it("« À jour » only for current remote equal+compatible; never from cache, embedded or unavailable", async () => {
    const eq = entry("example_tool", { proposedVersion: "1.2.0", latestKnownVersion: "3.0.0", comparison: "equal", canUpdate: false, updateReason: "equal" });
    await mount({ get_catalog: vi.fn().mockResolvedValue(cat([eq])), update: vi.fn() });
    expect(await screen.findByText("À jour pour cette version d’Allplan")).toBeInTheDocument();
    cleanup(); Reflect.deleteProperty(window, "pywebview");
    const informative = { ...eq, updateReason: "informative_source" };
    for (const o of [{ source: "cache", verifiedAt: "2026-11-09T10:00:00.000Z", lastAttemptAt: null }, { source: "embedded", verifiedAt: null, lastAttemptAt: null },
      { status: "unavailable", source: "cache", verifiedAt: "2026-11-09T10:00:00.000Z", error: { code: "network_error", message: "x" } }]) {
      await mount({ get_catalog: vi.fn().mockResolvedValue(cat([o.status ? { ...eq, updateReason: "catalog_unavailable" } : informative], o)), update: vi.fn() });
      expect(await screen.findByText(/Information du catalogue non vérifiée/)).toBeInTheDocument();
      expect(screen.queryByText(/À jour/)).toBeNull();
      expect(updateBtn()).toBeNull();
      cleanup(); Reflect.deleteProperty(window, "pywebview");
    }
  });
  it("superseded and late replies never replace the display; old Update disabled while pending", async () => {
    let resolve!: (v: unknown) => void;
    const get_catalog = vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }));
    await mount({ get_catalog, update: vi.fn() });
    expect(await screen.findByText("Consultation du catalogue…")).toBeInTheDocument();
    expect(updateBtn()).toBeNull();
    await act(async () => { resolve(cat([entry("example_tool", { canUpdate: false, updateReason: "catalog_superseded" })], { superseded: true })); });
    expect(updateBtn()).toBeNull();
    expect(screen.queryByText(/Dernière version connue/)).toBeNull();
  });
  it("incompatible higher release, unknown local version, remote and local construction, non-installed entries", async () => {
    await mount({ get_catalog: vi.fn().mockResolvedValue(cat([
      entry("example_tool", { catalogLifecycle: "construction", proposedVersion: "1.3.0" }),
      entry("unknown_tool", { installedVersion: null, comparison: "unknown", canUpdate: false, updateReason: "installed_version_unknown" }),
      entry("remote_only", { installed: false, installedVersion: null, installedLifecycle: null, comparison: "unknown", canUpdate: false, updateReason: "not_installed", catalogLifecycle: "construction", proposedVersion: null }),
    ])), update: vi.fn() }, [plugin("example_tool"), plugin("unknown_tool", { installedVersion: null }),
      plugin("local_build", { lifecycle: "construction", launchable: false, available: false, reason: "En construction", reasonCode: "construction" })]);
    const launchBtn = screen.getByRole("button", { name: /^Nom example_tool/ });
    expect(await within(launchBtn).findByText("Dernière version connue : 3.0.0 (en construction)")).toBeInTheDocument();
    expect(launchBtn).toBeEnabled();
    expect(screen.getByRole("button", { name: "Update Nom example_tool" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Update Nom unknown_tool" })).toBeNull();
    expect(within(screen.getByRole("button", { name: /^Nom unknown_tool/ })).getByText("Version inconnue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nom local_build/ })).toBeDisabled();
    const section = screen.getByRole("list", { name: "Disponibles, non installés" });
    expect(within(section).getByText("Catalogue remote_only")).toBeInTheDocument();
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /remote_only/ })).toBeNull();
  });
});

describe("useHomeCatalog consultations (hook harness, no UI refresh control)", () => {
  const deferred = () => { let resolve!: (v: unknown) => void; let reject!: (e: unknown) => void;
    const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  it("an older ok:false reply never replaces the current result nor its Update capability", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useHomeCatalog } = await import("@/suite/use-home-catalog");
    const first = deferred(), second = deferred();
    const update = vi.fn().mockResolvedValue({ ok: true, data: { id: "example_tool", version: "1.3.0", status: "link_open_requested" } });
    setHost({ get_catalog: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), update });
    const { result } = renderHook(() => useHomeCatalog(true));
    await waitFor(() => expect(result.current.phase).toBe("pending"));
    act(() => { void result.current.consult(); });
    await act(async () => { second.resolve(cat([entry("example_tool")], { requestId: 3 })); });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => { first.resolve({ ok: false, error: { code: "catalog_internal_error", message: "ancien" } }); });
    expect(result.current.phase).toBe("ready");
    expect(result.current.data?.requestId).toBe(3);
    expect(result.current.entryFor("example_tool")?.canUpdate).toBe(true);
    await act(async () => { await result.current.update("example_tool"); });
    expect(update).toHaveBeenCalledWith("example_tool");
  });
  it("a real rejection of the still-pending first consultation leaves the second result, message and Update unchanged", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useHomeCatalog } = await import("@/suite/use-home-catalog");
    const first = deferred(), second = deferred();
    const update = vi.fn().mockResolvedValue({ ok: true, data: { id: "example_tool", version: "1.3.0", status: "link_open_requested" } });
    const get_catalog = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    setHost({ get_catalog, update });
    const { result } = renderHook(() => useHomeCatalog(true));
    await waitFor(() => expect(get_catalog).toHaveBeenCalledTimes(1));
    act(() => { void result.current.consult(); });
    await act(async () => { second.resolve(cat([entry("example_tool")], { requestId: 3 })); });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => { await result.current.update("example_tool"); });
    expect(result.current.message).toBe("Demande d’ouverture du lien envoyée.");
    const current = { data: result.current.data, message: result.current.message, error: result.current.error };
    await act(async () => { first.reject(new Error("ancien rejet réel")); });
    expect(result.current.phase).toBe("ready");
    expect(result.current.data).toBe(current.data);
    expect(result.current.data?.requestId).toBe(3);
    expect(result.current.message).toBe(current.message);
    expect(result.current.error).toBe(current.error);
    expect(result.current.entryFor("example_tool")?.canUpdate).toBe(true);
    await act(async () => { await result.current.update("example_tool"); });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith("example_tool");
  });
  it("a new consultation disables already displayed Update at once, until a current valid reply arrives", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useHomeCatalog } = await import("@/suite/use-home-catalog");
    const next = deferred();
    const update = vi.fn();
    setHost({ get_catalog: vi.fn().mockResolvedValueOnce(cat([entry("example_tool")], { requestId: 1 })).mockReturnValueOnce(next.promise), update });
    const { result } = renderHook(() => useHomeCatalog(true));
    await waitFor(() => expect(result.current.entryFor("example_tool")?.canUpdate).toBe(true));
    act(() => { void result.current.consult(); });
    expect(result.current.phase).toBe("pending");
    expect(result.current.entryFor("example_tool")).toBeUndefined();
    await act(async () => { await result.current.update("example_tool"); });
    expect(update).not.toHaveBeenCalled();
    await act(async () => { next.resolve({ invalid: true }); });
    expect(result.current.entryFor("example_tool")).toBeUndefined();
  });
  it("after the pending consultation, a current valid reply re-enables Update", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useHomeCatalog } = await import("@/suite/use-home-catalog");
    const next = deferred();
    setHost({ get_catalog: vi.fn().mockResolvedValueOnce(cat([entry("example_tool")], { requestId: 1 })).mockReturnValueOnce(next.promise), update: vi.fn() });
    const { result } = renderHook(() => useHomeCatalog(true));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => { void result.current.consult(); });
    expect(result.current.entryFor("example_tool")).toBeUndefined();
    await act(async () => { next.resolve(cat([entry("example_tool")], { requestId: 2 })); });
    expect(result.current.entryFor("example_tool")?.canUpdate).toBe(true);
  });
});
