import { isInteractiveField } from "@/lib/toolbar-drag-guard";
import { useState, type ReactNode, type DragEvent } from "react";
import { Download, GripVertical, Plus, Settings2, Upload } from "lucide-react";
import { showMessage } from "@/lib/app-dialog";

const isCustom = (color: string) => color.startsWith("#");
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT, type TKey } from "@/lib/i18n";
import { defaultMenuLayout, menuColors, moveMenuItem, parseMenuLayout, serializeMenuLayout, useToolbarLayouts, type MenuGroup } from "@/lib/toolbar-layout";

export function CustomToolbar({ id, initial, buttons, className = "", layoutLabels }: { layoutLabels?: { importLayout: string; exportLayout: string }; className?: string; id: string; initial: MenuGroup[]; buttons: Record<string, ReactNode> }) {
  const t = useT();
  const stored = useToolbarLayouts((s) => s.layouts[id]);
  const save = useToolbarLayouts((s) => s.set);
  const frozen = useToolbarLayouts((s) => s.frozen);
  const setFrozen = useToolbarLayouts((s) => s.setFrozen);
  const fr = useT()("cancel") === "Annuler";
  const baseLayout = stored ?? defaultMenuLayout(initial);
  const groups = baseLayout.groups.map((g) => ({ ...g, buttons: g.buttons.filter((button) => buttons[button] !== undefined) })).filter((g) => g.buttons.length > 0);
  const known = new Set(groups.flatMap((g) => g.buttons));
  for (const g of initial) {
    const missing = g.buttons.filter((button) => !known.has(button) && buttons[button] !== undefined);
    if (!missing.length) continue;
    const existing = groups.find((group) => group.id === g.id);
    if (existing) existing.buttons.push(...missing); else groups.push({ ...g, buttons: missing });
  }
  const layout = { ...baseLayout, groups };
  const [dragging, setDragging] = useState<{ group: string; button?: string } | null>(null);
  const [insertion, setInsertion] = useState<{ group: string; before: string | null } | null>(null);
  const [groupInsertion, setGroupInsertion] = useState<string | null | undefined>(undefined);
  const [groupWidth, setGroupWidth] = useState(0);
  const [buttonWidth, setButtonWidth] = useState(36);
  const [editing, setEditing] = useState<string | null>(null);
  // A press in a search/text field selects text; it never arms a toolbar drag.
  const [fieldPress, setFieldPress] = useState(false);
  const start = (e: DragEvent, group: string, button?: string) => {
    e.stopPropagation(); e.dataTransfer.setData("application/x-smartcatalog-menu", id); e.dataTransfer.effectAllowed = "move";
    setDragging(button ? { group, button } : { group });
    setGroupInsertion(undefined);
    if (!button) setGroupWidth(e.currentTarget.getBoundingClientRect().width);
    else setButtonWidth(e.currentTarget.getBoundingClientRect().width);
  };
  const drop = (e: DragEvent, group?: string, button?: string) => {
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation();
    const before = insertion && insertion.group === group ? insertion.before : button;
    const targetGroup = !dragging.button && groupInsertion !== undefined ? groupInsertion : group;
    save(id, moveMenuItem(layout, dragging, targetGroup ? (dragging.button && before ? { group: targetGroup, button: before } : { group: targetGroup }) : undefined));
    setDragging(null); setInsertion(null); setGroupInsertion(undefined);
  };
  const previewGroups = (e: DragEvent<HTMLDivElement>) => {
    if (!dragging || dragging.button) return;
    e.preventDefault(); e.stopPropagation();
    const toolbar = e.currentTarget.closest<HTMLElement>("[data-toolbar]");
    if (!toolbar) return;
    const next = Array.from(toolbar.querySelectorAll<HTMLElement>("[data-menu-block]")).find((item) => {
      if (item.dataset['menuBlock'] === dragging.group) return false;
      const rect = item.getBoundingClientRect();
      return e.clientY < rect.top || (e.clientY <= rect.bottom && e.clientX < rect.left + rect.width / 2);
    });
    setGroupInsertion(next?.dataset['menuBlock'] ?? null);
  };
  const preview = (e: DragEvent<HTMLDivElement>, group: string) => {
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation();
    if (!dragging.button) { previewGroups(e); return; }
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-menu-button]"));
    const next = items.find((item) => {
      if (item.dataset['menuButton'] === dragging.button) return false;
      const rect = item.getBoundingClientRect();
      return e.clientX < rect.left + rect.width / 2;
    });
    setInsertion({ group, before: next?.dataset['menuButton'] ?? null });
  };
  const patch = (group: string, values: Partial<MenuGroup>) => save(id, { ...layout, groups: layout.groups.map((g) => g.id === group ? { ...g, ...values } : g) });
  const settings = (
      <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" title={t("menuSettings")} aria-label={t("menuSettings")} className="mt-1 h-9 w-7 shrink-0 text-muted-foreground"><Settings2 className="h-4 w-4" /></Button></PopoverTrigger>
        <PopoverContent align="end" className="toolbar-settings w-60 space-y-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={layout.showTitles} onChange={(e) => save(id, { ...layout, showTitles: e.target.checked })} />{t("menuShowTitles")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)} />{fr ? "Figer la présentation" : "Lock layout"}</label>
          <Button disabled={frozen} variant="outline" size="sm" onClick={() => save(id, defaultMenuLayout(initial))}><GripVertical className="h-3.5 w-3.5" />{t("menuReset")}</Button>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <Button variant="outline" size="sm" className="justify-start" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([serializeMenuLayout(id, layout)], { type: "application/json" })); a.download = `menu-${id}.menu`; a.click(); URL.revokeObjectURL(a.href); }}><Download className="h-3.5 w-3.5" />{layoutLabels?.exportLayout ?? (fr ? "Exporter l’organisation du menu" : "Export menu layout")}</Button>
            <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent ${frozen ? "pointer-events-none opacity-50" : ""}`}><Upload className="h-3.5 w-3.5" />{layoutLabels?.importLayout ?? (fr ? "Importer une organisation" : "Import menu layout")}
              <input type="file" accept=".menu,.json" className="hidden" disabled={frozen} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; let next = null; try { next = parseMenuLayout(JSON.parse(await f.text())); } catch { next = null; } if (next) save(id, next); else showMessage(fr ? "Ce fichier ne contient pas d’organisation de menu valide." : "This file does not contain a valid menu layout."); }} /></label>
          </div></PopoverContent>
      </Popover>
  );
  return (
    <div data-toolbar={id} onPointerDownCapture={(e) => setFieldPress(isInteractiveField(e.target))} onPointerUpCapture={() => setFieldPress(false)} className={`flex flex-wrap items-start gap-2 border-b border-border bg-panel py-2 ${id === "editor" || id === "manager" ? "px-2" : "px-0"} ${className}`} onDragOver={(e) => { if (dragging) { e.preventDefault(); setInsertion(null); previewGroups(e); } }} onDrop={(e) => drop(e)}>
      {layout.groups.map((g, gi) => (
        <div key={g.id} className={`relative shrink-0 ${gi === layout.groups.length - 1 ? "flex items-start gap-1" : ""}`} data-last-group={gi === layout.groups.length - 1 || undefined}><div className="relative shrink-0 transition-[padding] duration-150 motion-reduce:transition-none" style={{ paddingLeft: groupInsertion === g.id ? groupWidth + 8 : 0 }}>
        {groupInsertion === g.id && <div data-menu-group-insertion aria-hidden="true" className="drop-preview absolute inset-y-0 left-0" style={{ width: groupWidth }} />}
        <div data-menu-block={g.id} data-menu-color={isCustom(g.color) ? "custom" : g.color} style={isCustom(g.color) ? { ["--menu-accent" as string]: g.color } : undefined} draggable={!frozen && !fieldPress} onDragStart={(e) => { if (frozen || fieldPress) { e.preventDefault(); return; } start(e, g.id); }}
          onDragEnd={() => { setDragging(null); setInsertion(null); setGroupInsertion(undefined); }} onDragOver={(e) => preview(e, g.id)}
          onDrop={(e) => drop(e, g.id)} onContextMenu={(e) => { e.preventDefault(); setEditing(g.id); }}
          className={`menu-group flex ${frozen ? "" : "cursor-grab"} items-center gap-0.5 rounded-md border border-border/60 bg-toolbar-bg py-1 pr-1.5 ${dragging?.group === g.id && !dragging.button ? "opacity-50" : ""}`}>
          <Popover open={editing === g.id} onOpenChange={(open) => setEditing(open ? g.id : null)}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" title={t("menuCustomize")} aria-label={`${t("menuCustomize")} — ${g.title ?? t(g.label as TKey)}`}
                className="menu-accent mx-1 h-7 w-1 shrink-0 rounded-sm p-0" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-3 text-xs">
              <label className="block space-y-1"><span className="font-semibold">{t("menuGroupTitle")}</span>
                <input aria-label={t("menuGroupTitle")} value={g.title ?? t(g.label as TKey)} onChange={(e) => patch(g.id, { title: e.target.value })} className="h-8 w-full rounded-sm border border-input bg-background px-2" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={layout.showTitles} onChange={(e) => save(id, { ...layout, showTitles: e.target.checked })} />{t("menuShowTitles")}</label>
              <div className="font-semibold">{t("menuColor")}</div>
              <div className="flex gap-2">{menuColors.map((color) => <Button key={color} variant="ghost" size="icon" data-menu-color={color} aria-label={t(`menuColor_${color}` as TKey)} title={t(`menuColor_${color}` as TKey)} aria-pressed={g.color === color}
                onClick={() => patch(g.id, { color })} className={`menu-swatch h-7 w-7 rounded-full border-2 ${g.color === color ? "border-foreground" : "border-transparent"}`} />)}
                <label title={fr ? "Couleur personnalisée" : "Custom colour"} data-menu-color="custom" style={{ ["--menu-accent" as string]: isCustom(g.color) ? g.color : "var(--muted)" }}
                  className={`menu-swatch relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 ${isCustom(g.color) ? "border-foreground" : "border-dashed border-muted-foreground"}`}>
                  {!isCustom(g.color) && <Plus className="h-3.5 w-3.5 text-muted-foreground" />}
                  <input type="color" aria-label={fr ? "Couleur personnalisée" : "Custom colour"} value={isCustom(g.color) ? g.color : "#2f6fb0"} onChange={(e) => patch(g.id, { color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
                </label></div>
            </PopoverContent>
          </Popover>
          {layout.showTitles && <span className="max-w-40 truncate px-1 text-xs" title={g.title ?? t(g.label as TKey)}>{g.title ?? t(g.label as TKey)}</span>}
          {g.buttons.map((button) => <div key={button}
            className="relative shrink-0 transition-[padding] duration-150 motion-reduce:transition-none" style={{ paddingLeft: insertion?.group === g.id && insertion.before === button ? buttonWidth + 4 : 0 }}>
            {insertion?.group === g.id && insertion.before === button && <div data-menu-insertion aria-hidden="true" className="drop-preview absolute inset-y-0 left-0" style={{ width: buttonWidth }} />}
            <div data-menu-button={button} draggable={!frozen && !fieldPress} onDragStart={(e) => { if (frozen || fieldPress) { e.preventDefault(); return; } start(e, g.id, button); }}
              className={`shrink-0 ${dragging?.button === button ? "opacity-50" : ""}`}>{buttons[button]}</div>
          </div>)}
          <div className="relative h-9 shrink-0 transition-[width] duration-150 motion-reduce:transition-none" style={{ width: insertion?.group === g.id && insertion.before === null ? buttonWidth + 4 : 0 }}>
            {insertion?.group === g.id && insertion.before === null && <div data-menu-insertion aria-hidden="true" className="drop-preview absolute inset-y-0 left-0" style={{ width: buttonWidth }} />}
          </div>
        </div>
        </div>
        {gi === layout.groups.length - 1 && settings}
        </div>
      ))}
      {!layout.groups.length && settings}
      <div className="relative h-12 shrink-0 transition-[width] duration-150 motion-reduce:transition-none" style={{ width: groupInsertion === null ? groupWidth : 0 }}>
        {groupInsertion === null && <div data-menu-group-insertion aria-hidden="true" className="drop-preview absolute inset-0" />}
      </div>
      <div data-menu-empty className={`min-h-12 min-w-4 flex-1 rounded-md ${dragging ? "drop-target" : ""}`} onDrop={(e) => drop(e)} />
    </div>
  );
}