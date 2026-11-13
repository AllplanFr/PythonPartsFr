import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
import { ToolsHome } from "@/suite/ToolsHome";

afterEach(() => { cleanup(); Reflect.deleteProperty(window, "pywebview"); });
const plugin = (id: string, o: Record<string, unknown> = {}) => ({ id, name: `Plugin ${id}`, description: "Local plugin", installedVersion: null,
  lifecycle: "ready", launchable: true, available: true, reason: null, reasonCode: null, ...o });
function mountNative(plugins: unknown[]) {
  Object.defineProperty(window, "pywebview", { configurable: true, value: { api: {
    get_home_info: vi.fn().mockResolvedValue({ home_launch_contract: 1, context: { year: "", verification: true, country: "" }, plugin_inventory_contract: 1, plugins }),
    launch: vi.fn(), get_catalog: vi.fn(), update: vi.fn(),
  } } });
  render(<ToolsHome requireNative />);
}

describe("Tools home presentation", () => {
  it("counts the plugins actually listed", () => {
    render(<ToolsHome />);
    const list = screen.getByRole("list", { name: "Applications disponibles" });
    const n = within(list).getAllByRole("listitem").length;
    expect(screen.getByText(n > 1 ? `${n} plugins` : `${n} plugin`)).toBeTruthy();
  });
  it("footer Quit has no icon and no Allplan Tools update button without a host contract", () => {
    const { container } = render(<ToolsHome />);
    const footer = container.querySelector("footer")!;
    const quit = within(footer).getByRole("button", { name: "Quitter" });
    expect(quit.querySelector("svg")).toBeNull();
    expect(within(footer).queryByRole("button", { name: /mise à jour/i })).toBeNull();
    expect(within(footer).getAllByRole("button")).toHaveLength(1);
  });
  it.each([1, 2, 5])("native inventory: counter equals first-list cards only (%i ready)", async (ready) => {
    const plugins = [
      ...Array.from({ length: ready }, (_, i) => plugin(`ready_${i}`)),
      plugin("broken", { launchable: false, available: false, reason: "Ressource manquante.", reasonCode: "unavailable" }),
      plugin("building", { lifecycle: "construction", launchable: false, available: false, reason: "En construction", reasonCode: "construction" }),
    ];
    mountNative(plugins);
    await screen.findByRole("button", { name: /Plugin broken/ });
    const list = screen.getByRole("list", { name: "Applications disponibles" });
    const cards = within(list).getAllByRole("listitem");
    const expected = ready + 1;
    expect(cards).toHaveLength(expected);
    expect(list).toContainElement(screen.getByRole("button", { name: /Plugin broken/ }));
    expect(list).not.toContainElement(screen.getByRole("button", { name: /Plugin building/ }));
    const others = screen.getAllByRole("list").filter((l) => l !== list).reduce((n, l) => n + within(l).queryAllByRole("listitem").length, 0);
    expect(others).toBeGreaterThan(0);
    expect(screen.getByText(`${expected} plugin${expected > 1 ? "s" : ""}`)).toBeTruthy();
    expect(screen.queryByText(`${expected + others} plugins`)).toBeNull();
  });
});
