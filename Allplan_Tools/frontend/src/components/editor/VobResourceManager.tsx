import { vobUserResourcesFirst } from "@/lib/vob-presentation";
import { vobArtwork } from "@/lib/vob-artwork";
import { ResourceManagerHeading } from "./ResourceManagerHeading";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, FolderOpen, RefreshCw, Search, RotateCcw, Plus, X, Star, UserRound, FolderPlus, Briefcase, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVobEditor, type VobFile, type VobRule } from "@/lib/vob-editor";
import { useVobResources, peekVobSession, peekVobHeader, setVobSessionHeader, stepVobSession, peekVobSessionState, vobPathKey, isAllplanVobFile, toggleVobFavorite, vobFileHasChanges, removeAddedVobFile, removeVobProject, type VobProject } from "@/lib/vob-resources";
import { vobSwitch, vobListFiles, vobAddFiles, vobAddProject, vobPreviewDocument, vobDefaultHeader, vobSaveFile, vobRevealFile, useVobHost } from "@/lib/vob-bridge";
import { vobDroppedPaths } from "@/lib/vob-file-drop";
import { askConfirmation, askChoice, showMessage } from "@/lib/app-dialog";
import { MenuFlag } from "./MenuFlag";
import { VobRulePreview } from "./VobRulePreview";
import { Textarea } from "@/components/ui/textarea";
import { stripVobComment } from "@/lib/vob-editor";
import { useVobViewSettings } from "@/lib/vob-view-settings";
import type { VobColumn } from "@/lib/vob-view";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { includeVobVersion, managerVobFiles } from "@/lib/vob-manager-filter";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

const Logo = () => <img src={vobArtwork.allplan} alt="" className="h-4 w-4 shrink-0" draggable={false} />;

export function VobResourceManager({ fr, columns, display, displayIndex }: { fr: boolean; columns: [VobColumn, string][]; display: (rule: VobRule, column: VobColumn) => string; displayIndex: (rule: VobRule, column: VobColumn) => string }) {
  const text = (a: string, b: string) => fr ? a : b;
  const { files, file: current, rules: currentRules, header: currentHeader } = useVobEditor();
  const groupBy = useVobViewSettings((s) => s.groupBy);
  // Preview follows the row the user picks, not only the opened file (browser preview has no host to open files).
  const picked = useVobResources((s) => s.picked); const setPicked = (path: string | null) => useVobResources.setState({ picked: path });
  const file = files.find((f) => f.path === picked) ?? current;
  const headerRef = useRef<HTMLTextAreaElement>(null);
  const focusHeader = useVobResources((s) => s.focusHeader);
  useEffect(() => { if (!focusHeader) return; setPicked(null); const id = requestAnimationFrame(() => { headerRef.current?.focus(); useVobResources.setState({ focusHeader: false }); }); return () => cancelAnimationFrame(id); }, [focusHeader]);
  // Persisted with the VOB view settings so the splitter keeps its position.
  const headerHeight = useVobViewSettings((s) => s.headerHeight); const setHeaderHeight = (headerHeight: number) => useVobViewSettings.getState().set({ headerHeight });
  const dragHeader = (e: React.MouseEvent) => { e.preventDefault(); const y = e.clientY, h = headerHeight; const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const move = (ev: MouseEvent) => setHeaderHeight(Math.max(64, Math.min(box.height - 80, h + ev.clientY - y)));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); };
  const [preview, setPreview] = useState<{ path: string; rules: VobRule[] | null; header: string[] | null; loading: boolean } | null>(null);
  const loadPreview = async (path: string) => {
    const mem = path === current?.path ? currentRules : peekVobSession(path);
    if (mem) { setPreview({ path, rules: mem, header: path === current?.path ? currentHeader : peekVobHeader(path), loading: false }); return; }
    setPreview({ path, rules: null, header: null, loading: true }); const doc = await vobPreviewDocument(path);
    setPreview((p) => p?.path === path ? { path, rules: doc?.rules ?? null, header: doc?.header ?? null, loading: false } : p);
  };
  useEffect(() => { if (file?.path) void loadPreview(file.path); else setPreview(null); }, [file?.path, current?.path, currentRules, currentHeader]); const { busy, addedFiles, favorites, addedProjects } = useVobResources();
  const [query, setQuery] = useState(""); const [closed, setClosed] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false); const [version, setVersion] = useState("all");
  const [split, setSplit] = useState(50); const box = useRef<HTMLDivElement>(null);
  const addOff = useVobHost((s) => !!s.unavailable["vob.files.add"]); const projectOff = useVobHost((s) => !!s.unavailable["vob.projects.add"]);
  const addedKeys = new Set(addedFiles.map((f) => vobPathKey(f.path)));
  const isImported = (f: VobFile) => addedKeys.has(vobPathKey(f.path));
  const isAdded = (f: VobFile) => isImported(f) && !isAllplanVobFile(f);
  // Only versions that actually contain at least one file are offered.
  const inventory = managerVobFiles(files, current, "");
  const versions = [...new Set(inventory.flatMap((f) => !isAdded(f) && f.version ? [f.version] : []))].sort((a, b) => b.localeCompare(a));
  // Allplan resolution priority (2027+): PRJ > STD > ETC; Python supplies source, never inferred from names.
  const ORDER = ["PRJ", "STD", "ETC"]; const rank = (f: VobFile) => { const i = ORDER.indexOf((f.source ?? "").toUpperCase()); return i < 0 ? 9 : i; };
  const list = managerVobFiles(files, current, query);
  const favLabel = text("Mes favoris", "My favorites"), userLabel = text("Ajoutés par l’utilisateur", "Added by the user");
  const groups: { key: string; label: string; icon: "fav" | "user" | "allplan"; entries: VobFile[] }[] = [];
  const favs = list.filter((f) => favorites.includes(vobPathKey(f.path)));
  if (favs.length) groups.push({ key: "fav", label: favLabel, icon: "fav", entries: favs });
  for (const v of versions) if (includeVobVersion(v, version, current)) groups.push({ key: v, label: `Allplan ${v}`, icon: "allplan", entries: list.filter((f) => !isAdded(f) && f.version === v).sort((a, b) => rank(a) - rank(b)) });
  groups.push({ key: "user", label: userLabel, icon: "user", entries: list.filter((f) => isAdded(f) || (!f.version && f.path === current?.path)) });
  /** Header edits: opened file goes through the editor history, other files through their own session history. */
  const commitHeader = (f: VobFile, next: string[], typing: boolean) => {
    if (f.path === useVobEditor.getState().file?.path) { useVobEditor.getState().setHeader(next, { typing }); return; }
    setPreview((p) => { if (!p?.rules || p.path !== f.path) return p; setVobSessionHeader(f, p.rules, p.header ?? [], next, typing); return { ...p, header: next }; });
  };
  const stepHeader = (f: VobFile, direction: "undo" | "redo") => {
    if (f.path === useVobEditor.getState().file?.path) { const st = useVobEditor.getState(); if (direction === "undo") st.undo(); else st.redo(); return; }
    const next = stepVobSession(f.path, direction); if (next) setPreview((p) => p?.path === f.path ? { ...p, header: next } : p);
  };
  /** Refreshing with header changes asks to save; refusing restores the original header (undoable). */
  const refreshPreview = async (f: VobFile) => {
    const active = f.path === useVobEditor.getState().file?.path; const session = peekVobSessionState(f.path);
    const now = active ? useVobEditor.getState().header : session?.header; const original = active ? useVobEditor.getState().savedHeader : session?.savedHeader;
    if (now && original && JSON.stringify(now) !== JSON.stringify(original)) {
      const choice = await askChoice(text(`L’en-tête de « ${f.name} » a été modifié. Enregistrer avant d’actualiser l’aperçu ?`, `The header of “${f.name}” was modified. Save before refreshing the preview?`), [{ value: "save", label: text("Enregistrer", "Save") }, { value: "discard", label: text("Ne pas enregistrer", "Don’t save") }]);
      if (!choice) return;
      if (choice === "save") { if (!(await vobSaveFile(f.path))) return; }
      else if (active) useVobEditor.getState().setHeader(original);
      else if (session) { setVobSessionHeader(f, session.rules, original, original, false); setPreview((p) => p?.path === f.path ? { ...p, header: original } : p); }
    }
    await loadPreview(f.path);
  };
  const editText = (f: VobFile, action: "cut" | "copy" | "paste" | "delete" | "all") => {
    const t = headerRef.current; if (!t) return; const a = t.selectionStart, b = t.selectionEnd, sel = t.value.slice(a, b);
    const replace = (insert: string) => { commitHeader(f, (t.value.slice(0, a) + insert + t.value.slice(b)).split("\n").map(stripVobComment), false); requestAnimationFrame(() => { t.focus(); t.setSelectionRange(a + insert.length, a + insert.length); }); };
    if (action === "all") { t.focus(); t.select(); return; }
    if (action === "copy" || action === "cut") { if (sel) void navigator.clipboard?.writeText(sel).catch(() => {}); if (action === "cut" && sel) replace(""); else t.focus(); return; }
    if (action === "delete") { replace(""); return; }
    void (navigator.clipboard?.readText() ?? Promise.reject()).then((clip) => replace(clip.replace(/\r\n?/g, "\n")), () => showMessage(text("Le presse-papiers n’est pas accessible : utilisez Ctrl+V.", "The clipboard is not accessible: use Ctrl+V.")));
  };
  const open = async (path: string) => { if (await vobSwitch(path)) useVobResources.setState({ manager: false }); };
  const removeProject = async (p: VobProject) => { if (await askConfirmation(text(`Retirer le projet « ${p.name} » de la liste ? Le dossier et ses fichiers ne sont pas supprimés.`, `Remove project “${p.name}” from the list? The folder and its files are not deleted.`))) removeVobProject(p.path); };
  const remove = async (f: VobFile) => { if (await askConfirmation(text(`Retirer « ${f.name} » de la liste ? Le fichier n’est pas supprimé du disque.`, `Remove “${f.name}” from the list? The file is not deleted from disk.`))) removeAddedVobFile(f.path); };
  const fileActions = (f: VobFile) => [
    { label: text("Ouvrir dans l’éditeur", "Open in editor"), icon: FolderOpen, action: () => void open(f.path), disabled: busy },
    { label: text("Actualiser l’aperçu", "Refresh preview"), icon: RefreshCw, action: () => { setPicked(f.path); void refreshPreview(f); }, disabled: preview?.loading },
    { label: favorites.includes(vobPathKey(f.path)) ? text("Retirer de mes favoris", "Remove from favorites") : text("Ajouter à mes favoris", "Add to favorites"), icon: Star, action: () => toggleVobFavorite(f.path) },
    { label: text("Ouvrir le dossier du fichier", "Open containing folder"), icon: FolderOpen, action: () => void vobRevealFile(f.path, "folder") },
    ...(isImported(f) ? [{ label: text("Retirer de la liste…", "Remove from list…"), icon: X, action: () => void remove(f), disabled: busy }] : []),
  ];
  const drag = (e: React.MouseEvent) => { e.preventDefault(); const move = (m: MouseEvent) => { const r = box.current?.getBoundingClientRect(); if (r) setSplit(Math.min(80, Math.max(20, ((m.clientX - r.left) / r.width) * 100))); }; const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); };
  return <div ref={box} className="mgr-in flex min-h-0 flex-1 px-4 py-3">
    <section aria-label={text("Explorateur de fichiers VOB", "VOB file explorer")} style={{ width: `${split}%` }} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragging(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={(e) => { e.preventDefault(); setDragging(false); void vobAddFiles(vobDroppedPaths(e.dataTransfer)); }} className={`flex min-h-0 min-w-0 flex-col border border-border ${dragging ? "outline-2 -outline-offset-2 outline-dashed outline-drop-preview-border bg-drop-preview" : ""}`}>
      <ResourceManagerHeading title={text("VOB & gestionnaire de ressources", "VOB & resources manager")} icon={<FolderOpen className="h-4 w-4 text-ribbon-dark" />}> <Button variant="outline" size="sm" className="h-8 w-40 shrink-0 gap-1.5 rounded-sm bg-background px-2 text-xs" disabled={busy} title={text("Relancer la recherche des fichiers VOB dans toutes les versions Allplan et les projets ajoutés", "Search again for VOB files in every Allplan version and added project")} onClick={() => void vobListFiles()}><RefreshCw className={`h-3.5 w-3.5 text-ribbon-dark ${busy ? "animate-spin" : ""}`} />{text("Actualiser la liste", "Refresh list")}</Button></ResourceManagerHeading>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <Select value={version} onValueChange={setVersion}><SelectTrigger aria-label={text("Version Allplan", "Allplan version")} className="h-8 w-44 gap-2 rounded-sm text-xs"><SelectValue /></SelectTrigger><SelectContent className="rounded-sm text-xs"><SelectItem value="all" className="text-xs"><span className="flex items-center gap-2"><Logo />{text("Toutes les versions", "All versions")}</span></SelectItem>{versions.map((v) => <SelectItem key={v} value={v} className="text-xs"><span className="flex items-center gap-2"><Logo />Allplan {v}</span></SelectItem>)}</SelectContent></Select>
        <div className="flex h-8 min-w-40 flex-1 items-center border border-border bg-background"><Search className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" /><Input aria-label={text("Rechercher un fichier VOB", "Search VOB files")} placeholder={text("Rechercher un fichier VOB ou un chemin…", "Search VOB files or paths…")} value={query} onChange={(e) => setQuery(e.target.value)} className="h-full min-w-0 border-0 bg-transparent text-xs shadow-none" />{query && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={text("Effacer la recherche", "Clear search")} onClick={() => setQuery("")}><X className="h-3.5 w-3.5" /></Button>}</div>
        <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2"><Button variant="outline" size="sm" className="h-8 w-40 shrink-0 gap-1.5 rounded-sm bg-background px-2 text-xs" disabled={busy || addOff} onClick={() => void vobAddFiles()}><Plus className="h-4 w-4" />{text("Ajouter des fichiers", "Add files")}</Button>
        <Button variant="outline" size="sm" className="h-8 w-40 shrink-0 gap-1.5 rounded-sm bg-background px-2 text-xs" disabled={busy || projectOff} title={text("Choisir un ou plusieurs dossiers de projet Allplan contenant des fichiers VOB (2027+)", "Choose one or more Allplan project folders containing VOB files (2027+)")} onClick={() => void vobAddProject()}><FolderPlus className="h-4 w-4" />{text("Ajouter des projets", "Add projects")}</Button>
        </div>
      </div>
      <ContextMenu><ContextMenuTrigger asChild><div className="vob-resource-sections min-h-0 flex-1 overflow-auto">{addedProjects.length > 0 && <div><div className="flex h-8 items-center gap-2 bg-panel px-2 text-xs"><Briefcase className="h-4 w-4 text-ribbon-dark" /><span>{text("Projets ajoutés", "Added projects")}</span><span className="text-muted-foreground">({addedProjects.length})</span></div>{addedProjects.map((p, i) => <div key={p.path} className={`group flex h-8 items-center pl-12 text-xs ${i % 2 ? "bg-row-alt" : "bg-background"}`}><span className="truncate" title={p.path}>{p.name}</span><span className="ml-2 min-w-0 truncate text-[10px] text-muted-foreground">{p.path}</span><Button variant="ghost" size="icon" className="ml-auto mr-1 h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title={text("Retirer le projet de la liste", "Remove project from list")} onClick={() => void removeProject(p)}><X className="h-3.5 w-3.5" /></Button></div>)}</div>}{vobUserResourcesFirst(groups).map((g) => <div key={g.key} className={g.key === "user" ? "vob-resource-section-user" : undefined}>
        <Button variant="ghost" onClick={() => setClosed((old) => old.includes(g.key) ? old.filter((p) => p !== g.key) : [...old, g.key])} className="sticky top-0 z-10 flex h-8 w-full justify-start gap-2 rounded-none bg-panel px-2 text-xs">{closed.includes(g.key) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}{g.icon === "allplan" ? <Logo /> : g.icon === "fav" ? <Star className="h-4 w-4 fill-current text-icon-link" /> : <UserRound className="h-4 w-4 text-ribbon-dark" />}<span className="truncate">{g.label}</span><span className="shrink-0 text-muted-foreground">({g.entries.length})</span></Button>
        {(!closed.includes(g.key) || g.entries.some((f) => f.path === current?.path)) && (g.entries.length ? g.entries.filter((f) => !closed.includes(g.key) || f.path === current?.path).map((f, i) => { const isPicked = file?.path === f.path; const opened = current?.path === f.path; const fav = favorites.includes(vobPathKey(f.path)); return <div key={`${g.key}-${f.id}`} onContextMenu={() => setPicked(f.path)} className={`vob-resource-row group flex h-9 items-center ${isPicked ? "catalog-selected-row bg-selection font-semibold" : i % 2 ? "bg-row-alt" : "bg-background"}`}>
          <Button variant="ghost" disabled={busy} aria-current={isPicked ? "true" : undefined} onClick={() => setPicked(f.path)} onDoubleClick={() => void open(f.path)} className="flex h-full min-w-0 flex-1 justify-start rounded-none items-center gap-2 pl-12 pr-2 text-left text-xs font-normal"><MenuFlag filename={f.name} /><span className="truncate" title={f.path}>{f.name}</span>{f.source && !isAdded(f) && <span className="shrink-0 rounded-sm border border-border px-1 text-[10px] font-normal text-muted-foreground">{f.source.toUpperCase()}{f.projectName ? ` · ${f.projectName}` : ""}</span>}{opened && <span className="shrink-0 rounded-sm bg-ribbon-dark px-1.5 text-[10px] font-medium text-primary-foreground">{text("Ouvert", "Open")}</span>}{isAdded(f) && <span className="shrink-0 text-[10px] font-normal text-muted-foreground">{text("Version inconnue", "Unknown version")}</span>}{vobFileHasChanges(f.path) && <span className="shrink-0 text-[10px] font-medium text-icon-link">● {text("Modifications en cours", "Unsaved changes")}</span>}</Button>
          <Button variant="ghost" size="icon" className={`h-7 w-7 shrink-0 ${fav ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`} aria-pressed={fav} title={fav ? text("Retirer de mes favoris", "Remove from favorites") : text("Ajouter à mes favoris", "Add to favorites")} onClick={() => toggleVobFavorite(f.path)}><Star className={`h-3.5 w-3.5 ${fav ? "fill-current text-icon-link" : "text-muted-foreground"}`} /></Button>
          <DropdownMenu onOpenChange={(opened) => { if (opened) setPicked(f.path); }}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={text(`Actions pour ${f.name}`, `Actions for ${f.name}`)} onClick={() => setPicked(f.path)}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent className="w-60 rounded-sm">{fileActions(f).map((a) => <DropdownMenuItem key={a.label} className="gap-2 text-xs" disabled={!!a.disabled} onSelect={a.action}><a.icon className="h-4 w-4 text-ribbon-dark" />{a.label}</DropdownMenuItem>)}<DropdownMenuSeparator /><DropdownMenuItem className="gap-2 text-xs" disabled={busy || addOff} onSelect={() => void vobAddFiles()}><Plus className="h-4 w-4 text-ribbon-dark" />{text("Ajouter des fichiers", "Add files")}</DropdownMenuItem><DropdownMenuItem className="gap-2 text-xs" disabled={busy || projectOff} onSelect={() => void vobAddProject()}><FolderPlus className="h-4 w-4 text-ribbon-dark" />{text("Ajouter des projets", "Add projects")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          {isImported(f) && <Button variant="ghost" size="icon" className="mr-1 h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" title={text("Retirer de la liste", "Remove from list")} onClick={() => void remove(f)}><X className="h-3.5 w-3.5" /></Button>}
        </div>; }) : <div className="py-2 pl-12 text-xs text-muted-foreground">{g.icon === "user" ? text("Ajoutez ou déposez un fichier ici", "Add or drop a file here") : text("Aucun fichier", "No files")}</div>)}
      </div>)}</div></ContextMenuTrigger><ContextMenuContent className="w-60 rounded-sm">{file && fileActions(file).map((a) => <ContextMenuItem key={a.label} className="gap-2 text-xs" disabled={!!a.disabled} onSelect={a.action}><a.icon className="h-4 w-4 text-ribbon-dark" />{a.label}</ContextMenuItem>)}<ContextMenuSeparator /><ContextMenuItem className="gap-2 text-xs" disabled={busy || addOff} onSelect={() => void vobAddFiles()}><Plus className="h-4 w-4 text-ribbon-dark" />{text("Ajouter des fichiers", "Add files")}</ContextMenuItem><ContextMenuItem className="gap-2 text-xs" disabled={busy || projectOff} onSelect={() => void vobAddProject()}><FolderPlus className="h-4 w-4 text-ribbon-dark" />{text("Ajouter des projets", "Add projects")}</ContextMenuItem><ContextMenuItem className="gap-2 text-xs" disabled={busy} onSelect={() => void vobListFiles()}><RefreshCw className="h-4 w-4 text-ribbon-dark" />{text("Actualiser la liste", "Refresh list")}</ContextMenuItem></ContextMenuContent></ContextMenu>
    </section>
    <div role="separator" aria-orientation="vertical" aria-label={text("Redimensionner", "Resize")} onMouseDown={drag} onDoubleClick={() => setSplit(50)} className="vob-splitter w-3 shrink-0 cursor-col-resize" />
    <section aria-label={text("En-tête et aperçu", "Header and preview")} className="flex min-h-0 min-w-0 flex-1 flex-col border border-border">
      <div className="catalog-panel-heading flex h-10 shrink-0 items-center gap-2 px-3"><h2 className="min-w-0 flex-1 font-semibold">{text("En-tête et aperçu", "Header and preview")}</h2>{file?.path === current?.path && current && <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 rounded-sm bg-transparent px-2 text-xs hover:bg-background/60" title={text("Remplacer l’en-tête par les commentaires de base fournis par Allplan", "Replace the header with Allplan's default comments")} onClick={async () => { const base = await vobDefaultHeader(current); if (!currentHeader.length || await askConfirmation(text("Remplacer l’en-tête actuel par les commentaires de base ?", "Replace the current header with the default comments?"))) useVobEditor.getState().setHeader(base); }}><RotateCcw className="h-3.5 w-3.5 text-ribbon-dark" />{text("Commentaires de base", "Default comments")}</Button>}{file && <Button variant="outline" size="sm" className="h-8 w-40 shrink-0 gap-1.5 rounded-sm bg-background px-2 text-xs" disabled={preview?.loading} title={text("Relire le fichier sélectionné pour actualiser l’aperçu", "Read the selected file again to refresh the preview")} onClick={() => void refreshPreview(file)}><RefreshCw className={`h-3.5 w-3.5 text-ribbon-dark ${preview?.loading ? "animate-spin" : ""}`} />{text("Actualiser l’aperçu", "Refresh preview")}</Button>}</div>
      <div className="flex min-h-0 flex-1 flex-col" key={file?.path ?? "empty"}>
        {file && (() => { const active = file.path === current?.path; const lines = active ? currentHeader : preview?.header ?? null; return <><div className="flex shrink-0 flex-col overflow-hidden" style={{ height: headerHeight }}>
          <ContextMenu><ContextMenuTrigger asChild><Textarea ref={headerRef} aria-label={text("Commentaires d’en-tête", "Header comments")} spellCheck={false} value={(lines ?? []).join("\n")} disabled={!active && !preview?.rules}
            onKeyDown={(e) => { const k = e.key.toLowerCase(); if (!(e.ctrlKey || e.metaKey) || (k !== "z" && k !== "y")) return; e.preventDefault(); e.stopPropagation(); stepHeader(file, k === "y" || e.shiftKey ? "redo" : "undo"); }}
            onChange={(e) => commitHeader(file, e.target.value.split("\n").map(stripVobComment), true)} placeholder={text("Une ligne par commentaire, sans « // » (ajoutés à l’enregistrement)", "One comment per line, without “//” (added when saving)")} className="min-h-0 flex-1 resize-none rounded-none border-0 px-3 pt-2 pb-5 font-mono text-[11px] text-muted-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" /></ContextMenuTrigger>
          <ContextMenuContent className="w-52 rounded-sm">{(() => { const off = !active && !preview?.rules; const canUndo = active ? useVobEditor.getState().past.length > 0 : !!peekVobSessionState(file.path)?.past.length; const canRedo = active ? useVobEditor.getState().future.length > 0 : !!peekVobSessionState(file.path)?.future.length;
            const item = (label: string, keys: string, disabled: boolean, onSelect: () => void) => <ContextMenuItem key={label} className="text-xs" disabled={disabled} onSelect={onSelect}>{label}<span className="ml-auto text-[10px] text-muted-foreground">{keys}</span></ContextMenuItem>;
            return <>{item(text("Annuler", "Undo"), "Ctrl+Z", off || !canUndo, () => stepHeader(file, "undo"))}{item(text("Rétablir", "Redo"), "Ctrl+Y", off || !canRedo, () => stepHeader(file, "redo"))}<ContextMenuSeparator />
              {item(text("Couper", "Cut"), "Ctrl+X", off, () => editText(file, "cut"))}{item(text("Copier", "Copy"), "Ctrl+C", false, () => editText(file, "copy"))}{item(text("Coller", "Paste"), "Ctrl+V", off, () => editText(file, "paste"))}{item(text("Supprimer", "Delete"), "Suppr", off, () => editText(file, "delete"))}<ContextMenuSeparator />
              {item(text("Tout sélectionner", "Select all"), "Ctrl+A", false, () => editText(file, "all"))}</>; })()}</ContextMenuContent></ContextMenu>
        </div>
        <div role="separator" aria-orientation="horizontal" aria-label={text("Redimensionner l’en-tête", "Resize header")} onMouseDown={dragHeader} onDoubleClick={() => setHeaderHeight(168)} className="h-1 shrink-0 cursor-row-resize" /></>; })()}
        <div aria-label={text("Tableau d’aperçu VOB", "VOB preview table")} className="h-0 min-h-0 flex-1 overflow-x-auto overflow-y-auto" onDoubleClick={(e) => { if (file && !busy && !(e.target instanceof Element && e.target.closest('[role="separator"]'))) void open(file.path); }}>
          {preview?.rules ? <VobRulePreview key={preview.path} rules={preview.rules} groupBy={groupBy} columns={columns} display={display} displayIndex={displayIndex} />
            : <div className="flex h-full flex-col items-center justify-center gap-4 px-4"><FileText className="h-24 w-24 shrink-0 text-ribbon-dark" strokeWidth={1} /><span className="text-center text-xs text-muted-foreground">{preview?.loading ? text("Lecture du fichier…", "Reading file…") : file ? text("Contenu indisponible : l’aperçu est fourni par l’application Python.", "Content unavailable: the preview is supplied by the Python application.") : ""}</span></div>}
        </div>
      </div>
    </section>
  </div>;
}
