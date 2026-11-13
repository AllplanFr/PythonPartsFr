import { wouldCycle } from "./links";
import { completeFillAttributes, FILL_ATTRIBUTES, isFillAttribute, validFillValue } from "./fill-attributes";
import { completeRoomAttributes, isRoomAttribute, ROOM_ATTRIBUTES } from "./room-attributes";
import { completeLayerAttributes, isLayerAttribute, LAYER_ATTRIBUTES, validLayerValue } from "./layer-attributes";
import { showMessage } from "./app-dialog";
import { create } from "zustand";
import { moveSelectionInOrder } from "./selection-order";
import { parseExternalCatalog, externalTopLevel, type ExternalCatalog } from "./external-catalog";
import { isFormulaAttribute } from "./formula-favorites";
import allplanAttrs from "./allplan-attributes.json";
import { useTemplates, templateValues, type AttributeTemplate, type TemplateAttribute } from "./templates";

export type NodeType = "folder" | "group" | "component" | "link";
export type AttrType = "text" | "int" | "dec";

export interface CatalogNode {
  id: string;
  type: NodeType;
  name: string;
  description: string;
  children?: string[] | undefined;
  parentId: string | null;
  attrs: Record<number, string>;
  /** Custom folder icon (data URL); folders only. */
  icon?: string | undefined;
  /** User-defined display order of attribute rows. */
  attrOrder?: number[] | undefined;
}

export type AttrControl = "edit" | "combo" | "check" | "date" | "formula";
export interface AttrDef {
  num: number;
  name: string;
  type: AttrType;
  control?: AttrControl;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
  /** Indexes into ATTRIBUTE_GROUPS (bits of the Allplan group mask). */
  groups?: number[];
  comment?: string;
  readOnly?: boolean;
}

/** Real Allplan attribute definitions (temporary until the PythonPart supplies them). */
export const ATTRIBUTE_GROUPS: string[] = allplanAttrs.groups;
/** Local behaviour overrides on top of the Allplan definitions. */
const OVERRIDES: Record<number, Partial<AttrDef>> = { 96: { control: "formula" }, 267: { control: "formula" }, 76: { control: "formula" }, 180: { control: "formula" } };
export const ATTRIBUTE_CATALOG: AttrDef[] = (allplanAttrs.attributes as AttrDef[]).map((a) => (OVERRIDES[a.num] ? { ...a, ...OVERRIDES[a.num] } : a));
export const ATTRIBUTE_BY_NUMBER = new Map(ATTRIBUTE_CATALOG.map((attribute) => [attribute.num, attribute]));
/** Group names for an attribute, as in the Qt6 group_by_number_get. */
export const attrGroupNames = (a: AttrDef) => (a.groups ?? []).map((i) => ATTRIBUTE_GROUPS[i]).filter(Boolean) as string[];


type Nodes = Record<string, CatalogNode>;
interface Snapshot { nodes: Nodes; rootIds: string[] }

let seq = 0;
let booted = false;
const uid = () => (booted ? `n${Date.now().toString(36)}${(seq++).toString(36)}` : `s${(seq++).toString(36)}`);

/** Generates a large folder for stress-testing the virtualized tree. */
function addStress(s: Snapshot, count: number): Snapshot {
  const nodes = { ...s.nodes };
  const fid = uid();
  nodes[fid] = { id: fid, type: "folder", name: `Stress test (${count} items)`, description: "generated nodes", parentId: null, attrs: {}, children: [] };
  for (let i = 0; i < count / 100; i++) {
    const gid = uid();
    nodes[gid] = { id: gid, type: "group", name: `G-${i}`, description: `generated group ${i}`, parentId: fid, attrs: {}, children: [] };
    nodes[fid]!.children!.push(gid);
    for (let j = 0; j < 99; j++) {
      const cid = uid();
      nodes[cid] = { id: cid, type: "component", name: `9${String(i).padStart(3, "0")}${String(j).padStart(2, "0")}X`, description: `generated item ${i}.${j}`, parentId: gid, attrs: { 202: "pcs", 203: "1.000" } };
      nodes[gid]!.children!.push(cid);
    }
  }
  return { nodes, rootIds: [...s.rootIds, fid] };
}

export type Lang = "en" | "fr" | "it" | "de" | "es" | "hr" | "ro" | "ru" | "cs" | "sl" | "sk";
export type HistLabel = "hEdit" | "hAdd" | "hRemove" | "hPaste" | "hMove" | "hDuplicate" | "hAttr" | "hReplace" | "hStress";
interface HistEntry extends Snapshot { label: HistLabel }
export interface SearchOpts {
  types: NodeType[];
  scope: "title" | "all" | "attr" | "attrNum";
  attrNum: number;
  mode: "contains" | "starts" | "equals" | "regex";
  matchCase: boolean;
  errorsOnly: boolean;
}
export interface CatalogInfo { name: string; path: string; version: string; source: string; defAttr: number }
/** Pseudo attribute key for the node title. */
export const TITLE = -1;
/** Attribute row currently dragged from the property panel (native DnD payload mirror). */
export const dragAttr: { current: { fromId: string; key: number; keys?: number[]; copy?: boolean } | null } = { current: null };
/** Folder icon information row currently dragged (always copied). */
export const dragFolderIcon: { current: string | null } = { current: null };

export type InsertionPlacement = "child" | "sibling";
export interface InsertionPoint { parentId: string | null; index: number }

interface State extends Snapshot {
  insertionChoice: { targetId: string; apply: (placement: InsertionPlacement) => void } | null;
  chooseInsertion: (placement: InsertionPlacement | null) => void;
  moveOn: (id: string, targetId: string, placement?: InsertionPlacement) => void;
  selected: string[];
  anchor: string | null;
  expanded: Record<string, boolean>;
  past: HistEntry[];
  future: HistEntry[];
  dirty: boolean;
  clipboard: { ids: string[]; cut: boolean } | null;
  attrClip: { fromId: string; key: number; keys?: number[]; cut: boolean } | null;
  search: string;
  searchOpts: SearchOpts;
  lang: Lang;
  dark: boolean;
  renaming: string | null;
  view: "editor" | "manager";
  catalog: CatalogInfo;
  select: (id: string, mode?: "single" | "toggle" | "range", visible?: string[]) => void;
  toggle: (id: string) => void;
  expandAll: (v: boolean) => void;
  update: (id: string, patch: Partial<Pick<CatalogNode, "name" | "description" | "icon">>) => void;
  setAttr: (id: string, num: number, value: string | null) => void;
  applyFormulaFavorite: (id: string, formula: string, nums: number[]) => boolean;
  addFolders: (items: { name: string; description: string; icon?: string | undefined }[], icon?: string, placement?: InsertionPlacement, targetId?: string | null) => string[];
  addBatch: (type: "folder" | "group" | "component", items: { name: string; description: string; icon?: string | undefined; model?: AttributeTemplate | null }[], placement?: InsertionPlacement, targetId?: string | null) => string[];
  addNode: (type: NodeType, withoutAttributes?: boolean, placement?: InsertionPlacement, targetId?: string | null) => void;
  /** Creates a link to an ouvrage at the selection (or `at`); refuses dead or circular links. Returns the new id. */
  addLink: (groupId: string, at?: string | null) => string | null;
  /** Points an existing link to another ouvrage; refuses circular links. */
  setLinkTarget: (linkId: string, groupId: string) => boolean;
  /** Selects a node and expands its ancestors so the tree scrolls to it. */
  reveal: (id: string) => void;
  insertTemplate: (model: AttributeTemplate, targetId: string | null, placement?: InsertionPlacement) => string | null;
  importExternalAttrs: (source: ExternalCatalog, nodeIds: string[], keys: number[], toId: string) => number | null;
  importExternal: (source: ExternalCatalog, ids: string[], targetId: string | null, placement?: InsertionPlacement) => string[];
  addTemplateAttrs: (id: string, attrs: TemplateAttribute[]) => boolean;
  remove: () => void;
  copy: (cut: boolean) => void;
  paste: (placement?: InsertionPlacement, targetId?: string | null) => void;
  duplicate: () => void;
  moveSel: (dir: -1 | 1, edge?: boolean) => void;
  moveTo: (id: string, targetId: string, pos: "before" | "after" | "inside") => void;
  undo: (steps?: number) => void;
  redo: (steps?: number) => void;
  markSaved: () => void;
  load: (s: Snapshot) => void;
  setSearch: (s: string) => void;
  setSearchOpts: (o: Partial<SearchOpts>) => void;
  replaceAll: (find: string, repl: string) => number;
  setLang: (l: Lang) => void;
  setDark: (d: boolean) => void;
  setRenaming: (id: string | null) => void;
  setView: (v: "editor" | "manager") => void;
  setCatalog: (c: CatalogInfo) => void;
  setAttrClip: (c: State["attrClip"]) => void;
  transferAttr: (fromId: string, key: number, toId: string, move: boolean) => boolean;
  transferAttrs: (fromId: string, keys: number[], toId: string, move: boolean) => boolean;
  copyFolderIcon: (fromId: string, toId: string) => boolean;
  reorderAttr: (id: string, order: number[]) => void;
  stress: () => void;
}

/** Starts empty: catalogues come only from the user or the Python host, never demo data. */
const initial: Snapshot = { nodes: {}, rootIds: [] };
const initExpanded: Record<string, boolean> = {};
booted = true;

/** Hierarchy rules: folders hold only folders OR only groups (ouvrages); groups hold components and links; components/links are leaves. Root behaves like a folder. */
export function canContain(nodes: Nodes, rootIds: string[], parentId: string | null, childType: NodeType, ignore: string[] = []): boolean {
  const p = parentId ? nodes[parentId] : null;
  const ptype = p ? p.type : "folder";
  if (ptype === "component" || ptype === "link") return false;
  if (ptype === "group") return childType === "component" || childType === "link";
  if (childType !== "folder" && childType !== "group") return false;
  const kids = (p ? p.children! : rootIds).filter((c) => !ignore.includes(c) && nodes[c]);
  return kids.every((c) => nodes[c]!.type === childType);
}

/** Shared menu/drop intent; explicit edge moves keep their own positions. */
export function resolveInsertion(nodes: Nodes, rootIds: string[], targetId: string | null, types: NodeType[], placement?: InsertionPlacement, ignore: string[] = []): InsertionPoint | "choice" | null {
  if (!types.length) return null;
  const target = targetId ? nodes[targetId] : undefined;
  if (targetId && !target) return null;
  if (!target) return types.every((type) => canContain(nodes, rootIds, null, type, ignore)) ? { parentId: null, index: rootIds.length } : null;
  const child = types.every((type) => canContain(nodes, rootIds, target.id, type, ignore));
  const sibling = types.every((type) => canContain(nodes, rootIds, target.parentId, type, ignore));
  if (placement === "child") return child ? { parentId: target.id, index: 0 } : null;
  const siblings = target.parentId ? nodes[target.parentId]?.children ?? [] : rootIds;
  const beside = { parentId: target.parentId, index: siblings.indexOf(target.id) + 1 };
  if (placement === "sibling") return sibling ? beside : null;
  if (target.type === "folder" && types.every((type) => type === "folder") && child && sibling) return "choice";
  if (child) return { parentId: target.id, index: 0 };
  if (sibling) return beside;
  // Climb: e.g. a folder added on an ouvrage lands after that ouvrage's parent folder.
  if (types.every((type) => type === "folder")) for (let up = target.parentId ? nodes[target.parentId] : undefined; up; up = up.parentId ? nodes[up.parentId] : undefined) {
    if (types.every((type) => canContain(nodes, rootIds, up!.parentId, type, ignore))) {
      const list = up.parentId ? nodes[up.parentId]?.children ?? [] : rootIds;
      return { parentId: up.parentId, index: list.indexOf(up.id) + 1 };
    }
  }
  return null;
}

/** Group (ouvrage) codes must be unique across the catalog. */
export function groupNameTaken(nodes: Nodes, name: string, exceptId?: string) {
  const k = name.trim().toLowerCase();
  return Object.values(nodes).some((n) => n.type === "group" && n.id !== exceptId && n.name.trim().toLowerCase() === k);
}
function uniqueGroupName(nodes: Nodes, base: string) {
  if (!groupNameTaken(nodes, base)) return base;
  let i = 2; while (groupNameTaken(nodes, `${base} (${i})`)) i++;
  return `${base} (${i})`;
}

function siblings(s: Snapshot, parentId: string | null) {
  return parentId ? s.nodes[parentId]!.children! : s.rootIds;
}

function cloneDeep(nodes: Nodes, id: string, parentId: string | null, out: Nodes): string {
  const n = nodes[id]!;
  const nid = uid();
  out[nid] = { ...n, id: nid, parentId, attrs: { ...n.attrs }, children: n.children ? [] : undefined };
  if (n.type === "group") out[nid].name = uniqueGroupName({ ...nodes, ...out }, n.name);
  if (n.children) for (const c of n.children) out[nid].children!.push(cloneDeep(nodes, c, nid, out));
  return nid;
}

function isAncestor(nodes: Nodes, anc: string, id: string | null): boolean {
  while (id) { if (id === anc) return true; id = nodes[id]!.parentId; }
  return false;
}

/** Copy-on-write helper: nodes map + rootIds shallow-cloned, edits mutate the clones. */
function draft(s: Snapshot) {
  const nodes: Nodes = { ...s.nodes };
  const touch = (id: string) => (nodes[id] = { ...nodes[id]!, children: nodes[id]!.children ? [...nodes[id]!.children!] : undefined, attrs: { ...nodes[id]!.attrs } });
  return { nodes, rootIds: [...s.rootIds], touch };
}

export const useCatalog = create<State>((set, get) => {
  const commit = (next: Snapshot, extra: Partial<State> = {}, label: HistLabel = "hEdit") => {
    const { nodes, rootIds, past } = get();
    for (const [id, node] of Object.entries(next.nodes)) if (node !== nodes[id] && (node.type === "group" || node.type === "component")) next.nodes[id] = { ...node, attrs: completeRoomAttributes(completeFillAttributes(completeLayerAttributes(node.attrs))) };
    set({ ...next, ...extra, past: [...past.slice(-99), { nodes, rootIds, label }], future: [], dirty: true });
  };
  const detach = (d: ReturnType<typeof draft>, id: string) => {
    const p = d.nodes[id]!.parentId;
    if (p) { d.touch(p); d.nodes[p]!.children = d.nodes[p]!.children!.filter((c) => c !== id); }
    else d.rootIds = d.rootIds.filter((c) => c !== id);
  };
  const insert = (d: ReturnType<typeof draft>, id: string, parentId: string | null, index: number) => {
    d.touch(id); d.nodes[id]!.parentId = parentId;
    if (parentId) { d.touch(parentId); d.nodes[parentId]!.children!.splice(index, 0, id); }
    else d.rootIds.splice(index, 0, id);
  };
  const topLevelSel = () => {
    const { selected, nodes } = get();
    return selected.filter((id) => nodes[id] && !selected.some((o) => o !== id && isAncestor(nodes, o, nodes[id]!.parentId)));
  };

  return {
    ...initial,
    insertionChoice: null,
    chooseInsertion: (placement) => { const pending = get().insertionChoice; set({ insertionChoice: null }); if (placement && pending) pending.apply(placement); },
    moveOn: (id, targetId, placement) => {
      const state = get(); const ids = state.selected.includes(id) ? topLevelSel() : [id];
      if (ids.includes(targetId) || ids.some((mid) => isAncestor(state.nodes, mid, targetId))) return;
      const types = ids.flatMap((mid) => state.nodes[mid] ? [state.nodes[mid].type] : []);
      const point = resolveInsertion(state.nodes, state.rootIds, targetId, types, placement, ids);
      if (point === "choice") { set({ insertionChoice: { targetId, apply: (where) => { set({ selected: ids }); get().moveOn(id, targetId, where); } } }); return; }
      if (point) get().moveTo(id, targetId, point.parentId === targetId ? "inside" : "after");
    },
    selected: [],
    anchor: null,
    expanded: initExpanded,
    past: [], future: [], dirty: false, clipboard: null, attrClip: null, search: "", lang: "en", dark: false, renaming: null,
    searchOpts: { types: ["folder", "group", "component", "link"], scope: "title", attrNum: 83, mode: "contains", matchCase: false, errorsOnly: false },
    view: "editor",
    catalog: { name: "", path: "", version: "", source: "", defAttr: 0 },

    select: (id, mode = "single", visible) => {
      const { selected, anchor } = get();
      if (mode === "toggle") set({ selected: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id], anchor: id });
      else if (mode === "range" && anchor && visible) {
        const a = visible.indexOf(anchor), b = visible.indexOf(id);
        if (a < 0 || b < 0) return set({ selected: [id], anchor: id });
        set({ selected: visible.slice(Math.min(a, b), Math.max(a, b) + 1) });
      } else set({ selected: [id], anchor: id });
    },
    toggle: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
    expandAll: (v) => {
      if (!v) return set({ expanded: {} });
      const e: Record<string, boolean> = {};
      for (const n of Object.values(get().nodes)) if (n.children?.length && n.children.length < 500) e[n.id] = true;
      set({ expanded: e });
    },
    update: (id, patch) => {
      const n = get().nodes[id];
      if (n?.type === "group" && patch.name !== undefined && groupNameTaken(get().nodes, patch.name, id)) {
        showMessage(`"${patch.name}" : ${get().lang === "fr" ? "ce code d'ouvrage existe déjà" : "this group code already exists"}`); return;
      }
      const d = draft(get()); d.touch(id);
      if (n?.type === "group" && patch.name !== undefined && patch.name !== n.name) {
        for (const m of Object.values(get().nodes)) if (m.type === "link" && m.name === n.name) { d.touch(m.id); d.nodes[m.id]!.name = patch.name; }
      }
      Object.assign(d.nodes[id]!, patch);
      commit(d);
    },
    setAttr: (id, num, value) => {
      const s = get(), node = s.nodes[id];
      if (!node || (isLayerAttribute(num) && (node.type !== "group" && node.type !== "component" || value !== null && !validLayerValue(num, value)))) return;
      if (isFillAttribute(num) && (node.type !== "group" && node.type !== "component" || value !== null && !validFillValue(num, value, node.attrs))) return;
      const d = draft(s); const target = d.touch(id);
      if (num === 118 && value !== null && ["1", "2", "3", "4", "2+3"].includes(value) && target.attrs[111] !== undefined && !validFillValue(111, target.attrs[111] ?? "0", { 118: value })) target.attrs[111] = "0";
      if (value === null && isLayerAttribute(num)) {
        for (const key of LAYER_ATTRIBUTES) delete target.attrs[key];
        target.attrOrder = target.attrOrder?.filter((key) => !isLayerAttribute(key));
      } else if (value === null && isRoomAttribute(num)) {
        for (const key of ROOM_ATTRIBUTES) delete target.attrs[key];
        target.attrOrder = target.attrOrder?.filter((key) => !isRoomAttribute(key));
      } else if (value === null && num === 118) {
        for (const key of FILL_ATTRIBUTES) delete target.attrs[key];
        target.attrOrder = target.attrOrder?.filter((key) => !isFillAttribute(key));
      } else if (value === null) delete target.attrs[num]; else target.attrs[num] = value;
      commit(d);
    },
    applyFormulaFavorite: (id, formula, nums) => {
      const s = get(), node = s.nodes[id]; const keys = [...new Set(nums)];
      if (!node || (node.type !== "group" && node.type !== "component") || !formula.trim() || !keys.length || keys.some((num) => !isFormulaAttribute(num) || num === s.catalog.defAttr)) return false;
      if (keys.every((num) => node.attrs[num] === formula)) return true;
      const d = draft(s); const target = d.touch(id);
      for (const num of keys) target.attrs[num] = formula;
      target.attrOrder = [...new Set([...(node.attrOrder ?? Object.keys(node.attrs).map(Number)), ...keys])];
      commit(d, {}, "hAttr"); return true;
    },
    addTemplateAttrs: (id, attrs) => {
      const s = get(); const n = s.nodes[id];
      if (!n || (n.type !== "group" && n.type !== "component")) return false;
      const fresh = attrs.filter((a) => a.num > 0 && a.num <= 99999 && a.num !== 207 && a.num !== s.catalog.defAttr && n.attrs[a.num] === undefined);
      if (!fresh.length) return false;
      const d = draft(s); const target = d.touch(id);
      Object.assign(target.attrs, templateValues(fresh));
      if (target.type === "group" && target.attrs[207] !== undefined) target.description = target.attrs[207];
      target.attrOrder = [...new Set([...(target.attrOrder ?? Object.keys(n.attrs).map(Number)), ...fresh.map((a) => a.num)])];
      commit(d, {}, "hAttr"); return true;
    },
    importExternalAttrs: (source, nodeIds, keys, toId) => {
      const data = parseExternalCatalog(source); const s = get(); const dst = s.nodes[toId];
      const nums = [...new Set(keys)]; const ids = [...new Set(nodeIds)];
      if (!data || !dst || !ids.length || !nums.length || dst.type === "link" || nums.some((k) => !Number.isInteger(k) || (k !== TITLE && (k < 1 || k > 99999))) || ids.some((id) => !data.nodes[id]) || (dst.type === "folder" && nums.some((k) => k !== TITLE && k !== 207))) return null;
      const values = new Map<number, string>();
      for (const id of ids) { const node = data.nodes[id]; if (!node) return null; for (const key of nums) { const v = key === 207 ? node.attrs[207] ?? node.description : getField(node, key); if (v !== undefined && !values.has(key)) values.set(key, v); } }
      if (values.has(TITLE) && dst.type === "group" && groupNameTaken(s.nodes, values.get(TITLE) ?? "", toId)) return null;
      const d = draft(s); const target = d.touch(toId); let count = 0;
      for (const [key, value] of values) {
        if (key === TITLE) { if (target.name !== value) { target.name = value; count++; } }
        else if (key === 207) { if (target.description !== value) { target.description = value; if (target.type === "component") target.attrs[207] = value; count++; } }
        else if (key !== s.catalog.defAttr && target.attrs[key] === undefined) { target.attrs[key] = value; target.attrOrder = [...new Set([...(target.attrOrder ?? Object.keys(dst.attrs).map(Number)), key])]; count++; }
      }
      if (count) commit(d, {}, "hAttr"); return count;
    },
    importExternal: (source, ids, targetId, placement) => {
      const data = parseExternalCatalog(source); const s = get();
      if (!data) return [];
      const roots = externalTopLevel(data, ids); if (!roots.length) return [];
      const types = roots.flatMap((id) => data.nodes[id] ? [data.nodes[id].type] : []);
      const point = resolveInsertion(s.nodes, s.rootIds, targetId, types, placement);
      if (point === "choice" && targetId) { set({ insertionChoice: { targetId, apply: (where) => { get().importExternal(data, roots, targetId, where); } } }); return []; }
      if (!point || point === "choice") return [];
      const { parentId } = point; let index = point.index;
      const d = draft(s); const imported: string[] = [];
      const make = (sourceId: string, pid: string | null): string => {
        const sourceNode = data.nodes[sourceId]; if (!sourceNode) return "";
        const id = uid();
        d.nodes[id] = { ...sourceNode, id, parentId: pid, name: sourceNode.type === "group" ? uniqueGroupName(d.nodes, sourceNode.name) : sourceNode.name, attrs: { ...sourceNode.attrs }, attrOrder: sourceNode.attrOrder ? [...sourceNode.attrOrder] : undefined, children: sourceNode.children ? [] : undefined };
        const kids = (sourceNode.children ?? []).map((child) => make(child, id));
        const node = d.nodes[id]; if (node?.children) node.children = kids;
        return id;
      };
      for (const sourceId of roots) {
        const n = data.nodes[sourceId];
        if (!n || !canContain(d.nodes, d.rootIds, parentId, n.type)) return [];
        const id = make(sourceId, parentId);
        insert(d, id, parentId, index++);
        imported.push(id);
      }
      commit(d, { selected: imported, anchor: imported[0] ?? null, expanded: { ...s.expanded, ...(parentId ? { [parentId]: true } : {}), ...Object.fromEntries(imported.map((id) => [id, true])) } }, "hAdd");
      return imported;
    },
    insertTemplate: (model, targetId, placement) => {
      const s = get();
      const valid = (m: AttributeTemplate): boolean => (m.type === "group" || m.type === "component") && !!m.name.trim() && m.attrs.every((a) => a.num > 0 && a.num <= 99999) && (m.type === "group" ? m.children.every((c) => c.type === "component" && valid(c)) : m.children.length === 0);
      if (!valid(model)) return null;
      const point = resolveInsertion(s.nodes, s.rootIds, targetId, [model.type], placement);
      if (!point || point === "choice") return null;
      const { parentId } = point;
      const d = draft(s);
      const make = (m: AttributeTemplate, pid: string | null): string => {
        const id = uid(); const attrs = templateValues(m.attrs.filter((a) => a.num !== 207 && a.num !== s.catalog.defAttr));
        const name = m.type === "group" ? uniqueGroupName(d.nodes, m.name.trim()) : m.name.trim();
        d.nodes[id] = { id, name, type: m.type, parentId: pid, description: attrs[207] ?? "", attrs, icon: m.icon, attrOrder: m.attrs.map((a) => a.num), children: m.type === "group" ? [] : undefined };
        const kids = m.children.map((c) => make(c, id)); const n = d.nodes[id]; if (n?.children) n.children = kids;
        return id;
      };
      const id = make(model, parentId);
      insert(d, id, parentId, point.index);
      commit(d, { selected: [id], anchor: id, expanded: { ...s.expanded, ...(parentId ? { [parentId]: true } : {}), [id]: true } }, "hAdd");
      return id;
    },
    addFolders: (items, icon, placement, targetId) => get().addBatch("folder", items.map((i) => ({ ...i, icon: i.icon ?? icon })), placement, targetId),
    addBatch: (type, items, placement, targetId) => {
      const s = get(); const target = targetId === undefined ? s.selected[0] ?? null : targetId;
      if (!items.length) return [];
      const point = resolveInsertion(s.nodes, s.rootIds, target, [type], placement);
      if (point === "choice" && target) { set({ insertionChoice: { targetId: target, apply: (where) => { get().addBatch(type, items, where, target); } } }); return []; }
      if (!point || point === "choice") { showMessage(s.lang === "fr" ? "Impossible d'ajouter cet élément ici" : "This item cannot be added here"); return []; }
      const d = draft(s); const ids: string[] = [];
      const make = (m: AttributeTemplate, pid: string | null, name: string, description: string): string => {
        const id = uid(); const attrs = templateValues(m.attrs.filter((a) => a.num !== 207 && a.num !== s.catalog.defAttr));
        d.nodes[id] = { id, name: m.type === "group" ? uniqueGroupName(d.nodes, name) : name, type: m.type, parentId: pid, description, attrs, icon: m.icon, attrOrder: m.attrs.map((a) => a.num), children: m.type === "group" ? [] : undefined };
        const kids = m.children.map((c) => make(c, id, c.name.trim(), "")); const n = d.nodes[id]; if (n?.children) n.children = kids;
        return id;
      };
      items.forEach((item, i) => {
        let id: string;
        if (type === "folder") { id = uid(); d.nodes[id] = { id, type: "folder", name: item.name, description: item.description, parentId: null, attrs: {}, children: [], ...(item.icon ? { icon: item.icon } : {}) }; }
        else if (item.model && item.model.type === type) id = make(item.model, null, item.name, item.description);
        else { id = uid(); d.nodes[id] = { id, type, name: type === "group" ? uniqueGroupName(d.nodes, item.name) : item.name, description: item.description, parentId: null, attrs: {}, children: type === "group" ? [] : undefined }; }
        ids.push(id); insert(d, id, point.parentId, point.index + i);
      });
      commit(d, { selected: ids, anchor: ids[0] ?? null, expanded: point.parentId ? { ...s.expanded, [point.parentId]: true } : s.expanded }, "hAdd");
      return ids;
    },
    addNode: (type, withoutAttributes = false, placement, targetId) => {
      const s = get(); const target = targetId === undefined ? s.selected[0] ?? null : targetId;
      const point = resolveInsertion(s.nodes, s.rootIds, target, [type], placement);
      if (point === "choice" && target) { set({ insertionChoice: { targetId: target, apply: (where) => get().addNode(type, withoutAttributes, where, target) } }); return; }
      if (!point || point === "choice") { showMessage(s.lang === "fr" ? "Impossible d'ajouter cet élément ici" : "This item cannot be added here"); return; }
      const { parentId, index } = point; const d = draft(s); const id = uid();
      const name = type === "folder" ? "New folder" : type === "group" ? uniqueGroupName(s.nodes, "NEW_GROUP") : type === "link" ? "New link" : "NEW000";
      const leaf = type === "component" || type === "link";
      const defaultModel = useTemplates.getState().models.find((m) => m.id === (type === "group" ? "template-group" : type === "component" ? "template-component" : ""));
      const attrs = defaultModel && !withoutAttributes ? templateValues(defaultModel.attrs.filter((a) => a.num !== 207 && a.num !== s.catalog.defAttr)) : {};
      d.nodes[id] = { id, type, name, description: "", parentId: null, attrs, children: leaf ? undefined : [] };
      insert(d, id, parentId, index);
      commit(d, { selected: [id], anchor: id, renaming: id, expanded: parentId ? { ...s.expanded, [parentId]: true } : s.expanded }, "hAdd");
    },
    addLink: (groupId, at) => {
      const s = get(); const g = s.nodes[groupId]; const fr = s.lang === "fr";
      if (!g || g.type !== "group") return null;
      const target = at === undefined ? s.selected[0] ?? null : at;
      const point = resolveInsertion(s.nodes, s.rootIds, target, ["link"]);
      if (!point || point === "choice" || !point.parentId) { showMessage(fr ? "Sélectionnez un ouvrage ou un de ses composants pour y ajouter le lien" : "Select an ouvrage or one of its components to add the link"); return null; }
      if (wouldCycle(s.nodes, point.parentId, groupId)) { showMessage(fr ? `Lien circulaire : « ${g.name} » utilise déjà (directement ou via ses liens) l'ouvrage de destination` : `Circular link: “${g.name}” already uses the destination ouvrage (directly or through its links)`); return null; }
      const d = draft(s); const id = uid();
      d.nodes[id] = { id, type: "link", name: g.name, description: g.description, parentId: null, attrs: {} };
      insert(d, id, point.parentId, point.index);
      commit(d, { selected: [id], anchor: id, expanded: { ...s.expanded, [point.parentId]: true } }, "hAdd");
      return id;
    },
    setLinkTarget: (linkId, groupId) => {
      const s = get(); const l = s.nodes[linkId]; const g = s.nodes[groupId];
      if (!l || l.type !== "link" || !g || g.type !== "group") return false;
      if (wouldCycle(s.nodes, l.parentId, groupId)) { showMessage(s.lang === "fr" ? `Lien circulaire : « ${g.name} » revient vers l'ouvrage qui contient ce lien` : `Circular link: “${g.name}” leads back to the ouvrage containing this link`); return false; }
      const d = draft(s); d.touch(linkId); d.nodes[linkId]!.name = g.name; d.nodes[linkId]!.description = g.description;
      commit(d); return true;
    },
    reveal: (id) => {
      const s = get(); if (!s.nodes[id]) return;
      const expanded = { ...s.expanded };
      for (let p = s.nodes[id]!.parentId; p; p = s.nodes[p]?.parentId ?? null) expanded[p] = true;
      set({ expanded, selected: [id], anchor: id, view: "editor" });
    },
    remove: () => {
      const ids = topLevelSel(); if (!ids.length) return;
      const d = draft(get());
      const drop = (id: string) => { d.nodes[id]!.children?.forEach(drop); delete d.nodes[id]; };
      for (const id of ids) { detach(d, id); drop(id); }
      commit(d, { selected: [] }, "hRemove");
    },
    copy: (cut) => set({ clipboard: { ids: topLevelSel(), cut } }),
    paste: (placement, targetId) => {
      const s = get(); const cb = s.clipboard; if (!cb?.ids.length) return;
      const target = targetId === undefined ? s.selected[0] ?? null : targetId;
      const ids = cb.ids.filter((id) => !!s.nodes[id]);
      const types = ids.flatMap((id) => s.nodes[id] ? [s.nodes[id].type] : []);
      const point = resolveInsertion(s.nodes, s.rootIds, target, types, placement, cb.cut ? ids : []);
      if (point === "choice" && target) { set({ insertionChoice: { targetId: target, apply: (where) => { set({ clipboard: cb }); get().paste(where, target); } } }); return; }
      if (!point || point === "choice" || cb.cut && ids.some((id) => id === target || isAncestor(s.nodes, id, point.parentId))) return;
      const { parentId } = point; const d = draft(s); const newIds: string[] = [];
      if (cb.cut) for (const id of ids) detach(d, id);
      const targetNode = target ? d.nodes[target] : undefined;
      let index = parentId === target && target ? 0 : targetNode ? siblings(d, parentId).indexOf(targetNode.id) + 1 : siblings(d, parentId).length;
      for (const id of ids) {
        if (!canContain(d.nodes, d.rootIds, parentId, d.nodes[id]?.type ?? "link", cb.cut ? ids : [])) return;
        if (cb.cut) { insert(d, id, parentId, index++); newIds.push(id); }
        else { const extra: Nodes = {}; const nid = cloneDeep(d.nodes, id, null, extra); Object.assign(d.nodes, extra); insert(d, nid, parentId, index++); newIds.push(nid); }
      }
      if (newIds.length) commit(d, { selected: newIds, anchor: newIds[0] ?? null, clipboard: cb.cut ? null : cb, expanded: { ...s.expanded, ...(parentId ? { [parentId]: true } : {}) } }, "hPaste");
    },
    duplicate: () => {
      const ids = topLevelSel(); const d = draft(get()); const newIds: string[] = [];
      for (const id of ids) {
        const p = d.nodes[id]!.parentId; const extra: Nodes = {};
        const nid = cloneDeep(d.nodes, id, null, extra); Object.assign(d.nodes, extra);
        const sib = p ? d.nodes[p]!.children! : d.rootIds;
        insert(d, nid, p, sib.indexOf(id) + 1); newIds.push(nid);
      }
      commit(d, { selected: newIds }, "hDuplicate");
    },
    moveSel: (dir, edge = false) => {
      const s = get(); const ids = topLevelSel();
      const parents = new Set(ids.flatMap((id) => { const node = s.nodes[id]; return node ? [node.parentId] : []; }));
      const selected = new Set(ids); const d = draft(s); let changed = false;
      for (const p of parents) {
        const sib = siblings(s, p);
        const next = moveSelectionInOrder(sib, (id) => selected.has(id), dir, edge);
        if (next.every((id, i) => id === sib[i])) continue;
        const parent = p ? d.nodes[p] : undefined;
        if (parent) parent.children = next; else d.rootIds = next;
        changed = true;
      }
      if (changed) commit(d, {}, "hMove");
    },
    moveTo: (id, targetId, pos) => {
      const s = get(); const target = s.nodes[targetId]; if (!target || id === targetId || !s.nodes[id]) return;
      const ids = s.selected.includes(id) ? topLevelSel() : [id];
      const parentId = pos === "inside" ? targetId : target.parentId;
      if (ids.includes(targetId) || ids.some((mid) => isAncestor(s.nodes, mid, parentId) || !canContain(s.nodes, s.rootIds, parentId, s.nodes[mid]?.type ?? "link", ids))) return;
      const d = draft(s); for (const mid of ids) detach(d, mid);
      const sib = siblings(d, parentId); const ti = sib.indexOf(targetId);
      let index = pos === "inside" ? 0 : pos === "before" ? ti : ti + 1;
      for (const mid of ids) insert(d, mid, parentId, index++);
      if (ids.every((mid) => s.nodes[mid]?.parentId === d.nodes[mid]?.parentId) && siblings(s, parentId).every((mid, i) => mid === siblings(d, parentId)[i])) return;
      commit(d, pos === "inside" ? { expanded: { ...s.expanded, [targetId]: true } } : {}, "hMove");
    },
    undo: (steps = 1) => {
      let { past, future, nodes, rootIds } = get();
      for (let i = 0; i < steps && past.length; i++) {
        const prev = past[past.length - 1]!;
        future = [{ nodes, rootIds, label: prev.label }, ...future];
        past = past.slice(0, -1); nodes = prev.nodes; rootIds = prev.rootIds;
      }
      set({ nodes, rootIds, past, future, dirty: true });
    },
    redo: (steps = 1) => {
      let { past, future, nodes, rootIds } = get();
      for (let i = 0; i < steps && future.length; i++) {
        const next = future[0]!;
        past = [...past, { nodes, rootIds, label: next.label }];
        future = future.slice(1); nodes = next.nodes; rootIds = next.rootIds;
      }
      set({ nodes, rootIds, past, future, dirty: true });
    },
    markSaved: () => set({ dirty: false }),
    load: (snap) => set({ ...snap, insertionChoice: null, past: [], future: [], dirty: false, selected: [], expanded: {} }),
    setSearch: (search) => set({ search }),
    setSearchOpts: (o) => set((s) => ({ searchOpts: { ...s.searchOpts, ...o } })),
    replaceAll: (find, repl) => {
      const s = get(); const o = s.searchOpts; if (!find) return 0;
      let re: RegExp;
      try { re = new RegExp(o.mode === "regex" ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), o.matchCase ? "g" : "gi"); } catch { return 0; }
      const d = draft(s); let count = 0;
      const rep = (v: string) => { const nv = v.replace(re, repl); if (nv !== v) count++; return nv; };
      for (const n of Object.values(s.nodes)) {
        if (!matchNode(n, find, { ...o, errorsOnly: false })) continue;
        d.touch(n.id); const m = d.nodes[n.id]!;
        if (o.scope === "title" || o.scope === "all") {
          const nn = rep(m.name); if (m.type !== "group" || !groupNameTaken(d.nodes, nn, m.id)) m.name = nn;
          m.description = rep(m.description);
        }
        if (o.scope === "all") for (const k of Object.keys(m.attrs)) m.attrs[+k] = rep(m.attrs[+k]!);
        if (o.scope === "attr" && m.attrs[o.attrNum] !== undefined) m.attrs[o.attrNum] = rep(m.attrs[o.attrNum]!);
      }
      if (count) commit(d, {}, "hReplace");
      return count;
    },
    setLang: (lang) => set({ lang }),
    setDark: (dark) => set({ dark }),
    setRenaming: (renaming) => set({ renaming }),
    setView: (view) => set({ view }),
    setCatalog: (catalog) => set({ catalog }),
    setAttrClip: (attrClip) => set({ attrClip }),
    copyFolderIcon: (fromId, toId) => {
      const s = get(); const src = s.nodes[fromId], dst = s.nodes[toId];
      if (!src || !dst || src.type !== "folder" || dst.type !== "folder" || fromId === toId || src.icon === dst.icon) return false;
      const d = draft(s); d.touch(toId);
      const target = d.nodes[toId]; if (!target) return false;
      target.icon = src.icon;
      commit(d, {}, "hAttr");
      return true;
    },
    transferAttr: (fromId, key, toId, move) => get().transferAttrs(fromId, [key], toId, move),
    transferAttrs: (fromId, keys, toId, move) => {
      const s = get(); const src = s.nodes[fromId], dst = s.nodes[toId];
      if (!src || !dst || fromId === toId) return false;
      const unique = [...new Set(keys)];
      if (!unique.length || unique.some((key) => getField(src, key) === undefined)) return false;
      const fr = s.lang === "fr";
      if (dst.type === "link" || (dst.type === "folder" && unique.some((key) => key !== TITLE && key !== 207))) { showMessage(fr ? (dst.type === "link" ? "Un lien ne peut pas recevoir d'attributs" : "Un dossier ne reçoit que le titre et le 207") : (dst.type === "link" ? "Links cannot receive attributes" : "Folders only accept title and 207")); return false; }
      if (unique.includes(TITLE) && dst.type === "group" && groupNameTaken(s.nodes, src.name, toId)) { showMessage(fr ? "Ce code d'ouvrage existe déjà" : "This group code already exists"); return false; }
      const d = draft(s); d.touch(toId);
      const t = d.nodes[toId]; if (!t) return false;
      if (move) d.touch(fromId);
      for (const key of unique) {
        const v = getField(src, key); if (v === undefined) return false;
        if (key === TITLE) t.name = v;
        else if (key === 207 && t.type !== "component") t.description = v;
        else { t.attrs[key] = v; if (t.attrOrder && !t.attrOrder.includes(key)) t.attrOrder = [...t.attrOrder, key]; }
        const source = d.nodes[fromId];
        if (move && key !== TITLE && key !== 207 && source) {
          delete source.attrs[key];
          if (source.attrOrder) source.attrOrder = source.attrOrder.filter((k) => k !== key);
        }
      }
      commit(d, move ? { attrClip: null } : {}, "hAttr");
      return true;
    },
    reorderAttr: (id, order) => { const d = draft(get()); d.touch(id); d.nodes[id]!.attrOrder = order; commit(d, {}, "hAttr"); },
    stress: () => commit(addStress(get(), 10000), {}, "hStress"),
  };
});

/** Reads a transferable field: title, 207 (description outside components) or attribute. */
export function getField(n: CatalogNode, k: number): string | undefined {
  if (k === TITLE) return n.name;
  if (k === 207 && n.type !== "component") return n.description;
  return n.attrs[k];
}

export function makeTester(q: string, o: SearchOpts): (s: string) => boolean {
  if (o.mode === "regex") {
    try { const re = new RegExp(q, o.matchCase ? "" : "i"); return (s) => re.test(s); } catch { return () => false; }
  }
  const qq = o.matchCase ? q : q.toLowerCase();
  return (s0) => {
    const s = o.matchCase ? s0 : s0.toLowerCase();
    return o.mode === "starts" ? s.startsWith(qq) : o.mode === "equals" ? s === qq : s.includes(qq);
  };
}

/** Applies the search options to one node. */
export function matchNode(n: CatalogNode, q: string, o: SearchOpts, test = makeTester(q.trim(), o)): boolean {
  if (!o.types.includes(n.type)) return false;
  if (o.errorsOnly) {
    const f = n.attrs[267];
    if (!f || !validateFormula(f)) return false;
    if (!q.trim()) return true;
  }
  if (!q.trim()) return false;
  if (o.scope === "attrNum") return Object.keys(n.attrs).includes(q.trim());
  const texts = o.scope === "title" ? [n.name, n.description]
    : o.scope === "attr" ? [getField(n, o.attrNum) ?? ""]
    : [n.name, n.description, ...Object.values(n.attrs)];
  return texts.some(test);
}

// ---------- Import / export ----------
export function toJSON(s: Snapshot) {
  return JSON.stringify({ rootIds: s.rootIds, nodes: s.nodes }, null, 2);
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function toXML(s: Snapshot) {
  const out = (id: string, ind: string): string => {
    const n = s.nodes[id]!;
    const attrs = Object.entries(n.attrs).map(([k, v]) => `${ind}  <Attribute nr="${k}" value="${esc(v)}"/>`).join("\n");
    const kids = (n.children ?? []).map((c) => out(c, ind + "  ")).join("\n");
    return `${ind}<${n.type} name="${esc(n.name)}" description="${esc(n.description)}">\n${[attrs, kids].filter(Boolean).join("\n")}\n${ind}</${n.type}>`;
  };
  return `<?xml version="1.0" encoding="utf-8"?>\n<SmartCatalog>\n${s.rootIds.map((r) => out(r, "  ")).join("\n")}\n</SmartCatalog>`;
}

export function fromXML(xml: string): Snapshot {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const nodes: Nodes = {}; const rootIds: string[] = [];
  const walk = (el: Element, parentId: string | null) => {
    const type = el.tagName as NodeType;
    if (!["folder", "group", "component", "link"].includes(type)) return;
    const id = uid();
    const attrs: Record<number, string> = {};
    nodes[id] = { id, type, name: el.getAttribute("name") ?? "", description: el.getAttribute("description") ?? "", parentId, attrs, children: type === "component" || type === "link" ? undefined : [] };
    if (parentId) nodes[parentId]!.children!.push(id); else rootIds.push(id);
    for (const c of Array.from(el.children)) {
      if (c.tagName === "Attribute") attrs[Number(c.getAttribute("nr"))] = c.getAttribute("value") ?? "";
      else walk(c, id);
    }
  };
  for (const c of Array.from(doc.documentElement.children)) walk(c, null);
  return { nodes, rootIds };
}

export function fromJSON(txt: string): Snapshot {
  const j = JSON.parse(txt);
  return { nodes: j.nodes, rootIds: j.rootIds };
}

// ---------- Formula helpers ----------
export const FUNCTIONS = ["_IF_", "_AND_", "_OR_", "_NOT_", "_MIN_", "_MAX_", "_ROUND_", "_ABS_", "_SQRT_"];
export const VARIABLES = ["@OBJ@", "@LEN@", "@WID@", "@HGT@", "@VOL@", "@AREA@"];

export function validateFormula(f: string): { pos: number; msg: string } | null {
  let depth = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "(") depth++;
    if (f[i] === ")") { depth--; if (depth < 0) return { pos: i, msg: "Unexpected ')'" }; }
  }
  if (depth > 0) return { pos: f.length - 1, msg: "Missing ')'" };
  const ats = f.match(/@/g)?.length ?? 0;
  if (ats % 2) return { pos: f.lastIndexOf("@"), msg: "Unclosed @ token" };
  const re = /_[A-Z]+_/g; let m;
  while ((m = re.exec(f))) if (!FUNCTIONS.includes(m[0])) return { pos: m.index, msg: `Unknown function ${m[0]}` };
  const tok = /@([^@]+)@/g;
  while ((m = tok.exec(f))) {
    const t = m[1]!;
    if (/^\d+$/.test(t)) { if (!ATTRIBUTE_BY_NUMBER.has(Number(t))) return { pos: m.index, msg: `Unknown attribute @${t}@` }; }
    else if (!VARIABLES.includes(`@${t}@`)) return { pos: m.index, msg: `Unknown variable @${t}@` };
  }
  return null;
}

export function humanizeFormula(f: string) {
  return f
    .replace(/_IF_\(([^)]*)\)/g, "If ( $1 ) ")
    .replace(/_AND_/g, " And ").replace(/_OR_/g, " Or ").replace(/_NOT_/g, " Not ")
    .replace(/=703\b/g, " = Block Foundation")
    .replace(/@(\d+)@/g, (_, n) => ATTRIBUTE_BY_NUMBER.get(Number(n))?.name ?? `@${n}@`)
    .replace(/\s+/g, " ").trim();
}
