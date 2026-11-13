import { create } from "zustand";

export type VobRule = { id: string; trade: string; object: string; unit: string; method: string; formula: string; comment: string; /** false = line written with a leading "//" (disabled) */ enabled?: boolean };
export type VobFile = { id: string; name: string; path: string; version?: string; source?: string; projectName?: string; projectPath?: string };
type Snapshot = { rules: VobRule[]; selected: string | null; selectedIds: string[]; header?: string[] };
type VobState = Snapshot & {
  /** File header comment lines, stored without the leading "//"; outside undo history. */
  header: string[]; savedHeader: string[]; /** Undoable; consecutive typing within 1 s merges into one history entry. */ setHeader: (lines: string[], options?: { typing?: boolean }) => void; toggleEnabled: (ids: string[]) => void;
  open: boolean; saved: VobRule[]; past: Snapshot[]; future: Snapshot[];
  file: VobFile | null; load: (rules: VobRule[], file: VobFile | null, header?: string[]) => void; markSaved: (file: VobFile | null) => void;
  files: VobFile[]; setFiles: (files: VobFile[]) => void;
  setOpen: (open: boolean) => void;
  select: (id: string, options?: { toggle?: boolean; range?: boolean; order?: string[] }) => void;
  selectMany: (ids: string[]) => void;
  updateMany: (ids: string[], patch: Partial<Omit<VobRule, "id">>) => void;
  add: () => void; duplicate: (id?: string) => void; update: (id: string, patch: Partial<Omit<VobRule, "id">>) => void;
  clipboard: Omit<VobRule, "id">[]; copy: (ids?: string[]) => void; paste: () => void; revert: (ids: string[]) => void;
  remove: (all?: boolean) => void; removeMany: (ids: string[]) => void; undo: () => void; redo: () => void; saveSession: () => void;
};
const snapshot = (s: Snapshot): Snapshot => ({ rules: s.rules, selected: s.selected, selectedIds: s.selectedIds, header: s.header ?? [] });
export const selectedVobIds = (s: Pick<Snapshot, "selected" | "selectedIds">) => s.selectedIds.length ? s.selectedIds : s.selected ? [s.selected] : [];
export function commonVobValues(rules: VobRule[]) {
  const first = rules[0];
  if (!first) return null;
  const mixed = new Set<keyof Omit<VobRule, "id">>();
  for (const key of ["trade", "object", "unit", "method", "formula", "comment"] as const) {
    if (rules.some((rule) => rule[key] !== first[key])) mixed.add(key);
  }
  return { rule: first, mixed };
}
export const useVobEditor = create<VobState>((set, get) => {
  let headerAt = 0;
  const commit = (next: Snapshot) => { headerAt = 0; set((s) => ({ ...next, header: next.header ?? s.header, past: [...s.past, snapshot(s)].slice(-100), future: [] })); };
  return {
    open: false, rules: [], selected: null, selectedIds: [], saved: [], past: [], future: [],
    setOpen: (open) => set({ open }),
    file: null,
    header: [], savedHeader: [], setHeader: (header, options = {}) => {
      const s = get(); if (JSON.stringify(header) === JSON.stringify(s.header)) return;
      const now = Date.now(); const merge = options.typing && headerAt && now - headerAt < 1000 && s.past.length;
      if (merge) set({ header, future: [] }); else commit({ ...snapshot(s), header });
      headerAt = options.typing ? now : 0;
    },
    toggleEnabled: (ids) => { const s = get(); const t = s.rules.filter((r) => ids.includes(r.id)); if (!t.length) return; const enabled = t.every((r) => r.enabled === false); get().updateMany(ids, { enabled }); },
    load: (rules, file, header = []) => set({ rules, saved: rules, header, savedHeader: header, file, selected: rules[0]?.id ?? null, selectedIds: rules[0] ? [rules[0].id] : [], past: [], future: [] }),
    markSaved: (file) => set({ saved: get().rules, savedHeader: get().header, file }),
    files: [], setFiles: (files) => set({ files }),
    select: (id, options = {}) => {
      const s = get(); if (!s.rules.some((r) => r.id === id)) return;
      const ids = selectedVobIds(s), order = options.order ?? s.rules.map((r) => r.id);
      const anchor = order.indexOf(s.selected ?? id), end = order.indexOf(id);
      if (options.range && anchor >= 0 && end >= 0) {
        const range = order.slice(Math.min(anchor, end), Math.max(anchor, end) + 1);
        set({ selectedIds: options.toggle ? [...new Set([...ids, ...range])] : range });
      } else {
        const next = options.toggle ? ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id] : [id];
        set({ selected: next.includes(id) ? id : next[0] ?? null, selectedIds: next });
      }
    },
    selectMany: (ids) => set({ selectedIds: ids, selected: ids[0] ?? null }),
    add: () => {
      const s = get(); const id = crypto.randomUUID();
      commit({ rules: [...s.rules, { id, trade: "", object: "", unit: "", method: "", formula: "", comment: "" }], selected: id, selectedIds: [id] });
    },
    duplicate: (targetId) => {
      const s = get(); const targets = new Set(targetId ? [targetId] : selectedVobIds(s));
      const copies: VobRule[] = [];
      const rules = s.rules.flatMap((rule) => {
        if (!targets.has(rule.id)) return [rule];
        const copy = { ...rule, id: crypto.randomUUID() }; copies.push(copy);
        return [rule, copy];
      });
      const first = copies[0]; if (!first) return;
      commit({ ...snapshot(s), rules, selected: first.id, selectedIds: copies.map((rule) => rule.id) });
    },
    // Clipboard lives outside file sessions so rules can be pasted into another file.
    clipboard: [],
    copy: (targetIds) => { const s = get(); const ids = new Set(targetIds ?? selectedVobIds(s)); const rules = s.rules.filter((r) => ids.has(r.id)).map(({ id: _id, ...rest }) => rest); if (rules.length) set({ clipboard: rules }); },
    paste: () => {
      const s = get(); if (!s.clipboard.length) return;
      const ids = selectedVobIds(s); const last = Math.max(-1, ...ids.map((id) => s.rules.findIndex((r) => r.id === id)));
      const added = s.clipboard.map((r) => ({ ...r, id: crypto.randomUUID() })); const rules = [...s.rules];
      rules.splice(last < 0 ? rules.length : last + 1, 0, ...added);
      commit({ rules, selected: added[0]!.id, selectedIds: added.map((r) => r.id) });
    },
    /** Restores selected rules to their values from the last load/save; rules absent from it are untouched. */
    revert: (ids) => {
      const s = get(); const saved = new Map(s.saved.map((r) => [r.id, r]));
      if (!s.rules.some((r) => ids.includes(r.id) && saved.has(r.id) && JSON.stringify(saved.get(r.id)) !== JSON.stringify(r))) return;
      commit({ ...snapshot(s), rules: s.rules.map((r) => ids.includes(r.id) && saved.has(r.id) ? saved.get(r.id)! : r) });
    },
    update: (id, patch) => {
      get().updateMany([id], patch);
    },
    updateMany: (ids, patch) => {
      const s = get(); const targets = new Set(ids);
      if (!s.rules.some((r) => targets.has(r.id) && Object.entries(patch).some(([key, value]) => r[key as keyof VobRule] !== value))) return;
      commit({ ...snapshot(s), rules: s.rules.map((r) => targets.has(r.id) ? { ...r, ...patch } : r) });
    },
    remove: (all = false) => {
      const s = get(); if (!s.rules.length || (!all && !s.selected)) return;
      const ids = selectedVobIds(s);
      const rules = all ? [] : s.rules.filter((r) => !ids.includes(r.id));
      const selected = rules[0]?.id ?? null;
      commit({ rules, selected, selectedIds: selected ? [selected] : [] });
    },
    removeMany: (ids) => {
      const s = get(); const rules = s.rules.filter((r) => !ids.includes(r.id)); if (rules.length === s.rules.length) return;
      const keep = selectedVobIds(s).filter((id) => rules.some((r) => r.id === id));
      commit({ rules, selected: keep[0] ?? null, selectedIds: keep });
    },
    undo: () => { const s = get(); const previous = s.past.at(-1); headerAt = 0; if (previous) set({ ...previous, header: previous.header ?? s.header, past: s.past.slice(0, -1), future: [snapshot(s), ...s.future] }); },
    redo: () => { const s = get(); const next = s.future[0]; headerAt = 0; if (next) set({ ...next, header: next.header ?? s.header, past: [...s.past, snapshot(s)], future: s.future.slice(1) }); },
    saveSession: () => set({ saved: get().rules, savedHeader: get().header }),
  };
});
export const vobHasChanges = (s: Pick<VobState, "rules" | "saved"> & Partial<Pick<VobState, "header" | "savedHeader">>) => JSON.stringify(s.rules) !== JSON.stringify(s.saved) || JSON.stringify(s.header ?? []) !== JSON.stringify(s.savedHeader ?? []);
/** Strips the leading "//" (and one space) that Python adds back when writing. */
export const stripVobComment = (line: string) => line.replace(/^\s*\/\/\s?/, "");