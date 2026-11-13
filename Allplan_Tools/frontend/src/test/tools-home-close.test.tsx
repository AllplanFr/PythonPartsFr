import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolsHome } from "@/suite/ToolsHome";
import { HOME_TEXT } from "@/suite/home-text";
import { isCloseHomeReply } from "@/suite/contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@/suite/use-home-host", () => ({
  useHomeHost: () => ({ mode: "browser", info: null, message: "", error: false, launching: false, launch: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "pywebview");
  vi.restoreAllMocks();
});

function openConfirmation(close_home?: ReturnType<typeof vi.fn>) {
  if (close_home) {
    Object.defineProperty(window, "pywebview", { configurable: true, value: { api: { close_home } } });
  }
  const fallback = vi.spyOn(window, "close").mockImplementation(() => {});
  const view = render(<ToolsHome />);
  fireEvent.click(within(view.container.querySelector("footer")!).getByRole("button", { name: "Quitter" }));
  return { fallback, dialog: screen.getByRole("dialog") };
}

describe("home close confirmation", () => {
  it("cancels without either close call", () => {
    const close = vi.fn();
    const { fallback, dialog } = openConfirmation(close);
    fireEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("accepts requested without reporting confirmed closure or using fallback", async () => {
    const close = vi.fn().mockResolvedValue({ ok: true, status: "requested" });
    const { fallback, dialog } = openConfirmation(close);
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitter" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(fallback).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["failure", () => Promise.resolve({ ok: false, error: "Native close refused" }), "Native close refused"],
    ["rejection", () => Promise.reject(new Error("Bridge unavailable")), "Bridge unavailable"],
    ["invalid reply", () => Promise.resolve({ ok: true }), "Invalid close_home response"],
  ])("shows %s without using fallback", async (_name, response, message) => {
    const close = vi.fn(response);
    const { fallback, dialog } = openConfirmation(close);
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(close).toHaveBeenCalledExactlyOnceWith();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(["browser", "old host"])("keeps manual fallback for %s", (kind) => {
    if (kind === "old host") {
      Object.defineProperty(window, "pywebview", { configurable: true, value: { api: {} } });
    }
    const { fallback, dialog } = openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Quitter" }));
    expect(fallback).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByText(HOME_TEXT.fr.closeHint)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("validates the exact optional close reply shape", () => {
    expect(isCloseHomeReply({ ok: true, status: "requested" })).toBe(true);
    expect(isCloseHomeReply({ ok: false, error: "refused" })).toBe(true);
    for (const reply of [null, [], { ok: true }, { ok: true, status: "closed" }, { ok: false, error: "" }]) {
      expect(isCloseHomeReply(reply)).toBe(false);
    }
  });
});
