import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolsHome } from "@/suite/ToolsHome";
import { HOME_WAIT_MS } from "@/suite/use-home-host";
import { isHomeInfo, isLaunchReply } from "@/suite/contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, preload: _preload, children }: { to: string; preload?: boolean; children: React.ReactNode }) => <a href={to}>{children}</a> }));
const info = () => ({ home_launch_contract: 1, context: { year: "", verification: true, country: "" }, plugins: [
  { id: "smartcatalog", available: true, reason: null },
  { id: "vob_editor", available: false, reason: "Ressource livrée manquante." },
  { id: "information_manager", available: true, reason: null },
] });
const setHost = (api: unknown) => Object.defineProperty(window, "pywebview", { configurable: true, value: { api } });
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "pywebview"); vi.useRealTimers(); });
async function ready(launch = vi.fn().mockResolvedValue({ ok: true })) {
  const get_home_info = vi.fn().mockResolvedValue(info());
  setHost({ get_home_info, launch });
  render(<ToolsHome />);
  await waitFor(() => expect(screen.getByRole("button", { name: /Information Manager/ })).toBeEnabled());
  return { launch, get_home_info };
}
describe("native home only", () => {
  it("renders an extensible installed inventory and keeps construction inaccessible", async () => {
    const installed = ["local_one", "local_two", "local_three", "local_four"].map((id) => ({
      id, name: id, description: "Local plugin", installedVersion: null,
      lifecycle: "ready", launchable: true, available: true, reason: null, reasonCode: null,
    }));
    const launch = vi.fn().mockResolvedValue({ ok: true });
    setHost({ get_home_info: vi.fn().mockResolvedValue({
      ...info(), plugin_inventory_contract: 1, plugins: [...installed, {
        id: "building", name: "Building plugin", description: "Not finished",
        installedVersion: "0.1.0", lifecycle: "construction", launchable: false,
        available: false, reason: "In construction", reasonCode: "construction",
      }],
    }), launch });
    render(<ToolsHome requireNative />);
    const button = await screen.findByRole("button", { name: /local_four/ });
    expect(button).toBeEnabled();
    expect(screen.getByRole("button", { name: /Building plugin/ })).toBeDisabled();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    fireEvent.click(button);
    await waitFor(() => expect(launch).toHaveBeenCalledWith("local_four", "", true, ""));
    expect(screen.getByRole("status")).toHaveTextContent("Processus lancé.");
  });
  it("preserves the existing browser routes outside a host", async () => {
    render(<ToolsHome />);
    expect(await screen.findByRole("link", { name: /Information Manager/ })).toHaveAttribute("href", "/information-manager");
  });
  it("never offers web fallback from the dedicated local native entry", () => {
    render(<ToolsHome requireNative />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Information Manager/ })).toBeDisabled();
  });
  it("detects an already-ready host and reads its info once", async () => {
    const { get_home_info } = await ready();
    expect(get_home_info).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /Information Manager/ })).not.toBeInTheDocument();
  });
  it("waits for pywebviewready before enabling native actions", async () => {
    setHost({}); render(<ToolsHome />);
    expect(screen.getByRole("button", { name: /Information Manager/ })).toBeDisabled();
    const get_home_info = vi.fn().mockResolvedValue(info());
    setHost({ get_home_info, launch: vi.fn() });
    await act(async () => window.dispatchEvent(new Event("pywebviewready")));
    expect(get_home_info).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Information Manager/ })).toBeEnabled();
  });
  it("keeps a missing native service blocked after exactly 15 seconds", async () => {
    vi.useFakeTimers(); setHost({}); render(<ToolsHome />);
    await act(async () => vi.advanceTimersByTime(14_999));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1));
    expect(HOME_WAIT_MS).toBe(15_000);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it("rejects an invalid marker without browser fallback", async () => {
    setHost({ get_home_info: vi.fn().mockResolvedValue({ ...info(), home_launch_contract: "1" }), launch: vi.fn() });
    render(<ToolsHome />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /Information Manager/ })).toBeDisabled();
    expect(isHomeInfo({ ...info(), home_launch_contract: "1" })).toBe(false);
  });
  it("shows get_home_info transport refusal without enabling opening", async () => {
    setHost({ get_home_info: vi.fn().mockRejectedValue(new Error("pont refusé")), launch: vi.fn() }); render(<ToolsHome />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /Information Manager/ })).toBeDisabled();
  });
  it("uses host availability and does not launch an unavailable plugin", async () => {
    const { launch } = await ready();
    fireEvent.click(screen.getByRole("button", { name: /VOB Editor/ }));
    expect(launch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /VOB Editor/ })).toHaveAttribute("title", "Ressource livrée manquante.");
  });
  it("forwards host context unchanged, including empty year and country", async () => {
    const { launch } = await ready();
    fireEvent.click(screen.getByRole("button", { name: /Information Manager/ }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("information_manager", "", true, ""));
    expect(launch.mock.calls[0]).toHaveLength(4);
  });
  it("locks all launches synchronously during a pending request and restores availability", async () => {
    let resolve: ((reply: { ok: true }) => void) | undefined;
    const launch = vi.fn(() => new Promise((r) => { resolve = r; }));
    await ready(launch);
    const aim = screen.getByRole("button", { name: /Information Manager/ });
    act(() => { fireEvent.click(aim); fireEvent.click(aim); fireEvent.click(screen.getByRole("button", { name: /SmartCatalog Editor/ })); });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(aim).toBeDisabled();
    await act(async () => resolve?.({ ok: true }));
    expect(aim).toBeEnabled();
    expect(screen.getByRole("button", { name: /VOB Editor/ })).toBeDisabled();
  });
  it("adopts only process launch success", async () => {
    const { launch } = await ready(); fireEvent.click(screen.getByRole("button", { name: /Information Manager/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Information Manager/ })).toBeEnabled());
    expect(isLaunchReply(await launch.mock.results[0]?.value)).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("displays an explicit launch refusal and performs no automatic retry", async () => {
    const { launch } = await ready(vi.fn().mockResolvedValue({ ok: false, error: "AIM déjà ouvert." }));
    fireEvent.click(screen.getByRole("button", { name: /Information Manager/ }));
    await screen.findByRole("alert"); expect(launch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Information Manager/ })).toBeEnabled();
  });
  it.each([null, { ok: "true" }])("rejects malformed launch response %j", async (response) => {
    const { launch } = await ready(vi.fn().mockResolvedValue(response));
    fireEvent.click(screen.getByRole("button", { name: /Information Manager/ }));
    await screen.findByRole("alert"); expect(launch).toHaveBeenCalledTimes(1);
    expect(isLaunchReply(response)).toBe(false);
  });
  it("keeps transport rejection distinct from successful creation, without retry", async () => {
    const { launch } = await ready(vi.fn().mockRejectedValue(new Error("transport interrompu")));
    fireEvent.click(screen.getByRole("button", { name: /Information Manager/ }));
    await screen.findByRole("alert"); expect(launch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Information Manager/ })).toBeEnabled();
  });
});
const inv = (plugins: unknown[]) => ({ ...info(), plugin_inventory_contract: 1, plugins });
const ready1 = (o: Record<string, unknown> = {}) => ({ id: "local_one", name: "Local one", description: "Local plugin", installedVersion: "1.2.0",
  lifecycle: "ready", launchable: true, available: true, reason: null, reasonCode: null, ...o });
async function mountInventory(value: unknown) {
  const launch = vi.fn().mockResolvedValue({ ok: true });
  const get_catalog = vi.fn(); const update = vi.fn();
  setHost({ get_home_info: vi.fn().mockResolvedValue(value), launch, get_catalog, update });
  render(<ToolsHome requireNative />);
  return { launch, get_catalog, update };
}
describe("plugin manager presentation", () => {
  it("empty native inventory never brings back the three demonstration plugins", async () => {
    await mountInventory(inv([]));
    await waitFor(() => expect(screen.queryByText("Connexion à Allplan…")).toBeNull());
    for (const name of [/SmartCatalog/, /VOB/, /Information Manager/]) expect(screen.queryByRole("button", { name })).toBeNull();
  });
  it("ready but unavailable plugin stays listed with its diagnostic and cannot launch", async () => {
    const { launch } = await mountInventory(inv([ready1({ launchable: false, available: false, reason: "Ressource manquante.", reasonCode: "unavailable" })]));
    const button = await screen.findByRole("button", { name: /Local one/ });
    expect(button).toBeDisabled();
    expect(screen.getByText("Indisponible : Ressource manquante.")).toBeInTheDocument();
    fireEvent.click(button);
    expect(launch).not.toHaveBeenCalled();
  });
  it("construction plugin goes to its own category, separate from upcoming cards, and cannot launch", async () => {
    const { launch } = await mountInventory(inv([ready1({ id: "building", name: "Building", launchable: false, available: false, reason: "En construction", reasonCode: "construction", lifecycle: "construction" })]));
    const list = await screen.findByRole("list", { name: "Installés, en construction" });
    const button = screen.getByRole("button", { name: /Building/ });
    expect(list).toContainElement(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole("list", { name: "Bientôt disponibles" })).not.toContainElement(button);
    expect(screen.getByRole("list", { name: "Applications disponibles" })).not.toContainElement(button);
    fireEvent.click(button);
    expect(launch).not.toHaveBeenCalled();
  });
  it("null installed version shows an explicit unknown label and no deduced version", async () => {
    await mountInventory(inv([ready1({ installedVersion: null })]));
    const button = await screen.findByRole("button", { name: /Local one/ });
    expect(button).toHaveTextContent("Version inconnue");
    expect(button).not.toHaveTextContent("Version ?");
    expect(button.textContent).not.toMatch(/\d+\.\d+/);
  });
  it("invalid metadata rejects the inventory with no launchable fallback", async () => {
    const { launch } = await mountInventory(inv([ready1({ name: "  " })]));
    expect(await screen.findByRole("alert")).toHaveTextContent("Informations de l’accueil natif invalides.");
    for (const button of screen.queryAllByRole("button", { name: /Local one|SmartCatalog|VOB|Information Manager/ })) expect(button).toBeDisabled();
    expect(launch).not.toHaveBeenCalled();
  });
  it("catalog not configured: no Update button and no catalog/network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { get_catalog, update } = await mountInventory(inv([ready1()]));
    await screen.findByRole("button", { name: /Local one/ });
    expect(screen.queryByRole("button", { name: /update|mise à jour/i })).toBeNull();
    // Contract /2: consultation after inventory display; a non-/2 reply only means Update unavailable.
    await waitFor(() => expect(get_catalog).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("rejects a whitespace-only reason for an unavailable entry", () => {
    const v = info(); v.plugins[1] = { id: "vob_editor", available: false, reason: "   " };
    expect(isHomeInfo(v)).toBe(false);
    v.plugins[1] = { id: "vob_editor", available: false, reason: " Motif " };
    expect(isHomeInfo(v)).toBe(true);
  });
});
