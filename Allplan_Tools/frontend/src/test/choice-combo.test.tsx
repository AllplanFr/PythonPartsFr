import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChoiceCombo } from "../components/editor/ChoiceCombo";
import { normalizeVobIndex } from "@/lib/vob-references";

afterEach(cleanup);
it("recognizes a raw VOB value by its normalized index without changing it on mount or open", () => {
  const change = vi.fn();
  render(<ChoiceCombo label="Object" value="0035" normalizeValue={normalizeVobIndex} options={[{ value: "35", label: "Mur", index: "35" }]} onChange={change} />);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("combobox", { name: "Object" }));
  expect(screen.getByRole("option").getAttribute("aria-selected")).toBe("true");
  expect(change).not.toHaveBeenCalled();
});
it("matches mixed-case input and selects the stored option value with Enter", () => {
  const change = vi.fn();
  render(<ChoiceCombo label="Library" value="one" options={[{ value: "one", label: "Concrete" }, { value: "two", label: "Masonry" }]} onChange={change} />);
  fireEvent.click(screen.getByRole("combobox", { name: "Library" }));
  const search = screen.getByRole("textbox", { name: "Search · Library" });
  fireEvent.change(search, { target: { value: "mASon" } });
  expect(screen.queryByRole("option", { name: "Concrete" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Masonry" })).toBeInTheDocument();
  fireEvent.keyDown(search, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("two");
});
it("scrolls to the selected option when opened and Enter keeps that value", async () => {
  const scroll = vi.fn();
  const old = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const change = vi.fn();
    render(<ChoiceCombo label="Object" value="29" options={Array.from({ length: 30 }, (_, i) => ({ value: String(i), label: `Object ${i}` }))} onChange={change} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Object" }));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "nearest" }));
    expect(scroll.mock.instances[0]).toBe(screen.getByRole("option", { name: "Object 29" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search · Object" }), { key: "Enter" });
    expect(change).toHaveBeenCalledWith("29");
  } finally {
    HTMLElement.prototype.scrollIntoView = old;
  }
});