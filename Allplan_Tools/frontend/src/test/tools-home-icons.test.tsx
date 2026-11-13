import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolsHome } from "@/suite/ToolsHome";
import { resolveHomeIcon } from "@/suite/HomePluginIcon";
import { isHomeInfo } from "@/suite/contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
const info = (iconUrl: unknown) => ({ home_launch_contract: 1, context: { year: "2026", verification: false, country: "FR" }, plugins:
  ["smartcatalog", "vob_editor", "information_manager"].map((id) => ({ id, available: true, reason: null as string | null, ...(iconUrl === undefined ? {} : { iconUrl }) })) });
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "pywebview"); });
async function ready(iconUrl: unknown, available = true) {
  const launch = vi.fn().mockResolvedValue({ ok: true });
  const response = info(iconUrl);
  if (!available) response.plugins = response.plugins.map((plugin) => plugin.id === "information_manager" ? { ...plugin, available: false, reason: "Ressource livrée manquante." } : plugin);
  const get_home_info = vi.fn().mockResolvedValue(response);
  Object.defineProperty(window, "pywebview", { configurable: true, value: { api: { get_home_info, launch } } });
  render(<ToolsHome />);
  const button = screen.getByRole("button", { name: /Information Manager/ });
  await waitFor(() => expect(screen.getByRole("button", { name: /SmartCatalog Editor/ })).toBeEnabled());
  const image = button.querySelector("img");
  if (!image) throw new Error("Missing icon");
  return { button, image, launch };
}
describe("home-only optional local icons", () => {
  it.each(["smartcatalog", "vob_editor", "information_manager"] as const)("resolves only %s's exact local endpoint", (id) => {
    expect(resolveHomeIcon(id, `/plugin-icons/${id}.png`, "http://localhost:8080")).toBe(`http://localhost:8080/plugin-icons/${id}.png`);
  });
  it("uses the host image without changing launch context", async () => {
    const { button, image, launch } = await ready("/plugin-icons/information_manager.png");
    expect(image.src).toBe(`${window.location.origin}/plugin-icons/information_manager.png`);
    fireEvent.click(button);
    await waitFor(() => expect(launch).toHaveBeenCalledWith("information_manager", "2026", false, "FR"));
  });
  it("never enables an unavailable plugin even with a valid icon", async () => {
    const { button, image, launch } = await ready("/plugin-icons/information_manager.png", false);
    expect(image.src).toBe(`${window.location.origin}/plugin-icons/information_manager.png`);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(launch).not.toHaveBeenCalled();
  });
  it.each([undefined, null, 42, "/plugin-icons/vob_editor.png", "https://remote.example/icon.png", "C:\\icon.png", "/plugin-icons/information_manager.png?file=x"])("keeps local fallback and launch enabled for %j", async (value) => {
    expect(isHomeInfo(info(value))).toBe(true);
    expect(resolveHomeIcon("information_manager", value, window.location.origin)).toBeNull();
    const { button, image, launch } = await ready(value);
    expect(image.src).not.toContain("/plugin-icons/");
    fireEvent.click(button);
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
  });
  it("falls back once on image failure, even if the fallback fails or launch rerenders", async () => {
    const { button, image, launch } = await ready("/plugin-icons/information_manager.png");
    fireEvent.error(image);
    const fallback = image.src;
    expect(fallback).not.toContain("/plugin-icons/");
    fireEvent.error(image); fireEvent.error(image); fireEvent.click(button);
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).toBeEnabled());
    expect(image.src).toBe(fallback);
  });
  it("retains bundled icons and links without a host", async () => {
    render(<ToolsHome />);
    const link = await screen.findByRole("link", { name: /Information Manager/ });
    expect(link).toHaveAttribute("href", "/information-manager");
    expect(link.querySelector("img")?.src).not.toContain("/plugin-icons/");
  });
});