import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { completeFillAttributes, fillRows, shortImagePath, toggleFillMode } from "../lib/fill-attributes";
import { useCatalog } from "../lib/catalog-store";
import { FillAttributeField, FillAttributeRows } from "../components/editor/FillAttributeField";

beforeEach(() => useCatalog.getState().load({ nodes: { target: { id: "target", name: "C20/25", type: "group", description: "", parentId: null, children: [], attrs: {} } }, rootIds: ["target"] }));
afterEach(cleanup);
it.each([["1", [118, 111]], ["2", [118, 111]], ["3", [118, 111]], ["4", [118, 111, 252]], ["5", [118, 111]], ["6", [118, 336]]])("maps type %s to the specified attributes", (type, rows) => {
  expect(fillRows(String(type))).toEqual(rows);
});
it("adds 118 with 111 and changing to 4 adds 252 in a single undoable action", () => {
  useCatalog.getState().addTemplateAttrs("target", [{ num: 118, value: "", enabled: false }]);
  expect(useCatalog.getState().nodes["target"]?.attrs).toEqual({ 118: "1", 111: "0" });
  useCatalog.getState().setAttr("target", 118, "4");
  expect(useCatalog.getState().nodes["target"]?.attrs).toEqual({ 118: "4", 111: "0", 252: "0" });
  useCatalog.getState().undo();
  expect(useCatalog.getState().nodes["target"]?.attrs).toEqual({ 118: "1", 111: "0" });
});
it("creates image path for type 6 without discarding hidden values", () => {
  expect(completeFillAttributes({ 118: "6", 111: "25", 252: "4" })).toEqual({ 118: "6", 111: "25", 252: "4", 336: "" });
});
it.each(["1", "2", "3", "4"])("limits type %s values to 0–255", (type) => {
  useCatalog.getState().setAttr("target", 118, type);
  useCatalog.getState().setAttr("target", 111, "255");
  useCatalog.getState().setAttr("target", 111, "256");
  expect(useCatalog.getState().nodes["target"]?.attrs[111]).toBe("255");
  useCatalog.getState().setAttr("target", 111, "0");
  expect(useCatalog.getState().nodes["target"]?.attrs[111]).toBe("0");
});
it("rejects unknown filling types", () => {
  useCatalog.getState().setAttr("target", 118, "4");
  useCatalog.getState().setAttr("target", 118, "7");
  expect(useCatalog.getState().nodes["target"]?.attrs[118]).toBe("4");
});
it("resets a surface style ID outside 000–255 when switching to hatching", () => {
  useCatalog.getState().setAttr("target", 118, "5");
  useCatalog.getState().setAttr("target", 111, "301");
  useCatalog.getState().setAttr("target", 118, "1");
  expect(useCatalog.getState().nodes["target"]?.attrs[111]).toBe("0");
  useCatalog.getState().undo();
  expect(useCatalog.getState().nodes["target"]?.attrs[111]).toBe("301");
});
it("stores image paths relative to design and rejects escaping paths", () => {
  expect(shortImagePath("C:\\Project\\design\\Library\\Trees.png")).toBe("Library\\Trees.png");
  expect(shortImagePath("Library/Trees.png")).toBe("Library\\Trees.png");
  expect(shortImagePath("../Trees.png")).toBeNull();
  expect(shortImagePath("C:\\Other\\Trees.png")).toBeNull();
  expect(shortImagePath("https://example.com/image.png")).toBeNull();
});
it("completes hatching IDs with padded display and integer stored value", () => {
  const commit = vi.fn();
  render(<FillAttributeField num={111} value="2" attrs={{ 118: "1" }} onCommit={commit} />);
  const combo = screen.getByRole("combobox", { name: "111 · Hatching" });
  expect(combo).toHaveValue("002");
  fireEvent.focus(combo); fireEvent.change(combo, { target: { value: "255" } }); fireEvent.keyDown(combo, { key: "Enter" });
  expect(commit).toHaveBeenCalledWith("255");
});
it("completes style names case-insensitively without opening the browser", () => {
  const commit = vi.fn();
  render(<FillAttributeField num={111} value="0" attrs={{ 118: "5" }} onCommit={commit} />);
  const combo = screen.getByRole("combobox", { name: "111 · Surface style" });
  fireEvent.focus(combo); fireEvent.change(combo, { target: { value: "LiGHt paRT" } }); fireEvent.keyDown(combo, { key: "Enter" });
  expect(commit).toHaveBeenCalledWith("308");
  fireEvent.click(screen.getByRole("button", { name: "Choose a surface style" }));
  fireEvent.doubleClick(screen.getByRole("option", { name: /Reinforced concrete 301/ }));
  expect(commit).toHaveBeenCalledWith("301");
});
it("read-only external filling controls cannot change their values", () => {
  const commit = vi.fn();
  render(<FillAttributeField num={118} value="2" readOnly onCommit={commit} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Hatching" }));
  expect(commit).not.toHaveBeenCalled();
});
it("type 6 exposes only the image field, preserving inactive attributes", () => {
  render(<FillAttributeRows attrs={{ 118: "6", 111: "2", 252: "4", 336: "Trees.png" }} onCommit={vi.fn()} renderRow={(num, _label, control) => <div key={num}>{control}</div>} />);
  expect(screen.getByRole("textbox", { name: "336 · Image path" })).toHaveValue("Trees.png");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
it("combines hatching and color through their existing choices", () => {
  expect(toggleFillMode("1", "3")).toBe("4");
  expect(toggleFillMode("3", "1")).toBe("4");
  expect(toggleFillMode("4", "3")).toBe("1");
});
it("combines pattern and color and retains both indexed values atomically", () => {
  expect(toggleFillMode("2", "3")).toBe("2+3");
  expect(toggleFillMode("4", "2")).toBe("2+3");
  expect(fillRows("2+3")).toEqual([118, 111, 252]);
  useCatalog.getState().setAttr("target", 118, "2+3");
  useCatalog.getState().setAttr("target", 111, "23");
  useCatalog.getState().setAttr("target", 252, "146");
  expect(useCatalog.getState().nodes["target"]?.attrs).toEqual({ 118: "2+3", 111: "23", 252: "146" });
  expect(toggleFillMode("2+3", "3")).toBe("2");
});
it("combination controls call the catalog choice without changing source values", () => {
  const commit = vi.fn();
  render(<FillAttributeField num={118} value="2" onCommit={commit} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Color" }));
  expect(commit).toHaveBeenCalledWith("2+3");
});
