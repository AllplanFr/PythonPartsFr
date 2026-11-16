import { validPresentationName, titleMatchesSearch, type InlinePresentationRename } from "../lib/presentation-ui";
import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { PresentationAttributeForm } from "./presentation-attribute-form";
import { AimGroupColorMenu } from "./aim-color-menu";
import { attributeTooltip, readCategoryIcon } from "../lib/presentation-display";
import { setAimDragGhost } from "../lib/drag-ghost";
import { usePresentationSelection } from "../lib/presentation-selection";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Inbox,
  LayoutGrid,
  Layers,
  Folder,
  Plus,
  Pencil,
  Trash2,
  ImagePlus,
  TextCursorInput,
  SquareCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AimActionGlyph } from "./aim-action-glyph";
import { UnavailableRowActions } from "./unavailable-row-actions";
import { ValueDisplay, type OutsideAttribute } from "./organized-presentation";
import { CATEGORY_HOVER_DELAY_MS } from "../lib/organized-layout";
import {
  configurationRows,
  deleteTree,
  moveTree,
  moveTreeSelection,
  type TreeConfiguration,
  type TreeDisplayRow,
  type TreeMove,
  type TreePresentation,
  type TreeRow,
} from "../lib/presentation-tree";
import { isAnyConfiguration as isConfiguration } from "../lib/aim-presentation-contract";
import { IntGlyph, StrGlyph, FloatGlyph } from "./type-glyphs";
import { ChevronsUpDown, List, CalendarDays, Clock, AtSign, Phone, Link2 } from "lucide-react";
import { DEFAULT_SEARCH, matchesSearch, type SearchOptions } from "../lib/aim-interface";
import { DEFAULT_COLUMNS, type ColumnKey } from "./aim-columns";

export function TreePresentationView({
  presentation,
  onConfigurationChange,
  busy = false,
  outside = null,
  onAddOccurrence, onAddOccurrences, onPickIcon,
  query = "",
  searchOptions = DEFAULT_SEARCH,
  attributes = [],
  renderValue,
  columns = DEFAULT_COLUMNS, view: suppliedView, onViewChange, renameRequest, onRenameStarted,
}: {
  view?: string; onViewChange?: (view: string) => void; renameRequest?: InlinePresentationRename | null; onRenameStarted?: () => void;
  presentation: TreePresentation;
  columns?: ColumnKey[];
  attributes?: { number: string; label: string }[];
  onConfigurationChange?: (c: TreeConfiguration) => void;
  busy?: boolean;
  outside?: OutsideAttribute[] | null;
  onAddOccurrence?: (number: string, target: string, configuration?: TreeConfiguration) => void;
  onAddOccurrences?: (numbers: string[], target: string, before?: string) => void;
  onPickIcon?: (categoryId: string) => Promise<void>;
  query?: string;
  searchOptions?: SearchOptions;
  renderValue?: (row: OutsideAttribute | TreeDisplayRow) => ReactNode;
}) {
  const c = presentation.configuration;
  const searchActive = query.length > 0;
  const addDisabled = searchActive ? "Effacez la recherche pour ajouter un élément." : "";
  // One ordered definition drives column tracks, headers, cells and spanning rows.
  const visibleColumns = ([
    { key: "num", label: "N°", track: "aim-number-column" },
    { key: "title", label: "Titre", track: "aim-title-column" },
    { key: "value", label: "Valeur", track: "" },
    { key: "input", label: "Saisie", track: "aim-kind-column" },
    { key: "data", label: "Donnée", track: "aim-kind-column aim-data-column" },
  ] as const).filter(column => column.key === "value" || columns.includes(column.key));
  const visible = new Set<string>(visibleColumns.map(column => column.key));
  const columnCount = visibleColumns.length;
  const widgets = {
    entry: TextCursorInput,
    combo: ChevronsUpDown,
    list: List,
    checkbox: SquareCheck,
  };
  const types = {
    STR: StrGlyph,
    INT: IntGlyph,
    FLOAT: FloatGlyph,
    DATE: CalendarDays,
    TIME: Clock,
    EMAIL: AtSign,
    PHONE: Phone,
    URL: Link2,
  };
  const [localView, setLocalView] = useState("all");
  const view = suppliedView ?? localView;
  const setView = (id: string) => { setLocalView(id); onViewChange?.(id); };
  const selection = usePresentationSelection();
  const dragIds = useRef<string[]>([]);
  const dropRef = useRef<TreeMove | null>(null);
  const setDestination = (intent: TreeMove | null) => { dropRef.current = intent; setDrop(intent); };
  const [drag, setDrag] = useState<Pick<TreeMove, "kind" | "id"> | null>(null);
  const [drop, setDrop] = useState<TreeMove | null>(null);
  const outsideDrag = useRef<string[] | null>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const iconCategory = useRef<string | null>(null);
  const iconGeneration = useRef(0);
  useEffect(() => () => { iconGeneration.current++; }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = useRef<string | null>(null);
  const stopHover = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    hover.current = null;
  };
  useEffect(() => stopHover, []);
  const [edit, setEdit] = useState<{
    kind: TreeMove["kind"];
    id: string;
    title: string;
    color?: string;
    icon?: string;
    row?: TreeRow;
  } | null>(null);
  const [remove, setRemove] = useState<{
    kind: TreeMove["kind"];
    id: string;
    lines: number;
    groups: number;
  } | null>(null);
  const [create, setCreate] = useState<{
    kind: "group" | "category";
    move: Pick<TreeMove, "kind" | "id">;
    category: string;
    outsideNumber?: string;
  } | null>(null);
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!renameRequest) return;
    const category = c.categories.find(cat => cat.id === renameRequest.id);
    const group = c.categories.flatMap(cat => cat.children).find(child => child.kind === "group" && child.id === renameRequest.id);
    if (renameRequest.kind === "category" && category) setRename({ id: category.id, name: category.name });
    else if (group?.kind === "group") { setRename({ id: group.id, name: group.title }); }
    else return;
    onRenameStarted?.();
  }, [renameRequest, c, onRenameStarted]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const modelRows = new Map(
    presentation.model.categories
      .flatMap((cat) => cat.children.flatMap((x) => (x.kind === "row" ? [x] : x.rows)))
      .map((r) => [r.id, r]),
  );
  const matchesRow = (id: string, group: string, category: string) => {
    const row = modelRows.get(id);
    return !!row && matchesSearch({ num: row.number, title: row.title, name: String(row.definition?.["label"] ?? ""), value: row.value ?? "", group, category }, query, searchOptions);
  };
  const outsideRows = (outside ?? []).filter(a => matchesSearch({ num: a.number, name: a.label, title: a.label, value: a.value ?? "", group: "", category: "" }, query, searchOptions));
  const order = c.categories.filter(cat => view === "all" || cat.id === view).flatMap(cat => cat.children.flatMap(child => {
    if (child.kind === "row") return matchesRow(child.id, "Sans groupe", cat.name) ? [child.id] : [];
    const rows = child.rows.filter(row => matchesRow(row.id, child.title, cat.name)).map(row => row.id);
    return !query || rows.length || titleMatchesSearch(child.title, "group", query, searchOptions) ? [child.id, ...(child.expanded ? rows : [])] : [];
  }));
  const groups = c.categories.flatMap((cat) =>
    cat.children.filter((x) => x.kind === "group").map((g) => ({ ...g, category: cat })),
  );
  const change = (n: TreeConfiguration) => {
    if (!busy && isConfiguration(n)) onConfigurationChange?.(n);
  };
  const end = () => {
    stopHover();
    outsideDrag.current = null;
    setDrag(null);
    dragIds.current = [];
    setDestination(null);
  };
  const start = (e: DragEvent, kind: TreeMove["kind"], id: string, title = "") => {
    if (busy) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    setError("");
    const selectedIds = selection.dragIds(id, outsideDrag.current ? outsideRows.map(a => `outside-${a.number}`) : kind === "category" ? c.categories.map(cat => cat.id) : c.categories.flatMap(cat => cat.children.flatMap(child => child.kind === "group" ? [child.id, ...child.rows.map(row => row.id)] : [child.id])));
    dragIds.current = selectedIds.filter(key => !groups.some(group => selectedIds.includes(group.id) && group.rows.some(row => row.id === key)));
    if (outsideDrag.current) outsideDrag.current = dragIds.current.map(key => key.slice(8));
    setDrag({ kind, id });
    e.dataTransfer.setData("application/x-aim-layout", id);
    e.dataTransfer.effectAllowed = "move";
    setAimDragGhost(e, kind, title, dragIds.current.length);
  };
  const reject = (e: DragEvent) => { e.stopPropagation(); e.dataTransfer.dropEffect = "none"; setDestination(null); };
  const preview = (e: DragEvent, target: string, before?: string, endPosition = false, explicitCategory = false) => {
    if (drag?.kind !== "category" && !explicitCategory && !c.categories.some(cat => cat.id === view)) { reject(e); return; }
    if (drag?.kind === "category" && target !== "categories") { reject(e); return; }
    if (!drag || busy || dragIds.current.includes(target)) { reject(e); return; }
    if (dragIds.current.some(id => groups.some(group => group.id === id)) && groups.some(group => group.id === target)) { setError("Dépôt refusé : la sélection contient un groupe, qui doit rester dans une catégorie."); reject(e); return; }
    e.preventDefault();
    e.stopPropagation();
    setDestination({
      ...drag,
      target,
      ...(before ? { before } : {}),
      ...(endPosition ? { end: true } : {}),
    });
  };
  const finish = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const intent = dropRef.current;
    try {
      if (!intent || busy) return;
      if (outsideDrag.current) { if (!searchActive && !addDisabled) onAddOccurrences?.(outsideDrag.current, intent.target, intent.before); }
      else { const next = moveTreeSelection(c, intent, dragIds.current); if (next === c) setError("Dépôt refusé : destination incompatible avec la sélection."); else change(next); }
    } finally { end(); }
  };
  useEffect(() => {
    const cancel = () => end();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") end(); };
    window.addEventListener("dragend", cancel);
    window.addEventListener("drop", cancel);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("dragend", cancel); window.removeEventListener("drop", cancel); window.removeEventListener("keydown", escape); };
  }, []);
  const parent = (id: string) =>
    c.categories.find((cat) =>
      cat.children.some(
        (x) => x.id === id || (x.kind === "group" && x.rows.some((r) => r.id === id)),
      ),
    );
  const move = (kind: TreeMove["kind"], id: string, target: string) => {
    const ids = selection.dragIds(id, kind === "group" ? groups.map(group => group.id) : configurationRows(c).map(row => row.id));
    change(moveTreeSelection(c, { kind, id, target, end: true }, ids));
  };
  const commitRename = () => {
    if (!rename || busy) return;
    const name = rename.name.trim();
    const category = c.categories.find(cat => cat.id === rename.id);
    const siblings = category ? c.categories.filter(cat => cat.id !== rename.id).map(cat => cat.name) : groups.filter(group => group.id !== rename.id).map(group => group.title);
    if (!validPresentationName(name, siblings)) return;
    change({ ...c, categories: c.categories.map(cat => cat.id === rename.id ? { ...cat, name } : { ...cat, children: cat.children.map(child => child.kind === "group" && child.id === rename.id ? { ...child, title: name } : child) }) });
    setRename(null);
  };
  useEffect(() => {
    const validate = (event: Event) => {
      const category = rename && c.categories.find(cat => cat.id === rename.id);
      const siblings = category ? c.categories.filter(cat => cat.id !== rename?.id).map(cat => cat.name) : groups.filter(group => group.id !== rename?.id).map(group => group.title);
      if (edit || create || remove || rename && !validPresentationName(rename.name, siblings)) event.preventDefault();
    };
    window.addEventListener("aim-flush-presentation", validate);
    return () => window.removeEventListener("aim-flush-presentation", validate);
  }, [edit, create, remove, rename, c]);
  const controls = (kind: "row" | "group", id: string, outsideNumber?: string) => {
    const cat = c.categories.find(cat => cat.id === view);
    const moveAction = (target: string) => { if (outsideNumber) { if (!searchActive && !addDisabled) onAddOccurrence?.(outsideNumber, target); } else move(kind, id, target); };
    const group = groups.find((g) => g.rows.some((r) => r.id === id));
    return (
      <span className="aim-organized-tools flex items-center gap-0.5">
        {kind === "group" && (() => { const current = groups.find(g => g.id === id); return current && <AimGroupColorMenu label={`Couleur ${id}`} value={current.backgroundColor} disabled={busy} onPick={color => change({ ...c, categories: c.categories.map(category => ({ ...category, children: category.children.map(child => child.kind === "group" && child.id === id ? { ...child, backgroundColor: color } : child) })) })} />; })()}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="native"
              size="native"
              aria-label={`Déplacer vers ${id}`}
              disabled={busy || (!!outsideNumber && (!onAddOccurrence || searchActive || !!addDisabled))}
              title={outsideNumber && addDisabled ? addDisabled : "Déplacer vers"}
            >
              <AimActionGlyph name="move" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="suite-menu w-80">
            {kind === "row" && (
              <>
                <DropdownMenuLabel>DÉPLACER VERS · GROUPES</DropdownMenuLabel>
                {groups.map((g) => (
                  <DropdownMenuItem key={g.id} onSelect={() => moveAction(g.id)}>
                    <Layers className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{g.title}</span>
                    <span className="max-w-24 truncate text-xs text-muted-foreground">
                      {g.category.name}
                    </span>
                    {group?.id === g.id && "✓"}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onSelect={() => {
                    if (cat) moveAction(cat.id);
                  }}
                >
                  <Layers className="size-4" />
                  <i>Sans groupe</i>
                  {!group && "✓"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!cat || searchActive}
                  title={addDisabled}
                  onSelect={() => {
                    if (!cat || searchActive) return;
                    setName("");
                    setCreate({
                      kind: "group",
                      move: { kind, id },
                      category: cat?.id ?? "",
                      ...(outsideNumber ? { outsideNumber } : {}),
                    });
                  }}
                >
                  <Plus className="size-4" />
                  Nouveau groupe…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel>CATÉGORIES</DropdownMenuLabel>
            {c.categories.map((x) => (
              <DropdownMenuItem key={x.id} onSelect={() => moveAction(x.id)}>
                <Folder className="size-4" />
                {x.name}
                {cat?.id === x.id && <span className="ml-auto">✓</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              disabled={searchActive}
              title={addDisabled}
              onSelect={() => {
                if (searchActive) return;
                setName("");
                setCreate({ kind: "category", move: { kind, id }, category: "", ...(outsideNumber ? { outsideNumber } : {}) });
              }}
            >
              <Plus className="size-4" />
              Nouvelle catégorie…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {outsideNumber ? <UnavailableRowActions number={outsideNumber} /> : <>
        <Button
          variant="native"
          size="native"
          title="Éditer"
          aria-label={`Éditer ${id}`}
          disabled={busy}
          onClick={() => {
            if (kind === "group") { const group = groups.find(group => group.id === id); if (group) setRename({ id, name: group.title }); return; }
            const row = configurationRows(c).find((r) => r.id === id);
            const g = groups.find((x) => x.id === id);
            setError("");
            setEdit({
              kind,
              id,
              title: row?.title ?? g?.title ?? "",
              ...(kind === "row" && row ? { row: structuredClone(row) as TreeRow } : {}),
              ...(g ? { color: g.backgroundColor } : {}),
            });
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="native"
          size="native"
          title="Supprimer"
          aria-label={`Supprimer ${id}`}
          disabled={busy}
          onClick={() => {
            const g = groups.find((x) => x.id === id);
            if (kind === "row") change(deleteTree(c, kind, id));
            else setRemove({ kind, id, lines: g?.rows.length ?? 0, groups: 0 });
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
        </>}
      </span>
    );
  };
  const outsideActions = (a: OutsideAttribute) => controls("row", a.number, a.number);
  const placeholder = (target: string, before: string | undefined, key: string) =>
    drop && drop.target === target && drop.before === before ? (
      <tr
        key={key}
        data-tree-placeholder
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={finish}
      >
        <td colSpan={columnCount}>
          <div className="drop-preview h-8" />
        </td>
      </tr>
    ) : null;
  let stripe = 0;
  const rowMatches = matchesRow;
  const row = (
    r: TreeDisplayRow,
    target: string,
    next?: string,
    groupTitle = "Sans groupe",
    categoryTitle = "",
    groupAccent?: string,
    hidden = false,
  ) => {
    if (
      !matchesSearch(
        {
          num: r.number,
          title: r.title,
          name: String(r.definition?.["label"] ?? ""),
          value: r.value ?? "",
          group: groupTitle,
          category: categoryTitle,
        },
        query,
        searchOptions,
      )
    )
      return null;
    const WI = widgets[r.widget];
    const TI = r.type ? types[r.type] : IntGlyph;
    return (
      <Fragment key={r.id}>
        {!hidden && placeholder(target, r.id, `before-${r.id}`)}
        <tr
          data-row-id={r.id}
          hidden={hidden}
          data-parent-accent={groupAccent ? "" : undefined}
          style={groupAccent ? { ["--aim-group-accent" as string]: groupAccent } : undefined}
          tabIndex={0}
          aria-selected={selection.selected.has(r.id)}
          onClick={event => { if (!(event.target as HTMLElement).closest("button,input,textarea,select,[role=checkbox]")) selection.select(r.id, event, order); }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === " " || event.key === "Enter")) { event.preventDefault(); selection.select(r.id, event, order); } }}
          data-dragging={drag?.kind === "row" && dragIds.current.includes(r.id) ? "" : undefined}
          className={`${!hidden && stripe++ % 2 ? "row-alt" : ""} ${selection.selected.has(r.id) ? "aim-row-selected" : ""}`}
          onDragOver={(e) => {
            if (!drag || drag.kind === "category" || groups.some(group => group.id === target) && dragIds.current.some(id => groups.some(group => group.id === id))) { reject(e); return; }
            const rect = e.currentTarget.getBoundingClientRect();
            preview(
              e,
              target,
              e.clientY < rect.top + rect.height / 2 ? r.id : next,
              !next && e.clientY >= rect.top + rect.height / 2,
            );
          }}
          onDrop={finish}
        >
          {visible.has("num") && <td className="text-muted-foreground" data-tip={attributeTooltip(r, { group: groupTitle === "Sans groupe" ? undefined : groupTitle, category: categoryTitle })}>
            <span className="flex items-center gap-1">
              <span
                draggable={!busy}
                onDragStart={(e) => start(e, "row", r.id, `${r.number} ${r.title}`)}
                onDragEnd={end}
                className="aim-row-grip cursor-grab"
              >
                <GripVertical className="size-3.5" />
              </span>
              {r.number}
            </span>
          </td>}
          {visible.has("title") && <td>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="aim-readonly-cell block truncate">{r.title}</span>
              </TooltipTrigger>
              <TooltipContent className="border border-border bg-popover p-3 text-popover-foreground">
                <p className="font-semibold">
                  {typeof r.definition?.["label"] === "string" ? `Nom Allplan : ${r.definition["label"]}` : r.number}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-xs">
                  {[
                    ["N°", r.number],
                    ["Titre", r.title],
                    [
                      "Saisie",
                      {
                        entry: "Saisie libre",
                        combo: "Liste déroulante",
                        list: "Liste",
                        checkbox: "Case à cocher",
                      }[r.widget],
                    ],
                    ["Donnée", r.type === "STR" ? "Texte" : (r.type ?? "Case à cocher")],
                    ["Groupe", groupTitle],
                    [
                      "Valeur",
                      r.valueState === "set"
                        ? r.value
                        : r.valueState === "unset"
                          ? "Non renseigné"
                          : "Indisponible",
                    ],
                  ].map(([label, value]) => (
                    <Fragment key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </Fragment>
                  ))}
                </dl>
              </TooltipContent>
            </Tooltip>
          </td>}
          <td>
            <div className="flex items-center gap-1">{renderValue ? renderValue(r) : <ValueDisplay
              valueState={r.valueState}
              value={r.value}
              checkbox={r.widget === "checkbox"}
              wrap
            />}{!visible.has("data") && controls("row", r.id)}</div>
          </td>
          {visible.has("input") && <td className="aim-col-center" title={{ entry: "Saisie libre", combo: "Liste déroulante", list: "Liste", checkbox: "Case à cocher" }[r.widget]}>
            <WI className="mx-auto size-4 text-muted-foreground" />
          </td>}
          {visible.has("data") && <td>
            <div className="aim-data-cell flex items-center gap-1">
              <span className="flex-1 text-center text-xs text-muted-foreground" title={r.type ?? "Case à cocher"}>
                <TI className="mx-auto size-4 text-muted-foreground" />
              </span>
              {controls("row", r.id)}
            </div>
          </td>}
        </tr>
      </Fragment>
    );
  };
  const count = (cat: TreeConfiguration["categories"][number]) =>
    cat.children.reduce((n, x) => n + (x.kind === "row" ? 1 : x.rows.length), 0);
  return (
    <TooltipProvider>
      <div className="aim-organized flex min-h-0 flex-1 gap-2" aria-label="organized-presentation">
        <aside className="aim-organized-categories shrink-0 overflow-auto border border-border bg-panel">
          <p className="catalog-panel-heading px-2 py-1 font-semibold">Catégories</p>
          {[
            { id: "all", name: "Toutes" },
            ...c.categories,
            { id: "unlisted", name: "Hors présentation" },
          ].map((x) => {
            const fixed = x.id === "all" || x.id === "unlisted";
            const cat = c.categories.find((y) => y.id === x.id);
            if (query && cat && !titleMatchesSearch(cat.name, "category", query, searchOptions) && !cat.children.some(child => child.kind === "group" ? titleMatchesSearch(child.title, "group", query, searchOptions) || child.rows.some(r => rowMatches(r.id, child.title, cat.name)) : rowMatches(child.id, "", cat.name))) return null;
            return (
              <Fragment key={x.id}>
                {drag?.kind === "category" && drop?.before === x.id && (
                  <div className="drop-preview h-8" />
                )}
                <div
                  data-category-id={x.id}
                  data-fixed={fixed ? "" : undefined}
                  className={`group/cat aim-organized-category flex items-center ${view === x.id ? "catalog-selected-row bg-selection" : "hover:bg-accent"} ${x.id === "unlisted" ? "aim-category-separated" : ""}`}
                  onDragEnter={(e) => {
                    if (!drag || drag.kind === "category" || fixed || busy) return;
                    e.preventDefault();
                    if (hover.current === x.id) return;
                    stopHover();
                    hover.current = x.id;
                    timer.current = setTimeout(() => {
                      setView(x.id);
                      timer.current = null;
                    }, CATEGORY_HOVER_DELAY_MS);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) stopHover();
                  }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    if (fixed) { reject(e); return; }
                    if (drag.kind === "category") {
                      const i = c.categories.findIndex((y) => y.id === x.id);
                      const r = e.currentTarget.getBoundingClientRect();
                      preview(
                        e,
                        "categories",
                        e.clientY < r.top + r.height / 2 ? x.id : c.categories[i + 1]?.id,
                      );
                    } else preview(e, x.id, undefined, false, true);
                  }}
                  onDrop={e => { if (fixed) { reject(e); end(); } else finish(e); }}
                >
                  <span className="aim-category-grip-slot shrink-0">
                    {!fixed && (
                      <span
                        className="aim-row-grip cursor-grab"
                        draggable={!busy}
                        onDragStart={(e) => start(e, "category", x.id, x.name)}
                        onDragEnd={end}
                      >
                        <GripVertical className="size-3.5" />
                      </span>
                    )}
                  </span>
                  {rename?.id === x.id ? <input autoFocus aria-label="Nom de la catégorie" className="field min-w-0 flex-1" value={rename.name} maxLength={60} onFocus={e => e.currentTarget.select()} onChange={e => setRename({ ...rename, name: e.target.value })} onBlur={commitRename} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } else if (e.key === "Escape") { e.preventDefault(); setRename(null); } }} /> : <Button
                    variant="native"
                    size="native"
                    className="aim-category-select min-w-0 flex-1 justify-start gap-2 font-normal"
                    aria-pressed={view === x.id}
                    onClick={() => setView(x.id)}
                    onDoubleClick={() => { if (cat && !busy) setRename({ id: cat.id, name: cat.name }); }}
                  >
                    {x.id === "all" ? (
                      <LayoutGrid className="size-4" />
                    ) : x.id === "unlisted" ? (
                      <Inbox className="size-4" />
                    ) : cat?.icon.startsWith("data:image/") ? (
                      <img src={cat.icon} alt="" className="size-4" />
                    ) : (
                      <Folder className="size-4" />
                    )}
                    <span className="truncate">{x.name}</span>
                  </Button>}
                  {cat && (
                    <span className="aim-category-tools flex">
                      <Button
                        variant="native"
                        size="native"
                        aria-label={`Icône ${x.name}`}
                        title="Changer l’icône de la catégorie"
                        disabled={busy}
                        onClick={() => { if (onPickIcon) { void onPickIcon(x.id); return; } iconGeneration.current++; iconCategory.current = x.id; setError(""); iconInput.current?.click(); }}
                      >
                        <ImagePlus className="size-3.5" />
                      </Button>
                      <Button
                        variant="native"
                        size="native"
                        aria-label={`Éditer ${x.name}`}
                        title="Renommer la catégorie"
                        disabled={busy}
                        onClick={() =>
                          setRename({ id: x.id, name: x.name })
                        }
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="native"
                        size="native"
                        aria-label={`Supprimer ${x.name}`}
                        title="Supprimer la catégorie"
                        disabled={busy}
                        onClick={() =>
                          setRemove({
                            kind: "category",
                            id: x.id,
                            lines: count(cat),
                            groups: cat.children.filter((x) => x.kind === "group").length,
                          })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </span>
                  )}
                  <span data-category-count={x.id} className={`aim-category-count px-2 text-xs text-muted-foreground ${fixed ? "aim-fixed-count" : ""}`}>
                    {cat
                      ? count(cat)
                      : x.id === "all"
                        ? presentation.model.categories.reduce((n, cat) => n + cat.children.reduce((sum, child) => sum + (child.kind === "row" ? 1 : child.rows.length), 0), 0)
                        : (outside?.length ?? "—")}
                  </span>
                </div>
              </Fragment>
            );
          })}
          <input ref={iconInput} type="file" aria-label="Parcourir" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={e => {
            const file = e.target.files?.[0], id = iconCategory.current; e.target.value = "";
            if (!file || !id || busy) return;
            const generation = ++iconGeneration.current;
            void readCategoryIcon(file).then(icon => { if (generation === iconGeneration.current) change({ ...c, categories: c.categories.map(cat => cat.id === id ? { ...cat, icon } : cat) }); }).catch(() => { if (generation === iconGeneration.current) setError("Impossible de lire cette image locale ; icône conservée."); });
          }} />
          {error && <p role="alert" className="p-2 text-xs text-destructive">{error}</p>}
        </aside>
        <div className="suite-table min-w-0 flex-1 overflow-auto border border-border bg-background" onDragOver={e => { const cat = c.categories.find(cat => cat.id === view); if (!cat || drag?.kind === "category") { reject(e); return; } preview(e, cat.id, undefined, true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDestination(null); }} onDrop={finish}>
          <table
            className="aim-organized-table w-full text-sm"
            role="grid"
            aria-label={
              view === "unlisted" ? "Attributs hors présentation" : "Attributs de présentation"
            }
          >
            <colgroup>
              {visibleColumns.map(column => <col key={column.key} className={column.track} />)}
            </colgroup>
            <thead className="catalog-panel-heading sticky top-0 z-10">
              <tr>
                {visibleColumns.map((column) => (
                  <th
                    role="columnheader"
                    key={column.key}
                    className={column.key === "input" || column.key === "data" ? "aim-col-center" : ""}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(view === "unlisted" || outsideDrag.current) && outsideRows.map((a, i) => (
                    <tr key={`outside-${a.number}`} hidden={view !== "unlisted"} tabIndex={0} aria-selected={selection.selected.has(`outside-${a.number}`)} onClick={event => { if (!(event.target as HTMLElement).closest("button,input,textarea,select,[role=checkbox]")) selection.select(`outside-${a.number}`, event, outsideRows.map(row => `outside-${row.number}`)); }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === " " || event.key === "Enter")) { event.preventDefault(); selection.select(`outside-${a.number}`, event, outsideRows.map(row => `outside-${row.number}`)); } }} className={`${i % 2 ? "row-alt" : ""} ${selection.selected.has(`outside-${a.number}`) ? "aim-row-selected" : ""}`}>
                      {visible.has("num") && <td className="text-muted-foreground" data-tip={attributeTooltip(a)}><span className="flex items-center gap-1"><span aria-label={`Déplacer la ligne ${a.number}`} title={addDisabled || "Déplacer la ligne"} className="aim-row-grip cursor-grab"                       draggable={!busy && !searchActive && !addDisabled && !!onAddOccurrence} onDragStart={e => { if (busy || searchActive || addDisabled || !onAddOccurrence) { e.preventDefault(); return; } outsideDrag.current = [a.number]; start(e, "row", `outside-${a.number}`, `${a.number} ${a.label}`); }} onDragEnd={end}><GripVertical className="size-3.5" /></span>{a.number}</span></td>}
                      {visible.has("title") && <td>{a.label}</td>}
                      <td>
                        <div className="flex items-center gap-1">{renderValue ? renderValue(a) : <ValueDisplay valueState={a.valueState} value={a.value} />}{!visible.has("data") && outsideActions(a)}</div>
                      </td>
                      {visible.has("input") && <td className="aim-col-center" title="Saisie libre"><TextCursorInput className="mx-auto size-4 text-muted-foreground" /></td>}
                      {visible.has("data") && <td>
                        <div className="aim-data-cell flex items-center gap-1"><span className="flex-1 text-center text-xs text-muted-foreground" title="STR"><StrGlyph className="mx-auto size-4 text-muted-foreground" /></span>{outsideActions(a)}</div>
                      </td>}
                    </tr>
                  ))}
              {view !== "unlisted" && c.categories
                    // Keep the native drag source mounted when hovering another category.
                    .filter((cat) => view === "all" || cat.id === view || !!drag && parent(drag.id)?.id === cat.id)
                    .flatMap((cat) =>
                      cat.children.map((child, i) => {
                        const hidden = view !== "all" && cat.id !== view;
                        if (child.kind === "row") {
                          const r = modelRows.get(child.id);
                          return r
                            ? row(r, cat.id, cat.children[i + 1]?.id, "Sans groupe", cat.name, undefined, hidden)
                            : null;
                        }
                        if (query && !titleMatchesSearch(child.title, "group", query, searchOptions) && !child.rows.some(r => rowMatches(r.id, child.title, cat.name))) return null;
                        return (
                          <Fragment key={child.id}>
                            {!hidden && placeholder(cat.id, child.id, `ph-${child.id}`)}
                            <tr
                              data-group-id={child.id}
                              hidden={hidden}
                              tabIndex={0}
                              aria-selected={selection.selected.has(child.id)}
                              onClick={event => { if (!(event.target as HTMLElement).closest("button,input,[role=checkbox]")) selection.select(child.id, event, order); }}
                              onKeyDown={event => { if (event.target === event.currentTarget && (event.key === " " || event.key === "Enter")) { event.preventDefault(); selection.select(child.id, event, order); } }}
                              data-dragging={drag?.kind === "group" && dragIds.current.includes(child.id) ? "" : undefined}
                              className={`aim-organized-group ${selection.selected.has(child.id) ? "aim-row-selected" : ""}`}
                              style={{ ["--aim-group-accent" as string]: child.backgroundColor }}
                              onDragOver={(e) => {
                                if (drag?.kind === "row" && !dragIds.current.some(id => groups.some(group => group.id === id))) preview(e, child.id, undefined, true);
                                else {
                                  const r = e.currentTarget.getBoundingClientRect();
                                  preview(
                                    e,
                                    cat.id,
                                    e.clientY < r.top + r.height / 2
                                      ? child.id
                                      : cat.children[i + 1]?.id,
                                    e.clientY >= r.top + r.height / 2 && !cat.children[i + 1],
                                  );
                                }
                              }}
                              onDrop={finish}
                            >
                              <td colSpan={columnCount}>
                                <div className="flex items-center gap-1">
                                  <span
                                    className="aim-row-grip cursor-grab"
                                    aria-disabled={busy}
                                    draggable={!busy}
                                    onDragStart={(e) => start(e, "group", child.id, child.title)}
                                    onDragEnd={end}
                                  >
                                    <GripVertical className="size-4" />
                                  </span>
                                  <Button
                                    variant="native"
                                    size="native"
                                    aria-label={`${child.expanded ? "Replier" : "Déplier"} ${child.title}`}
                                    aria-expanded={child.expanded}
                                    disabled={busy}
                                    onClick={() => {
                                      const n = structuredClone(c);
                                      for (const ca of n.categories)
                                        for (const g of ca.children)
                                          if (g.kind === "group" && g.id === child.id)
                                            g.expanded = !g.expanded;
                                      change(n);
                                    }}
                                  >
                                    {child.expanded ? (
                                      <ChevronDown className="size-4" />
                                    ) : (
                                      <ChevronRight className="size-4" />
                                    )}
                                  </Button>
                                  <Checkbox aria-label={`Sélectionner les enfants de ${child.title}`} disabled={busy || !child.rows.length}
                                    checked={child.rows.length > 0 && child.rows.every(row => selection.selected.has(row.id)) ? true : child.rows.some(row => selection.selected.has(row.id)) ? "indeterminate" : false}
                                    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
                                    onCheckedChange={checked => selection.children(child.rows.map(row => row.id), checked === true)} />
                                  {rename?.id === child.id ? <input autoFocus aria-label="Nom du groupe" className="field min-w-0 flex-1" value={rename.name} maxLength={60} onFocus={e => e.currentTarget.select()} onChange={e => setRename({ ...rename, name: e.target.value })} onBlur={commitRename} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commitRename(); } else if (e.key === "Escape") { e.preventDefault(); setRename(null); } }} /> : <span className="flex-1 text-center font-semibold" onDoubleClick={() => { if (!busy) setRename({ id: child.id, name: child.title }); }}>{child.title}</span>}
                                  {controls("group", child.id)}
                                </div>
                              </td>
                            </tr>
                            {child.expanded && !(drag?.kind === "group" && dragIds.current.includes(child.id)) &&
                              child.rows.map((r, j) => {
                                const display = modelRows.get(r.id);
                                return display
                                  ? row(
                                      display,
                                      child.id,
                                      child.rows[j + 1]?.id,
                                      child.title,
                                      cat.name,
                                      child.backgroundColor,
                                      hidden,
                                    )
                                  : null;
                              })}
                            {!hidden && child.expanded && !(drag?.kind === "group" && dragIds.current.includes(child.id)) && <tr data-group-end={child.id} onDragOver={e => preview(e, child.id, undefined, true)} onDrop={finish}><td colSpan={columnCount} className="aim-group-drop-end">{drop?.target === child.id && !drop.before ? <div className="drop-preview h-8" /> : null}</td></tr>}

                          </Fragment>
                        );
                      }),
                    )}
              {c.categories.some(cat => cat.id === view) && <tr data-category-end={view} onDragOver={e => preview(e, view, undefined, true)} onDrop={finish}><td colSpan={columnCount} className="aim-category-drop-end">{drop?.target === view && !drop.before ? <div className="drop-preview h-8" /> : null}</td></tr>}
            </tbody>
          </table>
        </div>
        {edit?.row && <div className="fixed inset-0 z-50 flex items-center justify-center bg-dialog-overlay/30"><div className="aim-restored-form aim-stable-form">
          <PresentationAttributeForm addDisabled={searchActive ? "Effacez la recherche pour ajouter un élément." : ""} heading="Éditer l’attribut" attributes={attributes.map(a => ({ num: Number(a.number), name: a.label }))} initial={{ num: edit.row.num, name: String(modelRows.get(edit.id)?.definition?.["label"] ?? edit.title), title: edit.title, widget: edit.row.widget, type: edit.row.type ?? "STR", options: edit.row.options, value: "", group: groups.find(g => g.rows.some(r => r.id === edit.id))?.id }} used={[]} groups={groups.map(g => g.id)} cats={c.categories} groupCat={Object.fromEntries(groups.map(g => [g.id, g.category.id]))} groupLabels={Object.fromEntries(groups.map(g => [g.id, g.title]))} defaultCat={parent(edit.id)?.id ?? c.categories[0]?.id ?? ""} busy={busy} onCancel={() => setEdit(null)} onSubmit={(fields, category) => {
            const next = structuredClone(c);
            const current = configurationRows(next).find(r => r.id === edit.id);
            if (!current) return;
            current.num = fields.num; current.title = fields.title; current.widget = fields.widget;
            delete current.type; delete current.options;
            if (fields.widget !== "checkbox") current.type = fields.type;
            if (fields.widget === "combo" || fields.widget === "list") current.options = fields.options ?? [];
            let target = fields.group || category;
            if (fields.group && !groups.some(g => g.id === fields.group)) {
              const cat = next.categories.find(cat => cat.id === category);
              if (!cat) return;
              target = crypto.randomUUID();
              cat.children.push({ kind: "group", id: target, position: cat.children.length + 1, title: fields.group, backgroundColor: "#FFFFFF", expanded: true, rows: [] });
            }
            const currentTarget = groups.find(g => g.rows.some(r => r.id === edit.id))?.id ?? parent(edit.id)?.id;
            const moved = target === currentTarget ? next : moveTree(next, { kind: "row", id: edit.id, target });
            if (!isConfiguration(moved)) return;
            change(moved); setEdit(null);
          }} />
        </div></div>}
        {((edit && !edit.row) || remove || create) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-dialog-overlay/30">
            <form
              role="dialog"
              aria-modal="true"
              aria-label={
                remove
                  ? "Supprimer de la présentation"
                  : create
                    ? "Créer une destination"
                    : "Propriétés de présentation"
              }
              className="w-96 max-w-[95vw] border border-border bg-background text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                if (remove) {
                  change(deleteTree(c, remove.kind, remove.id));
                  setRemove(null);
                  return;
                }
                const n = structuredClone(c);
                if (create) {
                  if (searchActive) { setError(addDisabled); return; }
                  const id = crypto.randomUUID();
                  if (create.kind === "category")
                    n.categories.push({
                      id,
                      position: n.categories.length + 1,
                      name: name.trim(),
                      icon: "",
                      children: [],
                    });
                  else {
                    const cat = n.categories.find((x) => x.id === create.category);
                    if (!cat) return;
                    cat.children.push({
                      kind: "group",
                      id,
                      position: cat.children.length + 1,
                      title: name.trim(),
                      backgroundColor: "#FFFFFF",
                      expanded: true,
                      rows: [],
                    });
                  }
                  if (create.outsideNumber) onAddOccurrence?.(create.outsideNumber, id, n);
                  else change(moveTreeSelection(n, { ...create.move, target: id, end: true }, selection.dragIds(create.move.id, create.move.kind === "group" ? groups.map(group => group.id) : configurationRows(c).map(row => row.id))));
                  setCreate(null);
                  return;
                }
                if (edit) {
                  for (const cat of n.categories) {
                    if (edit.kind === "category" && cat.id === edit.id) {
                      cat.name = edit.title;
                      if (edit.icon !== undefined) cat.icon = edit.icon;
                    }
                    for (const child of cat.children) {
                      if (child.kind === "group" && child.id === edit.id) {
                        child.title = edit.title;
                        if (edit.color) child.backgroundColor = edit.color;
                      }
                      const rows = child.kind === "group" ? child.rows : [child];
                      for (let i = 0; i < rows.length; i++) {
                        const r = rows[i];
                        if (r?.id === edit.id && edit.row) {
                          delete r.type;
                          delete r.options;
                          delete r.dateFormat;
                          Object.assign(r, edit.row, {
                            id: r.id,
                            position: r.position,
                            kind: "row",
                            title: edit.title,
                          });
                        }
                      }
                    }
                  }
                  if (!isConfiguration(n)) {
                    setError("Ces propriétés ne sont pas compatibles.");
                    return;
                  }
                  change(n);
                  setEdit(null);
                }
              }}
            >
              <h2 className="catalog-panel-heading px-3 py-2">
                {remove
                  ? "Supprimer"
                  : create
                    ? "Nouvelle destination"
                    : "Propriétés de présentation"}
              </h2>
              <div className="space-y-3 p-3">
                {remove ? (
                  <p>
                    Supprimer {remove.kind === "category" ? "cette catégorie" : "ce groupe"} et ses{" "}
                    {remove.lines} lignes{remove.groups ? ` (${remove.groups} groupes)` : ""} de la
                    présentation ? Les valeurs Allplan seront conservées.
                  </p>
                ) : (
                  <>
                    <label className="flex flex-col gap-1">
                      Titre
                      <InputField
                        value={edit?.title ?? name}
                        onChange={(v) => (edit ? setEdit({ ...edit, title: v }) : setName(v))}
                      />
                    </label>
                    {edit?.icon !== undefined && (
                      <label className="flex flex-col gap-1">
                        Icône
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/svg+xml"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (!f || busy) return;
                            const id = edit.id;
                            void readCategoryIcon(f).then(icon => {
                              setEdit(current => current?.id === id ? { ...current, icon } : current);
                            }).catch(() => setError("Impossible de lire cette image locale ; icône conservée."));
                          }}
                        />
                      </label>
                    )}
                    {edit?.row && (
                      <>
                        <label className="flex flex-col gap-1">
                          N°
                          <input
                            type="number"
                            min="0"
                            className="field"
                            value={edit.row.num}
                            onChange={(e) =>
                              setEdit({
                                ...edit,
                                row: { ...(edit.row as TreeRow), num: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          Saisie
                          <select
                            className="field"
                            value={edit.row.widget}
                            onChange={(e) => {
                              const w = e.target.value as TreeRow["widget"];
                              const r = { ...(edit.row as TreeRow), widget: w };
                              if (w === "checkbox") {
                                delete r.type;
                                delete r.options;
                              } else {
                                r.type = "STR";
                                if (w === "combo" || w === "list") r.options = [];
                                else delete r.options;
                              }
                              setEdit({ ...edit, row: r });
                            }}
                          >
                            {["entry", "combo", "list", "checkbox"].map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </select>
                        </label>
                        {edit.row.widget !== "checkbox" && (
                          <label className="flex flex-col gap-1">
                            Donnée
                            <select
                              className="field"
                              value={edit.row.type}
                              onChange={(e) =>
                                setEdit({
                                  ...edit,
                                  row: {
                                    ...(edit.row as TreeRow),
                                    type: e.target.value as NonNullable<TreeRow["type"]>,
                                  },
                                })
                              }
                            >
                              {(edit.row.widget === "list"
                                ? ["STR"]
                                : edit.row.widget === "combo"
                                  ? ["STR", "INT", "FLOAT"]
                                  : ["STR", "INT", "FLOAT", "DATE", "TIME", "EMAIL", "PHONE", "URL"]
                              ).map((x) => (
                                <option key={x}>{x}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="flex flex-col gap-1">
                          Valeur de réinitialisation
                          <select
                            className="field"
                            value={edit.row.resetDefault.state}
                            onChange={(e) => {
                              const state = e.target.value;
                              if (state === "absent")
                                setEdit({
                                  ...edit,
                                  row: {
                                    ...(edit.row as TreeRow),
                                    resetDefault: { state: "absent" },
                                  },
                                });
                              else if (state === "defined")
                                setEdit({
                                  ...edit,
                                  row: {
                                    ...(edit.row as TreeRow),
                                    resetDefault: {
                                      state: "defined",
                                      value: edit.row?.widget === "checkbox" ? 0 : "",
                                    },
                                  },
                                });
                            }}
                          >
                            <option value="absent">Absente</option>
                            <option value="defined">Définie</option>
                            {edit.row.resetDefault.state === "unresolved" && (
                              <option value="unresolved">Non résolue</option>
                            )}
                          </select>
                        </label>
                        {edit.row.resetDefault.state === "defined" && (
                          <label className="flex flex-col gap-1">
                            Défaut
                            <input
                              className="field"
                              value={edit.row.resetDefault.value}
                              onChange={(e) =>
                                setEdit({
                                  ...edit,
                                  row: {
                                    ...(edit.row as TreeRow),
                                    resetDefault: {
                                      state: "defined",
                                      value:
                                        edit.row?.widget === "checkbox"
                                          ? e.target.value === "1"
                                            ? 1
                                            : 0
                                          : e.target.value,
                                    },
                                  },
                                })
                              }
                            />
                          </label>
                        )}
                        {edit.row.dateFormat && (
                          <label className="flex flex-col gap-1">
                            Format historique de date
                            <input
                              className="field"
                              value={edit.row.dateFormat.pattern}
                              onChange={(e) =>
                                setEdit({
                                  ...edit,
                                  row: {
                                    ...(edit.row as TreeRow),
                                    dateFormat: {
                                      pattern: e.target.value,
                                      syntax: "legacy_aim",
                                      support: "unsupported",
                                    },
                                  },
                                })
                              }
                            />
                          </label>
                        )}
                        {edit.row.options && (
                          <label className="flex flex-col gap-1">
                            Options
                            <textarea
                              className="field"
                              value={edit.row.options.join("\n")}
                              onChange={(e) =>
                                setEdit({
                                  ...edit,
                                  row: {
                                    ...(edit.row as TreeRow),
                                    options: e.target.value.split("\n"),
                                  },
                                })
                              }
                            />
                          </label>
                        )}
                      </>
                    )}
                    {error && (
                      <p role="alert" className="text-destructive">
                        {error}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div className="secondary-dialog-footer flex justify-end gap-2 p-2">
                <Button
                  type="submit"
                  variant="outline"
                  disabled={busy || !!create && searchActive || (!remove && !(edit?.title ?? name).trim())}
                  title={create ? addDisabled : undefined}
                >
                  {remove ? "Supprimer" : "Appliquer"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEdit(null);
                    setRemove(null);
                    setCreate(null);
                  }}
                >
                  Annuler
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
function InputField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      autoFocus
      required
      className="field"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
