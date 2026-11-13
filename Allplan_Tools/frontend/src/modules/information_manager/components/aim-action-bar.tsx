import { isInteractiveField } from "@/lib/toolbar-drag-guard";
import { aimStorage } from "@/modules/information_manager/lib/aim-storage";
import { useEffect, useState, type ReactNode, type DragEvent } from "react";
import { Search, X, SlidersHorizontal, Settings2, Download, Upload, GripVertical } from "lucide-react";
import { AimColorSwatches } from "./aim-color-menu";
import { aimUiText } from "@/modules/information_manager/lib/aim-ui-text";
import { toolbarText } from "@/modules/information_manager/lib/aim-toolbar-text";
import type { Lang } from "@/modules/information_manager/lib/i18n";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_LAYOUT, parseLayout, toolbarGroups, moveToolbarItem, type ToolbarGroup, type SearchOptions, type InterfaceText, type ToolbarLayout } from "@/modules/information_manager/lib/aim-interface";
const isCustom = (color: string) => color.startsWith("#");
export function AimActionBar({ text, buttons: commands, query, onQuery, options, onOptions, placeholder, lang }: { text: InterfaceText; buttons: Record<string, ReactNode>; query: string; onQuery: (q: string) => void; options: SearchOptions; onOptions: (o: SearchOptions) => void; placeholder: string; lang: Lang }) {
  const labels = aimUiText(lang); const mt = toolbarText(lang);
  const [layout, setLayout] = useState<ToolbarLayout>(DEFAULT_LAYOUT);
  const [error, setError] = useState("");
  useEffect(() => { try { const stored = aimStorage.getItem("aim-toolbar-layout"); if (stored) setLayout(parseLayout(JSON.parse(stored))); } catch { /* Old or unavailable preference. */ } }, []);
  const change = (next: ToolbarLayout) => { setLayout(next); try { aimStorage.setItem("aim-toolbar-layout", JSON.stringify(next)); } catch { /* Preference unavailable. */ } };
  const frozen = layout.locked;
  const setFrozen = (locked: boolean) => { change({ ...layout, locked }); setDragging(null); setInsertion(null); setGroupInsertion(undefined); };
  const groupLabel = (g: ToolbarGroup) => g.label === "newGroup" ? mt.newGroup : g.label === "columns" ? mt.columns : g.label === "file" ? mt.file : text[g.label];
  const active = options.mode !== "contains" || options.matchCase || options.scope !== "all";
  const search = <div data-no-toolbar-drag data-search-active={query ? "" : undefined} className="aim-search flex h-6 min-w-0 items-center border border-border bg-background">
    <input aria-label={text.search} value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} className="h-full w-56 min-w-0 bg-transparent px-2 text-xs outline-none" />
    {query && <Button variant="native" size="native" onClick={() => onQuery("")} aria-label={labels.resetSearch} title={labels.resetSearch} className="px-1 text-muted-foreground"><X className="size-3.5" /></Button>}
    <Search className="mx-1 size-4 shrink-0 text-muted-foreground" />
    {query && <span role="status" className="whitespace-nowrap px-1 text-xs font-semibold">Recherche active</span>}
    <Popover><PopoverTrigger asChild><Button variant="native" size="native" title={text.searchMode} aria-label={text.searchMode} className={`flex h-full w-7 items-center justify-center border-l border-border hover:bg-selection ${active ? "bg-selection text-ribbon-dark" : "text-muted-foreground"}`}><SlidersHorizontal className="size-3.5" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="suite-menu w-[360px] space-y-3 rounded-sm p-3 text-xs">
        <label className="flex flex-col gap-1.5 font-semibold">{text.searchIn}<select className="field h-7 w-full font-normal" value={options.scope} onChange={(e) => onOptions({ ...options, scope: e.target.value as SearchOptions["scope"] })}>{([['all', text.all], ['num', text.num], ['name', text.nameField], ['title', text.title], ['value', text.value], ['group', text.group], ['category', text.category]] as const).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <label className="flex flex-col gap-1.5 font-semibold">{text.searchMode}<select className="field h-7 w-full font-normal" value={options.mode} onChange={(e) => onOptions({ ...options, mode: e.target.value as SearchOptions["mode"] })}>{(["contains", "starts", "equals", "regex"] as const).map((mode) => <option key={mode} value={mode}>{text[mode]}</option>)}</select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={options.matchCase} onChange={(e) => onOptions({ ...options, matchCase: e.target.checked })} />{text.matchCase}</label>
      </PopoverContent>
    </Popover>
  </div>;
  const buttons: Record<string, ReactNode> = { ...commands, search };
  const [dragging, setDragging] = useState<{ group: string; button?: string } | null>(null);
  const [insertion, setInsertion] = useState<{ group: string; before: string | null } | null>(null);
  const [groupInsertion, setGroupInsertion] = useState<string | null | undefined>(undefined);
  const [groupWidth, setGroupWidth] = useState(0);
  const [buttonWidth, setButtonWidth] = useState(36);
  const [editing, setEditing] = useState<string | null>(null);
  // A press in a search/text field selects text; it never arms a toolbar drag.
  const [fieldPress, setFieldPress] = useState(false);
  const start = (e: DragEvent, group: string, button?: string) => {
    if (frozen) { e.preventDefault(); return; }
    e.stopPropagation(); e.dataTransfer.setData("application/x-smartcatalog-menu", "aim"); e.dataTransfer.effectAllowed = "move";
    setDragging(button ? { group, button } : { group });
    setGroupInsertion(undefined);
    if (!button) setGroupWidth(e.currentTarget.getBoundingClientRect().width);
    else setButtonWidth(e.currentTarget.getBoundingClientRect().width);
  };
  const drop = (e: DragEvent, group?: string, button?: string) => {
    if (!dragging || frozen) return;
    e.preventDefault(); e.stopPropagation();
    const before = insertion && insertion.group === group ? insertion.before : button;
    const targetGroup = !dragging.button && groupInsertion !== undefined ? groupInsertion : group;
    change(moveToolbarItem(layout, dragging, targetGroup ? (dragging.button && before ? { group: targetGroup, button: before } : { group: targetGroup }) : undefined));
    setDragging(null); setInsertion(null); setGroupInsertion(undefined);
  };
  const previewGroups = (e: DragEvent<HTMLDivElement>) => {
    if (!dragging || frozen || dragging.button) return;
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
    if (!dragging || frozen) return;
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
  const groups = toolbarGroups(layout);
  const patch = (group: string, values: Partial<ToolbarGroup>) => change({ ...layout, groups: groups.map((g) => g.id === group ? { ...g, ...values } : g) });
  const t = (key: "menuSettings" | "menuShowTitles" | "menuReset" | "menuCustomize" | "menuGroupTitle" | "menuColor") => ({ menuSettings: text.customize, menuShowTitles: text.showTitles, menuReset: mt.reset, menuCustomize: mt.customize, menuGroupTitle: mt.title, menuColor: mt.color }[key] ?? key);
  const settings = (
      <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" title={t("menuSettings")} aria-label={t("menuSettings")} className="mt-1 h-9 w-7 shrink-0 text-muted-foreground"><Settings2 className="h-4 w-4" /></Button></PopoverTrigger>
        <PopoverContent align="end" className="suite-menu w-60 space-y-3 p-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={layout.showTitles} onChange={(e) => change({ ...layout, showTitles: e.target.checked })} />{t("menuShowTitles")}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)} />{text.locked}</label>
          <Button disabled={frozen} variant="outline" size="sm" onClick={() => change(DEFAULT_LAYOUT)}><GripVertical className="h-3.5 w-3.5" />{t("menuReset")}</Button>
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <Button variant="outline" size="sm" className="justify-start" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" })); a.download = "AIM.menu"; a.click(); URL.revokeObjectURL(a.href); }}><Download className="h-3.5 w-3.5" />{text.exportLayout}</Button>
            <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent ${frozen ? "pointer-events-none opacity-50" : ""}`}><Upload className="h-3.5 w-3.5" />{text.importLayout}
              <input type="file" accept=".menu,.json" className="hidden" disabled={frozen} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; let next = null; try { next = parseLayout(JSON.parse(await f.text())); } catch { next = null; } if (next) change(next); else setError(labels.invalidLayout); }} /></label>
          </div></PopoverContent>
      </Popover>
  );
  return (
    <div data-toolbar="aim" onPointerDownCapture={(e) => setFieldPress(isInteractiveField(e.target))} onPointerUpCapture={() => setFieldPress(false)} className={`flex flex-wrap items-start gap-2 border-b border-border bg-panel py-2 px-2 suite-toolbar`} onDragOver={(e) => { if (dragging && !frozen) { e.preventDefault(); setInsertion(null); previewGroups(e); } }} onDrop={(e) => drop(e)}>
      {groups.map((g, gi) => (
        <div key={g.id} className={`relative shrink-0 ${gi === groups.length - 1 ? "flex items-start gap-1" : ""}`} data-last-group={gi === groups.length - 1 || undefined}><div className="relative shrink-0 transition-[padding] duration-150 motion-reduce:transition-none" style={{ paddingLeft: groupInsertion === g.id ? groupWidth + 8 : 0 }}>
        {groupInsertion === g.id && <div data-menu-group-insertion aria-hidden="true" className="drop-preview absolute inset-y-0 left-0" style={{ width: groupWidth }} />}
        <div data-menu-block={g.id} data-menu-color={isCustom(g.color) ? "custom" : g.color} style={isCustom(g.color) ? { ["--menu-accent" as string]: g.color } : undefined} draggable={!frozen && !fieldPress} onDragStart={(e) => { if (frozen || fieldPress) { e.preventDefault(); return; } start(e, g.id); }}
          onDragEnd={() => { setDragging(null); setInsertion(null); setGroupInsertion(undefined); }} onDragOver={(e) => preview(e, g.id)}
          onDrop={(e) => drop(e, g.id)} onContextMenu={(e) => { e.preventDefault(); setEditing(g.id); }}
          className={`menu-group flex ${frozen ? "" : "cursor-grab"} items-center gap-0.5 rounded-md border border-border/60 bg-toolbar-bg py-1 pr-1.5 ${dragging?.group === g.id && !dragging.button ? "opacity-50" : ""}`}>
          <Popover open={editing === g.id} onOpenChange={(open) => setEditing(open ? g.id : null)}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" title={t("menuCustomize")} aria-label={`${t("menuCustomize")} — ${g.title ?? groupLabel(g)}`}
                className="menu-accent mx-1 h-7 w-1 shrink-0 rounded-sm p-0" />
            </PopoverTrigger>
            <PopoverContent align="start" className="suite-menu w-64 space-y-3 p-3 text-xs">
              <label className="block space-y-1"><span className="font-semibold">{t("menuGroupTitle")}</span>
                <input aria-label={t("menuGroupTitle")} value={g.title ?? groupLabel(g)} onChange={(e) => patch(g.id, { title: e.target.value })} className="h-8 w-full rounded-sm border border-input bg-background px-2" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={layout.showTitles} onChange={(e) => change({ ...layout, showTitles: e.target.checked })} />{t("menuShowTitles")}</label>
              <div className="font-semibold">{t("menuColor")}</div>
              <AimColorSwatches value={g.color} lang={lang} onPick={color => patch(g.id, { color })} />
            </PopoverContent>
          </Popover>
          {layout.showTitles && <span className="max-w-40 truncate px-1 text-xs" title={g.title ?? groupLabel(g)}>{g.title ?? groupLabel(g)}</span>}
          {g.buttons.filter(button => button !== "project").map((button) => <div key={button}
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
        {gi === groups.length - 1 && settings}
        </div>
      ))}
      {!groups.length && settings}
      <div className="relative h-12 shrink-0 transition-[width] duration-150 motion-reduce:transition-none" style={{ width: groupInsertion === null ? groupWidth : 0 }}>
        {groupInsertion === null && <div data-menu-group-insertion aria-hidden="true" className="drop-preview absolute inset-0" />}
      </div>
      {error && <span role="alert" className="self-center text-xs text-destructive">{error}<Button variant="ghost" title={labels.dismiss} aria-label={labels.dismiss} onClick={() => setError("")}><X className="size-3" /></Button></span>}
      <div data-menu-empty className={`min-h-12 min-w-4 flex-1 rounded-md ${dragging ? "drop-target" : ""}`} onDrop={(e) => drop(e)} />
    </div>
  );
}