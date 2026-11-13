import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { useCatalog, type CatalogNode } from "../lib/catalog-store";
import { LAYER_ATTRIBUTES, LINE_COLORS, PEN_THICKNESSES, layerValue } from "../lib/layer-attributes";
import { AttributeValueField } from "../components/editor/PropertyPanel";
import { addTemplateAttributes } from "../lib/templates";
import { LineStyleField } from "../components/editor/LayerAttributeField";

const target = (attrs: Record<number, string> = {}): CatalogNode => ({ id: "target", name: "C20/25", type: "group", description: "", attrs, children: [], parentId: null });
beforeEach(() => useCatalog.getState().load({ nodes: { target: target() }, rootIds: ["target"] }));
afterEach(cleanup);
describe("Layer attribute bundle", () => {
  it.each([141, 349, 346, 345, 347])("adding %i adds all five in one undoable action", (num) => {
    useCatalog.getState().addTemplateAttrs("target", [{ num, value: "", enabled: false }]);
    expect(Object.keys(useCatalog.getState().nodes["target"]?.attrs ?? {}).map(Number).sort()).toEqual([141, 345, 346, 347, 349]);
    expect(useCatalog.getState().past).toHaveLength(1);
    useCatalog.getState().undo();
    expect(useCatalog.getState().nodes["target"]?.attrs).toEqual({});
  });
  it("preserves existing values when completing the bundle", () => {
    useCatalog.getState().load({ nodes: { target: target({ 141: "3802", 346: "4", 349: "3" }) }, rootIds: ["target"] });
    useCatalog.getState().addTemplateAttrs("target", [{ num: 347, value: "255", enabled: true }]);
    expect(useCatalog.getState().nodes["target"]?.attrs).toEqual({ 141: "3802", 349: "3", 346: "4", 345: "1", 347: "255" });
  });
  it("enforces indexed colors 0 through 255", () => {
    const s = useCatalog.getState(); s.setAttr("target", 347, "255");
    expect(useCatalog.getState().nodes["target"]?.attrs[347]).toBe("255");
    s.setAttr("target", 347, "256"); s.setAttr("target", 347, "-1");
    expect(useCatalog.getState().nodes["target"]?.attrs[347]).toBe("255");
    s.setAttr("target", 347, "0"); expect(useCatalog.getState().nodes["target"]?.attrs[347]).toBe("0");
  });
  it("resolves the source layer pen, line and color independently", () => {
    const attrs = { 141: "3802", 349: "5", 346: "1", 345: "2", 347: "3" };
    expect(layerValue(346, attrs)).toBe("4"); expect(layerValue(345, attrs)).toBe("2"); expect(layerValue(347, attrs)).toBe("146");
  });
  it("disables inheritance on default layer", () => {
    useCatalog.getState().setAttr("target", 141, "0"); useCatalog.getState().setAttr("target", 349, "7");
    expect(useCatalog.getState().nodes["target"]?.attrs[349]).toBe("0");
  });
  it("adds the complete bundle in models", () => {
    const model = addTemplateAttributes({ id: "m", name: "m", type: "group", attrs: [], children: [] }, [141]);
    expect(model.attrs.map((a) => a.num)).toEqual([...LAYER_ATTRIBUTES]);
  });
  it("uses the supplied pen indexes and palette", () => {
    expect(PEN_THICKNESSES.find((p) => p.id === 1)?.mm).toBe(0.25);
    expect(LINE_COLORS).toHaveLength(256); expect(LINE_COLORS[0]).toBe("#ffffff"); expect(LINE_COLORS[3]).toBe("#00ffff");
  });
  it("shows layer title while committing its integer ID", () => {
    const commit = vi.fn(); render(<AttributeValueField num={141} value="3802" onCommit={commit} />);
    expect(screen.getByRole("combobox", { name: "141 · Layer" })).toHaveValue("Mur béton porteur");
    fireEvent.click(screen.getByRole("button", { name: "Choose a layer" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Layer name, code or number…" }), { target: { value: "3806" } });
    fireEvent.doubleClick(screen.getByRole("option", { name: /Mur à sec/ }));
    expect(commit).toHaveBeenCalledWith("3806");
  });
  it("keeps inherited and read-only values immutable", () => {
    const commit = vi.fn(); render(<AttributeValueField num={346} value="1" attrs={{ 141: "3802", 349: "1" }} onCommit={commit} readOnly />);
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button")); expect(commit).not.toHaveBeenCalled();
  });
  it.each([[346, 1, "Pen thickness"], [345, 2, "Linetype"], [347, 4, "Line color"]] as const)("blocks %i independently when its 349 switch is active and preserves the manual value", (num, bit, label) => {
    const commit = vi.fn();
    const attrs = { 141: "3802", 349: String(bit), 346: "1", 345: "2", 347: "3" };
    const { rerender } = render(<LineStyleField attrs={attrs} onCommit={commit} />);
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    for (const other of ["Pen thickness", "Linetype", "Line color"].filter((name) => name !== label)) expect(screen.getByRole("button", { name: other })).toBeEnabled();
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: `From layer · ${label}` }));
    expect(commit).toHaveBeenCalledWith(349, "0");
    rerender(<LineStyleField attrs={{ ...attrs, 349: "0" }} onCommit={commit} />);
    expect(screen.getByRole("button", { name: label })).toBeEnabled();
    expect(screen.getByRole("button", { name: label })).toHaveTextContent(num === 346 ? "0.25 mm" : num === 345 ? "[2]" : "[3]");
  });
  it("completes layer names without case sensitivity and commits the integer ID", () => {
    const commit = vi.fn();
    render(<AttributeValueField num={141} value="3802" onCommit={commit} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "141 · Layer" }));
    fireEvent.change(screen.getByRole("combobox", { name: "141 · Layer" }), { target: { value: "mUR À sEC" } });
    fireEvent.click(screen.getByRole("option", { name: /Mur à sec/ }));
    expect(commit).toHaveBeenCalledWith("3806");
  });
});