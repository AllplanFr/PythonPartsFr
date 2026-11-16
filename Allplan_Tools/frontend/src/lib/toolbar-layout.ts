import { create } from "zustand";

export type MenuGroup = { id: string; label: string; title?: string; color: string; buttons: string[] };
export type MenuLayout = { groups: MenuGroup[]; showTitles: boolean };
export const defaultMenuLayout = (groups: MenuGroup[]): MenuLayout => ({ groups, showTitles: true });
export const menuColors = ["brand", "blue", "green", "orange", "yellow"] as const;

export function moveMenuItem(layout: MenuLayout, source: { group: string; button?: string }, target?: { group: string; button?: string }): MenuLayout {
  if (source.group === target?.group && source.button === target?.button) return layout;
  const groups = layout.groups.map((g) => ({ ...g, buttons: [...g.buttons] }));
  const from = groups.find((g) => g.id === source.group);
  if (!from) return layout;
  if (source.button) {
    if (!from.buttons.includes(source.button)) return layout;
    from.buttons = from.buttons.filter((b) => b !== source.button);
    const to = target ? groups.find((g) => g.id === target.group) : undefined;
    if (to) {
      const index = target?.button ? to.buttons.indexOf(target.button) : -1;
      to.buttons.splice(index < 0 ? to.buttons.length : index, 0, source.button);
    } else groups.push({ id: crypto.randomUUID(), label: "menuNewGroup", color: from.color, buttons: [source.button] });
  } else {
    groups.splice(groups.indexOf(from), 1);
    const index = target ? groups.findIndex((g) => g.id === target.group) : -1;
    groups.splice(index < 0 ? groups.length : index, 0, from);
  }
  return { ...layout, groups: groups.filter((g) => g.buttons.length > 0) };
}

export const useToolbarLayouts = create<{
  layouts: Record<string, MenuLayout>;
  set: (id: string, layout: MenuLayout) => void;
  /** Locks every main menu layout; unchecked by default, persisted by the PythonPart settings. */
  frozen: boolean;
  setFrozen: (frozen: boolean) => void;
}>((set) => ({ layouts: {}, frozen: false, setFrozen: (frozen) => set({ frozen }), set: (id, layout) => set((s) => ({ layouts: { ...s.layouts, [id]: layout } })) }));

/** Settings exchanged with the PythonPart (save on change, load from received settings). */
export const toolbarSettings = () => ({ frozen: useToolbarLayouts.getState().frozen, layouts: useToolbarLayouts.getState().layouts });
export function applyToolbarSettings(input: unknown) {
  if (!input || typeof input !== "object") return;
  const d = input as { frozen?: unknown; layouts?: unknown };
  useToolbarLayouts.setState({ ...(typeof d.frozen === "boolean" ? { frozen: d.frozen } : {}), ...(d.layouts && typeof d.layouts === "object" ? { layouts: d.layouts as Record<string, MenuLayout> } : {}) });
}
/** Validates an imported menu organisation; returns null when the file is not a menu layout. */
export function parseMenuLayout(input: unknown): MenuLayout | null {
  const d = input as { kind?: unknown; layout?: { groups?: unknown; showTitles?: unknown } } | null;
  const groups = d?.layout?.groups;
  if (d?.kind !== "smartcatalog-menu" || !Array.isArray(groups)) return null;
  const valid = groups.filter((g): g is MenuGroup => !!g && typeof g.id === "string" && typeof g.label === "string" && typeof g.color === "string" && Array.isArray(g.buttons) && g.buttons.every((b: unknown) => typeof b === "string"));
  if (valid.length !== groups.length) return null;
  return { groups: valid.map((g) => ({ id: g.id, label: g.label, color: g.color, buttons: [...g.buttons], ...(typeof g.title === "string" ? { title: g.title } : {}) })), showTitles: d.layout!.showTitles !== false };
}
export const serializeMenuLayout = (id: string, layout: MenuLayout) => JSON.stringify({ kind: "smartcatalog-menu", version: 1, toolbar: id, layout }, null, 2);
