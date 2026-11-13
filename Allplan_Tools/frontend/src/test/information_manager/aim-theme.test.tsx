import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeMenu } from "@/modules/information_manager/components/theme-menu";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark", "christmas");
});
afterEach(cleanup);

describe("VOB-style theme control", () => {
  it("toggles directly between light and dark and stores each choice", () => {
    const view = render(<ThemeMenu lang="fr" />);
    fireEvent.click(view.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("information_manager:theme")).toBe("dark");
    fireEvent.click(view.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("information_manager:theme")).toBe("light");
  });

  it("restores the saved dark theme on mounting", () => {
    localStorage.setItem("information_manager:theme", "dark");
    render(<ThemeMenu lang="fr" />);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});