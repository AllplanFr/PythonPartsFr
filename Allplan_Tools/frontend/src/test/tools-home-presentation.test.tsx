import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => <a href={to} {...props}>{children}</a> }));
import { ToolsHome } from "@/suite/ToolsHome";

afterEach(() => { cleanup(); Reflect.deleteProperty(window, "pywebview"); });
const plugin = (id: string, o: Record<string, unknown> = {}) => ({ id, name: `Plugin ${id}`, description: `Description ${id}`, installedVersion: "2.4.1",
  lifecycle: "ready", launchable: true, available: true, reason: null, reasonCode: null, ...o });
function mountNative(plugins: unknown[], version?: string, entries: unknown[] = []) {
  const launch = vi.fn().mockResolvedValue({ ok: true });
  const update = vi.fn().mockResolvedValue({ ok: true, data: { id: "one", version: "3.0.0", status: "link_open_requested" } });
  Object.defineProperty(window, "pywebview", { configurable: true, value: { api: {
    get_home_info: vi.fn().mockResolvedValue({ home_launch_contract: 1, version, context: { year: "", verification: true, country: "" }, plugin_inventory_contract: 1, plugins }),
    launch, update, get_catalog: vi.fn().mockResolvedValue({ ok: true, data: { schema: "allplan-tools-catalog/2", requestId: 1, superseded: false, status: "available", source: "remote", verifiedAt: "2026-11-16T08:33:00.000Z", lastAttemptAt: "2026-11-16T08:33:00.000Z", entries, error: null } }),
  } } });
  render(<ToolsHome requireNative />);
  return { launch, update };
}
const entry = (id: string, installed = true) => ({ id, name: `Remote ${id}`, installed, installedVersion: installed ? "2.4.1" : null, installedLifecycle: installed ? "ready" : null, inCatalog: true, latestKnownVersion: "3.0.0", proposedVersion: "3.0.0", catalogLifecycle: "ready", comparison: installed ? "newer" : "unknown", compatibility: "compatible", canUpdate: installed, updateReason: installed ? null : "not_installed" });
describe("Home master/detail actions", () => {
  it("selection shows native metadata without launching", async () => {
    const { launch } = mountNative([plugin("one"), plugin("two")]);
    const row = await screen.findByRole("treeitem", { name: "Plugin two" });
    fireEvent.click(row);
    const details = screen.getByRole("region", { name: "Fiche du plugin" });
    expect(within(details).getByRole("heading", { level: 2 }).textContent).toBe("Plugin two");
    expect(details).toHaveTextContent("Description two");
    expect(details).toHaveTextContent("2.4.1");
    expect(launch).not.toHaveBeenCalled();
  });
  it("launch and individual Update do not change selection; bulk remains unavailable", async () => {
    const { launch, update } = mountNative([plugin("one"), plugin("two")], undefined, [entry("one"), entry("two")]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Update Plugin one" })).toBeEnabled());
    fireEvent.click(screen.getByRole("treeitem", { name: "Plugin two" }));
    fireEvent.click(screen.getByRole("button", { name: "Update Plugin one" }));
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith("one"));
    fireEvent.click(screen.getByRole("button", { name: "Lancer Plugin one" }));
    await waitFor(() => expect(launch).toHaveBeenCalledExactlyOnceWith("one", "", true, ""));
    expect(within(screen.getByRole("region", { name: "Fiche du plugin" })).getByRole("heading", { level: 2 }).textContent).toBe("Plugin two");
    for (const b of screen.getAllByRole("button", { name: /Tout mettre à jour/ })) expect(b).toBeDisabled();
    expect(screen.queryByText("Processus lancé.")).toBeNull();
  });
  it("unavailable, construction and remote-only entries cannot launch or falsely update", async () => {
    const { launch, update } = mountNative([plugin("broken", { available: false, launchable: false, reason: "Manquant", reasonCode: "unavailable" }), plugin("building", { available: false, launchable: false, reason: "Construction", reasonCode: "construction", lifecycle: "construction" })], undefined, [entry("remote", false)]);
    await screen.findByRole("treeitem", { name: "Remote remote" });
    for (const name of ["Plugin broken", "Plugin building", "Remote remote"]) {
      const row = screen.getByRole("treeitem", { name }); fireEvent.click(row);
      const launchButton = within(row).getByRole("button", { name: `Lancer ${name}` });
      expect(launchButton).toBeDisabled(); fireEvent.click(launchButton);
      expect(within(row).queryByRole("button", { name: `Update ${name}` })).toBeNull();
    }
    expect(launch).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Tout mettre à jour/ })).toBeNull();
  });
  it("up-to-date plugins hide individual and group update actions", async () => {
    mountNative([plugin("one")], undefined, [{ ...entry("one"), comparison: "equal", canUpdate: false, updateReason: "up_to_date" }]);
    await screen.findByRole("treeitem", { name: "Plugin one" });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("button", { name: /Update/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tout mettre à jour/ })).toBeNull();
  });
  it("groups are always open: no collapse control, centered heading only", async () => {
    mountNative([plugin("one")]);
    const group = await screen.findByRole("treeitem", { name: "Plugins installés" });
    expect(group.firstElementChild?.querySelectorAll("button")).toHaveLength(0);
    fireEvent.click(within(group).getByText("Plugins installés"));
    expect(within(group).getByRole("treeitem", { name: "Plugin one" })).toBeVisible();
  });
  it("splitter resizes by keyboard within bounds", async () => {
    mountNative([plugin("one")]);
    const splitter = await screen.findByRole("separator");
    expect(splitter).toHaveAttribute("aria-valuenow", "42");
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(splitter).toHaveAttribute("aria-valuenow", "44");
    for (let i = 0; i < 40; i++) fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(splitter).toHaveAttribute("aria-valuenow", "75");
  });
  it.each([["7.8.9", "7.8.9"], [undefined, ""], ["unknown", ""]])("footer shows host version %p without label or fallback", async (version, shown) => {
    mountNative([plugin("one")], version);
    await screen.findByRole("treeitem", { name: "Plugin one" });
    await waitFor(() => expect(screen.getByTestId("suite-version").textContent).toBe(shown));
    expect(screen.getByRole("contentinfo")).not.toHaveTextContent("Allplan Tools");
  });
  it("empty inventory hides the installed group without bringing back demo plugins", async () => {
    mountNative([]); await waitFor(() => expect(screen.queryByText("Connexion à Allplan…")).toBeNull());
    expect(screen.queryByRole("treeitem", { name: "Plugins installés" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "SmartCatalog Editor" })).toBeNull();
  });
  it("launch refusal stays explicit", async () => {
    const { launch } = mountNative([plugin("one")]); launch.mockResolvedValue({ ok: false, error: "Déjà ouvert" });
    fireEvent.click(await screen.findByRole("button", { name: "Lancer Plugin one" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Déjà ouvert");
  });
  it.each(["7.8.9", undefined, "", "unknown"])("About reads the host version %p without fallback", async (version) => {
    mountNative([plugin("one", { installedVersion: "unknown" })], version);
    fireEvent.click(await screen.findByRole("treeitem", { name: "Plugin one" }));
    expect(screen.getByRole("region", { name: "Fiche du plugin" })).toHaveTextContent("Version inconnue");
    fireEvent.keyDown(screen.getByRole("button", { name: "Allplan Tools" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "À propos" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Version 7.8.9") !== null).toBe(version === "7.8.9");
    expect(dialog).not.toHaveTextContent("Version inconnue");
  });
});
