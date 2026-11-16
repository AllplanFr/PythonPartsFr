import { showMessage } from "@/lib/app-dialog";
import { dragNewAttrs } from "@/lib/attr-favorites";
import { dragExternal, dragExternalAttrs } from "@/lib/external-libraries";
import { externalTopLevel } from "@/lib/external-catalog";
import { dragTemplate, dragCatalogModel } from "@/lib/templates";
import { dragFormula, useFormulaFavorites } from "@/lib/formula-favorites";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, ContextMenuItem } from "@/components/ui/context-menu";
import { TemplateContextActions } from "./TemplateMenus";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, ChevronRight, CopyPlus, Pencil } from "lucide-react";
import cutIcon from "@/assets/icons/cut.svg.asset.json";
import copyIcon from "@/assets/icons/copy.svg.asset.json";
import pasteIcon from "@/assets/icons/paste.svg.asset.json";
import deleteIcon from "@/assets/icons/delete.svg.asset.json";
import moveUpIcon from "@/assets/icons/move_up.svg.asset.json";
import moveDownIcon from "@/assets/icons/move_down.svg.asset.json";
import { useCatalog, canContain, resolveInsertion, matchNode, makeTester, dragAttr, dragFolderIcon, TITLE, type CatalogNode } from "@/lib/catalog-store";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";
import { StickyTreeParents } from "./StickyTreeParents";
import { stickyParents } from "@/lib/tree-sticky";
import { FolderIconPicker } from "./FolderIconPicker";
import { Button } from "@/components/ui/button";
import { linkStatus, linkTarget, linksTo, nodePath } from "@/lib/links";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Eye, TriangleAlert } from "lucide-react";

/** Eye button on an ouvrage row: mini window listing the links that use it. */
function UsersPopover({ nodes, id }: { nodes: Record<string, CatalogNode>; id: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const users = linksTo(nodes, id);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!users.length) return <span className="w-6 shrink-0" />;
  const enter = () => { if (timer.current) clearTimeout(timer.current); setOpen(true); };
  const leave = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 200); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={t("lnkUsedBy")} onMouseEnter={enter} onMouseLeave={leave} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-selection"><Eye className="h-3.5 w-3.5 text-ribbon-dark" /></button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-0 text-xs" onMouseEnter={enter} onMouseLeave={leave} onOpenAutoFocus={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
      <div className="catalog-panel-heading flex h-7 items-center justify-center gap-2 px-3 font-semibold">{t("lnkUsedBy")}<span className="font-normal text-muted-foreground">{users.length}</span></div>
      <div className="max-h-64 overflow-auto py-1">
        {users.map((l) => { const host = l.parentId ? nodes[l.parentId] : undefined; const bad = linkStatus(nodes, l) === "circular";
          return <button key={l.id} type="button" title={t("lnkShow")} onClick={() => { useCatalog.getState().reveal(l.id); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-selection">
            {bad ? <TriangleAlert className="h-4 w-4 shrink-0 text-warning" /> : <NodeIcon type="link" />}
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{host?.name ?? "—"}</span><span className="block truncate text-[11px] text-muted-foreground">{nodePath(nodes, l.id)}</span></span>
          </button>; })}
        {!users.length && <div className="px-3 py-2 text-center text-muted-foreground">{t("lnkUnused")}</div>}
      </div>
    </PopoverContent>
  </Popover>;
}

const ROW = 32;

interface Row { id: string; depth: number }

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="bg-warning/60 text-foreground">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function TreePanel() {
  const t = useT();
  const { nodes, rootIds, expanded, selected, search: rawSearch, searchOpts, renaming } = useCatalog();
  const filtering = !!rawSearch.trim() || searchOpts.errorsOnly;
  const search = searchOpts.mode === "regex" || searchOpts.scope === "attrNum" ? "" : rawSearch.trim();
  const st = useCatalog.getState;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [col, setCol] = useState(260);
  const [drop, setDrop] = useState<{ id: string; pos: "before" | "after" | "inside" } | null>(null);
  useEffect(() => {
    const clear = () => setDrop(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => { window.removeEventListener("dragend", clear); window.removeEventListener("drop", clear); };
  }, []);
  const dragId = useRef<string | null>(null);
  const [descEdit, setDescEdit] = useState<string | null>(null);
  const [iconEdit, setIconEdit] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const knownNodes = useRef(new Set(Object.keys(nodes)));
  useEffect(() => {
    const id = selected.find((id) => !knownNodes.current.has(id));
    knownNodes.current = new Set(Object.keys(nodes));
    if (!id) return;
    const state = st();
    const expanded = { ...state.expanded };
    let parent = nodes[id]?.parentId;
    while (parent) { expanded[parent] = true; parent = nodes[parent]?.parentId; }
    useCatalog.setState({ expanded, search: "", searchOpts: { ...state.searchOpts, errorsOnly: false } });
  }, [nodes, selected]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    let matchSet: Set<string> | null = null;
    if (filtering) {
      matchSet = new Set();
      const test = makeTester(rawSearch.trim(), searchOpts);
      for (const n of Object.values(nodes)) {
        if (matchNode(n, rawSearch, searchOpts, test)) {
          let c: string | null = n.id;
          while (c && !matchSet.has(c)) { matchSet.add(c); c = nodes[c]!.parentId; }
        }
      }
    }
    const walk = (ids: string[], depth: number) => {
      for (const id of ids) {
        if (matchSet && !matchSet.has(id)) continue;
        out.push({ id, depth });
        const n = nodes[id]!;
        if (n.children?.length && (matchSet || expanded[id])) walk(n.children, depth + 1);
      }
    };
    walk(rootIds, 0);
    return out;
  }, [nodes, rootIds, expanded, rawSearch, searchOpts, filtering]);
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const rowIndices = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  useEffect(() => {
    const el = scrollRef.current;
    const index = visibleIds.indexOf(selected[0] ?? "");
    if (!el || index < 0) return;
    const top = index * ROW;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
    setScrollTop(el.scrollTop);
  }, [selected, visibleIds]);

  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('input,textarea,[contenteditable],[role="dialog"]')) return;
      const s = st(); const cur = s.selected[0] ?? ""; const i = visibleIds.indexOf(cur);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); s.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); s.redo(); }
      else if (mod && e.key.toLowerCase() === "c") s.copy(false);
      else if (mod && e.key.toLowerCase() === "x") s.copy(true);
      else if (mod && e.key.toLowerCase() === "v") s.paste();
      else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); s.duplicate(); }
      else if (e.key === "Delete") s.remove();
      else if (e.key === "F2" && cur) s.setRenaming(cur);
      else if (e.key === "ArrowDown" && i < visibleIds.length - 1) { e.preventDefault(); s.select(visibleIds[i + 1]!, e.shiftKey ? "range" : "single", visibleIds); ensure(i + 1); }
      else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); s.select(visibleIds[i - 1]!, e.shiftKey ? "range" : "single", visibleIds); ensure(i - 1); }
      else if (e.key === "ArrowRight" && cur && s.nodes[cur]!.children?.length && !s.expanded[cur]) s.toggle(cur);
      else if (e.key === "ArrowLeft" && cur) {
        if (s.expanded[cur]) s.toggle(cur);
        else if (s.nodes[cur]!.parentId) s.select(s.nodes[cur]!.parentId!);
      }
    };
    const ensure = (idx: number) => {
      const el = scrollRef.current; if (!el) return;
      const top = idx * ROW;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleIds, st]);

  const dropIndex = drop ? rows.findIndex((row) => row.id === drop.id) : -1;
  let afterIndex = dropIndex + 1;
  const dropRow = rows[dropIndex];
  if (drop?.pos === "after" && dropRow) while (rows[afterIndex] && (rows[afterIndex]?.depth ?? 0) > dropRow.depth) afterIndex++;
  const gapIndex = dropIndex < 0 || dragAttr.current || dragExternalAttrs.current || dragNewAttrs.current || dragFolderIcon.current || dragFormula.current || dragTemplate.current?.attrs ? -1 : drop?.pos === "before" ? dropIndex : drop?.pos === "after" ? afterIndex : dropIndex + 1;
  const GAP = ROW;
  const start = Math.max(0, Math.floor(scrollTop / ROW) - 10);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + 10);

  const onClickRow = (e: MouseEvent, id: string) => {
    st().select(id, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single", visibleIds);
  };

  const startColResize = (e: MouseEvent) => {
    const x0 = e.clientX, w0 = col;
    const mv = (ev: globalThis.MouseEvent) => setCol(Math.max(120, w0 + ev.clientX - x0));
    const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  };

  const tipKey = { folder: "tipFolder", group: "tipGroup", component: "tipComponent", link: "tipLink" } as const;
  const icon = (n: CatalogNode, _open: boolean) => {
    const st = n.type === "link" ? linkStatus(nodes, n) : "ok";
    return <span title={st === "dead" ? t("lnkDead") : st === "circular" ? t("lnkCircular") : t(tipKey[n.type])} className={`relative flex shrink-0 ${st === "ok" ? "" : "rounded-sm outline outline-1 " + (st === "dead" ? "outline-destructive" : "outline-warning")}`}><NodeIcon node={n} /></span>;
  };

  const mi = "w-full gap-2.5 px-3 py-1.5 text-left text-xs focus:bg-selection";
  const menuIcon = (src: string) => <img src={src} alt="" draggable={false} className="h-4 w-4 shrink-0 object-contain" />;

  return (
    <div className="flex h-full flex-col border border-border bg-background">
      <div className="catalog-panel-heading flex h-7 shrink-0 text-xs font-semibold">
        <div className="relative flex items-center px-1" style={{ width: `min(${col}px, 55%)` }}>
          {t("code")}
          <span onMouseDown={startColResize} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize border-r border-border" />
        </div>
        <div className="flex min-w-0 flex-1 items-center px-2">{t("description")} (207)</div>
        <div className="flex w-14 shrink-0 items-center justify-end pr-2 text-[10px] text-muted-foreground">{t("children")}</div>
      </div>
      <ContextMenu><ContextMenuTrigger asChild><div ref={scrollRef} className="relative flex-1 overflow-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDrop(null); }}
          onDragOver={(e) => { if (drop && (dragExternal.current || dragTemplate.current?.model || dragId.current) && !(e.target as HTMLElement).closest("[data-catalog-id]")) { e.preventDefault(); e.dataTransfer.dropEffect = dragId.current ? "move" : "copy"; } }}
          onDrop={(e) => {
            if (!drop || (e.target as HTMLElement).closest("[data-catalog-id]")) return;
            if (dragTemplate.current?.model) { e.preventDefault(); st().insertTemplate(dragTemplate.current.model, drop.id); setDrop(null); return; }
            if (dragId.current) { e.preventDefault(); if (drop.pos === "inside") st().moveOn(dragId.current, drop.id); else st().moveTo(dragId.current, drop.id, drop.pos); dragId.current = null; setDrop(null); return; }
            if (!dragExternal.current) return;
            e.preventDefault();
            const payload = dragExternal.current;
            const imported = st().importExternal(payload.data, payload.ids, drop.id);
            if (!imported.length && !st().insertionChoice) showMessage(t("extBlocked"));
            dragExternal.current = null; setDrop(null);
          }}
        >
        <div style={{ height: rows.length * ROW + (gapIndex >= 0 ? GAP : 0), position: "relative" }}>
          <StickyTreeParents rows={stickyParents(rows, nodes, rowIndices, scrollTop, ROW, gapIndex)} nodes={nodes} scrollTop={scrollTop} column={`min(${col}px, 55%)`} selected={selected} onSelect={(id) => st().reveal(id)} onCollapse={(id) => st().toggle(id)} />
          {gapIndex >= 0 && <div aria-hidden="true" className="catalog-drop-gap absolute left-0 right-0" style={{ top: gapIndex * ROW, height: GAP }} />}
          {rows.slice(start, end).map((r, k) => {
            const i = start + k; const n = nodes[r.id]; if (!n) return null;
            const open = filtering || !!expanded[r.id];
            const sel = selected.includes(r.id);
            const d = drop?.id === r.id ? drop.pos : null;
            return (
              <div key={r.id} data-catalog-id={r.id} draggable={!editing && renaming !== r.id && descEdit !== r.id && iconEdit !== r.id}
                onFocusCapture={(e) => { if ((e.target as HTMLElement).matches("input")) setEditing(true); }}
                onBlurCapture={() => setEditing(false)}
                onDragStart={(e) => { dragId.current = r.id; dragCatalogModel.current = n.type === "group" || n.type === "component" ? r.id : null; e.dataTransfer.setData("application/smartcatalog-node", r.id); e.dataTransfer.effectAllowed = "copyMove"; if (!sel) st().select(r.id); }}
                onDragEnd={() => { dragId.current = null; dragCatalogModel.current = null; setDrop(null); }}
                onDragOver={(e) => {
                   if (dragExternalAttrs.current) { const valid = n.type !== "link" && (n.type !== "folder" || dragExternalAttrs.current.keys.every((k) => k === TITLE || k === 207)); e.dataTransfer.dropEffect = valid ? "copy" : "none"; if (valid) { e.preventDefault(); setDrop({ id: r.id, pos: "inside" }); } else setDrop(null); return; }
                   if (dragExternal.current) {
                     const payload = dragExternal.current; const roots = externalTopLevel(payload.data, payload.ids);
                     const point = resolveInsertion(nodes, rootIds, r.id, roots.flatMap((id) => payload.data.nodes[id] ? [payload.data.nodes[id].type] : []));
                     const valid = !!point;
                     e.dataTransfer.dropEffect = valid ? "copy" : "none";
                     if (valid) { e.preventDefault(); setDrop({ id: r.id, pos: point !== "choice" && point?.parentId !== r.id ? "after" : "inside" }); } else setDrop(null);
                     return;
                   }
                   if (dragFormula.current) { const valid = n.type === "group" || n.type === "component"; e.dataTransfer.dropEffect = valid ? "copy" : "none"; if (valid) { e.preventDefault(); setDrop({ id: r.id, pos: "inside" }); } else setDrop(null); return; }
                   if (dragTemplate.current) {
                     const model = dragTemplate.current.model;
                     const point = model ? resolveInsertion(nodes, rootIds, r.id, [model.type]) : null;
                     const valid = model ? !!point : n.type === "group" || n.type === "component";
                     e.dataTransfer.dropEffect = valid ? "copy" : "none";
                     if (valid) { e.preventDefault(); setDrop({ id: r.id, pos: point && point !== "choice" && point.parentId !== r.id ? "after" : "inside" }); } else setDrop(null);
                     return;
                   }
                  if (dragFolderIcon.current) {
                    const valid = n.type === "folder" && r.id !== dragFolderIcon.current;
                    e.dataTransfer.dropEffect = valid ? "copy" : "none";
                    if (valid) { e.preventDefault(); setDrop({ id: r.id, pos: "inside" }); }
                    else setDrop(null);
                    return;
                  }
                  e.preventDefault();
                  if (dragNewAttrs.current) { if (n.type === "group" || n.type === "component") { e.dataTransfer.dropEffect = "copy"; if (drop?.id !== r.id) setDrop({ id: r.id, pos: "inside" }); } else if (drop) setDrop(null); return; }
                  if (dragAttr.current) { const a = dragAttr.current; e.dataTransfer.dropEffect = a.copy || (a.keys ?? [a.key]).every((key) => key === TITLE || key === 207) ? "copy" : "move"; if (drop?.id !== r.id) setDrop({ id: r.id, pos: "inside" }); return; }
                   const sourceId = dragId.current;
                   const incoming = sourceId ? nodes[sourceId] : undefined;
                   if (!incoming || sourceId === r.id) { setDrop(null); return; }
                   const moving = selected.includes(sourceId ?? "") ? selected : [sourceId ?? ""];
                   const types = moving.flatMap((id) => nodes[id] ? [nodes[id].type] : []);
                  const rect = e.currentTarget.getBoundingClientRect(); const y = (e.clientY - rect.top) / rect.height;
                   const point = resolveInsertion(nodes, rootIds, r.id, types, undefined, moving);
                   let pos: "before" | "after" | "inside" = y < 0.25 ? "before" : y > 0.75 ? "after" : point && point !== "choice" && point.parentId !== r.id ? "after" : "inside";
                   const parentId = pos === "inside" ? r.id : n.parentId;
                   const valid = types.length > 0 && (pos === "inside" && point === "choice" || types.every((type) => canContain(nodes, rootIds, parentId, type, moving)));
                   e.dataTransfer.dropEffect = valid ? "move" : "none";
                   if (valid) setDrop({ id: r.id, pos }); else setDrop(null);
                }}
                onDrop={(e) => { e.preventDefault();
                   if (dragExternalAttrs.current) { const payload = dragExternalAttrs.current; const count = st().importExternalAttrs(payload.data, payload.nodeIds, payload.keys, r.id); if (count === null) showMessage(t("extAttrsBlocked")); dragExternalAttrs.current = null; setDrop(null); return; }
                   if (dragExternal.current) { const payload = dragExternal.current; const imported = st().importExternal(payload.data, payload.ids, r.id); if (!imported.length && !st().insertionChoice) showMessage(t("extBlocked")); dragExternal.current = null; setDrop(null); return; }
                   if (dragFormula.current) { if (n.type === "group" || n.type === "component") useFormulaFavorites.getState().request(dragFormula.current, r.id); setDrop(null); return; }
                   if (dragTemplate.current) {
                     const payload = dragTemplate.current; setDrop(null);
                     if (payload.model) st().insertTemplate(payload.model, r.id);
                     else if (payload.attrs) st().addTemplateAttrs(r.id, payload.attrs);
                     return;
                   }
                  if (dragFolderIcon.current) {
                    const sourceId = dragFolderIcon.current; dragFolderIcon.current = null; setDrop(null);
                    if (st().copyFolderIcon(sourceId, r.id)) st().select(r.id);
                    return;
                  }
                  if (dragNewAttrs.current) { const nums = dragNewAttrs.current; setDrop(null); if (n.type === "group" || n.type === "component") { st().addTemplateAttrs(r.id, nums.map((num) => ({ num, value: "", enabled: false }))); st().select(r.id); } return; }
                  if (dragAttr.current) { const a = dragAttr.current; dragAttr.current = null; setDrop(null); const ok = st().transferAttrs(a.fromId, a.keys ?? [a.key], r.id, !a.copy); if (ok) st().select(r.id); return; }
                  if (dragId.current && drop) { if (drop.pos === "inside") st().moveOn(dragId.current, drop.id); else st().moveTo(dragId.current, drop.id, drop.pos); } setDrop(null); dragId.current = null; }}
                onClick={(e) => onClickRow(e, r.id)}
                onContextMenu={() => { if (!sel) st().select(r.id); }}
                onDoubleClick={() => n.children && st().toggle(r.id)}
                className={`catalog-drop-row absolute left-0 right-0 flex cursor-default select-none items-center gap-2 border-b border-border/50 pr-2 text-[13px] ${sel ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : "bg-background"} ${d === "inside" && gapIndex < 0 ? "drop-target" : ""}`}
                style={{ top: i * ROW + (gapIndex >= 0 && i >= gapIndex ? GAP : 0), height: ROW }}>

                <div className="flex shrink-0 items-center gap-1 overflow-hidden" style={{ width: `min(${col}px, 55%)`, paddingLeft: 4 + r.depth * 16 }}>
                  {n.children?.length ? <Button variant="ghost" size="icon" className="h-6 w-5 shrink-0 p-0" aria-label={t(open ? "collapseAll" : "expandAll")} onClick={(e) => { e.stopPropagation(); st().toggle(r.id); }}>
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </Button> : <span className="w-5 shrink-0" />}
                  {n.type === "folder" ? <FolderIconPicker compact id={r.id} icon={n.icon} open={iconEdit === r.id} onOpenChange={(v) => setIconEdit(v ? r.id : null)} /> : icon(n, open)}
                  {renaming === r.id ? (
                    <input aria-label={`${t("code")} — ${n.name}`} autoFocus defaultValue={n.name} className="h-6 min-w-0 flex-1 border border-ribbon-dark bg-background px-1 outline-none"
                      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { if (!cancelled.current && e.target.value !== n.name) st().update(r.id, { name: e.target.value }); cancelled.current = false; st().setRenaming(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancelled.current = true; e.currentTarget.blur(); } }} />
                  ) : (
                    <span onDoubleClick={(e) => { e.stopPropagation(); st().setRenaming(r.id); }} title={t("rename")} className="min-w-0 flex-1 truncate pl-1 font-semibold"><Highlight text={n.name} q={search} /></span>
                  )}
                </div>
                {descEdit === r.id ? (
                  <input aria-label={`${t("description")} — ${n.name}`} autoFocus defaultValue={n.description} className="mr-1 h-6 min-w-0 flex-1 border border-ribbon-dark bg-background px-1 outline-none"
                    onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { if (!cancelled.current && e.target.value !== n.description) st().update(r.id, { description: e.target.value }); cancelled.current = false; setDescEdit(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { cancelled.current = true; e.currentTarget.blur(); } }} />
                ) : n.type === "link" ? (
                  <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden px-1 text-xs text-muted-foreground"><span className="truncate"><Highlight text={linkTarget(nodes, n)?.description ?? ""} q={search} /></span></div>
                ) : (
                  <div className="flex h-full min-w-0 flex-1 items-center overflow-hidden px-1 text-xs text-muted-foreground" onDoubleClick={(e) => { e.stopPropagation(); setDescEdit(r.id); }}><span className="truncate"><Highlight text={n.description} q={search} /></span></div>
                )}
                {n.type === "link" ? (() => { const tg = linkTarget(nodes, n); return !tg ? <span className="w-6 shrink-0" /> : <button type="button" title={t("lnkShow")} aria-label={t("lnkShow")} onClick={(e) => { e.stopPropagation(); if (tg) st().reveal(tg.id); }} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-selection disabled:opacity-30"><Eye className="h-3.5 w-3.5 text-ribbon-dark" /></button>; })()
                  : n.type === "group" ? <UsersPopover nodes={nodes} id={r.id} /> : <span className="w-6 shrink-0" />}
                <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground" title={n.type === "folder" || n.type === "group" ? `${t("children")}: ${n.children?.length ?? 0}` : undefined}>{n.type === "folder" || n.type === "group" ? n.children?.length ?? 0 : null}</span>
              </div>
            );
          })}
        </div>
      </div>
      </ContextMenuTrigger><ContextMenuContent className="min-w-56 text-xs">
          <div className="border-y border-border bg-ribbon/35 px-3 py-2 text-[11px] font-semibold text-muted-foreground">{t("add")}</div>
          <ContextMenuItem className={mi} onSelect={() => st().addNode("folder")}><NodeIcon type="folder" />{t("add")} › {t("folder")}</ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => st().addNode("group")}><NodeIcon type="group" />{t("add")} › {t("group")}</ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => st().addNode("component")}><NodeIcon type="component" />{t("add")} › {t("component")}</ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => st().addNode("link")}><NodeIcon type="link" />{t("add")} › {t("link")}</ContextMenuItem>
          <div className="border-y border-border bg-ribbon/35 px-3 py-2 text-[11px] font-semibold text-muted-foreground">{t("edit")}</div>
          <ContextMenuItem className={mi} onSelect={() => st().copy(true)}>{menuIcon(cutIcon.url)}{t("cut")}<span className="ml-auto text-muted-foreground">Ctrl+X</span></ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => st().copy(false)}>{menuIcon(copyIcon.url)}{t("copy")}<span className="ml-auto text-muted-foreground">Ctrl+C</span></ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => st().paste()}>{menuIcon(pasteIcon.url)}{t("paste")}<span className="ml-auto text-muted-foreground">Ctrl+V</span></ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => st().duplicate()}><CopyPlus className="h-4 w-4 shrink-0 text-ribbon-dark" />{t("duplicate")}<span className="ml-auto text-muted-foreground">Ctrl+D</span></ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => selected[0] && st().setRenaming(selected[0])}><Pencil className="h-4 w-4 shrink-0 text-ribbon-dark" />{t("rename")}<span className="ml-auto text-muted-foreground">F2</span></ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => st().remove()}>{menuIcon(deleteIcon.url)}{t("del")}<span className="ml-auto text-muted-foreground">Del</span></ContextMenuItem>
          <div className="border-y border-border bg-ribbon/35 px-3 py-2 text-[11px] font-semibold text-muted-foreground">{t("move")}</div>
          <ContextMenuItem className={mi} onSelect={() => st().moveSel(-1)}>{menuIcon(moveUpIcon.url)}{t("up")}</ContextMenuItem>
          <ContextMenuItem className={mi} onSelect={() => st().moveSel(1)}>{menuIcon(moveDownIcon.url)}{t("down")}</ContextMenuItem>
          {selected[0] && <TemplateContextActions nodeId={selected[0]} />}
      </ContextMenuContent></ContextMenu>
    </div>
  );
}
