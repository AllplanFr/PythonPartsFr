import { vobArtwork } from "@/lib/vob-artwork";
import { useEffect, useRef, useState, lazy, Suspense, type ReactNode } from "react";
import { FileText, X, Languages, Moon, Sun, Power, Undo2, Redo2, Info, LibraryBig, Save, SaveAll, MoreHorizontal, Languages as TranslateIcon, RotateCcw, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VobSearchBox } from "./VobSearchBox";
import { VobRuleTree, VOB_COLUMN_WIDTHS } from "./VobRuleTree";
import { formatVobFormula, VOB_COLUMNS, DEFAULT_VOB_GROUP, groupVobRules, defaultVobSearch, filterVobRules, filterVobValues, type VobValueFilters, type VobColumn } from "@/lib/vob-view";
import { VobResourceManager } from "./VobResourceManager";
import { VobBackupDialog } from "./VobBackupDialog";
import { useVobResources, vobDirtyPaths, vobPathKey } from "@/lib/vob-resources";
import duplicateIcon from "@/assets/icons/duplicate.svg";
import { VobGroupingMenu, VobFilterMenu, VobColumnsMenu } from "./VobViewMenus";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from "@/components/ui/dropdown-menu";
import { DIALOG_BTN } from "./FormulaTools";
import { AppMessageDialog } from "./AppMessageDialog";
import { AppTooltips } from "./AppTooltips";
import { FormulaEditor } from "./PropertyPanel";
import { CustomToolbar } from "./CustomToolbar";
import { FormulaFavoritesMenu } from "./FormulaFavoriteMenus";
import { useFormulaFavorites } from "@/lib/formula-favorites";
import { ChoiceCombo } from "./ChoiceCombo";
import { MenuFlag } from "./MenuFlag";
import { VobAboutDialog } from "./VobAboutDialog";
import { VobStatusBar } from "./VobStatusBar";
import { useCatalog } from "@/lib/catalog-store";
import { askConfirmation } from "@/lib/app-dialog";
import { interfaceText } from "@/modules/information_manager/lib/aim-interface";
import { vobTradeLabel } from "@/lib/vob-reference-display";
import { TradeLabelContext, useT, LANGS } from "@/lib/i18n";
import { connectSettings } from "@/lib/app-settings";
import { useVobViewSettings } from "@/lib/vob-view-settings";
import { connectVobHost, vobSwitch, vobSave, vobSaveFile, vobSaveFiles, vobListBackups, useVobHost } from "@/lib/vob-bridge";
import { normalizeVobIndex, type RefKey } from "@/lib/vob-references";
import { displayVobTableReference, vobDisplayOptions, vobDisplayCode, vobUndefinedLabel } from "@/lib/vob-reference-display";
import { showMessage } from "@/lib/app-dialog";
import { useVobEditor, vobHasChanges, selectedVobIds, commonVobValues, type VobRule } from "@/lib/vob-editor";

const FormulaFavoriteDialog = lazy(() => import("./FormulaFavoriteDialog").then((module) => ({ default: module.FormulaFavoriteDialog })));

/** Standalone VOB editor page; independent of the SmartCatalog workspace. */
export function VobEditorPage({ onClose, onHostIdentified }: { onClose: () => Promise<void>; onHostIdentified?: (info: unknown) => void }) {
  const s = useVobEditor(); const sharedT = useT(); const { lang, setLang, dark, setDark } = useCatalog(); const fr = lang === "fr";
  const t: typeof sharedT = (key, vars) => key === "trade" ? vobTradeLabel(lang) : sharedT(key, vars);
  const menuText = interfaceText(lang);
  const text = (a: string, b: string) => fr ? a : b;
  const favoritesOpen = useFormulaFavorites((state) => state.open);
  useEffect(() => { useFormulaFavorites.getState().hydrate(); }, []);
  useEffect(() => connectSettings("vob_editor"), []);
  const identifiedCallback = useRef(onHostIdentified); identifiedCallback.current = onHostIdentified;
  useEffect(() => connectVobHost((cfg) => { const st = useCatalog.getState(); if (cfg.lang) st.setLang(cfg.lang as never); if (typeof cfg.dark === "boolean") st.setDark(cfg.dark); }, useCatalog.getState().lang, (info) => identifiedCallback.current?.(info)), []);
  const resources = useVobResources();
  const host = useVobHost(); const openOff = !!host.unavailable["vob.open"], saveOff = !!host.unavailable[s.file ? "vob.save" : "vob.save_as"], saveAsOff = !!host.unavailable["vob.save_as"];
  const save = async () => { await vobSave(); };
  const [query, setQuery] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [searchOptions, setSearchOptions] = useState(defaultVobSearch);
  const vv = useVobViewSettings(); const groupBy = vv.groupBy; const setGroupBy = (groupBy: VobColumn) => vv.set({ groupBy });
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const widths = { ...VOB_COLUMN_WIDTHS, ...vv.widths }; const setWidth = (key: VobColumn, width: number) => useVobViewSettings.getState().set({ widths: { ...useVobViewSettings.getState().widths, [key]: width } });
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { const k = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; const typing = !!el?.closest("input, textarea, [contenteditable=true]");
    if ((e.ctrlKey || e.metaKey) && !typing && !useVobResources.getState().manager && e.key.toLowerCase() === "d") { e.preventDefault(); const st = useVobEditor.getState(); st.toggleEnabled(selectedVobIds(st)); return; }
    if ((e.ctrlKey || e.metaKey) && !typing && !useVobResources.getState().manager && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v")) { e.preventDefault(); if (e.key.toLowerCase() === "c") useVobEditor.getState().copy(); else useVobEditor.getState().paste(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!useVobHost.getState().unavailable["vob.save"] && vobHasChanges(useVobEditor.getState())) void save(); } }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  const visible = vv.visible; const setVisible = (visible: VobColumn[]) => vv.set({ visible });
  const split = vv.split; const setSplit = (split: number) => useVobViewSettings.getState().set({ split }); const panes = useRef<HTMLDivElement>(null);
  const drag = (e: React.MouseEvent) => { e.preventDefault(); const move = (ev: MouseEvent) => { const box = panes.current?.getBoundingClientRect(); if (box) setSplit(Math.min(80, Math.max(25, ((ev.clientX - box.left) / box.width) * 100))); }; const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); };
  const [valueFilters, setValueFilters] = useState<VobValueFilters>({});
  const selection = selectedVobIds(s);
  const selectedRules = s.rules.filter((r) => selection.includes(r.id));
  const common = commonVobValues(selectedRules); const rule = common?.rule;
  const mixed = common?.mixed;
  const updateSelection = (patch: Partial<Omit<VobRule, "id">>) => s.updateMany(selection, patch);
  const dirty = vobHasChanges(s);
  void resources.drafts; const dirtyPaths = vobDirtyPaths();
  // "Selection" = file picked in VOB & resources when it has changes, else the opened file.
  const savePick = dirtyPaths.find((p) => resources.manager && resources.picked && vobPathKey(p) === vobPathKey(resources.picked)) ?? (dirty ? s.file?.path : undefined);
  const ref = host.references;
  const lookup = (key: RefKey, value: string) => displayVobTableReference(ref, key, value, lang);
  const unset = vobUndefinedLabel(lang);
  // Options come only from the received reference; raw values already in the document stay selectable without inventing labels.
  const optionsFor = (key: RefKey) => vobDisplayOptions(ref, key, s.rules.map((r) => r[key]), lang);
  const trades = optionsFor("trade"), objects = optionsFor("object"), units = optionsFor("unit"), methods = optionsFor("method");
  const refStatus = ref.kind === "v2" ? (["trades", "objects", "units", "methods"] as const).map((c) => { const m = ref.data.metadata[c]; const name = { trades: t("trade"), objects: text("Objets", "Objects"), units: t("unit"), methods: text("Méthodes", "Methods") }[c]; const st = m.status === "available" ? text("disponible", "available") : m.status === "available_with_diagnostics" ? text("disponible avec diagnostics", "available with diagnostics") : text("indisponible", "unavailable"); const lang = m.status !== "unavailable" && m.sources.every((so) => so.language === null) ? text(" (langue non établie)", " (language not established)") : ""; const users = m.sources.flatMap((so) => so.scope === "USER" ? [`${name} — ${text("source utilisateur", "user source")} « ${so.label} » (${so.language})`] : []); return { short: `${name} : ${st}${lang}`, detail: [...users, ...m.diagnostics.map((d) => `${name} — ${d.message}${d.id !== null ? ` [${normalizeVobIndex(d.id)}]` : ""}`)] }; })
    : [{ short: ref.kind === "legacy_unverified" ? text("Référentiels : disponibilité non attestée — ancien contrat", "References: availability not attested — legacy contract") : ref.kind === "contract_error" ? text(`Référentiels : erreur de contrat — ${ref.message}`, `References: contract error — ${ref.message}`) : ref.kind === "error" ? text(`Référentiels : erreur — ${ref.message}`, `References: error — ${ref.message}`) : ref.kind === "loading" ? text("Référentiels : chargement…", "References: loading…") : text("Référentiels indisponibles", "References unavailable"), detail: [] }];
  const clearFilters = () => { setQuery(""); setSearchOptions(defaultVobSearch()); setValueFilters({}); };
  // Insertions never change filters silently: reveal after render, or say explicitly that filters hide them.
  const [reveal, setReveal] = useState<{ id: string; tick: number } | null>(null);
  const revealSelection = () => { const id = selectedVobIds(useVobEditor.getState())[0]; if (id) setReveal({ id, tick: Date.now() }); };
  const add = () => { s.add(); revealSelection(); };
  const paste = () => { s.paste(); revealSelection(); };
  const duplicate = (id?: string) => { s.duplicate(id); revealSelection(); };
  const filtered = Object.values(valueFilters).some((values) => values?.length) || !!query || searchOptions.errorsOnly || searchOptions.columns.length !== 6 || searchOptions.mode !== "contains" || searchOptions.matchCase;
  const close = onClose;
  const remove = async (all = false) => {
    if (await askConfirmation(all ? text("Supprimer toutes les règles ?", "Delete all rules?") : text(`Supprimer les ${selection.length} règle(s) sélectionnée(s) ?`, `Delete the ${selection.length} selected rule(s)?`))) useVobEditor.getState().remove(all);
  };
  const tool = (label: string, icon: ReactNode, action: () => void, disabled = false) => <Button variant="ghost" size="icon" aria-label={label} title={label} className="h-9 w-9 rounded-sm" disabled={disabled} onClick={() => action()}>{icon}</Button>;
  const quick = (label: string, icon: ReactNode, action: () => void, disabled = false, active = false) => <Button variant="ghost" size="icon" aria-label={label} title={label} aria-pressed={active || undefined} className={`h-7 w-7 shrink-0 rounded-sm p-0 text-ribbon-dark [&>svg]:h-[18px] [&>svg]:w-[18px] ${active ? "h-8 rounded-none bg-background hover:bg-background" : "hover:bg-background/60"}`} disabled={disabled} onClick={() => action()}>{icon}</Button>;
  const columnLabels: Record<VobColumn, string> = { trade: t("trade"), object: text("Objet", "Object"), unit: t("unit"), method: text("Méthode", "Method"), formula: t("formulaCol"), comment: text("Commentaire", "Comment") };
  const columns: [VobColumn, string][] = vv.order.map((key) => [key, columnLabels[key]]);
  const cellValue = (r: VobRule, key: VobColumn) => key === "trade" || key === "object" || key === "unit" || key === "method" ? lookup(key, r[key]) : key === "formula" ? formatVobFormula(r.formula) : r[key];
  const cellIndex = (r: VobRule, key: VobColumn) => key === "formula" || key === "comment" || !r[key] || r[key] === "-1" ? "" : vobDisplayCode(key, r[key]);
  const rows = filterVobRules(filterVobValues(s.rules, valueFilters), query, searchOptions, cellValue);
  const revealKey = reveal ? `${reveal.id}:${reveal.tick}` : "";
  useEffect(() => {
    if (!reveal) return;
    if (!rows.some((r) => r.id === reveal.id)) { setReveal(null); showMessage(text("La règle insérée est sélectionnée mais masquée par les filtres ou la recherche actifs.", "The inserted rule is selected but hidden by the active filters or search.")); return; }
    const group = groupVobRules(rows, groupBy, cellValue).find((g) => g.rules.some((r) => r.id === reveal.id));
    if (group && closed.has(group.value)) { setClosed((old) => { const next = new Set(old); next.delete(group.value); return next; }); return; }
    const frame = requestAnimationFrame(() => { document.querySelector(`[data-vob-rule-id="${CSS.escape(reveal.id)}"]`)?.scrollIntoView({ block: "nearest" }); setReveal(null); });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, closed]);
  const art = (url: string) => <img src={url} alt="" draggable={false} className="h-5 w-5 shrink-0 object-contain" />;
  const choose = (key: "trade" | "object" | "unit" | "method", label: string, options: { value: string; label: string; index?: string }[]) => <div className="min-w-0 space-y-1.5"><span className="block text-xs font-medium text-muted-foreground">{label}</span><ChoiceCombo normalizeValue={normalizeVobIndex} label={label} value={mixed?.has(key) ? "*variable*" : rule?.[key] || "-1"} options={options.some((o) => o.value === "-1") ? options : [{ value: "-1", label: unset, index: "-1" }, ...options]} onChange={(value) => { if (rule) updateSelection({ [key]: value }); }} className="h-9 w-full text-[13px]" /></div>;
  const fileAction = async (saveAs = false) => { if (saveAs) await vobSave(true); else await vobSwitch(); };
  const header = <div className="flex min-w-0 flex-1 items-center gap-1">
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" aria-label={text("Menu principal VOB", "VOB main menu")} className="smartcatalog-tab flex h-full shrink-0 items-center gap-2 rounded-none pl-5 pr-6 text-xs font-semibold text-primary-foreground"><img src={vobArtwork.app} alt="" className="h-5 w-5" />VOB Editor</Button></DropdownMenuTrigger><DropdownMenuContent align="start" sideOffset={0} className="w-80 rounded-sm text-xs">
      <DropdownMenuItem className="gap-2 rounded-none text-xs" onSelect={() => useVobResources.setState({ manager: true })}>{art(vobArtwork.open)}{text("Ouvrir", "Open")}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="gap-2 rounded-none text-xs" disabled={saveOff || !dirty} onSelect={() => void save()}>{art(vobArtwork.save)}{text("Enregistrer", "Save")}<span className="ml-auto text-[10px] text-muted-foreground">Ctrl+S</span></DropdownMenuItem>
      <DropdownMenuItem className="gap-2 rounded-none text-xs" disabled={saveAsOff} onSelect={() => void fileAction(true)}>{art(vobArtwork.saveAs)}{text("Enregistrer sous…", "Save as…")}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!s.file} className="gap-2 rounded-none text-xs" onSelect={() => { useVobResources.setState({ backupsOpen: true }); void vobListBackups(); }}>{art(vobArtwork.save)}{text("Gestionnaire de sauvegardes", "Backup manager")}</DropdownMenuItem>
      <DropdownMenuItem className="gap-2 rounded-none text-xs" onSelect={() => setAboutOpen(true)}><Info className="h-4 w-4 text-ribbon-dark" />{t("about")}</DropdownMenuItem>
      <DropdownMenuSeparator /><DropdownMenuItem className="gap-2 rounded-none text-xs" onSelect={() => void close()}><Power className="h-4 w-4 text-destructive" />{t("quit")}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    {quick(text("VOB & gestionnaire de ressources", "VOB & resources manager"), <LibraryBig strokeWidth={2.25} />, () => useVobResources.setState({ manager: !resources.manager }), false, resources.manager)}
    {quick(text("Enregistrer", "Save"), <Save strokeWidth={2.25} />, () => void save(), saveOff || resources.busy || !dirty)}
    {quick(text("Enregistrer sous…", "Save as…"), <SaveAll strokeWidth={2.25} />, () => void fileAction(true), saveAsOff || resources.busy)}
    {quick(t("undo"), <Undo2 strokeWidth={2.75} />, s.undo, !s.past.length)}{quick(t("redo"), <Redo2 strokeWidth={2.75} />, s.redo, !s.future.length)}
    <span className="min-w-0 flex-1 truncate px-2 text-center">{text("Éditeur VOB — Règles de calcul", "VOB Editor — Calculation rules")}</span>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" title={t("lang")} aria-label={t("lang")} className="h-7 shrink-0 gap-1 px-1.5 text-xs"><Languages className="h-4 w-4 text-ribbon-dark" /><span className="uppercase">{lang}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="rounded-sm">{LANGS.map((l) => <DropdownMenuItem key={l.code} className={`gap-2 rounded-none text-xs ${lang === l.code ? "bg-selection" : ""}`} onSelect={() => setLang(l.code)}><MenuFlag language={l.code} />{l.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title={t("dark")} aria-label={t("dark")} onClick={() => setDark(!dark)}>{dark ? <Sun className="h-4 w-4 text-ribbon-dark" /> : <Moon className="h-4 w-4 text-ribbon-dark" />}</Button>
  </div>;
  const toggle = (value: string) => setClosed((old) => { const next = new Set(old); if (next.has(value)) next.delete(value); else next.add(value); return next; });
  const footer = <>
    {(ref.kind === "error" || ref.kind === "contract_error") && <span role="alert" className="min-w-0 shrink truncate text-xs text-destructive" title={ref.message}>{refStatus[0]?.short}</span>}
    <div className="flex min-w-0 shrink items-center gap-1.5 whitespace-nowrap text-xs font-medium" title={dirty ? text("Modifications conservées en mémoire, non enregistrées sur disque", "Changes kept in memory, not saved to disk") : s.file?.path ?? ""}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dirty ? "bg-icon-link" : "bg-success"}`} /><span className="truncate">{dirty ? text("Modifications en mémoire", "Changes in memory") : text("Session à jour", "Session up to date")}</span></div>
    {dirtyPaths.length > 1 ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className={`${DIALOG_BTN} gap-1`} disabled={saveOff || resources.busy}>{text("Enregistrer", "Save")}<ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" side="top" className="w-72 rounded-sm">
      <DropdownMenuItem className="gap-2 rounded-none text-xs" disabled={!savePick} onSelect={() => { if (savePick) void vobSaveFile(savePick); }}>{art(vobArtwork.save)}<span className="truncate">{text("Enregistrer la sélection", "Save selection")}{savePick ? ` — ${savePick.split(/[\\/]/).pop()}` : ""}</span></DropdownMenuItem>
      <DropdownMenuItem className="gap-2 rounded-none text-xs" onSelect={() => void vobSaveFiles(dirtyPaths)}>{art(vobArtwork.saveAs)}{text(`Enregistrer toutes les modifications (${dirtyPaths.length})`, `Save all changes (${dirtyPaths.length})`)}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    : <Button variant="outline" className={DIALOG_BTN} disabled={saveOff || resources.busy || !dirtyPaths.length} onClick={() => { if (dirtyPaths[0]) void vobSaveFile(dirtyPaths[0]); }}>{text("Enregistrer", "Save")}</Button>}
    <Button variant="ghost" className={DIALOG_BTN} onClick={() => void close()}>{t("quit")}</Button>
  </>;
  return <TradeLabelContext.Provider value={vobTradeLabel(lang)}><div className="vob-app flex h-screen flex-col overflow-hidden bg-background text-foreground text-[13px]">
    <AppTooltips /><AppMessageDialog compact title="VOB Editor" iconSrc={vobArtwork.app} />
    <Suspense fallback={null}>{favoritesOpen && <FormulaFavoriteDialog />}</Suspense>
    {resources.backupsOpen && <VobBackupDialog />}
    <VobAboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    <div className="flex h-8 shrink-0 select-none items-center gap-1 border-b border-border bg-titlebar pr-2 text-xs font-semibold">{header}</div>
    {resources.manager ? <VobResourceManager fr={fr} columns={columns} display={cellValue} displayIndex={cellIndex} /> : <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-2">
    <CustomToolbar layoutLabels={menuText} id="vob-editor-actions-v4" initial={[
      { id: "tree", label: "view", color: "brand", buttons: ["expand", "collapse"] },
      { id: "edit", label: "edit", color: "brand", buttons: ["add", "delete", "copy", "paste", "duplicate", "header"] },
      { id: "group", label: "group", title: text("Regrouper et afficher", "Group & display"), color: "orange", buttons: ["group", "filter", "columns"] },
      { id: "search", label: "search", title: t("search"), color: "blue", buttons: ["search"] },
    ]} buttons={{
      add: <Button variant="ghost" className="h-9 gap-1.5 rounded-sm px-2 text-xs" title={text("Ajouter une règle", "Add rule")} onClick={add}>{art(vobArtwork.add)}{text("Ajouter une règle", "Add rule")}</Button>,
      header: tool(text("Éditer l’en-tête du fichier", "Edit file header"), <FileText className="h-5 w-5 text-ribbon-dark" />, () => useVobResources.setState({ manager: true, focusHeader: true })),
      duplicate: tool(t("duplicate"), art(duplicateIcon), () => duplicate(), !rule),
      copy: tool(text("Copier (aussi vers un autre fichier)", "Copy (also to another file)"), art(vobArtwork.copy), s.copy, !rule),
      paste: tool(s.clipboard.length ? text(`Coller ${s.clipboard.length} règle(s)`, `Paste ${s.clipboard.length} rule(s)`) : t("paste"), art(vobArtwork.paste), paste, !s.clipboard.length),
      delete: tool(t("del"), art(vobArtwork.delete), () => void remove(), !rule),
      expand: tool(t("expandAll"), art(vobArtwork.expand), () => setClosed(new Set())),
      collapse: tool(t("collapseAll"), art(vobArtwork.collapse), () => setClosed(new Set(groupVobRules(rows, groupBy, cellValue).map((g) => g.value)))),
      group: <VobGroupingMenu columns={columns} value={groupBy} onChange={(v) => { setGroupBy(v); setClosed(new Set()); }} label={text("Regrouper par", "Group by")} />,
      filter: <VobFilterMenu columns={columns} rows={s.rules} value={valueFilters} onChange={setValueFilters} display={cellValue} displayIndex={cellIndex} label={text("Afficher uniquement", "Show only")} reset={text("Effacer les filtres", "Clear filters")} unset={unset} searchIn={(c) => text(`Rechercher dans ${c}…`, `Search in ${c}…`)} noMatch={text("Aucune valeur", "No value")} activationLabels={{ title: text("Activation", "Activation"), active: text("Actives", "Active"), inactive: text("Désactivées", "Disabled") }} />,
      columns: <VobColumnsMenu columns={columns} value={visible} onChange={setVisible} label={text("Colonnes", "Columns")} />,
      search: <VobSearchBox query={query} onQuery={setQuery} options={searchOptions} onOptions={setSearchOptions} columns={columns} />,
    }} />
    <div className="vob-workspace mt-3 flex min-h-0 flex-1 flex-col border-t border-border">
      <div ref={panes} className="vob-panes min-h-0 flex-1" style={{ gridTemplateColumns: `minmax(0, ${split}fr) 12px minmax(380px, ${100 - split}fr)` }}>
        <section aria-label={text("Règles de calcul", "Calculation rules")} className="flex min-h-64 min-w-0 flex-col">
          <div className="catalog-panel-heading flex h-10 shrink-0 items-center justify-between gap-2 px-3"><h2 className="text-[13px] font-semibold">{text("Règles de calcul", "Calculation rules")}</h2><span className="flex items-center gap-2"><span className="text-xs tabular-nums text-muted-foreground">{filtered ? `${rows.length} / ${s.rules.length}` : s.rules.length} {text("règle(s)", "rule(s)")}</span><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm" aria-label={text("Menu des règles", "Rules menu")} title={text("Menu des règles", "Rules menu")}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-60 rounded-sm">
            <DropdownMenuItem className="gap-2 text-xs" onSelect={add}>{art(vobArtwork.add)}{text("Ajouter une règle", "Add rule")}</DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" disabled={!rule} onSelect={() => duplicate()}>{art(duplicateIcon)}{t("duplicate")}</DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" disabled={!rule} onSelect={() => s.copy()}>{art(vobArtwork.copy)}{text("Copier", "Copy")}</DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" disabled={!s.clipboard.length} onSelect={paste}>{art(vobArtwork.paste)}{t("paste")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs" disabled={!rule} onSelect={() => s.toggleEnabled(selection)}><Power className="h-4 w-4 text-success" />{selectedRules.length && selectedRules.every((r) => r.enabled === false) ? text("Activer", "Enable") : text("Désactiver", "Disable")}<span className="ml-auto text-[10px] text-muted-foreground">Ctrl+D</span></DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" disabled={!rule} onSelect={() => void remove()}>{art(vobArtwork.delete)}{t("del")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub><DropdownMenuSubTrigger className="gap-2 text-xs"><Info className="h-4 w-4" />{text("État des référentiels", "Reference status")}</DropdownMenuSubTrigger><DropdownMenuPortal><DropdownMenuSubContent className="max-h-80 max-w-[min(560px,90vw)] overflow-auto rounded-sm text-xs">{refStatus.flatMap((entry) => [entry.short, ...entry.detail]).map((line, index) => <DropdownMenuItem key={index} onSelect={(event) => event.preventDefault()} className="whitespace-pre-wrap break-words text-xs">{line}</DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuPortal></DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs" onSelect={() => setClosed(new Set())}>{art(vobArtwork.expand)}{t("expandAll")}</DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onSelect={() => setClosed(new Set(groupVobRules(rows, groupBy, cellValue).map((g) => g.value)))}>{art(vobArtwork.collapse)}{t("collapseAll")}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu></span></div>
          <div className="min-h-0 flex-1 overflow-auto">
            <VobRuleTree rows={rows} groupBy={groupBy} columns={columns} visible={visible} widths={widths} savedWidths={vv.widths} onMoveColumn={vv.moveColumn} columnMoveHint={text("Déplacer la colonne — glisser-déposer ou Alt + flèches", "Move column — drag or Alt + arrows")} onResize={setWidth} closed={closed} onToggle={toggle} selected={selection} onSelect={(id, event) => s.select(id, { toggle: Boolean(event?.ctrlKey || event?.metaKey), range: Boolean(event?.shiftKey), order: groupVobRules(rows, groupBy, cellValue).filter((g) => !closed.has(g.value)).flatMap((g) => g.rules.map((r) => r.id)) })} display={cellValue} displayIndex={cellIndex} unset={unset} choices={{ trade: [{ value: "-1", label: unset, index: "-1" }, ...trades], object: [{ value: "-1", label: unset, index: "-1" }, ...objects], unit: units, method: methods }} onSelectGroup={(ids, checked) => s.selectMany(checked ? [...new Set([...selection, ...ids])] : selection.filter((id) => !ids.includes(id)))} onUpdate={(id, patch) => s.updateMany(selection.includes(id) ? selection : [id], patch)} onRemove={async (ids, group) => { if (group && !(await askConfirmation(text(`Supprimer les ${ids.length} règle(s) de ce dossier ?`, `Delete the ${ids.length} rule(s) in this folder?`)))) return; s.removeMany(ids); }} onSetEnabled={async (ids, enabled) => { if (!enabled && !(await askConfirmation(text(`Désactiver les ${ids.length} règle(s) de ce dossier ?`, `Disable the ${ids.length} rule(s) in this folder?`)))) return; s.updateMany(ids, { enabled }); }} onCopy={(id) => s.copy([id])} onDuplicate={duplicate} copyLabel={text("Copier la règle", "Copy rule")} duplicateLabel={text("Dupliquer la règle", "Duplicate rule")} removeLabel={text("Supprimer la règle", "Delete rule")} groupLabels={{ enable: text("Activer les règles du dossier", "Enable folder rules"), disable: text("Désactiver les règles du dossier", "Disable folder rules"), remove: text("Supprimer les règles du dossier", "Delete folder rules") }} onToggleEnabled={(id) => s.toggleEnabled(selection.includes(id) ? selection : [id])} enableLabel={(on) => on ? text("Règle active — cliquer pour désactiver", "Active rule — click to disable") : text("Règle désactivée (//) — cliquer pour activer", "Disabled rule (//) — click to enable")} />
            {!rows.length && <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-6 py-12 text-center"><FileText className="h-10 w-10 text-ribbon-dark/60" strokeWidth={1.25} /><span className="text-sm font-medium">{s.rules.length ? text("Aucune règle correspondante", "No matching rules") : text("Aucune règle dans cette session", "No rules in this session")}</span><Button variant="outline" size="sm" className="gap-2" onClick={s.rules.length ? clearFilters : add}>{s.rules.length ? <X className="h-4 w-4" /> : art(vobArtwork.add)}{s.rules.length ? text("Effacer les filtres", "Clear filters") : text("Ajouter une règle", "Add rule")}</Button></div>}
          </div>
        </section>
        <div role="separator" aria-orientation="vertical" aria-label={text("Redimensionner", "Resize")} onMouseDown={drag} onDoubleClick={() => setSplit(58)} className="vob-splitter w-3 shrink-0 cursor-col-resize" />
        <section aria-label={text("Détail de la règle", "Rule details")} className="vob-detail flex min-h-0 min-w-0 flex-col">
          <div className="catalog-panel-heading flex h-10 shrink-0 items-center justify-between gap-2 px-4"><h2 className="text-[13px] font-semibold">{text("Détail de la règle", "Rule details")}</h2>{rule && <span className="flex items-center gap-2">{selection.length > 1 && <span className="text-xs tabular-nums text-muted-foreground">{text(`${selection.length} règles sélectionnées`, `${selection.length} selected rules`)}</span>}{(() => { const off = selectedRules.every((r) => r.enabled === false); return <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" aria-pressed={!off} title={off ? text("Activer la ligne (retire « // »)", "Enable the line (removes “//”)") : text("Désactiver la ligne (ajoute « // »)", "Disable the line (adds “//”)")} onClick={() => s.toggleEnabled(selection)}><Power className={`h-3.5 w-3.5 ${off ? "text-muted-foreground" : "text-success"}`} />{off ? text("Activer", "Enable") : text("Désactiver", "Disable")}</Button>; })()}<Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={!selectedRules.some((r) => { const o = s.saved.find((x) => x.id === r.id); return o && JSON.stringify(o) !== JSON.stringify(r); })} title={text("Remettre les valeurs du chargement du fichier", "Restore the values from when the file was loaded")} onClick={() => s.revert(selection)}><RotateCcw className="h-3.5 w-3.5 text-ribbon-dark" />{text("Valeurs d’origine", "Original values")}</Button></span>}</div>
          {rule ? <div key={selection.join(":")} className="min-h-0 flex-1 overflow-auto px-4 py-4">
            <fieldset className="m-0 min-w-0 border-0 p-0"><legend className="mb-3 text-[13px] font-semibold">{text("Éléments concernés", "Rule scope")}</legend><div className="grid grid-cols-2 gap-x-3 gap-y-3">{choose("trade", t("trade"), trades)}{choose("object", text("Objet", "Object"), objects)}{choose("unit", t("unit"), units)}{choose("method", text("Méthode de calcul", "Calculation method"), methods)}</div></fieldset>
            <div className="mb-3 mt-5 border-t border-border pt-4 text-[13px] font-semibold">{t("formulaCol")}</div>
            {mixed?.has("formula") && <div className="flex justify-end"><FormulaFavoritesMenu onApply={(formula) => updateSelection({ formula })} /></div>}
            <div key={mixed?.has("formula") ? "mixed" : "common"}>{mixed?.has("formula") ? <textarea aria-label={t("formulaCol")} placeholder="*variable*" defaultValue="" onChange={(e) => { e.currentTarget.dataset["edited"] = "true"; }} onBlur={(e) => { if (e.target.dataset["edited"]) updateSelection({ formula: e.target.value }); }} className="min-h-24 w-full resize-y rounded-sm border border-input bg-background p-2 font-mono text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" /> : <FormulaEditor value={rule.formula} onFavoriteApply={(formula) => updateSelection({ formula })} onCommit={(formula) => updateSelection({ formula })} />}</div>
            <label className="mt-5 block border-t border-border pt-4"><span className="mb-2 block text-[13px] font-semibold">{text("Commentaire", "Comment")}</span><textarea aria-label={text("Commentaire", "Comment")} key={mixed?.has("comment") ? "mixed" : rule.comment} placeholder={mixed?.has("comment") ? "*variable*" : undefined} defaultValue={mixed?.has("comment") ? "" : rule.comment} onChange={(e) => { e.currentTarget.dataset["edited"] = "true"; }} onBlur={(e) => { if (mixed?.has("comment") ? Boolean(e.target.dataset["edited"]) : e.target.value !== rule.comment) updateSelection({ comment: e.target.value }); }} rows={2} className="min-h-16 w-full resize-y rounded-sm border border-input bg-background p-2 text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring" /></label>
            <Button variant="ghost" size="sm" disabled={mixed?.has("comment") || !rule.comment.trim()} title={text("Ouvrir Google Traduction", "Open Google Translate")} className="mt-1 h-7 gap-1.5 text-xs" onClick={() => window.open(`https://translate.google.com/?sl=auto&tl=${encodeURIComponent(lang)}&text=${encodeURIComponent(rule.comment)}&op=translate`, "_blank", "noopener,noreferrer")}><TranslateIcon className="h-3.5 w-3.5" />{text("Traduire le commentaire", "Translate comment")}</Button>
          </div> : <div className="flex min-h-64 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{s.rules.length ? text("Sélectionnez une règle", "Select a rule") : text("Détail de la règle", "Rule details")}</div>}
        </section>
      </div>
    </div>
    </div>}
    <VobStatusBar fr={fr}>{footer}</VobStatusBar>
  </div></TradeLabelContext.Provider>;
}
