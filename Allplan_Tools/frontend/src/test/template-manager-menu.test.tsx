import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TemplateDropdown } from "@/components/editor/TemplateMenus";
import { useTemplates } from "@/lib/templates";
import { useCatalog } from "@/lib/catalog-store";

afterEach(cleanup);

describe("Model manager entry", () => {
  it("opens available models on click and opens the manager only through its menu action", () => {
    useCatalog.setState({ lang: "en" });
    useTemplates.setState({ open: false });
    render(<TemplateDropdown />);
    fireEvent.click(screen.getByRole("button", { name: "Manage models" }));
    expect(useTemplates.getState().open).toBe(false);
    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Manage models" }));
    expect(useTemplates.getState().open).toBe(true);
    useTemplates.setState({ open: false });
  });
});