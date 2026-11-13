import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useExternalLibraries } from "../lib/external-libraries";
import { useCatalog } from "../lib/catalog-store";

vi.mock("@/components/editor/FormulaTools", () => ({
  DIALOG_BTN: "",
  Dialog: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) => <section aria-label={title}>{children}{footer}</section>,
}));
vi.mock("@/components/editor/CustomToolbar", () => ({ CustomToolbar: ({ buttons, initial }: { buttons: Record<string, ReactNode>; initial: { buttons: string[] }[] }) => <div>{initial.flatMap((g) => g.buttons).map((id) => <span key={id}>{buttons[id]}</span>)}</div> }));
vi.mock("@/components/editor/SearchBox", () => ({ SearchBox: () => null }));
vi.mock("@/components/editor/PropertyPanel", () => ({ AttributeValueField: ({ value }: { value: string }) => <input readOnly value={value} />, TextField: ({ value, onCommit }: { value: string; onCommit: (v: string) => void }) => <input aria-label="Personal name" value={value} onChange={(e) => onCommit(e.target.value)} /> }));
import { ExternalLibraryDialog } from "../components/editor/ExternalLibraryDialog";
import { seedDemo } from "./fixtures/seed-demo";
seedDemo();

const initial = useExternalLibraries.getState();
beforeEach(() => {
  useExternalLibraries.setState(initial, true);
  useCatalog.setState({ lang: "en" });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("External library management navigation", () => {
  it("opens a database on double click without asking to save an unchanged organization", () => {
    render(<ExternalLibraryDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Manage sources" }));
    fireEvent.doubleClick(screen.getByText("Bibliothèque de démonstration", { selector: "span" }));
    expect(screen.getByRole("button", { name: "Manage sources" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Continue without saving" })).toBeNull();
  });
  it("asks to save changes before browsing and a personal name never changes the database location or contents", () => {
    const before = useExternalLibraries.getState().sources[0];
    render(<ExternalLibraryDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Manage sources" }));
    fireEvent.change(screen.getByLabelText("Personal name"), { target: { value: "My library" } });
    expect(useExternalLibraries.getState().sources[0]?.location).toBe(before?.location);
    expect(useExternalLibraries.getState().sources[0]?.data).toBe(before?.data);
    fireEvent.doubleClick(screen.getByText("My library", { selector: "span" }));
    expect(screen.getByRole("button", { name: "Manage sources" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Continue without saving" }));
    expect(screen.getByRole("button", { name: "Manage sources" })).toHaveAttribute("aria-pressed", "false");
  });
});