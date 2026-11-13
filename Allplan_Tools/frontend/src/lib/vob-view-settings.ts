import { create } from "zustand";
import { VOB_COLUMNS, DEFAULT_VOB_GROUP, type VobColumn } from "./vob-view";

/** Personal VOB Editor presentation (columns, widths, grouping, splitter); saved via app-settings. */
export type VobViewSettings = { order: VobColumn[]; visible: VobColumn[]; widths: Partial<Record<VobColumn, number>>; groupBy: VobColumn; split: number; /** Header editor height in VOB & resources (px). */ headerHeight: number };
type Store = VobViewSettings & { set: (patch: Partial<VobViewSettings>) => void; moveColumn: (source: VobColumn, target: VobColumn, after: boolean) => void };
export const defaultVobViewSettings = (): VobViewSettings => ({ order: [...VOB_COLUMNS], visible: [...VOB_COLUMNS], widths: {}, groupBy: DEFAULT_VOB_GROUP, split: 58, headerHeight: 168 });
export const useVobViewSettings = create<Store>((set) => ({ ...defaultVobViewSettings(), set: (patch) => set(patch), moveColumn: (source, target, after) => set((state) => {
  if (source === target || !state.order.includes(source) || !state.order.includes(target)) return state;
  const order = state.order.filter((key) => key !== source);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, source);
  return { order };
}) }));

const isCol = (v: unknown): v is VobColumn => VOB_COLUMNS.includes(v as VobColumn);
export const vobViewSettings = (): VobViewSettings => { const { order, visible, widths, groupBy, split, headerHeight } = useVobViewSettings.getState(); return { order, visible, widths, groupBy, split, headerHeight }; };
export function applyVobViewSettings(input: unknown) {
  if (!input || typeof input !== "object") return;
  const d = input as { order?: unknown; visible?: unknown; widths?: unknown; groupBy?: unknown; split?: unknown; headerHeight?: unknown }, patch: Partial<VobViewSettings> = {};
  if (Array.isArray(d.order)) {
    const order = [...new Set(d.order.filter(isCol))];
    patch.order = [...order, ...VOB_COLUMNS.filter((key) => !order.includes(key))];
  }
  if (Array.isArray(d.visible)) { const v = [...new Set(d.visible.filter(isCol))]; if (v.length) patch.visible = v; }
  if (d.widths && typeof d.widths === "object") patch.widths = Object.fromEntries(Object.entries(d.widths).filter(([k, w]) => isCol(k) && typeof w === "number" && w >= 30 && w <= 2000));
  if (isCol(d.groupBy)) patch.groupBy = d.groupBy;
  if (typeof d.split === "number" && d.split >= 25 && d.split <= 80) patch.split = d.split;
  if (typeof d.headerHeight === "number" && d.headerHeight >= 64 && d.headerHeight <= 2000) patch.headerHeight = Math.round(d.headerHeight);
  useVobViewSettings.getState().set(patch);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("vob-settings-loaded"));
}
