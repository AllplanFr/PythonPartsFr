import { ChoiceCombo } from "./ChoiceCombo";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Info, MoreHorizontal, ChevronUp, BookOpen, ChevronDown, ChevronRight, CopyPlus, Database, FolderOpen, Plus, Star, X, Globe, RefreshCw, ArrowDownToLine, DatabaseBackup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATTRIBUTE_CATALOG, matchNode, makeTester, type SearchOpts, resolveInsertion, fromXML, useCatalog, TITLE } from "@/lib/catalog-store";
import { parseExternalCatalog, externalTopLevel } from "@/lib/external-catalog";
import { dragExternal, dragExternalAttrs, parseLibraryList, useExternalLibraries } from "@/lib/external-libraries";
import { useT } from "@/lib/i18n";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { CustomToolbar } from "./CustomToolbar";
import { NodeIcon } from "./NodeIcon";
import { StickyTreeParents } from "./StickyTreeParents";
import { stickyParents } from "@/lib/tree-sticky";
import { RowDragGrip } from "./RowDragGrip";
import { SearchBox } from "./SearchBox";
import { TX, Tip } from "./CatalogManager";
import { AttributeValueField, TextField } from "./PropertyPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import progemi from "@/assets/icons/external_bdd_progemi.png.asset.json";
import synermi from "@/assets/icons/external_bdd_synermi.png.asset.json";
import tsIcon from "@/assets/icons/external_bdd_ts.png.asset.json";
import mxdb from "@/assets/icons/external_bdd_mxdb.png.asset.json";
import nevaris from "@/assets/icons/external_bdd_nevaris.png.asset.json";
import folderPng from "@/assets/icons/folder.png.asset.json";
import dbIcon from "@/assets/icons/external_bdd.png.asset.json";
import acca from "@/assets/icons/external_bdd_acca.png.asset.json";
import ajsoft from "@/assets/icons/external_bdd_aj_soft.png.asset.json";
import allmetre from "@/assets/icons/external_bdd_allmetre.png.asset.json";
import bcm from "@/assets/icons/external_bdd_bcm.png.asset.json";
import bcmc from "@/assets/icons/external_bdd_bcm_c.png.asset.json";
import bimplus from "@/assets/icons/external_bdd_bimplus.png.asset.json";
import capmi from "@/assets/icons/external_bdd_capmi.png.asset.json";
import frilo from "@/assets/icons/external_bdd_frilo.png.asset.json";
import gimi from "@/assets/icons/external_bdd_gimi.png.asset.json";

const DB_ICONS = [["ACCA", acca.url], ["AJ Soft", ajsoft.url], ["Allmetre", allmetre.url], ["BCM", bcm.url], ["BCM C", bcmc.url], ["Bimplus", bimplus.url], ["Capmi", capmi.url], ["Frilo", frilo.url], ["Gimi", gimi.url], ["MXDB", mxdb.url], ["Nevaris", nevaris.url], ["Progemi", progemi.url], ["Synermi", synermi.url], ["TS", tsIcon.url]] as const;
import externalIcon from "@/assets/icons/external_bdd_option.png.asset.json";
import upIcon from "@/assets/icons/move_up.svg.asset.json";
import downIcon from "@/assets/icons/move_down.svg.asset.json";
import expandIcon from "@/assets/icons/expand_all.png.asset.json";
import { ExpandButton, CollapseButton } from "./ExpandMenus";
import { applyExpand, applyCollapse } from "@/lib/tree-expand";
import collapseIcon from "@/assets/icons/collapse_all.png.asset.json";
import { DEFAULT_ATTRS } from "@/lib/default-attributes";
import importIcon from "@/assets/icons/favorite_open.svg.asset.json";
import exportIcon from "@/assets/icons/favorite_save.svg.asset.json";
import deleteIcon from "@/assets/icons/delete.svg.asset.json";

const input = "h-8 w-full rounded-sm border border-border bg-background px-2 text-xs outline-none focus:border-ribbon-dark";
const Img = ({ src }: { src: string }) => <img src={src} alt="" className="h-5 w-5 object-contain" draggable={false} />;

export function ExternalLibraryDialog() {
  const t = useT(); const store = useExternalLibraries(); const catalog = useCatalog();
  const source = store.sources.find((s) => s.id === store.active);
  const [mode, setMode] = useState<"browse" | "manage">("browse");
  const [selected, setSelected] = useState<string[]>([]); const anchor = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState(""); const [opts, setOpts] = useState<SearchOpts>({ types: ["folder", "group", "component", "link"], scope: "title", attrNum: 83, mode: "contains", matchCase: false, errorsOnly: false }); const [sourceQuery, setSourceQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [split, setSplit] = useState(53); const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0); const [height, setHeight] = useState(500); const tree = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null); const reload = useRef(false); const iconFile = useRef<HTMLInputElement>(null);
  const [sourceOver, setSourceOver] = useState<{ id: string; pos: "before" | "after" } | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const folder = store.folders.find((f) => f.id === folderId);
  const [closedFolders, setClosedFolders] = useState<Record<string, boolean>>({});
  const [newLibrary, setNewLibrary] = useState(false); const [url, setUrl] = useState(""); const [libraryName, setLibraryName] = useState(""); const [loading, setLoading] = useState(false);
  const [attrKeys, setAttrKeys] = useState<number[]>([]); const attrAnchor = useRef<number | null>(null);
  const listFile = useRef<HTMLInputElement>(null);
  const dataFolderFile = useRef<HTMLInputElement>(null);
  const dataFolderSource = useRef<string | null>(null);
  const organization = JSON.stringify({ folders: store.folders, sources: store.sources });
  const savedOrganization = useRef(organization);
  const [pendingBrowse, setPendingBrowse] = useState<string | null>(null);
  const targetId = catalog.selected.length === 1 ? catalog.selected[0] ?? null : null;
  const current = source?.data.nodes[selected[0] ?? ""];
  useEffect(() => { setAttrKeys([]); attrAnchor.current = null; }, [selected.join(",")]);
  useEffect(() => { const first = source?.data.rootIds[0]; setExpanded(Object.fromEntries(Object.keys(source?.data.nodes ?? {}).map((id) => [id, true]))); setSelected(first ? [first] : []); setQuery(""); setMessage(""); setError(""); setScrollTop(0); setAttrKeys([]); }, [source?.id, source?.data]);
  const rows = useMemo(() => {
    const out: { id: string; depth: number }[] = []; if (!source) return out;
    const matched = new Set<string>(); const q = query.trim() || (opts.errorsOnly || opts.types.length < 4 ? " " : ""); const test = makeTester(query.trim(), opts);
    if (q) for (const n of Object.values(source.data.nodes)) if (matchNode(n, query, opts, test)) { let id: string | null = n.id; while (id && !matched.has(id)) { matched.add(id); id = source.data.nodes[id]?.parentId ?? null; } }
    const walk = (ids: string[], depth: number) => { for (const id of ids) { const n = source.data.nodes[id]; if (!n || q && !matched.has(id)) continue; out.push({ id, depth }); if (q || expanded[id]) walk(n.children ?? [], depth + 1); } };
    walk(source.data.rootIds, 0); return out;
  }, [source, query, opts, expanded]);
  const rowIndices = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  useEffect(() => { const el = tree.current; if (!el) return; const observer = new ResizeObserver(() => setHeight(el.clientHeight)); observer.observe(el); return () => observer.disconnect(); }, [mode, source?.id]);
  useEffect(() => { const el = tree.current; const index = rows.findIndex((r) => r.id === selected[0]); if (!el || index < 0) return; if (index * 32 < el.scrollTop) el.scrollTop = index * 32; else if ((index + 1) * 32 > el.scrollTop + el.clientHeight) el.scrollTop = (index + 1) * 32 - el.clientHeight; setScrollTop(el.scrollTop); }, [selected, rows]);
  const roots = source ? externalTopLevel(source.data, selected) : [];
  const compatible = (target: string | null) => !!source && roots.length > 0 && !!resolveInsertion(catalog.nodes, catalog.rootIds, target, roots.flatMap((id) => source.data.nodes[id] ? [source.data.nodes[id].type] : []));
  const importItems = () => { if (!source) return; const imported = catalog.importExternal(source.data, selected, targetId); setError(imported.length || useCatalog.getState().insertionChoice ? "" : t("extBlocked")); setMessage(imported.length ? t("extImported", { n: imported.length }) : ""); };
  const importAttributes = () => { if (!source || !targetId) return; const result = catalog.importExternalAttrs(source.data, selected, attrKeys, targetId); setError(result === null ? t("extAttrsBlocked") : ""); setMessage(result !== null ? t("extAttrsDone", { n: result }) : ""); };
  const close = () => { dragExternal.current = null; dragExternalAttrs.current = null; store.setOpen(false); };
  const loadFile = async (f?: File) => {
    if (!f) return;
    try { const text = await f.text(); const parsed = /\.(json|xml)$/i.test(f.name) ? parseExternalCatalog(f.name.toLowerCase().endsWith(".xml") ? fromXML(text) : JSON.parse(text)) : null; if (!parsed) { if (reload.current || /\.(json|xml)$/i.test(f.name)) throw new Error(); store.receive({ name: libraryName || f.name.replace(/\.[^.]+$/, ""), location: f.name, kind: "file", parentId: folderId, version: catalog.catalog.version, dataSource: "STD", defAttr: 83, data: { nodes: {}, rootIds: [] } }); setMessage(t("extPending")); setNewLibrary(false); return; }
      if (reload.current && source) useExternalLibraries.setState((s) => ({ sources: s.sources.map((entry) => entry.id === source.id ? { ...entry, data: parsed, location: f.name, demo: false } : entry) }));
      else store.receive({ name: libraryName || f.name.replace(/\.[^.]+$/, ""), location: f.name, kind: "file", parentId: folderId, version: catalog.catalog.version, dataSource: "STD", defAttr: 83, data: parsed });
      setSelected([parsed.rootIds[0] ?? ""]); setExpanded(Object.fromEntries(Object.keys(parsed.nodes).map((id) => [id, true]))); setError(""); setNewLibrary(false); setFolderId(null);
    } catch { setError(t("extInvalid")); } finally { reload.current = false; }
  };
  const loadUrl = async (address = url, replace = false) => {
    setLoading(true); setError("");
    try { const endpoint = new URL(address); if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error();
      const response = await fetch(endpoint.href, { credentials: "omit", signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error();
      const text = await response.text(); const parsed = parseExternalCatalog(text.trim().startsWith("<") ? fromXML(text) : JSON.parse(text)); if (!parsed) throw new Error();
      if (replace && source) useExternalLibraries.setState((s) => ({ sources: s.sources.map((entry) => entry.id === source.id ? { ...entry, data: parsed, demo: false } : entry) }));
      else store.receive({ name: libraryName || endpoint.hostname, location: endpoint.href, kind: "url", parentId: folderId, version: catalog.catalog.version, dataSource: "STD", defAttr: 83, data: parsed });
      setNewLibrary(false); setFolderId(null);
    } catch { setError(t("extUrlError")); } finally { setLoading(false); }
  };
  const exportList = () => { const blob = new Blob([JSON.stringify({ folders: store.folders, sources: store.sources }, null, 2)], { type: "application/json" }); const href = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = href; a.download = "libraries.json"; a.click(); URL.revokeObjectURL(href); };
  const openBrowse = (id = store.active) => {
    if (organization !== savedOrganization.current) { setPendingBrowse(id); return; }
    useExternalLibraries.setState({ active: id }); setFolderId(null); setMode("browse");
  };
  const finishBrowse = (save: boolean) => {
    if (pendingBrowse === null) return;
    if (save) exportList();
    savedOrganization.current = organization;
    useExternalLibraries.setState({ active: pendingBrowse }); setFolderId(null); setMode("browse"); setPendingBrowse(null);
  };
  const openFile = (replace = false) => { reload.current = replace; file.current?.click(); };
  const managementRows = useMemo(() => {
    const out: { id: string; depth: number; type: "folder" | "source" }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of store.folders.filter((f) => f.parentId === parent)) { out.push({ id: f.id, depth, type: "folder" }); if (!closedFolders[f.id]) walk(f.id, depth + 1); }
      for (const s of store.sources.filter((s) => (s.parentId ?? null) === parent)) out.push({ id: s.id, depth, type: "source" });
    };
    if (sourceQuery || favoritesOnly) return store.sources.filter((s) => (!favoritesOnly || s.favorite) && s.name.toLowerCase().includes(sourceQuery.toLowerCase())).map((s) => ({ id: s.id, depth: 0, type: "source" as const }));
    walk(null, 0); return out;
  }, [store.folders, store.sources, closedFolders, sourceQuery, favoritesOnly]);
  useEffect(() => { if (mode !== "manage") return; const id = folderId ?? store.active; document.querySelector(`[data-library-entry="${id}"]`)?.scrollIntoView({ block: "nearest" }); }, [folderId, store.active, mode]);
  const sourceDropIndex = managementRows.findIndex((row) => row.id === sourceOver?.id);
  let sourceGapIndex = sourceDropIndex;
  if (sourceDropIndex >= 0 && sourceOver?.pos === "after") {
    sourceGapIndex++;
    const targetDepth = managementRows[sourceDropIndex]?.depth ?? 0;
    while (managementRows[sourceGapIndex] && (managementRows[sourceGapIndex]?.depth ?? 0) > targetDepth) sourceGapIndex++;
  }
  const moveEntry = (direction: -1 | 1) => { if (!folder) { if (source) store.move(source.id, direction); return; } useExternalLibraries.setState((s) => { const folders = [...s.folders]; const siblings = folders.filter((f) => f.parentId === folder.parentId); const next = siblings[siblings.findIndex((f) => f.id === folder.id) + direction]; if (!next) return {}; const a = folders.findIndex((f) => f.id === folder.id), b = folders.findIndex((f) => f.id === next.id); folders[a] = next; folders[b] = folder; return { folders }; }); };
  const [more, setMore] = useState(false);
  const inp = "h-8 min-w-0 flex-1 border border-border bg-background px-2 text-[13px] outline-none focus:border-ribbon-dark";
  const side = "flex h-8 items-center justify-center border border-l-0 border-border bg-panel px-2 text-xs font-semibold hover:bg-selection";
  const x = (TX as Record<string, typeof TX.en>)[catalog.lang] ?? TX.en;
  const Lbl = ({ tip, children }: { tip: string[]; children: ReactNode }) => <TooltipProvider delayDuration={300}><Tip tip={tip} side="left"><label className="mb-1 mt-4 flex w-fit cursor-help items-center gap-1 text-xs font-semibold first:mt-0">{children}<Info className="h-3 w-3 text-muted-foreground" /></label></Tip></TooltipProvider>;
  const tool = (label: string, icon: ReactNode, action: () => void, disabled = false) => <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={action} disabled={disabled} className="h-9 w-9 rounded-md p-0 hover:bg-selection">{icon}</Button>;
  const buttons = {
    manage: <Button variant="ghost" size="icon" aria-label={t("extManage")} aria-pressed={mode === "manage"} title={t("extManage")} onClick={() => mode === "manage" ? openBrowse() : setMode("manage")} className={`h-9 w-9 rounded-md p-0 hover:bg-selection ${mode === "manage" ? "bg-selection ring-1 ring-ribbon-dark" : ""}`}><Database className="h-5 w-5 text-ribbon-dark" /></Button>,
    browse: tool(t("extBrowse"), <BookOpen className="h-5 w-5 text-ribbon-dark" />, () => openBrowse()),
    sources: <ChoiceCombo label={t("extSources")} className="w-56" value={store.active} onChange={(active) => { useExternalLibraries.setState({ active }); setFolderId(null); }} options={store.sources.length ? store.sources.map((s) => ({ value: s.id, label: s.name })) : [{ value: "", label: t("extEmpty") }]} />,
    folder: tool(t("extNewFolder"), <Img src={folderPng.url} />, () => { const id = store.addFolder(folderId); store.updateFolder(id, { name: t("extNewFolder") }); setFolderId(id); setClosedFolders({}); }),
    listImport: tool(t("extListImport"), <Img src={importIcon.url} />, () => listFile.current?.click()),
    listExport: tool(t("extListExport"), <Img src={exportIcon.url} />, exportList),
    sync: tool(t("extSyncInfo"), <DatabaseBackup className="h-5 w-5 text-muted-foreground" />, () => {}, true),
    attrs: tool(t("extAttrsImport"), <ArrowDownToLine className="h-5 w-5 text-ribbon-dark" />, importAttributes, !targetId || !attrKeys.length),
    add: tool(t("extAdd"), <span className="relative"><Database className="h-5 w-5 text-ribbon-dark" /><Plus strokeWidth={3} className="absolute -bottom-1 -right-1.5 h-3 w-3 rounded-full bg-background text-success" /></span>, () => { setLibraryName(""); setUrl(""); setNewLibrary(true); }),
    reload: tool(t("extReplace"), <RefreshCw className="h-5 w-5 text-ribbon-dark" />, () => source?.kind === "url" ? void loadUrl(source.location, true) : openFile(true), !source),
    expand: mode === "manage" ? tool(t("expandAll"), <Img src={expandIcon.url} />, () => setClosedFolders({})) : <ExpandButton scope="ext" icon={<Img src={expandIcon.url} />} hasSelection={!!selected.length} onMode={(m) => source && setExpanded((e) => applyExpand(source.data.nodes, source.data.rootIds, e, m, selected))} />,
    collapse: mode === "manage" ? tool(t("collapseAll"), <Img src={collapseIcon.url} />, () => setClosedFolders(Object.fromEntries(store.folders.map((f) => [f.id, true])))) : <CollapseButton scope="ext" icon={<Img src={collapseIcon.url} />} hasSelection={!!selected.length} onMode={(m) => source && setExpanded((e) => applyCollapse(source.data.nodes, e, m, selected))} />,
    up: tool(t("up"), <Img src={upIcon.url} />, () => moveEntry(-1), !source && !folder),
    down: tool(t("down"), <Img src={downIcon.url} />, () => moveEntry(1), !source && !folder),
    del: tool(t("del"), <Img src={deleteIcon.url} />, () => source && store.remove(source.id), !source),
    favorite: tool(t("favSave"), <Star className={`h-5 w-5 ${source?.favorite ? "fill-icon-attr text-icon-attr" : "text-ribbon-dark"}`} />, () => source && store.update(source.id, { favorite: !source.favorite }), !source),
    search: <SearchBox external={{ value: query, onChange: (v) => { setQuery(v); tree.current?.scrollTo(0, 0); setScrollTop(0); }, opts, onOpts: (o) => setOpts((p) => ({ ...p, ...o })), nodes: source?.data.nodes ?? {}, readOnly: true }} />,
    import: tool(t("extImport"), <CopyPlus className="h-5 w-5 text-ribbon-dark" />, importItems, !compatible(targetId)),
  };
  const groups = mode === "browse" ? [
    { id: "manage", label: "manage", color: "blue" as const, buttons: ["manage", "sources"] }, { id: "view", label: "view", color: "blue" as const, buttons: ["expand", "collapse"] }, { id: "tools", label: "tools", color: "blue" as const, buttons: ["reload", "sync"] }, { id: "search", label: "search", color: "blue" as const, buttons: ["search"] },
  ] : [
    { id: "manage", label: "manage", color: "blue" as const, buttons: ["manage"] }, { id: "view", label: "view", color: "blue" as const, buttons: ["expand", "collapse"] }, { id: "move", label: "move", color: "blue" as const, buttons: ["up", "down"] }, { id: "add", label: "add", color: "green" as const, buttons: ["folder", "add"] }, { id: "favorites", label: "favorites", color: "yellow" as const, buttons: ["listImport", "listExport"] },
  ];
  const start = Math.max(0, Math.floor(scrollTop / 32) - 5); const visible = rows.slice(start, start + Math.ceil(height / 32) + 12);
  const select = (id: string, e: React.MouseEvent) => { const ids = rows.map((r) => r.id); if (e.shiftKey && anchor.current && ids.includes(anchor.current)) { const a = ids.indexOf(anchor.current), b = ids.indexOf(id); setSelected(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); } else { setSelected(e.ctrlKey || e.metaKey ? selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] : [id]); anchor.current = id; } setMessage(""); };
  return <Dialog layoutId="external-libraries" title={t("extTitle")} icon={externalIcon.url} width={1220} height={760} nonModal onClose={close} footer={<>
    {mode === "browse" && <Button variant="outline" className={DIALOG_BTN} disabled={!compatible(targetId)} onClick={importItems}><CopyPlus className="h-3.5 w-3.5" />{t("extImport")}</Button>}
    {mode === "browse" && <Button variant="outline" className={DIALOG_BTN} disabled={!targetId || !attrKeys.length} onClick={importAttributes}>{t("extAttrsImport")}</Button>}
    <Button variant="outline" className={DIALOG_BTN} onClick={close}>{t("quit")}</Button></>}>
    <CustomToolbar id={`external-v4-${mode}`} buttons={buttons} initial={groups} className="px-0" />
    {(error || message) && <div role={error ? "alert" : "status"} className={`mt-2 border-l-2 px-3 py-2 text-xs ${error ? "border-destructive bg-destructive/10 text-destructive" : "border-success bg-success/10 text-foreground"}`}>{error || message}</div>}
    {mode === "manage" ? <div className="flex min-h-0 flex-1 gap-3 pt-3">
      <div className="flex w-[32%] min-w-36 flex-col border border-border"><div className="catalog-panel-heading flex h-7 items-center px-2 text-xs font-semibold">{t("extSources")}</div><div className="flex gap-1 border-b border-border p-2"><input aria-label={t("search")} placeholder={t("search")} value={sourceQuery} onChange={(e) => setSourceQuery(e.target.value)} className={input} /><Button variant="ghost" size="icon" aria-pressed={favoritesOnly} title={t("favOpen")} className="h-8 w-8 shrink-0" onClick={() => setFavoritesOnly(!favoritesOnly)}><Star className={`h-4 w-4 ${favoritesOnly ? "fill-icon-attr text-icon-attr" : "text-muted-foreground"}`} /></Button></div><div className="min-h-0 flex-1 overflow-auto [--drop-height:36px]" onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setSourceOver(null); }}>
        {managementRows.map((row, i) => { const f = row.type === "folder" ? store.folders.find((f) => f.id === row.id) : undefined; const s = row.type === "source" ? store.sources.find((s) => s.id === row.id) : undefined; const item = f ?? s; if (!item) return null; return <Fragment key={row.id}>{sourceGapIndex === i && <div className="drop-gap" />}<div data-library-entry={row.id} onDragEnd={() => setSourceOver(null)} onDoubleClick={() => { if (s) openBrowse(s.id); }} data-draggable-row draggable style={{ paddingLeft: 20 + row.depth * 16 }} className={`relative flex h-9 cursor-default items-center gap-2 border-b border-border/50 pr-2 text-xs ${folderId === row.id || !folderId && store.active === row.id ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : "bg-background"}`} onClick={() => { if (f) setFolderId(f.id); else { useExternalLibraries.setState({ active: row.id }); setFolderId(null); } }} onDragStart={(e) => e.dataTransfer.setData("application/smartcatalog-external-source", row.id)} onDragOver={(e) => { if (e.dataTransfer.types.includes("application/smartcatalog-external-source")) { e.preventDefault(); setSourceOver({ id: row.id, pos: f ? "after" : "before" }); } }} onDrop={(e) => { setSourceOver(null); const id = e.dataTransfer.getData("application/smartcatalog-external-source"); if (!id || id === row.id) return; e.preventDefault(); if (f) { const movingFolder = store.folders.find((x) => x.id === id); if (movingFolder) { let parent: string | null = f.id; while (parent) { if (parent === id) return; parent = store.folders.find((x) => x.id === parent)?.parentId ?? null; } useExternalLibraries.setState((state) => ({ folders: state.folders.map((x) => x.id === id ? { ...x, parentId: f.id } : x) })); } else store.update(id, { parentId: f.id }); setClosedFolders((prev) => ({ ...prev, [f.id]: false })); } else if (s) { useExternalLibraries.setState((state) => { const sources = state.sources.filter((x) => x.id !== id); const moving = state.sources.find((x) => x.id === id); if (!moving) return {}; sources.splice(sources.findIndex((x) => x.id === row.id), 0, { ...moving, parentId: s.parentId ?? null }); return { sources }; }); } }}><RowDragGrip className="absolute left-1" />{f && <Button variant="ghost" size="icon" className="h-6 w-4 p-0" aria-label={t(closedFolders[f.id] ? "expandAll" : "collapseAll")} onClick={(e) => { e.stopPropagation(); setClosedFolders((prev) => ({ ...prev, [f.id]: !prev[f.id] })); }}>{closedFolders[f.id] ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</Button>}{f ? <NodeIcon node={{ type: "folder", icon: f.icon }} /> : <img src={item.icon || dbIcon.url} alt="" className="h-4 w-4 shrink-0 object-contain" />}<span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>{s?.kind === "url" && <Globe className="h-3.5 w-3.5 text-muted-foreground" />}{s && <Button variant="ghost" size="icon" className="h-7 w-7" title={t("favSave")} onClick={(e) => { e.stopPropagation(); store.update(s.id, { favorite: !s.favorite }); }}><Star className={`h-3.5 w-3.5 ${s.favorite ? "fill-icon-attr text-icon-attr" : "text-muted-foreground"}`} /></Button>}<Button variant="ghost" size="icon" className="h-7 w-7" title={t("del")} aria-label={`${t("del")} ${item.name}`} onClick={(e) => { e.stopPropagation(); if (f) { store.removeFolder(f.id); setFolderId(null); } else store.remove(row.id); }}><X className="h-3.5 w-3.5" /></Button></div></Fragment>; })}{sourceGapIndex === managementRows.length && sourceGapIndex >= 0 && <div className="drop-gap" />}
      </div></div>
      <div className="flex min-w-0 flex-1 flex-col border border-border"><div className="catalog-panel-heading flex h-7 items-center px-2 text-xs font-semibold">{folder?.name ?? source?.name ?? t("extSources")}</div><div className="min-h-0 flex-1 overflow-auto p-4">{folder ? <div className="space-y-4"><label className="block space-y-1.5 text-xs font-semibold">{t("title")}<input aria-label={t("title")} value={folder.name} onChange={(e) => store.updateFolder(folder.id, { name: e.target.value })} className={input} autoFocus /></label><Button variant="outline" onClick={() => iconFile.current?.click()}><NodeIcon node={{ type: "folder", icon: folder.icon }} />{t("chooseIcon")}</Button><Button variant="ghost" onClick={() => store.updateFolder(folder.id, { icon: undefined })}>{t("defaultIcon")}</Button></div> : source ? <div>
        <Lbl tip={[t("extPersonalName"), t("extPersonalNameInfo")]}>{t("title")}</Lbl>
        <div key={source.id}><TextField value={source.name} caseBtn onCommit={(name) => { if (name.trim()) store.update(source.id, { name }); }} /></div>
        <Lbl tip={x.tipPath}>{source.kind === "url" ? "URL" : t("catPath")}</Lbl>
        <div className="flex min-w-0"><input aria-label={t("extConnection")} className={inp} value={source.location} onChange={(e) => store.update(source.id, { location: e.target.value })} /><Button variant="ghost" size="icon" title={t("extReplace")} className={side} onClick={() => source.kind === "url" ? void loadUrl(source.location, true) : openFile(true)}>{source.kind === "url" ? <RefreshCw className="h-4 w-4 text-ribbon-dark" /> : <MoreHorizontal className="h-4 w-4 text-ribbon-dark" />}</Button></div>
        <Lbl tip={[t("chooseIcon"), ""]}>{t("chooseIcon")}</Lbl>
        <div className="flex flex-wrap items-center gap-1"><button title={t("chooseIcon")} onClick={() => iconFile.current?.click()} className={`flex h-8 w-8 items-center justify-center border border-border ${source.icon && !DB_ICONS.some(([, u]) => u === source.icon) ? "bg-selection border-ribbon-dark" : "bg-background"}`}><FolderOpen className="h-4 w-4 text-ribbon-dark" /></button><button title={t("defaultIcon")} onClick={() => store.update(source.id, { icon: undefined })} className={`flex h-8 w-8 items-center justify-center border ${!source.icon ? "border-ribbon-dark bg-selection" : "border-border bg-background"}`}><img src={dbIcon.url} alt="" className="h-5 w-5 object-contain" /></button>{DB_ICONS.map(([name, url]) => <button key={name} title={name} onClick={() => store.update(source.id, { icon: url })} className={`flex h-8 w-8 items-center justify-center border ${source.icon === url ? "border-ribbon-dark bg-selection" : "border-border bg-background"}`}><img src={url} alt="" className="h-5 w-5 object-contain" /></button>)}</div>
        <Lbl tip={x.tipVersion}>{t("allplanVersion")}</Lbl>
        <ChoiceCombo label={t("allplanVersion")} className="w-full" value={source.version} onChange={(version) => store.update(source.id, { version })} options={["2027", "2026", "2025", "2024"].map((v) => ({ value: v, label: v }))} />
        <Lbl tip={x.tipSource}>{t("dataFrom")}</Lbl>
        <div className="flex"><input aria-label={t("dataFrom")} className={inp} value={source.dataSource} onChange={(e) => store.update(source.id, { dataSource: e.target.value })} /><TooltipProvider><Tip tip={x.tipSource}><Button variant="ghost" className={side} onClick={() => store.update(source.id, { dataSource: "STD" })}>STD</Button></Tip></TooltipProvider><Button variant="ghost" size="icon" aria-label={t("extBrowseData")} title={`${t("extBrowseData")}\n${t("extBrowseDataInfo")}`} className={side} onClick={() => { dataFolderSource.current = source.id; dataFolderFile.current?.click(); }}><MoreHorizontal className="h-4 w-4 text-ribbon-dark" /></Button></div>
        <button onClick={() => setMore(!more)} className="catalog-panel-heading mt-4 flex h-8 w-full items-center gap-2 border border-border px-2 text-xs font-semibold hover:bg-selection">{more ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{t("moreOptions")}</button>
        {more && <div className="border border-t-0 border-border p-3"><Lbl tip={x.tipDefAttr}>{t("defAttr")}</Lbl><ChoiceCombo label={t("defAttr")} className="w-full" value={String(source.defAttr)} onChange={(value) => store.update(source.id, { defAttr: Number(value) })} options={DEFAULT_ATTRS.map((a) => ({ value: String(a.num), label: a.num ? `${a.num} -- ${a.name}` : t("none") }))} />
        </div>}
      </div> : <div className="p-6 text-center text-muted-foreground">{t("extEmpty")}</div>}</div></div>
    </div> : <>
      <div ref={box} className="flex min-h-0 flex-1 pt-3">
        <div style={{ width: `${split}%` }} className="flex min-w-0 flex-col border border-border"><div className="catalog-panel-heading flex h-7 shrink-0 items-center text-xs font-semibold"><span className="w-[46%] px-2">{t("code")}</span><span className="flex-1 px-2">{t("description")} (207)</span></div>
          <div ref={tree} role="tree" aria-label={t("extTitle")} aria-multiselectable tabIndex={0} className="relative min-h-0 flex-1 overflow-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={(e) => { const index = rows.findIndex((r) => r.id === selected[0]); if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const row = rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === "ArrowDown" ? 1 : -1)))]; if (row) setSelected([row.id]); } if ((e.ctrlKey || e.metaKey) && e.key === "a") { e.preventDefault(); setSelected(rows.map((r) => r.id)); } }}>
            <div style={{ height: rows.length * 32, position: "relative" }}>{source && <StickyTreeParents rows={stickyParents(rows, source.data.nodes, rowIndices, scrollTop, 32)} nodes={source.data.nodes} scrollTop={scrollTop} column="46%" selected={selected} onSelect={(id) => { setSelected([id]); const index = rowIndices.get(id); if (tree.current && index !== undefined) { tree.current.scrollTop = index * 32; setScrollTop(index * 32); } }} onCollapse={(id) => setExpanded((s) => ({ ...s, [id]: false }))} />}{visible.map((row, i) => { const n = source?.data.nodes[row.id]; if (!n || !source) return null; const active = selected.includes(n.id); return <div key={n.id} role="treeitem" aria-selected={active} aria-expanded={n.children?.length ? !!expanded[n.id] : undefined} data-external-id={n.id} data-draggable-row draggable onDragStart={(e) => { if ((e.target as HTMLElement).closest("button,input,textarea,select")) { e.preventDefault(); return; } const ids = active ? selected : [n.id]; dragExternal.current = { data: source.data, ids }; e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("application/smartcatalog-external", n.id); if (!active) setSelected(ids); }} onDragEnd={() => { dragExternal.current = null; }} style={{ position: "absolute", top: (start + i) * 32, left: 0, right: 0, height: 32 }} className={`flex cursor-default select-none items-center border-b border-border/50 text-xs ${active ? "catalog-selected-row bg-selection" : (start + i) % 2 ? "bg-row-alt" : "bg-background"}`} onClick={(e) => select(n.id, e)}>
              <div className="relative flex h-full w-[46%] min-w-0 items-center gap-1.5 pl-4 pr-2" style={{ paddingLeft: 16 + row.depth * 16 }}><RowDragGrip className="absolute left-1" />{n.children?.length ? <Button variant="ghost" size="icon" className="h-6 w-4 shrink-0 p-0" aria-label={t(expanded[n.id] ? "collapseAll" : "expandAll")} onClick={(e) => { e.stopPropagation(); setExpanded((s) => ({ ...s, [n.id]: !s[n.id] })); }}>{expanded[n.id] || query ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</Button> : <span className="w-4 shrink-0" />}<NodeIcon node={n} /><span className="truncate" title={`${n.name}\n${n.description}`}>{n.name}</span></div><span className="min-w-0 flex-1 truncate px-2" title={n.description}>{n.description}</span>{n.children && <span className="w-7 pr-2 text-right text-[10px] text-muted-foreground">{n.children.length}</span>}
            </div>; })}</div>{!rows.length && <div className="p-8 text-center text-xs text-muted-foreground">{t(source ? "extNoResults" : "extEmpty")}</div>}
          </div><div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">{t("extSelected", { n: selected.length })}</div>
        </div>
        <div role="separator" aria-orientation="vertical" className="w-3 shrink-0 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); const move = (ev: MouseEvent) => { const r = box.current?.getBoundingClientRect(); if (r) setSplit(Math.max(30, Math.min(70, (ev.clientX - r.left) / r.width * 100))); }; const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); }} />
        <div className="flex min-w-0 flex-1 flex-col border border-border"><div className="catalog-panel-heading flex h-7 shrink-0 items-center gap-2 px-2 text-xs font-semibold"><span className="truncate">{current?.name ?? t("extSelect")}</span></div><div className="min-h-0 flex-1 overflow-auto">
          {current ? <>{[{ num: TITLE, name: t("title"), value: current.name }, { num: 207, name: t("description"), value: current.description }, ...[...new Set([...(current.attrOrder ?? []), ...Object.keys(current.attrs).map(Number)])].filter((num) => num !== 207 && num !== source?.defAttr && current.attrs[num] !== undefined).map((num) => ({ num, name: ATTRIBUTE_CATALOG.find((a) => a.num === num)?.name ?? t("attribute"), value: current.attrs[num] ?? "" }))].map((attr, i) => { const def = ATTRIBUTE_CATALOG.find((a) => a.num === attr.num); return <div key={attr.num} data-external-attr={attr.num} data-draggable-row draggable onClick={(e) => { const nums = [TITLE, 207, ...Object.keys(current.attrs).map(Number).filter((n) => n !== 207)]; if (e.shiftKey && attrAnchor.current !== null) { const a = nums.indexOf(attrAnchor.current), b = nums.indexOf(attr.num); setAttrKeys(nums.slice(Math.min(a, b), Math.max(a, b) + 1)); } else { setAttrKeys(e.ctrlKey || e.metaKey ? attrKeys.includes(attr.num) ? attrKeys.filter((k) => k !== attr.num) : [...attrKeys, attr.num] : [attr.num]); attrAnchor.current = attr.num; } }} onDragStart={(e) => { if ((e.target as HTMLElement).closest("input,textarea,button,select")) { e.preventDefault(); return; } const keys = attrKeys.includes(attr.num) ? attrKeys : [attr.num]; setAttrKeys(keys); dragExternalAttrs.current = { data: source.data, nodeIds: selected, keys }; e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("application/smartcatalog-external-attrs", keys.join(",")); }} onDragEnd={() => { dragExternalAttrs.current = null; }} className={`relative grid grid-cols-[3rem_minmax(6rem,1fr)_2.5rem_minmax(0,2fr)] items-start gap-2 border-b border-border/50 py-2 pl-3 pr-2 ${attrKeys.includes(attr.num) ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : "bg-background"}`}><RowDragGrip className="absolute left-0 top-2" /><span className="flex h-7 w-12 shrink-0 items-center justify-center attribute-number rounded-sm border text-[11px]">{attr.num === TITLE ? <NodeIcon node={current} /> : attr.num}</span><span className="min-w-0 truncate pt-1.5 text-[11px] font-semibold" title={def?.comment}>{attr.name}</span><span className="pt-1.5 text-right text-[10px] text-muted-foreground">{def?.type === "dec" ? "0,0" : def?.type === "int" ? "123" : "ABC"}</span><div className="min-w-0"><AttributeValueField num={attr.num} value={attr.value} attrs={current.attrs} readOnly /></div></div>; })}</> : <div className="p-8 text-center text-xs text-muted-foreground">{t("extSelect")}</div>}
        </div></div>
      </div>
    </>}
    {pendingBrowse !== null && <Dialog title={t("extSaveOrganization")} width={510} height={230} resizable={false} onClose={() => setPendingBrowse(null)} footer={<><Button variant="outline" className={DIALOG_BTN} onClick={() => finishBrowse(true)}>{t("saveBtn")}</Button><Button variant="outline" className={DIALOG_BTN} onClick={() => finishBrowse(false)}>{t("extContinue")}</Button><Button variant="outline" className={DIALOG_BTN} onClick={() => setPendingBrowse(null)}>{t("close")}</Button></>}><p className="mt-4 text-sm text-foreground">{t("extSaveOrganizationInfo")}</p></Dialog>}
    <input ref={dataFolderFile} type="file" {...{ webkitdirectory: "", directory: "" }} className="hidden" onChange={(e) => { const relative = e.target.files?.[0]?.webkitRelativePath; const id = dataFolderSource.current; if (id && relative) store.update(id, { dataSource: relative.split("/")[0] ?? "" }); e.target.value = ""; }} />
    <input ref={file} type="file" accept=".json,.xml,.db,.sqlite,.mdb" className="hidden" onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
    <input ref={iconFile} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f || (!source && !folder)) return; const id = folder?.id ?? source?.id; if (!id) return; const isFolder = !!folder; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === "string") isFolder ? store.updateFolder(id, { icon: reader.result }) : store.update(id, { icon: reader.result }); }; reader.readAsDataURL(f); e.target.value = ""; }} />
    <input ref={listFile} type="file" accept=".json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { const list = parseLibraryList(JSON.parse(await f.text())); if (!list) throw new Error(); useExternalLibraries.setState({ ...list, active: list.sources[0]?.id ?? "" }); setFolderId(null); setError(""); } catch { setError(t("extListInvalid")); } }} />
    {newLibrary && <Dialog title={t("extNewLibrary")} width={480} height={330} resizable={false} onClose={() => setNewLibrary(false)} footer={<><Button variant="outline" className={DIALOG_BTN} disabled={!url || loading} onClick={() => void loadUrl()}>{loading ? t("extLoading") : t("add")}</Button><Button variant="outline" className={DIALOG_BTN} onClick={() => setNewLibrary(false)}>{t("quit")}</Button></>}><label className="mt-3 block space-y-1.5 text-xs font-semibold">{t("catName")}<input aria-label={t("catName")} value={libraryName} onChange={(e) => setLibraryName(e.target.value)} className={input} /></label><div className="mt-4 flex gap-2"><Button variant="outline" onClick={() => openFile()}><FolderOpen className="h-4 w-4 text-ribbon-dark" />{t("extFile")}</Button><Globe className="my-auto h-4 w-4 text-ribbon-dark" /><input aria-label={t("extUrl")} placeholder="https://" type="url" value={url} onChange={(e) => setUrl(e.target.value)} className={input} /></div>{error && <div role="alert" className="mt-3 text-xs text-destructive">{error}</div>}</Dialog>}
  </Dialog>;
}