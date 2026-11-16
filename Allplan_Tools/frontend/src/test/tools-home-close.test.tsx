import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolsHome } from "@/suite/ToolsHome";
import type { AllplanToolsHomeApi } from "@/suite/contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "pywebview");
  vi.restoreAllMocks();
});

function mount(close_home?: AllplanToolsHomeApi["close_home"]) {
  const api = {
    get_home_info: vi.fn().mockResolvedValue({
      home_launch_contract: 1,
      context: { year: "2026", verification: false, country: "FRA" },
      plugins: [],
    }),
    launch: vi.fn(),
    ...(close_home ? { close_home } : {}),
  };
  Object.defineProperty(window, "pywebview", { configurable: true, value: { api } });
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  render(<ToolsHome requireNative />);
  fireEvent.click(screen.getByRole("button", { name: "Quitter" }));
  return { api, close, dialog: screen.getByRole("dialog") };
}

describe("Home close request", () => {
  it("cancels without calling either closure mechanism", () => {
    const native = vi.fn().mockResolvedValue({ ok: true, status: "requested" });
    const { dialog, close } = mount(native);
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(native).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("acknowledges only a native request, preserving the API receiver", async () => {
    const native = vi.fn().mockResolvedValue({ ok: true, status: "requested" });
    const { api, dialog, close } = mount(native);
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitter" }));
    const status = await within(dialog).findByRole("status");
    expect(status).toHaveTextContent("Demande de fermeture émise");
    expect(status).toHaveTextContent("La fermeture effective n’est pas confirmée");
    expect(native).toHaveBeenCalledTimes(1);
    expect(native.mock.contexts[0]).toBe(api);
    expect(close).not.toHaveBeenCalled();
  });

  it("shows the returned error without a browser fallback", async () => {
    const native = vi.fn().mockResolvedValue({ ok: false, error: "Fenêtre absente.\nJournal : logs" });
    const { dialog, close } = mount(native);
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitter" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Fenêtre absente.");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Journal : logs");
    expect(close).not.toHaveBeenCalled();
  });

  it("shows a rejected native request without a browser fallback", async () => {
    const { dialog, close } = mount(vi.fn().mockRejectedValue(new Error("Pont interrompu")));
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitter" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Pont interrompu");
    expect(close).not.toHaveBeenCalled();
  });

  it("retains browser closure and manual guidance for an older host", async () => {
    const { dialog, close } = mount();
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitter" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Vous pouvez fermer cet onglet ou cette fenêtre");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([null, { ok: true }, { ok: true, status: "closed" }])("refuses malformed acknowledgement %j", async (reply) => {
    const { dialog, close } = mount(vi.fn().mockResolvedValue(reply));
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitter" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("La demande de fermeture a échoué");
    expect(close).not.toHaveBeenCalled();
  });
});
