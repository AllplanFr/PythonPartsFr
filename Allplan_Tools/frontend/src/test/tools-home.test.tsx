import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolsHome } from "@/suite/ToolsHome";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, preload: _preload, children, ...props }: { to: string; preload?: boolean; children: React.ReactNode }) => <a href={to} {...props}>{children}</a> }));

describe("unavailable tool entries", () => {
  it.each(["Trade Editor", "Layer Editor", "Attribute Editor"])("does not allow opening %s", (name) => {
    render(<ToolsHome />);
    expect(screen.getByRole("button", { name: new RegExp(name) })).toBeDisabled();
  });
});