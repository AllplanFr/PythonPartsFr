import { beforeEach, describe, expect, it } from "vitest";
import { ATTRIBUTE_CATALOG, useCatalog, type CatalogNode } from "../lib/catalog-store";
import { useTemplates, modelFromCatalog, addTemplateAttributes, reorderTemplateAttributes, parseTemplates, normalizeModels, templateValues, type AttributeTemplate } from "../lib/templates";
const model: AttributeTemplate = { id: "test", name: "Concrete", type: "group", attrs: [{ num: 120, value: "2", enabled: true }, { num: 202, value: "m3", enabled: false }], children: [] };
const folder: CatalogNode = { id: "folder", name: "Folder", type: "folder", parentId: null, description: "", attrs: {}, children: [] };
describe("attribute models", () => {
  it("protects built-in names, icons, types and removal while allowing values", () => {
    useTemplates.setState({ models: normalizeModels([]) });
    const s = useTemplates.getState();
    s.update("template-group", (m) => ({ ...m, name: "Changed", type: "component", icon: "test", attrs: [{ num: 120, value: "42", enabled: true }] }));
    s.remove("template-group");
    expect(useTemplates.getState().models.find((m) => m.id === "template-group")).toMatchObject({ name: "Ouvrage", type: "group", icon: undefined, attrs: [{ num: 120, value: "42", enabled: true }] });
  });
  it("excludes implicit description 207 from models", () => {
    expect(addTemplateAttributes(model, [207]).attrs).toEqual(model.attrs);
  });
  it("excludes the active title attribute but allows it when None is selected", () => {
    const catalog = useCatalog.getState().catalog;
    useCatalog.getState().setCatalog({ ...catalog, defAttr: 507 });
    expect(addTemplateAttributes(model, [507]).attrs).toEqual(model.attrs);
    useCatalog.getState().setCatalog({ ...catalog, defAttr: 0 });
    expect(addTemplateAttributes(model, [507]).attrs.map((a) => a.num)).toContain(507);
    useCatalog.getState().setCatalog(catalog);
  });
  it("uses ouvrage and component default values on plain Add", () => {
    useTemplates.setState({ models: normalizeModels([]) });
    useTemplates.getState().update("template-group", (m) => ({ ...m, attrs: [{ num: 120, value: "7", enabled: true }] }));
    useTemplates.getState().update("template-component", (m) => ({ ...m, attrs: [{ num: 96, value: "@223@", enabled: true }] }));
    useCatalog.getState().select("folder"); useCatalog.getState().addNode("group");
    const g = useCatalog.getState().selected[0];
    expect(g ? useCatalog.getState().nodes[g]?.attrs : null).toEqual({ 120: "7" });
    useCatalog.getState().addNode("component"); const c = useCatalog.getState().selected[0];
    expect(c ? useCatalog.getState().nodes[c]?.attrs : null).toEqual({ 96: "@223@" });
  });
  it("uses the formula control for attribute 96, just like 267", () => {
    expect(ATTRIBUTE_CATALOG.find((a) => a.num === 96)?.control).toBe("formula");
    expect(ATTRIBUTE_CATALOG.find((a) => a.num === 267)?.control).toBe("formula");
  });
  it("saves and restores models as settings including an empty collection", () => {
    useTemplates.setState({ models: [model] });
    expect(useTemplates.getState().saveSettings()).toBe(true);
    useTemplates.setState({ models: [] }); useTemplates.getState().hydrate();
    expect(useTemplates.getState().models.find((m) => m.id === "test")).toEqual(model);
    useTemplates.setState({ models: [] }); useTemplates.getState().saveSettings();
    useTemplates.setState({ models: [model] }); useTemplates.getState().hydrate();
    expect(useTemplates.getState().models.map((m) => m.id).sort()).toEqual(["template-component", "template-group"]);
  });
  it("captures ouvrages with child components and values but not links", () => {
    const nodes: Record<string, CatalogNode> = { g: { ...folder, id: "g", type: "group", name: "Work", children: ["c", "l"], attrs: { 96: "@223@" } }, c: { ...folder, id: "c", type: "component", name: "Part", parentId: "g", attrs: { 267: "@229@" } }, l: { ...folder, id: "l", type: "link", parentId: "g" } };
    const captured = modelFromCatalog(nodes, "g");
    expect(captured?.children).toHaveLength(1);
    expect(captured?.attrs).toEqual([{ num: 96, value: "@223@", enabled: true }]);
    expect(captured?.children[0]?.attrs).toEqual([{ num: 267, value: "@229@", enabled: true }]);
    expect(modelFromCatalog(nodes, "l")).toBeNull(); expect(modelFromCatalog(nodes, "folder")).toBeNull();
  });
  it("imports a component as an ouvrage model child without changing catalog history", () => {
    useTemplates.setState({ models: [model] });
    const component: CatalogNode = { ...folder, id: "c", type: "component", name: "New component", attrs: { 96: "@223@" } };
    const before = useCatalog.getState().past.length;
    const id = useTemplates.getState().importCatalog({ c: component }, "c", model.id);
    expect(useTemplates.getState().models[0]?.children[0]?.id).toBe(id);
    expect(useTemplates.getState().models[0]?.children).toHaveLength(1);
    expect(useCatalog.getState().past).toHaveLength(before);
  });
  it("imports a component before existing child models", () => {
    useTemplates.setState({ models: [{ ...model, children: [{ ...model, id: "existing", type: "component", children: [] }] }] });
    const component: CatalogNode = { ...folder, id: "c", type: "component", name: "First child" };
    const id = useTemplates.getState().importCatalog({ c: component }, "c", model.id);
    expect(useTemplates.getState().models[0]?.children.map((m) => m.id)).toEqual([id, "existing"]);
  });
  it("imports a component beside a component model without nesting", () => {
    useTemplates.setState({ models: [{ ...model, children: [{ ...model, id: "existing", type: "component", children: [] }] }] });
    const component: CatalogNode = { ...folder, id: "c", type: "component", name: "Sibling" };
    const id = useTemplates.getState().importCatalog({ c: component }, "c", "existing");
    expect(useTemplates.getState().models[0]?.children.map((m) => m.id)).toEqual(["existing", id]);
    expect(useTemplates.getState().models[0]?.children[0]?.children).toEqual([]);
  });
  beforeEach(() => useCatalog.getState().load({ nodes: { folder }, rootIds: ["folder"] }));
  it("applies only activated defaults while keeping every attribute", () => {
    expect(templateValues(model.attrs)).toEqual({ 120: "2", 202: "" });
  });
  it("creates a complete ouvrage with components in one undo step", () => {
    const s = useCatalog.getState(); const id = s.insertTemplate({ ...model, children: [{ ...model, id: "child", type: "component", name: "Child" }] }, "folder");
    expect(id).not.toBeNull(); const n = id ? useCatalog.getState().nodes[id] : undefined;
    expect(n?.attrs).toEqual({ 120: "2", 202: "" }); expect(n?.children).toHaveLength(1);
    expect(useCatalog.getState().past).toHaveLength(1);
    s.undo(); expect(Object.keys(useCatalog.getState().nodes)).toEqual(["folder"]);
    s.redo(); expect(Object.keys(useCatalog.getState().nodes)).toHaveLength(3);
  });
  it("enforces hierarchy without partial insertion", () => {
    expect(useCatalog.getState().insertTemplate({ ...model, type: "component" }, "folder")).toBeNull();
    expect(useCatalog.getState().insertTemplate({ ...model, children: [{ ...model, id: "nested" }] }, "folder")).toBeNull();
    expect(useCatalog.getState().past).toHaveLength(0);
  });
  it("makes ouvrage names catalog-unique", () => {
    const s = useCatalog.getState(); s.insertTemplate(model, "folder"); s.insertTemplate(model, "folder");
    expect(Object.values(useCatalog.getState().nodes).filter((n) => n.type === "group").map((n) => n.name)).toEqual(["Concrete", "Concrete (2)"]);
  });
  it("skips existing attributes and applies a batch in one history entry", () => {
    const s = useCatalog.getState(); const id = s.insertTemplate(model, "folder"); if (!id) throw new Error("Insertion failed");
    expect(s.addTemplateAttrs(id, [{ num: 120, value: "99", enabled: true }, { num: 209, value: "3", enabled: true }])).toBe(true);
    expect(useCatalog.getState().nodes[id]?.attrs).toEqual({ 120: "2", 202: "", 209: "3" });
    expect(useCatalog.getState().past).toHaveLength(2); s.undo(); expect(useCatalog.getState().nodes[id]?.attrs[209]).toBeUndefined();
  });
  it("rejects attribute drops on folders and links", () => {
    useCatalog.setState((s) => ({ nodes: { ...s.nodes, link: { ...folder, id: "link", type: "link" } } }));
    expect(useCatalog.getState().addTemplateAttrs("folder", model.attrs)).toBe(false);
    expect(useCatalog.getState().addTemplateAttrs("link", model.attrs)).toBe(false);
  });
  it("adds new picker attributes as siblings without duplicates or enabled defaults", () => {
    expect(addTemplateAttributes(model, [209, 209, 120, 99999], 202).attrs).toEqual([model.attrs[0], { num: 209, value: "", enabled: false }, { num: 99999, value: "", enabled: false }, model.attrs[1]]);
  });
  it("rejects invalid imports and accepts complete models", () => {
    expect(parseTemplates([model])).toEqual([model]);
    expect(parseTemplates([{ ...model, attrs: [{ num: 100000, enabled: false, value: "" }] }])).toBeNull();
    expect(parseTemplates([model, model])).toBeNull();
  });
  it("reorders selected rows together without changing their default values", () => {
    const full = addTemplateAttributes(model, [209, 267]);
    const next = reorderTemplateAttributes(full, [120, 209], 267);
    expect(next.attrs.map((a) => a.num)).toEqual([202, 120, 209, 267]);
    expect(next.attrs.find((a) => a.num === 120)).toEqual({ num: 120, value: "2", enabled: true });
    expect(reorderTemplateAttributes(full, [120, 209], 209)).toBe(full);
  });
});