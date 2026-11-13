import { validPresentationName, titleMatchesSearch, type InlinePresentationRename } from "../lib/presentation-ui";
import { attributeTooltip, readCategoryIcon } from "../lib/presentation-display";
import { PresentationAttributeForm } from "./presentation-attribute-form";
import { AimGroupColorMenu } from "./aim-color-menu";
import { AimActionGlyph } from "./aim-action-glyph";
import { UnavailableRowActions } from "./unavailable-row-actions";
import { setAimDragGhost } from "../lib/drag-ghost";
import { usePresentationSelection } from "../lib/presentation-selection";
import { Checkbox } from "@/components/ui/checkbox";
import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Inbox, LayoutGrid, Folder, TextCursorInput, ChevronsUpDown, SquareCheck, CalendarDays, Clock, AtSign, Phone, Link2, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SmartCatalogIcon } from "./smartcatalog-icons";
import { StrGlyph, IntGlyph, FloatGlyph, ListBoxGlyph } from "./type-glyphs";
import { DEFAULT_COLUMNS, type ColumnKey } from "./aim-columns";
import { DICTS, type Lang } from "../lib/i18n";
import { DEFAULT_SEARCH, matchesSearch, type SearchOptions } from "../lib/aim-interface";
import { CATEGORY_HOVER_DELAY_MS, moveLayout, moveLayoutSelection, type LayoutMove } from "../lib/organized-layout";
import type { Configuration, DisplayRow, Presentation } from "../lib/aim-presentation-contract";

export const UPDATE_UNAVAILABLE = "Mise a jour en memoire indisponible avec cet hote";
export const OUTSIDE_EMPTY = "Aucun attribut du projet hors présentation.";
export type OutsideAttribute = { number: string; label: string; valueState: "set" | "unset" | "unavailable"; value: string | null };
/** Visual indicators only: never stored nor sent as a value. */
export const VALUE_UNSET = "Non renseigné";
export const VALUE_UNAVAILABLE = "Indisponible";
const CHECKED = new Set(["1", "true", "True", "TRUE", "oui", "yes"]);
/** Absent (unset) is distinct from false, "0" or an unchecked box; checkbox rows keep the box and show the indicator beside it. */
export function ValueDisplay({ valueState, value, checkbox = false, wrap = false }: { valueState: "set" | "unset" | "unavailable"; value: string | null; checkbox?: boolean; wrap?: boolean }) {
  const note = valueState === "unset" ? VALUE_UNSET : valueState === "unavailable" ? VALUE_UNAVAILABLE : null;
  const cls = `aim-readonly-cell min-w-0 flex-1 ${wrap ? "block whitespace-pre-wrap break-words" : "truncate"}`;
  if (checkbox) return <span data-value-state={valueState} aria-readonly="true" className={`${cls} flex items-center gap-1.5`}>
    <span role="checkbox" aria-checked={note ? "mixed" : CHECKED.has(value ?? "")} aria-disabled="true" data-unset={note ? "" : undefined} className="aim-value-checkbox" />
    {note && <span className="italic text-muted-foreground">{note}</span>}
    {!note && <span className="sr-only">{value ?? ""}</span>}
  </span>;
  return <span data-value-state={valueState} aria-readonly="true" className={`${cls} ${note ? "italic text-muted-foreground" : ""}`}>{note ?? value ?? ""}</span>;
}
const widgetIcons = { entry: TextCursorInput, combo: ChevronsUpDown, list: ListBoxGlyph, checkbox: SquareCheck };
const typeIcons = { STR: StrGlyph, INT: IntGlyph, FLOAT: FloatGlyph, DATE: CalendarDays, TIME: Clock, EMAIL: AtSign, PHONE: Phone, URL: Link2 };

/** Configuration is editable; the received model remains untouched and is looked up only by occurrence ID. */
export function OrganizedPresentationView({ presentation, configuration: provided, onConfigurationChange, columns = DEFAULT_COLUMNS, lang = "fr", query = "", searchOptions = DEFAULT_SEARCH, technicalDetails = "", footerDetails = false, busy = false, outside = null, onAddOccurrence, onAddOccurrences, onPickIcon, addDisabled, attributes = [], renderValue, view: suppliedView, onViewChange, renameRequest, onRenameStarted }: {
  view?: string; onViewChange?: (view: string) => void; renameRequest?: InlinePresentationRename | null; onRenameStarted?: () => void;
  presentation: Presentation; configuration?: Configuration; attributes?: { number: string; label: string }[]; onConfigurationChange?: (c: Configuration) => void;
  columns?: ColumnKey[]; lang?: Lang; query?: string; searchOptions?: SearchOptions; technicalDetails?: string; footerDetails?: boolean; busy?: boolean;
  /** Python-resolved project attributes not represented in the confirmed configuration; null = no project data. */
  outside?: OutsideAttribute[] | null; onAddOccurrence?: (number: string, groupId: string) => void; onAddOccurrences?: (numbers: string[], target: string, before?: string) => void; addDisabled?: string | undefined;
  renderValue?: (row: OutsideAttribute | DisplayRow) => ReactNode;
  onPickIcon?: (categoryId: string) => Promise<void>;
}) {
  const [local, setLocal] = useState(presentation.configuration);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [deleteCategory, setDeleteCategory] = useState<string | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<string | null>(null);
  const [iconError, setIconError] = useState("");
  const iconRead = useRef(0);
  useEffect(() => () => { iconRead.current++; }, []);
  const [iconCategory, setIconCategory] = useState<string | null>(null);
  const configuration = provided ?? local;
  const change = (c: Configuration) => { if (busy) return; setLocal(c); onConfigurationChange?.(c); };
  const t = DICTS[lang];
  const [localView, setLocalView] = useState("all");
  const view = suppliedView ?? localView;
  const setView = (id: string) => { setLocalView(id); onViewChange?.(id); };
  const [groupRename, setGroupRename] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!renameRequest) return;
    if (renameRequest.kind === "category") {
      const category = configuration.categories.find(cat => cat.id === renameRequest.id);
      if (!category) return;
      setEditingCategory(category.id); setCategoryName(category.name);
    } else {
      const group = configuration.categories.flatMap(cat => cat.groups).find(group => group.id === renameRequest.id);
      if (!group) return;
      setGroupRename({ id: group.id, name: group.title });
    }
    onRenameStarted?.();
  }, [renameRequest, configuration, onRenameStarted]);
  const selection = usePresentationSelection();
  const [drag, setDrag] = useState<Pick<LayoutMove, "kind" | "id"> | null>(null);
  const dragIds = useRef<string[]>([]);
  const outsideDrag = useRef<string[] | null>(null);
  const [dropError, setDropError] = useState("");
  const [drop, setDrop] = useState<LayoutMove | null>(null);
  const dropRef = useRef<LayoutMove | null>(null);
  const setDestination = (intent: LayoutMove | null) => { dropRef.current = intent; setDrop(intent); };
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = null; };
  useEffect(() => clearHover, []);
  const endDrag = () => { clearHover(); outsideDrag.current = null; dragIds.current = []; setDrag(null); setDestination(null); };
  useEffect(() => {
    const cancel = () => endDrag();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") endDrag(); };
    window.addEventListener("dragend", cancel); window.addEventListener("drop", cancel); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("dragend", cancel); window.removeEventListener("drop", cancel); window.removeEventListener("keydown", escape); };
  }, []);
  const m = presentation.model;
  const display = new Map(m.categories.flatMap((c) => c.groups.flatMap((g) => g.rows.map((r) => [r.id, r] as const))));
  const outsideRows = (outside ?? []).filter(a => matchesSearch({ num: a.number, title: a.label, name: a.label, value: a.value ?? "", group: "", category: "" }, query, searchOptions));
  const order = configuration.categories.filter(cat => view === "all" || cat.id === view).flatMap(cat => cat.groups.flatMap(group => {
    const rows = group.rows.filter(row => {
      const r = display.get(row.id);
      return !!r && matchesSearch({ num: r.number, title: r.title, name: String(r.definition?.["label"] ?? ""), value: r.value ?? "", group: group.title, category: cat.name }, query, searchOptions);
    }).map(row => row.id);
    return !query || rows.length || titleMatchesSearch(group.title, "group", query, searchOptions) ? [group.id, ...(group.expanded ? rows : [])] : [];
  }));
  const groups = configuration.categories.flatMap((c) => c.groups);
  const moveOrder = (kind: LayoutMove["kind"]) => kind === "category" ? configuration.categories.map(cat => cat.id) : kind === "group" ? groups.map(group => group.id) : groups.flatMap(group => group.rows.map(row => row.id));
  const move = (intent: LayoutMove) => { change(moveLayoutSelection(configuration, intent, selection.dragIds(intent.id, moveOrder(intent.kind)))); endDrag(); };
  const reject = (e: DragEvent) => { e.stopPropagation(); e.dataTransfer.dropEffect = "none"; setDestination(null); };
  const preview = (e: DragEvent, intent: LayoutMove, explicitCategory = false) => { if (drag && !outsideDrag.current && dragIds.current.some(id => !moveOrder(drag.kind).includes(id))) { setDropError("Dépôt refusé : cet hôte ne permet pas de déplacer ensemble des groupes et des lignes. Aucune modification."); reject(e); return; } if (drag && (intent.target === "all" || intent.target === "unlisted" || dragIds.current.includes(intent.target))) { reject(e); return; } if (!drag || busy) { reject(e); return; } if (drag.kind !== "category" && !explicitCategory && !configuration.categories.some(cat => cat.id === view)) { reject(e); return; } e.preventDefault(); e.stopPropagation(); setDestination(intent); };
  const finish = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    const intent = dropRef.current;
    try {
      if (!intent || !drag || busy) return;
      if (outsideDrag.current) { if (!addDisabled) onAddOccurrences?.(outsideDrag.current, intent.target, intent.before); }
      else { const next = moveLayoutSelection(configuration, intent, dragIds.current); if (next === configuration) setDropError("Dépôt refusé : destination incompatible avec la sélection."); else change(next); }
    } finally { endDrag(); }
  };
  const start = (e: DragEvent, kind: LayoutMove["kind"], id: string, title = "") => { if (busy) { e.preventDefault(); return; } e.stopPropagation(); setDropError(""); const selectedIds = selection.dragIds(id, outsideDrag.current ? outsideRows.map(a => `outside-${a.number}`) : kind === "category" ? moveOrder(kind) : groups.flatMap(group => [group.id, ...group.rows.map(row => row.id)])); dragIds.current = selectedIds.filter(key => !groups.some(group => selectedIds.includes(group.id) && group.rows.some(row => row.id === key))); if (outsideDrag.current) outsideDrag.current = dragIds.current.map(key => key.slice(8)); setDrag({ kind, id }); e.dataTransfer.setData("application/x-aim-layout", id); e.dataTransfer.effectAllowed = "move"; setAimDragGhost(e, kind, title, dragIds.current.length); };
  const step = (kind: "row" | "group", id: string, direction: -1 | 1) => {
    const parent = kind === "row" ? groups.find((g) => g.rows.some((r) => r.id === id)) : configuration.categories.find((c) => c.groups.some((g) => g.id === id));
    if (!parent) return;
    const siblings = "rows" in parent ? parent.rows : parent.groups;
    const i = siblings.findIndex((r) => r.id === id);
    if (i + direction < 0 || i + direction >= siblings.length) return;
    const before = direction < 0 ? siblings[i - 1]?.id : siblings[i + 2]?.id;
    move({ kind, id, target: parent.id, ...(before ? { before } : {}) });
  };
  const commitCategoryName = () => {
    if (busy || !editingCategory || !validPresentationName(categoryName, configuration.categories.filter(cat => cat.id !== editingCategory).map(cat => cat.name))) return;
    change({ ...configuration, categories: configuration.categories.map(c => c.id === editingCategory ? { ...c, name: categoryName.trim() } : c) });
    setEditingCategory(null);
  };
  const commitGroupName = () => {
    if (busy || !groupRename || !validPresentationName(groupRename.name, groups.filter(group => group.id !== groupRename.id).map(group => group.title))) return;
    change({ ...configuration, categories: configuration.categories.map(cat => ({ ...cat, groups: cat.groups.map(group => group.id === groupRename.id ? { ...group, title: groupRename.name.trim() } : group) })) });
    setGroupRename(null);
  };
  useEffect(() => {
    const validate = (event: Event) => {
      if (editingRow || deleteCategory || deleteGroup
          || editingCategory && !validPresentationName(categoryName, configuration.categories.filter(cat => cat.id !== editingCategory).map(cat => cat.name))
          || groupRename && !validPresentationName(groupRename.name, groups.filter(group => group.id !== groupRename.id).map(group => group.title))) event.preventDefault();
    };
    window.addEventListener("aim-flush-presentation", validate);
    return () => window.removeEventListener("aim-flush-presentation", validate);
  }, [editingRow, deleteCategory, deleteGroup, editingCategory, categoryName, groupRename, configuration]);
  const tools = (kind: "row" | "group", id: string) => <span className="aim-organized-tools flex items-center gap-0.5">
    {kind === "group" && (() => { const current = groups.find(g => g.id === id); return current && <AimGroupColorMenu label={`Couleur ${id}`} value={current.backgroundColor} lang={lang} disabled={busy} onPick={color => change({ ...configuration, categories: configuration.categories.map(category => ({ ...category, groups: category.groups.map(group => group.id === id ? { ...group, backgroundColor: color } : group) })) })} />; })()}
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="native" size="native" title={t.moveTo} aria-label={`${t.moveTo} ${id}`} disabled={busy} onClick={(e) => e.stopPropagation()}><AimActionGlyph name="move" /></Button></DropdownMenuTrigger><DropdownMenuContent className="suite-menu">
      {kind === "group" && <><DropdownMenuItem disabled={configuration.categories.find(c => c.groups.some(g => g.id === id))?.groups[0]?.id === id} onSelect={() => step(kind, id, -1)}><ArrowUp className="size-3.5" />Monter</DropdownMenuItem><DropdownMenuItem disabled={configuration.categories.find(c => c.groups.some(g => g.id === id))?.groups.at(-1)?.id === id} onSelect={() => step(kind, id, 1)}><ArrowDown className="size-3.5" />Descendre</DropdownMenuItem></>}
      {(kind === "row" ? groups : configuration.categories).map((target) => <DropdownMenuItem key={target.id} onSelect={() => move({ kind, id, target: target.id })}>{"title" in target ? target.title : target.name}</DropdownMenuItem>)}
    </DropdownMenuContent></DropdownMenu>
    <Button variant="native" size="native" disabled={busy} title="Éditer" aria-label={`Éditer ${id}`} onClick={() => { if (kind === "row") setEditingRow(id); else { const group = groups.find(group => group.id === id); if (group) setGroupRename({ id, name: group.title }); } }}><Pencil className="size-3.5" /></Button>
    <Button variant="native" size="native" disabled={busy} title="Supprimer de la présentation" aria-label={`Supprimer ${id}`} onClick={() => {
      if (kind === "group") { setDeleteGroup(id); return; }
      change({ ...configuration, categories: configuration.categories.map(c => ({ ...c, groups: c.groups.map(g => ({ ...g, rows: g.rows.filter(r => r.id !== id).map((r, i) => ({ ...r, position: i + 1 })) })) })) });
    }}><Trash2 className="size-3.5" /></Button>
  </span>;
  const outsideTools = (a: OutsideAttribute) => <span className="aim-organized-tools flex items-center gap-0.5">
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="native" size="native" title={addDisabled ?? t.moveTo} aria-label={`${t.moveTo} ${a.number}`} disabled={busy || !!addDisabled || !groups.length || !onAddOccurrence}><AimActionGlyph name="move" /></Button></DropdownMenuTrigger><DropdownMenuContent className="suite-menu">
      {groups.map(g => <DropdownMenuItem key={g.id} onSelect={() => onAddOccurrence?.(a.number, g.id)}>{g.title}</DropdownMenuItem>)}
    </DropdownMenuContent></DropdownMenu>
    <UnavailableRowActions number={a.number} />
  </span>;
  const diagnostics = <>
    <pre className="whitespace-pre-wrap">{technicalDetails}</pre>
    <p>{JSON.stringify(m.counts)}</p>
    <ul aria-label="global-diagnostics">{m.diagnostics.filter((d) => d.lineIds.length === 0).map((d, i) => <li key={i}>[{d.severity}] {d.code} — {d.message}</li>)}</ul>
    <ul>{m.diagnostics.filter((d) => d.lineIds.length > 0).map((d, i) => <li key={i}>{d.lineIds.join(", ")} · {d.code} — {d.message}</li>)}</ul>
    <ul>{m.categories.flatMap((c) => c.groups.flatMap((g) => g.rows)).filter((r) => r.diagnostics.length || r.dateFormat || r.resetDefault.state === "unresolved").map((r) => <li key={r.id}>{r.id} · {r.diagnostics.join(", ")}{r.dateFormat ? ` · ${r.dateFormat.pattern}` : ""}{r.resetDefault.state === "unresolved" ? ` · ${r.resetDefault.issueId}` : ""}</li>)}</ul>
    <ul>{m.conversionDiagnostics.map((d, i) => <li key={i}>{d.targetId} · {d.code} — {d.message}</li>)}</ul>
  </>;
  const sourceCategory = drag && configuration.categories.find(cat => cat.groups.some(group => group.id === drag.id || group.rows.some(row => row.id === drag.id)))?.id;
  const categories = configuration.categories.filter(cat => view === "all" || cat.id === view || cat.id === sourceCategory);
  const count = 1 + columns.length;
  const total = configuration.categories.reduce((n, c) => n + c.groups.reduce((sum, g) => sum + g.rows.length, 0), 0);
  let rowIndex = 0;
  return <div className="aim-organized flex min-h-0 flex-1 gap-2" aria-label="organized-presentation">
    <aside className="suite-category-panel aim-organized-categories shrink-0 overflow-y-auto border border-border bg-panel">
      <div><p className="catalog-panel-heading px-2 py-1 font-semibold">{t.categories}</p><div className="flex flex-col">
        {[{ id: "all", name: t.catAll }, ...configuration.categories, { id: "unlisted", name: t.unlistedBtn }].map((c) => {
          const fixed = c.id === "all" || c.id === "unlisted";
          const category = configuration.categories.find((cat) => cat.id === c.id);
          if (query && category && !titleMatchesSearch(category.name, "category", query, searchOptions) && !category.groups.some(group => titleMatchesSearch(group.title, "group", query, searchOptions) || group.rows.some(row => { const r = display.get(row.id); return r && matchesSearch({ num: r.number, title: r.title, name: String(r.definition?.["label"] ?? ""), value: r.value ?? "", group: group.title, category: category.name }, query, searchOptions); }))) return null;
          const n = c.id === "all" ? total : c.id === "unlisted" ? outside?.length ?? "—" : category?.groups.reduce((sum, g) => sum + g.rows.length, 0) ?? 0;
          return <div key={c.id} data-fixed={fixed ? "" : undefined} className={`group/cat aim-organized-category flex items-center ${c.id === "unlisted" ? "aim-category-separated" : ""} ${view === c.id ? "catalog-selected-row bg-selection" : "hover:bg-accent"} ${drop?.kind === "group" && drop.first && drop.target === c.id ? "drop-target" : ""}`} data-category-id={c.id} data-drop-category={drop?.kind === "group" && drop.target === c.id && drop.first ? "" : undefined}
            onDragEnter={(e) => { if ((drag?.kind !== "group" && !outsideDrag.current) || fixed || busy) return; e.preventDefault(); if (hoverTimer.current && e.currentTarget.contains(e.relatedTarget as Node | null)) return; clearHover(); const id = c.id; hoverTimer.current = setTimeout(() => { hoverTimer.current = null; setView(id); }, CATEGORY_HOVER_DELAY_MS); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { clearHover(); if (drop?.first && drop.target === c.id) setDestination(null); } }}
            onDragOver={(e) => {
              if (fixed) { reject(e); return; }
              if (drag?.kind === "category") { const rect = e.currentTarget.getBoundingClientRect(); const index = configuration.categories.findIndex(cat => cat.id === c.id); const before = e.clientY < rect.top + rect.height / 2 ? c.id : configuration.categories[index + 1]?.id; preview(e, { ...drag, target: "categories", before }, true); }
              else if (drag?.kind === "row" && outsideDrag.current && category) { setDropError("Dépôt refusé : cette présentation nécessite un groupe pour les attributs."); reject(e); }
              else if (drag?.kind === "group" && category) { const first = category.groups.find((g) => !dragIds.current.includes(g.id))?.id; preview(e, { ...drag, target: c.id, ...(first ? { before: first } : {}), first: true }, true); }
            }} onDrop={e => { if (fixed) { reject(e); endDrag(); } else finish(e); }}>
            {!fixed && <span className="aim-category-grip-slot aim-row-grip" draggable={!busy} onDragStart={event => start(event, "category", c.id, c.name)} onDragEnd={endDrag}><GripVertical className="size-3.5" /></span>}
            {drag?.kind === "category" && drop?.before === c.id && <span className="drop-preview h-6 w-1" />}
            {editingCategory === c.id ? <input autoFocus aria-label="Nom" maxLength={60} className="field min-w-0 flex-1" value={categoryName} onFocus={e => e.currentTarget.select()} onChange={e => setCategoryName(e.target.value)} onBlur={commitCategoryName} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitCategoryName(); } else if (e.key === "Escape") { e.preventDefault(); setEditingCategory(null); } }} /> : <Button variant="native" size="native" aria-label={c.name} aria-pressed={view === c.id} onClick={() => setView(c.id)} onDoubleClick={() => { if (category && !busy) { setEditingCategory(category.id); setCategoryName(category.name); } }} className="aim-category-select flex min-w-0 flex-1 items-center justify-start gap-2 px-2 text-left">
              {c.id === "all" ? <LayoutGrid className="size-4 shrink-0" /> : c.id === "unlisted" ? <Inbox className="size-4 shrink-0" /> : category?.icon.startsWith("data:image/") ? <img src={category.icon} alt="" className="size-4 shrink-0 object-contain" /> : <Folder className="size-4 shrink-0" />}<span className="truncate font-normal">{c.name}</span>
            </Button>}
            <span className={`aim-category-actions relative flex h-7 shrink-0 items-center justify-end pr-2 ${fixed ? "w-6" : "w-[76px]"}`}>
              {!fixed && <span className="aim-category-tools absolute inset-0 flex items-center justify-end gap-0.5">
                <Button variant="native" size="native" disabled={busy} title={t.catIconTip} aria-label={`${t.catIconTip} ${c.name}`} onClick={() => { if (onPickIcon) { void onPickIcon(c.id); return; } iconRead.current++; setIconError(""); setIconCategory(c.id); document.getElementById("organized-category-icon")?.click(); }}><ImagePlus className="size-3.5" /></Button>
                <Button variant="native" size="native" disabled={busy} title={lang === "fr" ? "Renommer la catégorie" : t.catShort} aria-label={`${t.catShort} — ${c.name}`} onClick={() => { setEditingCategory(c.id); setCategoryName(c.name); }}><Pencil className="size-3.5" /></Button>
                <Button variant="native" size="native" disabled={busy} title={t.catDeleteTip} aria-label={`${t.catDeleteTip} ${c.name}`} onClick={() => setDeleteCategory(c.id)}><Trash2 className="size-3.5" /></Button>
              </span>}
              <span className={`aim-category-count text-xs tabular-nums text-muted-foreground ${fixed ? "aim-fixed-count" : ""}`}>{n}</span>
            </span>
          </div>;
        })}
      </div></div>
      {drag?.kind === "category" && drop?.target === "categories" && !drop.before && <div className="drop-preview h-1" />}
      <input id="organized-category-icon" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0], id = iconCategory; e.target.value = "";
        if (!f || !id || busy) return;
        const generation = ++iconRead.current;
        void readCategoryIcon(f).then(icon => {
          if (generation === iconRead.current) change({ ...configuration, categories: configuration.categories.map(c => c.id === id ? { ...c, icon } : c) });
        }).catch(() => { if (generation === iconRead.current) setIconError("Impossible de lire cette image locale ; icône conservée."); });
      }} />
      {dropError && <p role="alert" className="p-2 text-xs text-destructive">{dropError}</p>}
      {iconError && <p role="alert" className="p-2 text-xs text-destructive">{iconError}</p>}
    </aside>
    {deleteCategory && <div className="fixed inset-0 z-50 flex items-center justify-center bg-dialog-overlay/30"><form role="dialog" aria-modal="true" aria-label={editingCategory ? "Renommer la catégorie" : t.catDeleteTip} className="w-96 border border-border bg-panel text-sm" onSubmit={(e) => {
      e.preventDefault();
      const removed = configuration.categories.find((c) => c.id === deleteCategory);
      const remaining = configuration.categories.filter((c) => c.id !== deleteCategory);
      const target = remaining[0];
      if (!editingCategory && !removed) return;
      const next = editingCategory ? { ...configuration, categories: configuration.categories.map((c) => c.id === editingCategory ? { ...c, name: categoryName.trim() } : c) } : { ...configuration, categories: remaining.map((c, i) => ({ ...c, position: i + 1, groups: c.groups })) };
      change(next); if (view === deleteCategory) setView("all"); setEditingCategory(null); setDeleteCategory(null);
    }}>
      <h2 className="catalog-panel-heading px-3 py-2">{editingCategory ? "Renommer la catégorie" : t.catDeleteTip}</h2>
      <div className="p-3">{editingCategory ? <label className="flex flex-col gap-1">{t.colTitle}<input autoFocus required aria-label="Nom" value={categoryName} maxLength={60} onChange={(e) => setCategoryName(e.target.value)} className="field" /></label> : <p>Supprimer cette catégorie et ses {configuration.categories.find((c) => c.id === deleteCategory)?.groups.reduce((n,g)=>n+g.rows.length,0) ?? 0} lignes de la présentation ? Les valeurs Allplan seront conservées.</p>}</div>
      <div className="secondary-dialog-footer flex justify-end gap-2 p-2"><Button type="submit" variant="outline" disabled={busy || (!!editingCategory && !categoryName.trim())}>{editingCategory ? t.save : t.catDeleteTip}</Button><Button type="button" variant="ghost" onClick={() => { setEditingCategory(null); setDeleteCategory(null); }}>{t.cancel}</Button></div>
    </form></div>}
    {deleteGroup && <div className="fixed inset-0 z-50 flex items-center justify-center bg-dialog-overlay/30"><form role="dialog" aria-modal="true" aria-label="Supprimer de la présentation" className="w-96 border border-border bg-panel text-sm" onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      change({ ...configuration, categories: configuration.categories.map(cat => ({ ...cat, groups: cat.groups.filter(group => group.id !== deleteGroup).map((group, index) => ({ ...group, position: index + 1 })) })) });
      setDeleteGroup(null);
    }}>
      <h2 className="catalog-panel-heading px-3 py-2">Supprimer de la présentation</h2>
      <p className="p-3">Supprimer ce groupe et ses {groups.find(group => group.id === deleteGroup)?.rows.length ?? 0} lignes de la présentation ? Les valeurs Allplan seront conservées.</p>
      <div className="secondary-dialog-footer flex justify-end gap-2 p-2"><Button type="submit" variant="outline" disabled={busy}>Supprimer</Button><Button type="button" variant="ghost" onClick={() => setDeleteGroup(null)}>{t.cancel}</Button></div>
    </form></div>}
    <div className="suite-table min-w-0 flex-1 overflow-auto border border-border bg-panel" onDragOver={e => { const cat = configuration.categories.find(cat => cat.id === view); if (!cat || drag?.kind !== "group") { if (cat && drag?.kind === "row") setDropError("Dépôt refusé : cette présentation nécessite un groupe pour les lignes."); reject(e); return; } preview(e, { ...drag, target: cat.id }); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDestination(null); }} onDrop={finish}>
      {m.prjatt.status === "error" && <p role="alert" className="px-3 py-2 font-semibold text-destructive">Erreur de lecture des valeurs du projet.</p>}
      {(view === "unlisted" || outsideDrag.current) && (!outside || !outside.length ? <p role="status" className="p-4 text-sm">{outside ? OUTSIDE_EMPTY : "Aucun projet chargé : choisissez un projet."}</p> : <table role="grid" aria-label="Attributs hors présentation" hidden={view !== "unlisted"} className="aim-organized-table w-full text-sm">
        <colgroup>{columns.includes("num") && <col className="aim-number-column" />}{columns.includes("title") && <col className="aim-title-column" />}<col />{columns.includes("input") && <col className="aim-kind-column" />}{columns.includes("data") && <col className="aim-kind-column aim-data-column" />}</colgroup>
        <thead className="catalog-panel-heading sticky top-0 z-10 text-left"><tr>{columns.includes("num") && <th scope="col" role="columnheader">{t.colNum}</th>}{columns.includes("title") && <th scope="col" role="columnheader">{t.colTitle}</th>}<th scope="col" role="columnheader">{t.colValue}</th>{columns.includes("input") && <th scope="col" role="columnheader" className="aim-col-center">{t.colWidget}</th>}{columns.includes("data") && <th scope="col" role="columnheader" className="aim-col-center">{t.colType}</th>}</tr></thead>
        <tbody>{outsideRows.map((a, i) => <tr key={a.number} data-outside-number={a.number} tabIndex={0} aria-selected={selection.selected.has(`outside-${a.number}`)} onClick={event => { if (!(event.target as HTMLElement).closest("button,input,textarea,select,[role=checkbox]")) selection.select(`outside-${a.number}`, event, outsideRows.map(a => `outside-${a.number}`)); }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === " " || event.key === "Enter")) { event.preventDefault(); selection.select(`outside-${a.number}`, event, outsideRows.map(a => `outside-${a.number}`)); } }} className={`${i % 2 ? "row-alt" : ""} ${selection.selected.has(`outside-${a.number}`) ? "aim-row-selected" : ""}`}>
          {columns.includes("num") && <td data-tip={attributeTooltip(a)} className="text-muted-foreground tabular-nums"><span className="aim-number-content flex items-center gap-1"><span aria-label={`Déplacer la ligne ${a.number}`}           title={addDisabled ?? "Déplacer la ligne"} className="aim-row-grip cursor-grab" draggable={!busy && !addDisabled && !!onAddOccurrence && !!groups.length} onDragStart={e => { if (busy || addDisabled || !onAddOccurrence || !groups.length) { e.preventDefault(); return; } outsideDrag.current = [a.number]; start(e, "row", `outside-${a.number}`, `${a.number} ${a.label}`); }} onDragEnd={endDrag}><GripVertical className="size-3.5" /></span>{a.number.padStart(3, "0")}</span></td>}{columns.includes("title") && <td><span className="aim-readonly-cell block truncate">{a.label}</span></td>}
          <td><div className="flex items-center gap-1">{renderValue ? renderValue(a) : <ValueDisplay valueState={a.valueState} value={a.value} />}{!columns.includes("data") && outsideTools(a)}</div></td>
          {columns.includes("input") && <td title={t.wEntry} className="aim-col-center"><TextCursorInput className="mx-auto size-4 text-muted-foreground" /></td>}
          {columns.includes("data") && <td><div className="aim-data-cell flex items-center gap-2"><span title="STR" className="flex flex-1 justify-center text-muted-foreground"><StrGlyph className="size-4 shrink-0" /></span>{outsideTools(a)}</div></td>}
        </tr>)}</tbody>
      </table>)}
      {view !== "unlisted" && <table role="grid" aria-label="Attributs de présentation" className="aim-organized-table w-full text-sm">
        <colgroup>{columns.includes("num") && <col className="aim-number-column" />}{columns.includes("title") && <col className="aim-title-column" />}<col />{columns.includes("input") && <col className="aim-kind-column" />}{columns.includes("data") && <col className="aim-kind-column aim-data-column" />}</colgroup>
        <thead className="catalog-panel-heading sticky top-0 z-10 text-left"><tr>{columns.includes("num") && <th scope="col" role="columnheader">{t.colNum}</th>}{columns.includes("title") && <th scope="col" role="columnheader">{t.colTitle}</th>}<th scope="col" role="columnheader">{t.colValue}</th>{columns.includes("input") && <th scope="col" role="columnheader" className="aim-col-center">{t.colWidget}</th>}{columns.includes("data") && <th scope="col" role="columnheader" className="aim-col-center">{t.colType}</th>}</tr></thead>
        <tbody>{categories.flatMap((c) => c.groups.map((g) => {
          const hidden = view !== "all" && c.id !== view;
          const rows = g.rows.map((r) => display.get(r.id)).filter((r): r is DisplayRow => !!r && matchesSearch({ num: r.number, title: r.title, name: String(r.definition?.["label"] ?? ""), value: r.value ?? "", group: g.title, category: c.name }, query, searchOptions));
          if (query && !rows.length && !titleMatchesSearch(g.title, "group", query, searchOptions)) return null;
          const placeholder = (key: string) => <tr key={key} aria-hidden="true" data-group-placeholder className="aim-group-placeholder" onDragOver={(e) => { if (drag?.kind === "group") { e.preventDefault(); e.stopPropagation(); } }} onDrop={finish}><td colSpan={count}><div className="drop-preview" /></td></tr>;
          const groupDrop = !hidden && drag?.kind === "group" && drop?.kind === "group" && !drop.first && drop.target === c.id;
          const isLast = c.groups.at(-1)?.id === g.id;
          return <Fragment key={g.id}>
            {groupDrop && drop.before === g.id && drag.id !== g.id && placeholder(`ph-${g.id}`)}
            <tr data-group-id={g.id} hidden={hidden} tabIndex={0} aria-selected={selection.selected.has(g.id)}
              onClick={event => { if (!(event.target as HTMLElement).closest("button,input,[role=checkbox]")) selection.select(g.id, event, order); }}
              onKeyDown={event => { if (event.target === event.currentTarget && (event.key === " " || event.key === "Enter")) { event.preventDefault(); selection.select(g.id, event, order); } }}
              style={{ ["--aim-group-accent" as string]: g.backgroundColor }} data-dragging={drag?.kind === "group" && dragIds.current.includes(g.id) ? "" : undefined} className={`aim-organized-group ${selection.selected.has(g.id) ? "aim-row-selected" : ""}`}>
              <td colSpan={count} onDragOver={(e) => { if (!drag) return; if (drag.kind === "category") { reject(e); return; } if (drag.kind === "row") { preview(e, { ...drag, target: g.id }); return; } const r = e.currentTarget.getBoundingClientRect(); const i = c.groups.findIndex((x) => x.id === g.id); const before = e.clientY < r.top + r.height / 2 ? g.id : c.groups[i + 1]?.id; preview(e, { ...drag, target: c.id, ...(before ? { before } : {}) }); }} onDrop={finish} className={drop?.kind === "row" && drop.target === g.id && !drop.before ? "drop-target" : ""}>
                <div className="flex items-center gap-1">
                  <span draggable={!busy} onDragStart={(e) => start(e, "group", g.id, g.title)} onDragEnd={endDrag} title="Déplacer le groupe" aria-disabled={busy} className="aim-row-grip cursor-grab"><GripVertical className="size-4" /></span>
                  <Button variant="native" size="native" aria-label={`${g.expanded ? t.collapseAll : t.expandAll} ${g.title}`} aria-expanded={g.expanded} disabled={busy} onClick={() => change({ ...configuration, categories: configuration.categories.map((cat) => ({ ...cat, groups: cat.groups.map((group) => group.id === g.id ? { ...group, expanded: !group.expanded } : group) })) })}>{g.expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button>
                  <Checkbox aria-label={`Sélectionner les enfants de ${g.title}`} disabled={busy || !g.rows.length} checked={g.rows.length > 0 && g.rows.every(row => selection.selected.has(row.id)) ? true : g.rows.some(row => selection.selected.has(row.id)) ? "indeterminate" : false}
                    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onCheckedChange={checked => selection.children(g.rows.map(row => row.id), checked === true)} />
                  {groupRename?.id === g.id ? <input autoFocus aria-label="Nom du groupe" className="field min-w-0 flex-1" value={groupRename.name} maxLength={60} onFocus={e => e.currentTarget.select()} onChange={e => setGroupRename({ ...groupRename, name: e.target.value })} onBlur={commitGroupName} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitGroupName(); } else if (e.key === "Escape") { e.preventDefault(); setGroupRename(null); } }} /> : <Button variant="native" size="native" onDoubleClick={() => { if (!busy) setGroupRename({ id: g.id, name: g.title }); }} aria-pressed={selection.selected.has(g.id)} onClick={event => selection.select(g.id, event, order)} className="min-w-0 flex-1 justify-center truncate px-2 font-semibold uppercase">{g.title}</Button>}{tools("group", g.id)}
                </div>
              </td>
            </tr>
            {g.expanded && !(drag?.kind === "group" && dragIds.current.includes(g.id)) && rows.map((r) => {
              const WI = widgetIcons[r.widget], TI = r.type ? typeIcons[r.type] : IntGlyph;
              return <tr key={r.id} hidden={hidden} data-row-id={r.id} data-parent-accent="" data-dragging={drag?.kind === "row" && dragIds.current.includes(r.id) ? "" : undefined} style={{ ["--aim-group-accent" as string]: g.backgroundColor }} aria-selected={selection.selected.has(r.id)} tabIndex={0}
                onClick={event => { if (!(event.target as HTMLElement).closest("button,input,textarea,select,[role=checkbox]")) selection.select(r.id, event, order); }}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === " " || e.key === "Enter")) { e.preventDefault(); selection.select(r.id, e, order); } if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); step("row", r.id, e.key === "ArrowUp" ? -1 : 1); }                 }} onDragOver={(e) => { if (drag?.kind !== "row") { reject(e); return; } if (drag?.kind === "row") { const rect = e.currentTarget.getBoundingClientRect(); const index = g.rows.findIndex(row => row.id === r.id); preview(e, { ...drag, target: g.id, before: e.clientY < rect.top + rect.height / 2 ? r.id : g.rows[index + 1]?.id }); }                 }} onDrop={finish} className={`${!hidden && rowIndex++ % 2 ? "row-alt" : ""} ${selection.selected.has(r.id) ? "aim-row-selected" : ""} ${drop?.before === r.id ? "drop-target" : ""}`}>
                {columns.includes("num") && <td className="text-muted-foreground tabular-nums" data-tip={attributeTooltip(r, { group: g.title, category: c.name })}><span className="aim-number-content flex items-center gap-1"><span draggable={!busy} onDragStart={(e) => start(e, "row", r.id, `${r.number} ${r.title}`)} onDragEnd={endDrag} title="Déplacer la ligne" className="aim-row-grip cursor-grab"><GripVertical className="size-3.5" /></span>{r.number.padStart(3, "0")}</span></td>}
                {columns.includes("title") && <td title={r.definition ? String(r.definition["label"]) : r.title}><span className="aim-readonly-cell block truncate">{r.title}</span></td>}
                <td><div className="flex items-center gap-1">{renderValue ? renderValue(r) : <ValueDisplay valueState={r.valueState} value={r.value} checkbox={r.widget === "checkbox"} wrap />}{!columns.includes("data") && tools("row", r.id)}</div></td>
                {columns.includes("input") && <td title={t[{ entry: "wEntry", combo: "wCombo", list: "wList", checkbox: "wCheckbox" }[r.widget] as "wEntry"]} className="aim-col-center"><WI className="mx-auto size-4 text-muted-foreground" /></td>}{columns.includes("data") && <td><div className="aim-data-cell flex items-center gap-2"><span title={r.type} className="flex flex-1 justify-center text-muted-foreground"><TI className="size-4 shrink-0" /></span>{tools("row", r.id)}</div></td>}
              </tr>;
            })}
            {!hidden && g.expanded && !(drag?.kind === "group" && dragIds.current.includes(g.id)) && <tr data-group-end={g.id} onDragOver={e => { if (drag?.kind !== "row") { reject(e); return; } preview(e, { ...drag, target: g.id }); }} onDrop={finish}><td colSpan={count} className="aim-group-drop-end">{drop?.target === g.id && !drop.before ? <div className="drop-preview h-8" /> : null}</td></tr>}
            {groupDrop && isLast && !drop.before && drag.id !== g.id && placeholder(`ph-end-${c.id}`)}
          </Fragment>;
        }))}
          {configuration.categories.some(cat => cat.id === view) && <tr data-category-end={view} onDragOver={e => { if (drag?.kind !== "group") { setDropError("Dépôt refusé : cette présentation nécessite un groupe pour les lignes."); reject(e); return; } preview(e, { ...drag, target: view }); }} onDrop={finish}><td colSpan={count} className="aim-category-drop-end">{drop?.target === view && !drop.before ? <div className="drop-preview h-8" /> : null}</td></tr>}
        </tbody>
      </table>}
    </div>
    {editingRow && (() => {
      const row = groups.flatMap(g => g.rows).find(r => r.id === editingRow);
      const group = groups.find(g => g.rows.some(r => r.id === editingRow));
      const category = configuration.categories.find(c => c.groups.some(g => g.id === group?.id));
      if (!row || !group || !category) return null;
      return <div className="fixed inset-0 z-50 flex items-center justify-center bg-dialog-overlay/30"><div className="aim-restored-form aim-stable-form"><PresentationAttributeForm groupRequired addDisabled={query ? "Effacez la recherche pour ajouter un élément." : ""} heading="Éditer l’attribut" attributes={attributes.map(a => ({ num: Number(a.number), name: a.label }))} initial={{ num: row.num, name: String(display.get(row.id)?.definition?.["label"] ?? row.title), title: row.title, widget: row.widget, type: row.type ?? "STR", options: row.options, value: "", group: group.id }} used={[]} groups={groups.map(g => g.id)} groupLabels={Object.fromEntries(groups.map(g => [g.id, g.title]))} cats={configuration.categories} groupCat={Object.fromEntries(configuration.categories.flatMap(c => c.groups.map(g => [g.id, c.id])))} defaultCat={category.id} busy={busy} onCancel={() => setEditingRow(null)} onSubmit={(fields, categoryId) => {
        const next = structuredClone(configuration);
        const edited = next.categories.flatMap(c => c.groups.flatMap(g => g.rows)).find(r => r.id === row.id);
        if (!edited) return;
        edited.num = fields.num; edited.title = fields.title; edited.widget = fields.widget; delete edited.type; delete edited.options;
        if (fields.widget !== "checkbox") edited.type = fields.type;
        if (fields.widget === "combo" || fields.widget === "list") edited.options = fields.options ?? [];
        let target = fields.group;
        if (!target || !groups.some(g => g.id === target)) {
          const cat = next.categories.find(c => c.id === categoryId); if (!cat) return;
          target = crypto.randomUUID(); cat.groups.push({ id: target, position: cat.groups.length + 1, title: fields.group || t.noGroup, backgroundColor: group.backgroundColor, expanded: true, rows: [] });
        }
        change(target === group.id ? next : moveLayout(next, { kind: "row", id: row.id, target })); setEditingRow(null);
      }} /></div></div>;
    })()}
    {!footerDetails && <div hidden aria-hidden="true">{diagnostics}</div>}
  </div>;
}
