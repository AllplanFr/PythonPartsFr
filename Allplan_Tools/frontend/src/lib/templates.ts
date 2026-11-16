import { create } from "zustand";
import { moveSelectionInOrder } from "./selection-order";
import { isLayerAttribute, LAYER_ATTRIBUTES } from "./layer-attributes";
import { useCatalog, type CatalogNode } from "./catalog-store";

export interface TemplateAttribute { num: number; value: string; enabled: boolean }
export interface AttributeTemplate {
  id: string; name: string; type: "group" | "component"; icon?: string | undefined;
  attrs: TemplateAttribute[]; children: AttributeTemplate[];
}
export const dragTemplate: { current: { model?: AttributeTemplate; attrs?: TemplateAttribute[] } | null } = { current: null };
export const dragCatalogModel: { current: string | null } = { current: null };
const SETTINGS_KEY = "smartcatalog-model-settings";
export function modelFromCatalog(nodes: Record<string, CatalogNode>, id: string): AttributeTemplate | null {
  const node = nodes[id];
  if (!node || (node.type !== "group" && node.type !== "component")) return null;
  const nums = [...new Set([...(node.attrOrder ?? []), ...Object.keys(node.attrs).map(Number), ...(node.description ? [207] : [])])].filter((num) => modelAttributeAllowed(num));
  return { id: crypto.randomUUID(), name: node.name, type: node.type, icon: node.icon, attrs: nums.map((num) => ({ num, value: num === 207 ? node.description : node.attrs[num] ?? "", enabled: true })), children: node.type === "group" ? (node.children ?? []).flatMap((child) => { const n = nodes[child]; const model = n?.type === "component" ? modelFromCatalog(nodes, child) : null; return model ? [model] : []; }) : [] };
}
export const isDefaultTemplate = (m: AttributeTemplate) => m.id === "template-group" || m.id === "template-component";
export const modelAttributeAllowed = (num: number, titleAttr = useCatalog.getState().catalog.defAttr) => num > 0 && num <= 99999 && num !== 207 && (!titleAttr || num !== titleAttr);
export function normalizeModels(models: AttributeTemplate[], titleAttr = useCatalog.getState().catalog.defAttr): AttributeTemplate[] {
  const clean = (m: AttributeTemplate): AttributeTemplate => ({ ...m, ...(isDefaultTemplate(m) ? { name: m.id === "template-group" ? "Ouvrage" : "Composant", type: m.id === "template-group" ? "group" as const : "component" as const, icon: undefined } : {}), attrs: m.attrs.filter((a) => modelAttributeAllowed(a.num, titleAttr)), children: m.children.map(clean) });
  const next = models.map(clean);
  for (const m of [base("template-group", "Ouvrage", "group", [120, 202, 209]), base("template-component", "Composant", "component", [96, 120, 202, 209, 267])]) if (!next.some((x) => x.id === m.id)) next.unshift(clean(m));
  return next;
}
export const templateValues = (attrs: TemplateAttribute[]) => Object.fromEntries(attrs.map((a) => [a.num, a.enabled ? a.value : ""])) as Record<number, string>;
export function addTemplateAttributes(model: AttributeTemplate, nums: number[], before?: number): AttributeTemplate {
  const requested = nums.some(isLayerAttribute) ? [...nums, ...LAYER_ATTRIBUTES] : nums;
  const fresh = [...new Set(requested)].filter((num) => modelAttributeAllowed(num) && !model.attrs.some((a) => a.num === num)).map((num) => ({ num, value: "", enabled: false }));
  const attrs = [...model.attrs]; const index = before === undefined ? attrs.length : attrs.findIndex((a) => a.num === before);
  attrs.splice(index < 0 ? attrs.length : index, 0, ...fresh);
  return { ...model, attrs };
}
export function findTemplate(models: AttributeTemplate[], id: string): AttributeTemplate | undefined {
  for (const m of models) { if (m.id === id) return m; const found = findTemplate(m.children, id); if (found) return found; }
  return undefined;
}
export function reorderTemplateAttributes(model: AttributeTemplate, nums: number[], before?: number): AttributeTemplate {
  if (before !== undefined && nums.includes(before)) return model;
  const moving = model.attrs.filter((a) => nums.includes(a.num));
  const rest = model.attrs.filter((a) => !nums.includes(a.num));
  const index = before === undefined ? rest.length : rest.findIndex((a) => a.num === before);
  rest.splice(index < 0 ? rest.length : index, 0, ...moving);
  return { ...model, attrs: rest };
}
export function parseTemplates(input: unknown): AttributeTemplate[] | null {
  const valid = (x: unknown): x is AttributeTemplate => {
    if (!x || typeof x !== "object") return false;
    const m = x as Record<string, unknown>;
    return typeof m['id'] === "string" && typeof m['name'] === "string" && !!m['name'].trim() && (m['type'] === "group" || m['type'] === "component") && (m['icon'] === undefined || typeof m['icon'] === "string") && Array.isArray(m['attrs']) && m['attrs'].every((x: unknown) => {
      if (!x || typeof x !== "object") return false; const a = x as Record<string, unknown>;
      return typeof a['num'] === "number" && Number.isInteger(a['num']) && a['num'] > 0 && a['num'] <= 99999 && typeof a['value'] === "string" && typeof a['enabled'] === "boolean";
    }) && Array.isArray(m['children']) && (m['type'] === "component" ? m['children'].length === 0 : m['children'].every((c: unknown) => valid(c) && c.type === "component"));
  };
  if (!Array.isArray(input) || !input.every(valid)) return null;
  const ids = new Set<string>(); const unique = (m: AttributeTemplate): boolean => { if (ids.has(m.id) || new Set(m.attrs.map((a) => a.num)).size !== m.attrs.length) return false; ids.add(m.id); return m.children.every(unique); };
  return input.every(unique) ? input : null;
}
const mapModels = (models: AttributeTemplate[], id: string, fn: (m: AttributeTemplate) => AttributeTemplate): AttributeTemplate[] => models.map((m) => m.id === id ? fn(m) : { ...m, children: mapModels(m.children, id, fn) });
const base = (id: string, name: string, type: AttributeTemplate["type"], nums: number[]): AttributeTemplate => ({ id, name, type, attrs: nums.map((num) => ({ num, value: "", enabled: false })), children: [] });
interface TemplatesState {
  open: boolean; models: AttributeTemplate[];
  hydrate: () => void;
  saveSettings: () => boolean;
  importCatalog: (nodes: Record<string, CatalogNode>, id: string, parentId?: string) => string | null;
  setOpen: (open: boolean) => void;
  update: (id: string, fn: (m: AttributeTemplate) => AttributeTemplate) => void;
  create: (type: AttributeTemplate["type"], name: string, parentId?: string) => string;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  move: (id: string, dir: -1 | 1, edge?: boolean) => void;
}
export const useTemplates = create<TemplatesState>((set, get) => ({
  open: false,
  models: [base("template-group", "Ouvrage", "group", [120, 202, 209]), base("template-component", "Composant", "component", [96, 120, 202, 209, 267])],
  hydrate: () => { try { const raw = localStorage.getItem(SETTINGS_KEY); if (!raw) return; const models = parseTemplates(JSON.parse(raw)); if (models) set({ models: normalizeModels(models) }); } catch { /* Keep usable defaults when settings are unavailable. */ } },
  saveSettings: () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(get().models)); return true; } catch { return false; } },
  importCatalog: (nodes, id, parentId) => {
    const model = modelFromCatalog(nodes, id); if (!model) return null;
    const target = parentId ? findTemplate(get().models, parentId) : undefined;
    if (target?.type === "group" && model.type === "component") get().update(target.id, (m) => ({ ...m, children: [model, ...m.children] }));
    else if (target?.type === model.type) {
      const insert = (models: AttributeTemplate[]): AttributeTemplate[] => models.flatMap((m) => m.id === target.id ? [m, model] : [{ ...m, children: insert(m.children) }]);
      set((s) => ({ models: insert(s.models) }));
    } else if (target) return null;
    else set((s) => ({ models: [...s.models, model] }));
    return model.id;
  },
  setOpen: (open) => set({ open }),
  update: (id, fn) => set((s) => ({ models: mapModels(s.models, id, (m) => {
    const next = fn(m);
    return { ...next, ...(isDefaultTemplate(m) ? { id: m.id, name: m.name, type: m.type, icon: m.icon } : {}), attrs: next.attrs.filter((a) => modelAttributeAllowed(a.num)) };
  }) })),
  create: (type, name, parentId) => {
    const id = crypto.randomUUID(); const model = base(id, name, type, []);
    const p = parentId ? findTemplate(get().models, parentId) : undefined;
    if (p?.type === "group" && type === "component") get().update(p.id, (m) => ({ ...m, children: [model, ...m.children] }));
    else set((s) => ({ models: [...s.models, model] }));
    return id;
  },
  remove: (id) => { if (id === "template-group" || id === "template-component") return; const filter = (ms: AttributeTemplate[]): AttributeTemplate[] => ms.filter((m) => m.id !== id).map((m) => ({ ...m, children: filter(m.children) })); set((s) => ({ models: filter(s.models) })); },
  duplicate: (id) => { const m = findTemplate(get().models, id); if (!m) return; const clone = (m: AttributeTemplate): AttributeTemplate => ({ ...m, id: crypto.randomUUID(), attrs: m.attrs.map((a) => ({ ...a })), children: m.children.map(clone) }); set((s) => ({ models: [...s.models, { ...clone(m), name: `${m.name} (2)` }] })); },
  move: (id, dir, edge = false) => { const reorder = (ms: AttributeTemplate[]): AttributeTemplate[] => moveSelectionInOrder(ms.map((m) => ({ ...m, children: reorder(m.children) })), (m) => m.id === id, dir, edge); set((s) => ({ models: reorder(s.models) })); },
}));
