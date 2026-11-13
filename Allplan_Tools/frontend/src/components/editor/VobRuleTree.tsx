import { normalizeVobIndex } from "@/lib/vob-references";
import { vobArtwork } from "@/lib/vob-artwork";
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { VobRowHover } from "./VobRowHover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChoiceCombo } from "./ChoiceCombo";
import { fitVobColumns, groupVobRules, type VobColumn } from "@/lib/vob-view";
import type { VobRule } from "@/lib/vob-editor";

export const VOB_COLUMN_WIDTHS: Record<VobColumn, number> = { trade: 130, object: 170, unit: 70, method: 130, formula: 260, comment: 200 };
type Option = { value: string; label: string; index?: string };

/** Single-column grouping tree; indentation matches the catalog tree. */
export function VobRuleTree({ rows, groupBy, columns, visible, widths, savedWidths = {}, onResize, onMoveColumn, columnMoveHint, closed, onToggle, selected, onSelect, display, displayIndex, unset, choices, onUpdate, onToggleEnabled, enableLabel, onCopy, onDuplicate, copyLabel, duplicateLabel, onSelectGroup, onRemove, onSetEnabled, removeLabel, groupLabels, actions = true }: { rows: VobRule[]; groupBy: VobColumn; columns: [VobColumn, string][]; visible: VobColumn[]; widths: Record<VobColumn, number>; savedWidths?: Partial<Record<VobColumn, number>>; onResize: (key: VobColumn, width: number) => void; onMoveColumn?: (source: VobColumn, target: VobColumn, after: boolean) => void; columnMoveHint?: string; closed: Set<string>; onToggle: (value: string) => void; selected: string[]; onSelect: (id: string, event?: React.MouseEvent | React.KeyboardEvent) => void; display: (r: VobRule, key: VobColumn) => string; displayIndex?: (r: VobRule, key: VobColumn) => string; unset: string; choices?: Partial<Record<VobColumn, Option[]>>; onUpdate?: (id: string, patch: Partial<Omit<VobRule, "id">>) => void; onCopy?: (id: string) => void; onDuplicate?: (id: string) => void; copyLabel?: string; duplicateLabel?: string; onToggleEnabled?: (id: string) => void; enableLabel?: (enabled: boolean) => string; onSelectGroup?: (ids: string[], checked: boolean) => void; onRemove?: (ids: string[], group: boolean) => void; onSetEnabled?: (ids: string[], enabled: boolean) => void; removeLabel?: string; groupLabels?: { enable: string; disable: string; remove: string }; actions?: boolean }) {
  const [editing, setEditing] = useState<{ id: string; key: VobColumn; draft: string } | null>(null);
  // Automatic widths are presentation-only; only explicit user choices enter settings.
  const [autoWidths, setAutoWidths] = useState<Partial<Record<VobColumn, number>>>({});
  const effectiveWidths = { ...widths, ...autoWidths, ...savedWidths };
  const cancelMove = useRef<(() => void) | null>(null);
  const [drop, setDrop] = useState<{ key: VobColumn; after: boolean } | null>(null);
  const cols = columns.filter(([key]) => visible.includes(key));
  const grid = { gridTemplateColumns: cols.map(([key]) => `${effectiveWidths[key]}px`).join(" ") };
  const title = columns.find(([key]) => key === groupBy)?.[1] ?? "";
  const resize = (key: VobColumn) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation(); const x = e.clientX, w = effectiveWidths[key];
    const move = (ev: PointerEvent) => onResize(key, Math.max(50, w + ev.clientX - x));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
  };
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => () => cancelMove.current?.(), []);
  const moveColumn = (key: VobColumn) => (e: React.PointerEvent) => {
    if (!onMoveColumn || e.button !== 0 || (e.target instanceof Element && e.target.closest('[role="separator"]'))) return;
    e.preventDefault();
    cancelMove.current?.();
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    let destination: { key: VobColumn; after: boolean } | null = null;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      moved = true;
      const header = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-vob-header]');
      const target = cols.find(([column]) => column === header?.dataset["vobHeader"])?.[0];
      if (!header || !target || target === key || !rootRef.current?.contains(header)) { destination = null; setDrop(null); return; }
      const box = header.getBoundingClientRect();
      destination = { key: target, after: ev.clientX > box.left + box.width / 2 };
      setDrop(destination);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      cancelMove.current = null; setDrop(null);
    };
    const finish = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      move(ev);
      if (moved && destination) onMoveColumn(key, destination.key, destination.after);
      cancel();
    };
    cancelMove.current = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
  };
  const natural = (key: VobColumn, index: number, target: HTMLElement) => {
    const context = document.createElement("canvas").getContext("2d"); if (!context) return 50;
    const cell = target.closest('[role="tree"]')?.querySelector<HTMLElement>(`[data-vob-column="${key}"]`);
    const style = getComputedStyle(cell?.querySelector("span") ?? cell ?? target);
    context.font = `${style.fontWeight || "400"} ${style.fontSize || "13px"} ${style.fontFamily}`;
    const nameWidths = rows.map((r) => context.measureText(display(r, key) || unset).width);
    context.font = `400 10px ${style.fontFamily}`;
    const textWidth = Math.max(0, ...rows.map((r, i) => (nameWidths[i] ?? 0) + (displayIndex?.(r, key) ? context.measureText(displayIndex(r, key)).width + 6 : 0)));
    context.font = `600 12px ${getComputedStyle(target).fontFamily}`;
    const headingWidth = context.measureText(columns.find(([c]) => c === key)?.[1] ?? "").width;
    return Math.ceil(Math.max(textWidth + (index === 0 ? 84 : 28), headingWidth + (index === 0 ? 54 : 24), 50));
  };
  const fit = (key: VobColumn, index: number, target: HTMLElement) => onResize(key, natural(key, index, target));
  const visibleKey = cols.map(([k]) => k).join();
  const measurementKey = JSON.stringify(rows.map((r) => cols.map(([key]) => [display(r, key), displayIndex?.(r, key)])));
  const savedWidthKey = JSON.stringify(savedWidths);
  useLayoutEffect(() => {
    const root = rootRef.current; if (!root) return;
    const refit = () => {
      const available = (root.parentElement?.clientWidth ?? root.clientWidth) - 2;
      const widthsFit = fitVobColumns(cols.map(([key], i) => savedWidths[key] ?? natural(key, i, root)), available, 50, cols.map(([key]) => savedWidths[key] !== undefined));
      setAutoWidths(Object.fromEntries(cols.map(([key], i) => [key, widthsFit[i] ?? 50])));
    };
    let active = true;
    refit(); setFitted(true);
    let frame = requestAnimationFrame(refit);
    const schedule = () => { if (!active) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(refit); };
    const observer = new ResizeObserver(schedule); if (root.parentElement) observer.observe(root.parentElement);
    window.addEventListener("vob-settings-loaded", schedule);
    document.fonts?.ready.then(schedule);
    return () => { active = false; cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("vob-settings-loaded", schedule); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, measurementKey, savedWidthKey]);
  const [fitted, setFitted] = useState(false);
  const commit = () => { if (editing) onUpdate?.(editing.id, { [editing.key]: editing.draft }); setEditing(null); };
  let n = 0;
  return <div ref={rootRef} role="tree" aria-label={title} aria-multiselectable="true" className="min-w-fit" style={fitted ? undefined : { visibility: "hidden" }}>
    <div className="catalog-panel-heading !sticky top-0 z-10 grid h-8 items-center border-b border-border text-xs font-semibold" style={grid}>{cols.map(([key, name], i) => <div key={key} data-vob-header={key} onPointerDown={moveColumn(key)} className={`relative h-full min-w-0 touch-none select-none cursor-grab px-2 leading-8 active:cursor-grabbing ${i ? "border-l border-border/60" : "pl-[42px]"}`}>
      <Button variant="ghost" aria-label={name} title={columnMoveHint} onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        e.preventDefault(); const target = cols[i + (e.key === "ArrowLeft" ? -1 : 1)];
        if (target) onMoveColumn?.(key, target[0], e.key === "ArrowRight");
      }} className="h-full w-full min-w-0 cursor-grab justify-start rounded-none px-0 text-xs font-semibold active:cursor-grabbing"><span className="truncate">{name}</span></Button>
      {drop?.key === key && <span className={`pointer-events-none absolute inset-y-0 z-20 border-l-2 border-dashed border-drop-preview-border ${drop.after ? "right-0" : "left-0"}`} />}
      <span role="separator" aria-orientation="vertical" aria-label={name} onPointerDown={resize(key)} onDoubleClick={(e) => fit(key, i, e.currentTarget)} className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/40" />
    </div>)}</div>
    {groupVobRules(rows, groupBy, display).map((group) => {
      const first = group.rules[0];
      const label = first ? display(first, groupBy) : unset;
      const expanded = !closed.has(group.value); n++;
      const categoryHue = ([...`${groupBy}:${group.value}`].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) * 137.508) % 360;
      const groupSelected = group.rules.every((r) => selected.includes(r.id));
      return <div key={group.value} role="treeitem" aria-label={label} aria-expanded={expanded} className="vob-category" style={{ "--vob-category-hue": categoryHue } as React.CSSProperties}>
        <div role="button" tabIndex={0} data-selected={groupSelected || undefined} style={{ "--vob-category-hue": categoryHue } as React.CSSProperties} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(group.value); } }} className="vob-category-row sticky top-8 z-[5] flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-none border-b border-border/60 pl-1 pr-3 text-[13px]" onClick={() => onToggle(group.value)}>
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}{onSelectGroup && (() => { const ids = group.rules.map((r) => r.id); const count = ids.filter((id) => selected.includes(id)).length; return <input type="checkbox" aria-label={label} checked={count === ids.length} ref={(el) => { if (el) el.indeterminate = count > 0 && count < ids.length; }} onClick={(e) => e.stopPropagation()} onChange={(e) => onSelectGroup(ids, e.target.checked)} className="shrink-0" />; })()}<span className="min-w-0 flex-1 truncate text-center font-bold" title={`${label}${first && displayIndex?.(first, groupBy) ? ` · ${displayIndex(first, groupBy)}` : ""}`}>{label}</span>{first && displayIndex?.(first, groupBy) && <span className="shrink-0 text-[10px] tabular-nums">{displayIndex(first, groupBy)}</span>}{actions && <span className="shrink-0 text-[10px] font-normal tabular-nums">{group.rules.length}</span>}
        </div>
        {expanded && <div role="group">{group.rules.map((r) => { const a = n++ % 2; return <VobRowHover key={r.id} summary={columns.map(([c, label]) => `${label} : ${display(r, c) || "—"}${displayIndex?.(r, c) ? ` · ${displayIndex(r, c)}` : ""}`).concat(r.enabled === false ? ["// (désactivée / disabled)"] : []).join("\n")} enabled={r.enabled !== false} onCopy={actions && onCopy ? () => onCopy(r.id) : undefined} onDuplicate={actions && onDuplicate ? () => onDuplicate(r.id) : undefined} copyLabel={copyLabel} duplicateLabel={duplicateLabel} removeLabel={removeLabel} enableLabel={enableLabel?.(r.enabled !== false)} onRemove={actions && onRemove ? () => onRemove([r.id], false) : undefined} onToggle={actions && onToggleEnabled ? () => onToggleEnabled(r.id) : undefined}><div role="treeitem" data-vob-rule-id={r.id} tabIndex={0} aria-selected={selected.includes(r.id)} aria-disabled={r.enabled === false || undefined} data-vob-disabled={r.enabled === false || undefined} onClick={(e) => { if (e.target instanceof Element && e.target.closest('input,button,textarea')) return; if (!selected.includes(r.id) || e.ctrlKey || e.metaKey || e.shiftKey) onSelect(r.id, e); }} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(r.id, e); } }} className={`vob-rule-row group/vobrow relative grid ${cols.some(([c]) => c === "comment") ? "min-h-8" : "h-8"} w-full cursor-default items-center border-b border-border/60 text-[13px] ${r.enabled === false ? "text-muted-foreground [&_span]:line-through" : ""} ${selected.includes(r.id) ? "catalog-selected-row bg-selection" : a ? "bg-row-alt" : "bg-background"}`} style={grid}>
          {cols.map(([key, name], i) => <div key={key} data-vob-column={key} title={actions || (editing?.id === r.id && editing.key === key) ? undefined : columns.map(([c, label]) => `${label} : ${display(r, c) || "—"}${displayIndex?.(r, c) ? ` · ${displayIndex(r, c)}` : ""}`).concat(r.enabled === false ? ["// (désactivée / disabled)"] : []).join("\n")} onDoubleClick={() => { if (onUpdate) { if (!selected.includes(r.id)) onSelect(r.id); setEditing({ id: r.id, key, draft: r[key] }); } }} className={`relative flex min-w-0 items-center gap-1.5 px-2 ${i === 0 ? "pl-5" : ""} ${key === "formula" ? "font-mono text-[11px]" : ""} ${key === "comment" ? "text-muted-foreground py-1" : ""}`}>
            {i === 0 && <><span className="w-3.5 shrink-0" /><img src={vobArtwork.rule} alt="" draggable={false} className="h-4 w-4 shrink-0" /></>}
            {editing?.id === r.id && editing.key === key ? choices?.[key] ? <ChoiceCombo normalizeValue={normalizeVobIndex} label={name} value={r[key]} options={choices[key] ?? []} className="w-full" onChange={(value) => { onUpdate?.(r.id, { [key]: value }); setEditing(null); }} /> : <Input autoFocus aria-label={name} value={editing.draft} className="h-7 min-w-0 text-xs" onChange={(e) => setEditing({ ...editing, draft: e.target.value })} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(null); }} /> : <><span className={key === "comment" ? "min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "min-w-0 truncate"}>{display(r, key) || (r[key] === "-1" && key !== "formula" && key !== "comment" ? "" : <span className="text-muted-foreground">—</span>)}</span>{displayIndex?.(r, key) && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{displayIndex(r, key)}</span>}</>}
          </div>)}
        </div></VobRowHover>; })}</div>}
      </div>;
    })}
  </div>;
}
