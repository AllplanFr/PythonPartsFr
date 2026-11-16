import { addPresentationBatch } from "./lib/presentation-batch";
import { uniquePresentationName, type InlinePresentationRename } from "./lib/presentation-ui";
import { aimStorage } from "@/modules/information_manager/lib/aim-storage";
import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { CATALOG, setCatalog } from "@/modules/information_manager/lib/attribute-catalog";
import {
  DICTS,
  LANGS,
  LANG_LABELS,
  LangContext,
  detectLang,
  normLang,
  useT,
  type Dict,
  type Lang,
  type TKey,
} from "@/modules/information_manager/lib/i18n";
import {
  StrGlyph,
  IntGlyph,
  FloatGlyph,
  ListBoxGlyph,
} from "@/modules/information_manager/components/type-glyphs";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  CaseSensitive,
  Check,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  GripVertical,
  FolderPlus,
  Trash2,
  Pencil,
  Eye,
  EyeOff,
  FolderInput,
  FolderOutput,
  Hash,
  Layers,
  List as ListIcon,
  Percent,
  Plus,
  Search,
  SquareCheck,
  TextCursorInput,
  X,
  Languages,
  Clock,
  AtSign,
  ChevronsDownUp,
  ChevronsUpDown as ExpandAll,
  Moon,
  Sun,
  Folder,
  ImagePlus,
  Inbox,
  LayoutGrid,
  RotateCcw,
  Shapes,
  Wrench,
  Phone,
  Link2,
  type LucideIcon,
} from "lucide-react";
import { Save, Undo2, Redo2, SlidersHorizontal, FolderOpen, ExternalLink, LibraryBig } from "lucide-react";
import { AppTooltips } from "@/modules/information_manager/components/app-tooltips";
import {
  ColumnsMenu,
  COLUMN_KEYS,
  DEFAULT_COLUMNS,
  insertAttribute,
  type ColumnKey,
} from "@/modules/information_manager/components/aim-columns";
import { toolbarText } from "@/modules/information_manager/lib/aim-toolbar-text";
import { AimActionBar } from "@/modules/information_manager/components/aim-action-bar";
import { AimGroupColorMenu } from "./components/aim-color-menu";
import { ProjectBackupDialog } from "@/modules/information_manager/components/project-backup-dialog";
import {
  DEFAULT_SEARCH,
  interfaceText,
  matchesSearch,
  makeBackup,
  parseBackup,
  recordHistory,
  travelHistory,
  type History,
  type ProjectBackup,
  type SearchOptions,
} from "@/modules/information_manager/lib/aim-interface";
import { AboutDialog } from "@/modules/information_manager/components/about-dialog";
import { ThemeMenu } from "@/modules/information_manager/components/theme-menu";
import { Button } from "@/components/ui/button";
import { SuiteMenu, SuiteLanguageMenu } from "@/modules/information_manager/components/suite-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AimActionGlyph } from "@/modules/information_manager/components/aim-action-glyph";
import { SmartCatalogIcon } from "@/modules/information_manager/components/smartcatalog-icons";
import { aimUiText } from "@/modules/information_manager/lib/aim-ui-text";
import { GroupPicker } from "@/modules/information_manager/components/group-picker";
import {
  hostStateText,
  incomingValue,
  saveStateText,
  snapshotHostState,
  type HostState,
  type HostDiagnostic,
  type HostPhase,
} from "@/modules/information_manager/lib/aim-host-state";
import {
  AIM_INITIAL_DATA_TIMEOUT_MS,
  browserOnlySaveNotice,
  limitedOutcomeText,
  parseAimInitialContainer,
  parseLegacyMessage,
  validateAimContent,
  type AimLimitedOutcome,
} from "@/modules/information_manager/lib/aim-legacy";
import {
  parseRecentResponse,
  isSelectCancelled,
  type AimRecentProject,
} from "@/modules/information_manager/lib/aim-project-contract";
import { getVerifiedAppInfo, isAimLegacyEstablished } from "@/shared/transport/native-binding";
import {
  aimProjectContract,
  definitionsState,
  isAimProjectSnapshot,
  parseAimProjectSnapshot,
  parseSelectResponse,
  snapshotStatus,
  type AimProjectSnapshot,
} from "@/modules/information_manager/lib/aim-project-contract";
import { UPDATE_UNAVAILABLE } from "@/modules/information_manager/components/organized-presentation";
import {
  OrganizedPresentationView,
  PresentationImportDialog,
  PRESENTATION_UNAVAILABLE,
} from "@/modules/information_manager/components/presentation-import";
import { ValueDisplay } from "@/modules/information_manager/components/organized-presentation";
import {
  addOccurrence,
  callPresentation,
  outsideAttributes,
  parseGet,
  parseUpdate,
  presentationAvailable,
  presentationCanUpdate,
  presentationTreeAvailable,
} from "@/modules/information_manager/lib/aim-presentation-contract";
import {
  projectText,
  projectValues,
  selectionReason,
  valueAfterSwitch,
  type AimProjectStatus,
} from "@/modules/information_manager/lib/aim-project";
import { PresentationAttributeForm } from "./components/presentation-attribute-form";
import { ProjectManager } from "./components/project-manager";
import { TreePresentationView } from "./components/tree-presentation";
import { NativeAttributesTable } from "./components/native-attributes-table";
import {
  configurationGroups,
  configurationRows,
  type AnyPresentation as Presentation,
  type TreePresentation,
} from "./lib/presentation-tree";
import { callManager, managerAvailable, managerProjectIsActive, type DefinitionSource } from "./lib/aim-manager-contract";
import { askAimDiscard } from "./lib/aim-choice";
import { EXPORT_UNAVAILABLE, exportNotice, parseExport, presentationExportAvailable, waitForPresentationSync } from "./lib/aim-export";
import { AimMessageDialog, type AimClosePrompt } from "./components/aim-message-dialog";
import { useAppDialog } from "@/lib/app-dialog";
import { setLayoutExpanded } from "@/modules/information_manager/lib/organized-layout";
import { callWorking, workingProfileAvailable, workingEditable, presentationIdentity, parseWorkingPresentation, projectSaveAvailable, isWorkingStateV2, callProjectSave, sameSaveRequest, saveResultNotice, canAdoptSaveWork, canAdoptPresentationSaveWork, presentationSaveAvailable, callPresentationSave, saveCloseAvailable } from "./lib/aim-working-contract";
import type { ConfirmedWorkingState, WorkingRequests, WorkingPresentation, SaveRequest, SaveResult } from "./contracts/AIM_PROJECT_MANAGER_CONTRACT";
import type { DisplayRow } from "./lib/aim-presentation-contract";
import type { OutsideAttribute } from "./components/organized-presentation";
import { absoluteIconPath, iconSelectAvailable, selectNativeIcon } from "./lib/aim-icon-select";

type DataType = "STR" | "FLOAT" | "INT" | "DATE" | "TIME" | "EMAIL" | "PHONE" | "URL";
type Widget = "entry" | "combo" | "list" | "checkbox";
type Attr = {
  num: number;
  name: string;
  title: string;
  widget: Widget;
  type: DataType;
  options?: string[];
  value: string;
  group?: string | undefined;
  /** Category of a row without group. */
  cat?: string | undefined;
};

type Cat = { id: string; name: string; icon?: string | undefined };
const GENERAL = "general";
const DEFAULT_CATS: Cat[] = [{ id: GENERAL, name: "" }];

/** Muted palette for optional group colors. */
const GROUP_COLORS = [
  "#5B7FA6",
  "#4E9A8F",
  "#7FA05A",
  "#C9A14A",
  "#C2714F",
  "#B5627A",
  "#8A6FA8",
  "#6B7785",
];

const WIDGETS: Record<Widget, TKey> = {
  entry: "wEntry",
  combo: "wCombo",
  list: "wList",
  checkbox: "wCheckbox",
};
const TYPES: Record<DataType, TKey> = {
  STR: "tSTR",
  FLOAT: "tFLOAT",
  INT: "tINT",
  DATE: "tDATE",
  TIME: "tTIME",
  EMAIL: "tEMAIL",
  PHONE: "tPHONE",
  URL: "tURL",
};
type GlyphC = ComponentType<{ className?: string }>;
const WIDGET_ICONS: Record<Widget, GlyphC> = {
  entry: TextCursorInput,
  combo: ChevronsUpDown,
  list: ListBoxGlyph,
  checkbox: SquareCheck,
};
const TYPE_ICONS: Record<DataType, GlyphC> = {
  STR: StrGlyph,
  INT: IntGlyph,
  FLOAT: FloatGlyph,
  DATE: CalendarDays,
  TIME: Clock,
  EMAIL: AtSign,
  PHONE: Phone,
  URL: Link2,
};

type SortKey = "manual" | "num" | "name" | "widget" | "type" | "title" | "value";
type Sort = { key: SortKey; dir: 1 | -1 };
function SortTh({
  k,
  sort,
  onSort,
  className = "",
  children,
}: {
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const active = sort.key === k;
  const I = !active ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th
      className={`px-4 py-3 ${className}`}
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <Button
        variant="native"
        size="native"
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-primary ${active ? "text-primary" : ""}`}
      >
        {children}
        <I className={`size-3 ${active ? "" : "opacity-40"}`} />
      </Button>
    </th>
  );
}
/** Data types permitted per input kind (checkbox has none). */
const ALLOWED: Record<Widget, DataType[]> = {
  entry: ["STR", "FLOAT", "INT", "DATE", "TIME", "EMAIL", "PHONE", "URL"],
  combo: ["STR", "FLOAT", "INT"],
  list: ["STR"],
  checkbox: [],
};

const KEY = "project-attrs-v2";

function checkValue(type: DataType, v: string): TKey | null {
  if (v === "") return null;
  if (type === "INT" && !/^-?\d+$/.test(v)) return "errINT";
  if (type === "FLOAT" && !/^-?\d+([.,]\d+)?$/.test(v)) return "errFLOAT";
  if (type === "DATE" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)))) return "errDATE";
  if (type === "TIME" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return "errTIME";
  if (type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "errEMAIL";
  if (type === "PHONE" && !/^\+?[\d\s().-]{6,20}$/.test(v)) return "errPHONE";
  if (type === "URL" && !/^(https?:\/\/|www\.)[^\s]+\.[^\s]+$/i.test(v)) return "errURL";
  return null;
}
function validate(a: Attr): TKey | null {
  return a.widget === "checkbox" ? null : checkValue(a.type, a.value);
}
/** Blocks keystrokes that can never produce a valid value for the type. */
function allowTyping(type: DataType, v: string): boolean {
  if (type === "INT") return /^-?\d*$/.test(v);
  if (type === "FLOAT") return /^-?\d*([.,]\d*)?$/.test(v);
  if (type === "DATE") return /^[\d-]{0,10}$/.test(v);
  if (type === "TIME") return /^[\d:]{0,5}$/.test(v);
  if (type === "PHONE") return /^\+?[\d\s().-]{0,20}$/.test(v);
  if (type === "EMAIL" || type === "URL") return !/\s/.test(v) && v.length <= 500;
  return v.length <= 500;
}

/** Complete Information Manager editor. hostEnabled=false keeps the aim_legacy WebView2 adapter fully inactive (no globals, listener or ready message). */
export function AimEditor({
  hostEnabled = true,
  limitedHost = false,
  onDirtyChange,
  onLeaveRequest,
}: {
  hostEnabled?: boolean;
  limitedHost?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onLeaveRequest?: (request: (() => Promise<boolean>) | null) => void;
}) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [backups, setBackups] = useState<ProjectBackup[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const projectPathRef = useRef("");
  const [hostError, setHostError] = useState("");
  const [hostState, setHostState] = useState<HostState>({
    phase: "not-requested",
    diagnostics: [],
  });
  const [saveNotice, setSaveNoticeState] = useState("");
  const saveNoticeRef = useRef("");
  const setSaveNotice = (message: string) => { saveNoticeRef.current = message; setSaveNoticeState(message); };
  const [limitedNotice, setLimitedNotice] = useState("");
  const [searchOptions, setSearchOptions] = useState<SearchOptions>(DEFAULT_SEARCH);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const pendingHost = useRef(
    new Map<
      string,
      {
        resolve: (data: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const historyReset = useRef(true);
  const historyTravel = useRef(false);
  const [lang, setLangState] = useState<Lang>("fr");
  useEffect(() => {
    setLangState(detectLang());
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    aimStorage.setItem("lang", l);
  };
  const setLangRef = useRef(setLang);
  setLangRef.current = setLang;
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const t = DICTS[lang];
  const ui = interfaceText(lang);
  const labels = aimUiText(lang);
  const [rows, setRows] = useState<Attr[]>([]);
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showName, setShowName] = useState(true);
  useEffect(() => {
    if (aimStorage.getItem("show-name") === "0") setShowName(false);
  }, []);
  const toggleName = (v: boolean) => {
    setShowName(v);
    aimStorage.setItem("show-name", v ? "1" : "0");
  };
  const [editing, setEditing] = useState<number | null>(null);
  const [showColors, setShowColors] = useState(false);
  const [groupColors, setGroupColors] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    if (aimStorage.getItem("show-colors") === "1") setShowColors(true);
    try {
      const gc = JSON.parse(aimStorage.getItem("group-colors") ?? "{}");
      setGroupColors(
        Object.fromEntries<string>(
          Object.entries(gc as Record<string, string>).filter(
            ([, c]) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c),
          ),
        ),
      );
    } catch {
      /* ignore */
    }
    try {
      setCollapsed(JSON.parse(aimStorage.getItem("group-collapsed") ?? "[]"));
    } catch {
      /* ignore */
    }
  }, []);
  const toggleColors = (v: boolean) => {
    setShowColors(v);
    aimStorage.setItem("show-colors", v ? "1" : "0");
  };
  const setColors = (c: Record<string, string>) => {
    setGroupColors(c);
    aimStorage.setItem("group-colors", JSON.stringify(c));
  };
  const setAllCollapsed = (keys: string[]) => {
    setCollapsed(keys);
    aimStorage.setItem("group-collapsed", JSON.stringify(keys));
  };
  const toggleCollapse = (g: string) =>
    setCollapsed((c) => {
      const n = c.includes(g) ? c.filter((x) => x !== g) : [...c, g];
      aimStorage.setItem("group-collapsed", JSON.stringify(n));
      return n;
    });
  const [confirmDel, setConfirmDel] = useState<number | null>(null);

  const [base, setBase] = useState<Attr[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [baseGroups, setBaseGroups] = useState<string[]>([]);
  useEffect(() => {
    const s = aimStorage.getItem(KEY);
    if (s)
      try {
        const p = JSON.parse(s);
        setRows(p);
        setBase(p);
      } catch {
        /* ignore */
      }
    try {
      const g = JSON.parse(aimStorage.getItem("project-groups") ?? "[]");
      if (Array.isArray(g)) {
        setGroups(g.map(String));
        setBaseGroups(g.map(String));
      }
    } catch {
      /* ignore */
    }
  }, []);
  const [cats, setCats] = useState<Cat[]>(DEFAULT_CATS);
  const [baseCats, setBaseCats] = useState<Cat[]>(DEFAULT_CATS);
  const [groupCat, setGroupCat] = useState<Record<string, string>>({});
  const [baseGroupCat, setBaseGroupCat] = useState<Record<string, string>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [baseColors, setBaseColors] = useState<Record<string, string>>({});
  const [view, setView] = useState<string>("all");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [dropCat, setDropCat] = useState<string | null>(null);
  const [iconFor, setIconFor] = useState<string | null>(null);
  useEffect(() => {
    try {
      const c = JSON.parse(aimStorage.getItem("project-cats") ?? "null");
      if (Array.isArray(c) && c.length) {
        setCats(c);
        setBaseCats(c);
      }
    } catch {
      /* ignore */
    }
    try {
      const m = JSON.parse(aimStorage.getItem("project-groupcat") ?? "{}");
      setGroupCat(m);
      setBaseGroupCat(m);
    } catch {
      /* ignore */
    }
    try {
      setIcons(JSON.parse(aimStorage.getItem("cat-icons") ?? "{}"));
    } catch {
      /* ignore */
    }
  }, []);
  const storeIcons = (m: Record<string, string>) => {
    setIcons(m);
    try {
      aimStorage.setItem("cat-icons", JSON.stringify(m));
    } catch {
      /* quota */
    }
  };
  const validCat = (id: string | undefined) => (id && cats.some((c) => c.id === id) ? id : GENERAL);
  const catOf = (r: Attr) => validCat(r.group ? groupCat[r.group] : r.cat);
  const isCatView = view !== "all" && view !== "unlisted";
  const catName = (c: Cat) => (c.id === GENERAL && !c.name ? t.catGeneral : c.name);
  const catOpts = cats.map((c) => ({ id: c.id, name: catName(c) }));
  const tableRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [theadH, setTheadH] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [asideTop, setAsideTop] = useState({ top: 0, h: 0 });
  const formOpenRef = useRef(false);
  useEffect(() => {
    const upd = () => {
      if (tableRef.current && contentRef.current) {
        const tr = tableRef.current.getBoundingClientRect();
        const top = Math.round(tr.top - contentRef.current.getBoundingClientRect().top);
        const h = Math.round(tr.bottom - contentRef.current.getBoundingClientRect().top);
        setAsideTop((o) => (o.top === top && o.h === h ? o : { top, h }));
        const th = tableRef.current.querySelector("thead")?.getBoundingClientRect().height;
        if (th) setTheadH(Math.round(th));
      }
    };
    upd();
  });
  useEffect(() => {
    const upd = () => {
      if (tableRef.current && contentRef.current) {
        const tr = tableRef.current.getBoundingClientRect();
        setAsideTop({
          top: Math.round(tr.top - contentRef.current.getBoundingClientRect().top),
          h: Math.round(tr.bottom - contentRef.current.getBoundingClientRect().top),
        });
      }
    };
    upd();
    const ro = new ResizeObserver(upd);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener("resize", upd);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", upd);
    };
  }, []);
  const [extraVals, setExtraVals] = useState<Record<number, string>>({});
  const [baseExtra, setBaseExtra] = useState<Record<number, string>>({});
  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState<AimProjectStatus>("none");
  const setProjectRef = useRef(setProjectName);
  // AIM project contract 2: identity info captured by the gate; snapshot fully replaced on every switch.
  const [workCap] = useState(() => limitedHost && workingProfileAvailable(getVerifiedAppInfo()));
  const [workEditCap] = useState(() => limitedHost && workingEditable(getVerifiedAppInfo()));
  const [contract] = useState(() => aimProjectContract(presentationIdentity(limitedHost ? getVerifiedAppInfo() : null)));
  const [work, setWork] = useState<ConfirmedWorkingState | null>(null);
  const workRef = useRef<ConfirmedWorkingState | null>(null);
  const workRunning = useRef(false);
  const [workBusy, setWorkBusy] = useState(false);
  const workTask = useRef<Promise<unknown> | null>(null);
  const valueFlushers = useRef(new Map<symbol, () => Promise<boolean>>());
  const localDrafts = useRef(new Set<symbol>());
  const [localDraftCount, setLocalDraftCount] = useState(0);
  const [followTick, setFollowTick] = useState(0);
  const markLocalDraft = (key: symbol, pending: boolean) => {
    if (pending) localDrafts.current.add(key); else localDrafts.current.delete(key);
    setLocalDraftCount(localDrafts.current.size);
  };
  const [saveCap] = useState(() => limitedHost && projectSaveAvailable(getVerifiedAppInfo()));
  const [presentationSaveCap] = useState(() => limitedHost && presentationSaveAvailable(getVerifiedAppInfo()));
  const [saveCloseCap] = useState(() => limitedHost && saveCloseAvailable(getVerifiedAppInfo()));
  const [closePrompt, setClosePrompt] = useState<AimClosePrompt | null>(null);
  const closingRequest = useRef(false);
  const closeAnswer = useRef<((choice: "save" | "discard" | null) => void) | null>(null);
  const closeHandler = useRef<() => Promise<void>>(async () => {});
  const saveLocked = useRef(false);
  const savePreparing = useRef(false);
  const flushingEdits = useRef(false);
  const presentationFlushBlocked = useRef(false);
  const [saveFrozen, setSaveFrozen] = useState(false);
  const saveFollowing = useRef(false);
  const saveReference = useRef<SaveRequest | null>(null);
  const saveSeen = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveWake = useRef<(() => void) | null>(null);
  const lockSave = (locked: boolean) => { saveLocked.current = locked; setSaveFrozen(locked || savePreparing.current || closingRequest.current); };
  const [aimSnapshot, setAimSnapshot] = useState<AimProjectSnapshot | null>(null);
  // Presentation contract 1: Python-prepared organized presentation, held in memory only (never browser storage).
  const [presentationCap] = useState(
    () => limitedHost && presentationAvailable(presentationIdentity(getVerifiedAppInfo())),
  );
  const [organized, setOrganized] = useState<Presentation | null>(null);
  const [layoutView, setLayoutView] = useState("all");
  const [layoutRename, setLayoutRename] = useState<InlinePresentationRename | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<Presentation["configuration"] | null>(null);
  const [organizedAdd, setOrganizedAdd] = useState<"category" | "group" | "attribute" | null>(null);
  const [layoutName, setLayoutName] = useState("");
  const [layoutCategory, setLayoutCategory] = useState("");
  const [layoutAttribute, setLayoutAttribute] = useState("");
  // Sixth documented capability: configuration edits are submitted to Python, which returns the recomputed model.
  const [managerCap] = useState(() => limitedHost && managerAvailable(getVerifiedAppInfo()));
  const [treeCap] = useState(() => limitedHost && presentationTreeAvailable(presentationIdentity(getVerifiedAppInfo())));
  const [iconSelectCap] = useState(() => limitedHost && iconSelectAvailable(getVerifiedAppInfo()));
  const iconSelecting = useRef(false);
  const [iconSelectBusy, setIconSelectBusy] = useState(false);
  const selectedIconPaths = useRef(new Map<string, { icon: string; path: string }>());
  const [managerOpen, setManagerOpen] = useState(false);
  const [definitionSource, setDefinitionSource] = useState<DefinitionSource | null>(null);
  const sourceSeq = useRef(0);
  const [canUpdate] = useState(() => limitedHost && presentationCanUpdate(presentationIdentity(getVerifiedAppInfo())));
  const [exportCap] = useState(() => limitedHost && presentationExportAvailable(getVerifiedAppInfo()));
  const [exporting, setExporting] = useState(false);
  /** Unconfirmed configuration sent (or to resend) through presentation.update; never displayed as confirmed. */
  type PendingUpdate = {
    configuration: Presentation["configuration"];
    status: "sending" | "failed" | "uncertain";
    message: string;
  };
  const [pendingUpdate, storePendingUpdate] = useState<PendingUpdate | null>(null);
  const pendingUpdateRef = useRef<PendingUpdate | null>(null);
  const setPendingUpdate = (next: PendingUpdate | null) => {
    pendingUpdateRef.current = next;
    storePendingUpdate(next);
  };
  const updateTask = useRef<Promise<void> | null>(null);
  const updating = pendingUpdate?.status === "sending";
  const updateSeq = useRef(0);
  const updateRunning = useRef(false);
  const activeConfiguration = canUpdate
    ? (organized?.configuration ?? null)
    : (layoutDraft ?? organized?.configuration ?? null);
  const searchActive = q.length > 0;
  const searchAddReason = searchActive ? "Effacez la recherche pour ajouter un élément." : "";
  const presentationHistory = useRef<History<Presentation["configuration"]> | null>(null);
  const presentationHistoryKey = useRef("");
  const historyDestination = useRef<History<Presentation["configuration"]> | null>(null);
  const [presentationHistoryCounts, setPresentationHistoryCounts] = useState({ undo: 0, redo: 0 });
  const rememberConfiguration = (configuration: Presentation["configuration"] | null, key: string) => {
    if (!configuration) { presentationHistory.current = null; presentationHistoryKey.current = ""; }
    else if (!presentationHistory.current || presentationHistoryKey.current !== key) {
      presentationHistory.current = { past: [], present: structuredClone(configuration), future: [] };
      presentationHistoryKey.current = key;
      historyDestination.current = null;
    } else if (historyDestination.current && JSON.stringify(historyDestination.current.present) === JSON.stringify(configuration)) {
      presentationHistory.current = historyDestination.current;
      historyDestination.current = null;
    } else presentationHistory.current = recordHistory(presentationHistory.current, structuredClone(configuration));
    setPresentationHistoryCounts({ undo: presentationHistory.current?.past.length ?? 0, redo: presentationHistory.current?.future.length ?? 0 });
  };
  useEffect(() => {
    if (!workCap) rememberConfiguration(activeConfiguration, `${projectPath}:${activeConfiguration?.configurationId ?? ""}`);
  }, [workCap, activeConfiguration, projectPath]);
  const organizedRef = useRef<Presentation | null>(null);
  organizedRef.current = organized;
  /** After a project switch: "ready" shows the model, "loading"/"error" hide every value of the previous project. */
  const [organizedStatus, setOrganizedStatus] = useState<"ready" | "loading" | "error">("ready");
  const organizedSeq = useRef(0);
  const [importOpen, setImportOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectNotice, setSelectNotice] = useState("");
  const [selectDetails, setSelectDetails] = useState("");
  const selectionBusy = useRef(false);
  const mountedRef = useRef(true);
  const initializationGeneration = useRef(0);
  const isActiveGeneration = (generation: number) => mountedRef.current && generation === initializationGeneration.current;
  // Four configurable columns; Value is always present in every table mode.
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  useEffect(() => {
    try {
      const c = JSON.parse(aimStorage.getItem("aim-columns") ?? "null");
      if (Array.isArray(c) && c.length && c.every((k) => COLUMN_KEYS.includes(k))) setColumns(c);
    } catch {
      /* ignore */
    }
  }, []);
  const changeColumns = (c: ColumnKey[]) => {
    setColumns(c);
    aimStorage.setItem("aim-columns", JSON.stringify(c));
  };
  const showNum = columns.includes("num"),
    showTitle = columns.includes("title"),
    showInput = columns.includes("input"),
    showData = columns.includes("data");
  const showTypes = showInput || showData;
  const showTools = true;
  const setShowTools = (_: boolean) => {};
  const extraDirty = useMemo(() => {
    const used = new Set(rows.map((r) => r.num));
    return CATALOG.some(
      (c) => !used.has(c.num) && (extraVals[c.num] ?? "") !== (baseExtra[c.num] ?? ""),
    );
  }, [rows, extraVals, baseExtra]);
  const legacyDirty = useMemo(
    () =>
      JSON.stringify(groupColors) !== JSON.stringify(baseColors) ||
      extraDirty ||
      JSON.stringify(rows) !== JSON.stringify(base) ||
      JSON.stringify(groups) !== JSON.stringify(baseGroups) ||
      JSON.stringify(cats) !== JSON.stringify(baseCats) ||
      JSON.stringify(groupCat) !== JSON.stringify(baseGroupCat),
    [
      extraDirty,
      rows,
      base,
      groups,
      baseGroups,
      cats,
      baseCats,
      groupCat,
      baseGroupCat,
      groupColors,
      baseColors,
    ],
  );
  const organizedDirty =
    !!organized &&
    !!layoutDraft &&
    JSON.stringify(layoutDraft) !== JSON.stringify(organized.configuration);
  const dirty = workCap ? (work?.dirty.any ?? false) || !!pendingUpdate || localDraftCount > 0 : organized ? organizedDirty : legacyDirty;
  const legacyValuesDirty = useMemo(
    () =>
      extraDirty ||
      rows.some((r) => (r.value ?? "") !== (base.find((b) => b.num === r.num)?.value ?? "")),
    [extraDirty, rows, base],
  );
  const legacyPresentationDirty = useMemo(() => {
    const strip = (l: Attr[]) => JSON.stringify(l.map(({ value: _v, ...x }) => x));
    return (
      strip(rows) !== strip(base) ||
      JSON.stringify(groups) !== JSON.stringify(baseGroups) ||
      JSON.stringify(cats) !== JSON.stringify(baseCats) ||
      JSON.stringify(groupCat) !== JSON.stringify(baseGroupCat) ||
      JSON.stringify(groupColors) !== JSON.stringify(baseColors)
    );
  }, [
    rows,
    base,
    groups,
    baseGroups,
    cats,
    baseCats,
    groupCat,
    baseGroupCat,
    groupColors,
    baseColors,
  ]);
  const snapshot = { rows, groups, cats, groupCat, groupColors, extraVals, icons };
  type Snapshot = typeof snapshot;
  const historyRef = useRef<History<Snapshot>>({ past: [], present: snapshot, future: [] });
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  useEffect(() => {
    const next = structuredClone({ rows, groups, cats, groupCat, groupColors, extraVals, icons });
    if (historyReset.current) {
      historyRef.current = { past: [], present: next, future: [] };
      historyReset.current = false;
    } else if (historyTravel.current) historyTravel.current = false;
    else historyRef.current = recordHistory(historyRef.current, next);
    setHistoryCounts({
      undo: historyRef.current.past.length,
      redo: historyRef.current.future.length,
    });
  }, [rows, groups, cats, groupCat, groupColors, extraVals, icons]);
  const travel = (direction: "undo" | "redo") => {
    if (managerOpen || importOpen || closePrompt || saveLocked.current || savePreparing.current || closingRequest.current) return;
    if (organized) { void travelConfiguration(direction); return; }
    const current = historyRef.current;
    const next = travelHistory(current, direction);
    if (current === next) return;
    historyRef.current = next;
    historyTravel.current = true;
    const state = next.present;
    setRows(state.rows);
    setGroups(state.groups);
    setCats(state.cats);
    setGroupCat(state.groupCat);
    setColors(state.groupColors);
    setExtraVals(state.extraVals);
    storeIcons(state.icons);
    setAdding(false);
    setEditing(null);
    setNewGroup(null);
    setConfirmDel(null);
    setSelectedRow(null);
    setSelectedGroup(null);
    setHistoryCounts({ undo: next.past.length, redo: next.future.length });
  };
  const allGroups = (list: Attr[], extra: string[]) => [
    ...new Set([...extra, ...list.map((r) => r.group ?? "")].filter(Boolean)),
  ];
  const sendToHost = async (msg: unknown) => {
    const hostObjects =
      !hostEnabled || !isAimLegacyEstablished()
        ? undefined
        : (
            window as unknown as {
              chrome?: {
                webview?: {
                  postMessage?: (s: string) => void;
                  hostObjects?: {
                    bridge?: Promise<{ SendToHost: (s: string) => Promise<unknown> }>;
                  };
                };
              };
            }
          ).chrome?.webview;
    if (!hostObjects) return false;
    const json = JSON.stringify(msg);
    try {
      // Host object "bridge" if registered, otherwise standard WebMessageReceived
      const bridge = await hostObjects.hostObjects?.bridge;
      if (bridge) await bridge.SendToHost(json);
      else if (hostObjects.postMessage) hostObjects.postMessage(json);
      else throw new Error(ui.hostError);
      return true;
    } catch (err) {
      console.error("Échec de l'envoi vers Allplan :", err);
      throw err;
    }
  };
  const requestHost = (type: string, payload: Record<string, unknown> = {}): Promise<unknown> => {
    if (!hostEnabled || !isAimLegacyEstablished()) return Promise.reject(new Error(ui.hostError));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingHost.current.delete(requestId);
        reject(new Error(ui.hostError));
      }, 8000);
      pendingHost.current.set(requestId, { resolve, reject, timer });
      void sendToHost({ type, requestId, ...payload }).catch((error) => {
        clearTimeout(timer);
        pendingHost.current.delete(requestId);
        reject(error instanceof Error ? error : new Error(ui.hostError));
      });
    });
  };
  const openProject = async (target: "folder" | "attributes") => {
    setHostError("");
    try {
      await requestHost("project.open", { target });
    } catch (error) {
      setHostError(error instanceof Error ? error.message : ui.hostError);
    }
  };
  /** Presentation file format: only num, title, widget, type (not for checkbox), options (combo/list). */
  const toPresentation = (list: Attr[]) => ({
    version: 1,
    lang,
    showName,
    showColors,
    groups: allGroups(list, list === base ? baseGroups : groups),
    groupColors: (() => {
      const gs = allGroups(list, list === base ? baseGroups : groups);
      return Object.fromEntries(Object.entries(groupColors).filter(([g]) => gs.includes(g)));
    })(),
    sort: { column: sort.key, dir: sort.dir === 1 ? "asc" : "desc" },
    categories: (list === base ? baseCats : cats).map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.icon ? { icon: c.icon } : {}),
    })),
    view,
    collapsed,
    window: {
      width: Math.round(window.outerWidth || window.innerWidth),
      height: Math.round(window.outerHeight || window.innerHeight),
    },
    groupCategories: (() => {
      const gs = allGroups(list, list === base ? baseGroups : groups);
      const m = list === base ? baseGroupCat : groupCat;
      return Object.fromEntries(
        Object.entries(m).filter(([g, c]) => gs.includes(g) && c !== GENERAL),
      );
    })(),
    attributes: list.map((a) => ({
      num: a.num,
      title: a.title,
      widget: a.widget,
      ...(a.group ? { group: a.group } : a.cat && a.cat !== GENERAL ? { category: a.cat } : {}),
      ...(a.widget !== "checkbox" ? { type: a.type } : {}),
      ...(a.widget === "combo" || a.widget === "list" ? { options: a.options ?? [] } : {}),
    })),
  });
  // Toujours lire l'état le plus récent (évite une fermeture périmée au clic Enregistrer)
  const latestRef = useRef<{
    rows: Attr[];
    unlisted: Attr[];
    toPresentation: typeof toPresentation;
    extraVals: typeof extraVals;
    groups: typeof groups;
    cats: typeof cats;
    groupCat: typeof groupCat;
    groupColors: typeof groupColors;
  }>({ rows, unlisted: [], toPresentation, extraVals, groups, cats, groupCat, groupColors });
  const followSave = async (request: SaveRequest, operationId: string | null = null): Promise<SaveResult | null> => {
    if (saveFollowing.current) return null;
    const generation = initializationGeneration.current;
    saveFollowing.current = true;
    saveReference.current = request;
    saveSeen.current.add(JSON.stringify(request));
    lockSave(true);
    try {
      while (isActiveGeneration(generation)) {
        const status = await callProjectSave("project.values.save.status", request);
        if (!isActiveGeneration(generation)) return null;
        if (!status.ok || status.status === "not_found") {
          setSaveNotice(status.ok ? "Résultat inconnu ; absence d’écriture non prouvée. Enregistrement bloqué ; suivi seulement." : `Suivi indisponible : ${status.error.message}. Effets inconnus ; enregistrement bloqué.`);
          return null;
        }
        if (operationId !== null && status.operationId !== operationId) throw new Error("Identité d’opération incompatible");
        operationId = status.operationId;
        if (status.status === "completed") {
          const current = workRef.current;
          // Historical results may be consulted, never adopted by another session.
          if (!current || !isWorkingStateV2(current) || current.sessionId !== request.sessionId) {
            setSaveNotice("Résultat d’une ancienne session ; aucun état appliqué au projet courant.");
            saveReference.current = null;
            lockSave(!!current && isWorkingStateV2(current) && current.save.state !== "idle");
            return null;
          }
          const next = status.work;
          if (next && canAdoptSaveWork(current, next, request)) adoptWork(next);
          // Read the current atomic state as well: terminal evidence may already be historical.
          await refreshWork(generation);
          if (!isActiveGeneration(generation)) return null;
          const confirmed = workRef.current;
          if (confirmed && isWorkingStateV2(confirmed) && confirmed.sessionId === request.sessionId && confirmed.source.project?.path === current.source.project?.path) {
            setSaveNotice(saveResultNotice(status.result));
            lockSave(status.result.recoveryRequired || confirmed.save.state !== "idle");
            if (!saveLocked.current) saveReference.current = null;
            return status.result;
          } else {
            setSaveNotice("Résultat d’une ancienne session ; aucun acquittement appliqué au projet courant.");
            saveReference.current = null;
            lockSave(!!confirmed && isWorkingStateV2(confirmed) && confirmed.save.state !== "idle");
          }
          return null;
        }
        setSaveNotice("Enregistrement en cours ; aucune confirmation de réussite pour le moment.");
        await new Promise<void>(resolve => {
          saveWake.current = resolve;
          saveTimer.current = setTimeout(() => { saveTimer.current = null; saveWake.current = null; resolve(); }, 1000);
        });
      }
    } catch {
      if (isActiveGeneration(generation)) setSaveNotice("Communication interrompue ; résultat inconnu, écriture possible. Enregistrement bloqué ; suivi seulement.");
    } finally {
      if (isActiveGeneration(generation)) { saveFollowing.current = false; setFollowTick(n => n + 1); }
    }
    return null;
  };
  const flushActiveEdits = async () => {
    flushingEdits.current = true;
    presentationFlushBlocked.current = false;
    try {
      if (organizedAdd) {
        presentationFlushBlocked.current = true;
        setSaveNotice("Validez ou annulez le formulaire de présentation ouvert avant de poursuivre.");
        return false;
      }
      if (!window.dispatchEvent(new Event("aim-flush-presentation", { cancelable: true }))) {
        presentationFlushBlocked.current = true;
        setSaveNotice("Saisie de présentation invalide ou formulaire non validé ; terminez-la avant de poursuivre.");
        return false;
      }
      if (workTask.current) await workTask.current;
      if (updateTask.current) await updateTask.current;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (workTask.current) await workTask.current;
      if (updateTask.current) await updateTask.current;
      for (const flush of [...valueFlushers.current.values()]) if (!await flush()) {
        setSaveNotice("Saisie invalide ou non acceptée ; aucune fermeture ni nouvel enregistrement.");
        return false;
      }
      if (workTask.current) await workTask.current;
      if (updateTask.current) await updateTask.current;
      if (pendingUpdateRef.current || localDrafts.current.size > 0) {
        setSaveNotice("Saisie ou présentation non synchronisée ; corrigez-la avant de poursuivre.");
        return false;
      }
      return true;
    } finally {
      flushingEdits.current = false;
    }
  };
  const saveValues = async (): Promise<SaveResult | null> => {
    const generation = initializationGeneration.current;
    const current = workRef.current;
    if (!current || !isWorkingStateV2(current) || !workEditCap || current.source.read_only !== true || current.source.selection !== "accepted" || !current.fileSaveAvailable || current.pendingImport || current.save.state !== "idle" || current.save.blockedReasons.length) {
      setSaveNotice("Valeurs non enregistrées : état Python non enregistrable.");
      return null;
    }
    const request: SaveRequest = { sessionId: current.sessionId, revision: current.revision, projectRevision: current.projectRevision };
    saveReference.current = request;
    lockSave(true);
    try {
      const accepted = await callProjectSave("project.values.save", request);
      if (!isActiveGeneration(generation)) return null;
      if (!accepted.ok) {
        lockSave(false); saveReference.current = null;
        await refreshWork(generation);
        setSaveNotice(accepted.error.message);
        return null;
      }
      setSaveNotice("Demande acceptée ; enregistrement non encore confirmé.");
      return await followSave(request, accepted.operationId);
    } catch {
      if (!isActiveGeneration(generation)) return null;
      setSaveNotice("Acceptation non reçue ; recherche du suivi, sans renvoyer l’enregistrement.");
      try {
        const recovered = await refreshWork(generation);
        if (!isActiveGeneration(generation)) return null;
        if (recovered && isWorkingStateV2(recovered) && recovered.save.request && sameSaveRequest(recovered.save.request, request)) return await followSave(recovered.save.request, recovered.save.operationId);
        return await followSave(request);
      } catch {
        setSaveNotice("Résultat inconnu ; écriture possible. Enregistrement bloqué ; suivi seulement.");
        return null;
      }
    }
  };
  const save = async (): Promise<boolean> => {
    if (!saveCap || !projectSaveAvailable(getVerifiedAppInfo()) || !workEditCap || saveLocked.current || savePreparing.current) return false;
    const generation = initializationGeneration.current;
    savePreparing.current = true;
    let presentationNotice = "";
    try {
      if (selectionBusy.current || importOpen || exportBusy.current || !await flushActiveEdits()) return false;
      if (!isActiveGeneration(generation)) return false;
      setSaveFrozen(true);
      let current = workRef.current;
      if (!current || !isWorkingStateV2(current)) return false;
      if (current.dirty.presentation && (!presentationSaveCap || !presentationSaveAvailable(getVerifiedAppInfo()))) {
        setSaveNotice("Présentation non enregistrée : la commande d’enregistrement est indisponible dans ce profil. Modifications conservées ; aucune fermeture.");
        return false;
      }
      if (presentationSaveCap && (current.dirty.presentation || current.presentation && !current.dirty.values)) {
        const request: SaveRequest = { sessionId: current.sessionId, revision: current.revision, projectRevision: current.projectRevision };
        const result = await callPresentationSave(request);
        if (!isActiveGeneration(generation)) return false;
        if (!result.ok) {
          setSaveNotice(`${result.written === true ? "Présentation écrite mais non confirmée." : result.written === null ? "Écriture de présentation incertaine." : "Présentation non enregistrée."} ${result.error.message} Valeurs non envoyées ; aucune relance automatique.`);
          return false;
        }
        if (result.status === "cancelled") {
          setSaveNotice("Choix du fichier annulé ; présentation et valeurs non enregistrées, modifications conservées.");
          return false;
        }
        if (!canAdoptPresentationSaveWork(current, result.work, request)) throw new Error("Acquittement de présentation incompatible ; modifications conservées");
        adoptWork(result.work);
        presentationNotice = `Présentation enregistrée dans ${result.fileName}.`;
      }
      current = workRef.current;
      if (current?.dirty.values) {
        const result = await saveValues();
        if (!isActiveGeneration(generation)) return false;
        const valuesNotice = result ? saveResultNotice(result) : saveNoticeRef.current || "Valeurs non confirmées ; consultez le suivi. Aucune relance automatique.";
        setSaveNotice([presentationNotice, valuesNotice].filter(Boolean).join(" "));
        if (!result || result.status !== "saved" || !result.acknowledged) return false;
      }
      const confirmed = workRef.current;
      const success = !!confirmed && !confirmed.dirty.any && !confirmed.pendingImport && !pendingUpdateRef.current && localDrafts.current.size === 0;
      if (success && presentationNotice && !current?.dirty.values) setSaveNotice(presentationNotice);
      return success;
    } catch (error) {
      if (isActiveGeneration(generation)) setSaveNotice([presentationNotice, "Enregistrement non confirmé ; aucune fermeture ni relance automatique.", error instanceof Error ? error.message : "Communication interrompue."].filter(Boolean).join(" "));
      return false;
    } finally {
      if (isActiveGeneration(generation)) { savePreparing.current = false; setSaveFrozen(saveLocked.current || closingRequest.current); }
    }
  };
  const requestClose = async () => {
    if (!saveCloseCap || closingRequest.current || savePreparing.current || saveFollowing.current || workRunning.current || selectionBusy.current || exportBusy.current || importOpen || useAppDialog.getState().queue.length) return;
    const generation = initializationGeneration.current;
    closingRequest.current = true;
    try {
      savePreparing.current = true;
      const editsReady = await flushActiveEdits();
      if (!isActiveGeneration(generation)) return;
      savePreparing.current = false;
      setSaveFrozen(true);
      const current = workRef.current;
      if (!current || !isWorkingStateV2(current) || current.save.state === "running") return;
      const values = current.dirty.values || localDrafts.current.size > 0;
      const presentation = current.dirty.presentation || !!pendingUpdateRef.current || presentationFlushBlocked.current || !editsReady && !values;
      let choice: "save" | "discard" | null = "save";
      if (values || presentation || current.pendingImport) {
        const both = values && presentation;
        const title = both ? "Enregistrer les modifications avant de quitter ?" : values ? "Enregistrer les valeurs avant de quitter ?" : "Enregistrer la présentation avant de quitter ?";
        const message = both ? "La présentation et les valeurs du projet ont été modifiées." : values ? "Des valeurs du projet ont été modifiées." : "La présentation a été modifiée.";
        choice = await new Promise<"save" | "discard" | null>(resolve => {
          closeAnswer.current = resolve;
          setClosePrompt({ title, message, answer: answer => {
            if (closeAnswer.current !== resolve) return;
            closeAnswer.current = null; setClosePrompt(null); resolve(answer);
          } });
        });
        if (!isActiveGeneration(generation) || choice === null) return;
        if (choice === "save" && !await save()) return;
      }
      const latest = workRef.current;
      if (!latest || !isActiveGeneration(generation)) return;
      if (choice !== "discard" && (latest.dirty.any || latest.pendingImport || pendingUpdateRef.current || localDrafts.current.size > 0)) {
        setSaveNotice("Modifications non confirmées ; fermeture annulée.");
        return;
      }
      const result = await callWorking("work.close", { revision: latest.revision, discard: choice === "discard" });
      if (!result.ok) {
        if (result.error.code === "stale_work") await refreshWork(generation);
        setSaveNotice(result.error.message);
      }
    } catch (error) {
      if (isActiveGeneration(generation)) setSaveNotice(`Fermeture annulée : ${error instanceof Error ? error.message : "communication interrompue"}`);
    } finally {
      closingRequest.current = false;
      savePreparing.current = false;
      if (isActiveGeneration(generation)) setSaveFrozen(saveLocked.current);
    }
  };
  closeHandler.current = requestClose;
  useEffect(() => {
    if (!saveCloseCap) return;
    const listener = () => { void closeHandler.current(); };
    window.addEventListener("aim-close-requested", listener);
    return () => {
      window.removeEventListener("aim-close-requested", listener);
      closeAnswer.current?.(null); closeAnswer.current = null;
    };
  }, [saveCloseCap]);
  const cancel = async () => {
    if (saveCloseCap) { await requestClose(); return; }
    if (workCap) {
      if (saveLocked.current || savePreparing.current || workRunning.current || selectionBusy.current || updateRunning.current || importOpen || !workRef.current) return;
      const discard = workRef.current.dirty.any ? await confirmWorkLoss() : false;
      if (workRef.current.dirty.any && !discard) return;
      const result = await runWorking("work.close", { revision: workRef.current.revision, discard });
      if (result?.ok) setSaveNotice("Fermeture demandée à l’hôte Python.");
      return;
    }
    if (organizedRef.current || contract.recognized) {
      setSaveNotice(
        "Fermez la fenêtre avec sa croix. Les valeurs Allplan restent inchangées.",
      );
      return;
    }
    setRows(base);
    setGroups(baseGroups);
    setCats(baseCats);
    setGroupCat(baseGroupCat);
    setExtraVals(baseExtra);
    setAdding(false);
    setEditing(null);
    setConfirmDel(null);
    // Quitter = lignes du dernier enregistrement + réglages actuels (langue, tri, nom)
    try {
      await sendToHost({ type: "quit", data: toPresentation(base) });
    } catch (error) {
      setHostError(error instanceof Error ? error.message : ui.hostError);
    }
  };
  const exportJson = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(toPresentation(rows), null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "presentation-attributs.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  /** Native export uses only the last Python-confirmed configuration and never adopts or clears work state. */
  const exportBusy = useRef(false);
  const exportDispatched = useRef(false);
  const exportPresentation = async () => {
    if (saveLocked.current || savePreparing.current || !exportCap || !presentationExportAvailable(getVerifiedAppInfo()) || exportBusy.current || selectionBusy.current || workRunning.current || importOpen) return;
    exportBusy.current = true;
    setExporting(true);
    try {
      // Let an update scheduled by the same interaction register before choosing the export snapshot.
      await Promise.resolve();
      await waitForPresentationSync((async () => {
        while (updateTask.current) await updateTask.current;
      })());
      if (!mountedRef.current) return;
      if (pendingUpdateRef.current) {
        setSaveNotice(pendingUpdateRef.current.message || "La présentation affichée n'est pas synchronisée. Aucun export envoyé.");
        return;
      }
      const configuration = workCap ? workRef.current?.presentation?.configuration : organizedRef.current?.configuration;
      if (!configuration) { setSaveNotice("Aucune présentation active."); return; }
      if (saveLocked.current || savePreparing.current || selectionBusy.current || workRunning.current || importOpen) return;
      exportDispatched.current = true;
      setSaveNotice("Export de la présentation en cours dans l'application Python…");
      const outcome = parseExport(await callPresentation("presentation.export", { configuration }), configuration.configurationId);
      if (mountedRef.current) setSaveNotice(exportNotice(outcome));
    } catch (error) {
      if (mountedRef.current)
        setSaveNotice(error instanceof Error ? error.message : "Export non confirmé : échec de la communication avec l'application Python.");
    } finally {
      exportBusy.current = false;
      exportDispatched.current = false;
      if (mountedRef.current) setExporting(false);
    }
  };
  /** Applies a presentation (object, array or JSON string). Name comes from the catalog; current values are kept by num. */
  const [catCount, setCatCount] = useState(0);
  const applyData = (input: unknown, asSaved: boolean) => {
    const d = (typeof input === "string" ? JSON.parse(input) : input) as
      | {
          attributes?: unknown;
          showName?: unknown;
          lang?: unknown;
          sort?: { column?: unknown; dir?: unknown };
        }
      | unknown[];
    if (!d || typeof d !== "object") throw new Error("format");
    const list = Array.isArray(d) ? d : (d?.attributes ?? []);
    if (!Array.isArray(list)) throw new Error("format");
    if (!Array.isArray(d)) setCatalog((d as { catalog?: unknown })?.catalog);
    setCatCount(CATALOG.length);
    if (asSaved) historyReset.current = true;
    const diagnostics: HostDiagnostic[] = [];
    const vals =
      !Array.isArray(d) && d && typeof (d as { values?: unknown }).values === "object"
        ? ((d as { values?: Record<string, unknown> }).values ?? {})
        : {};
    // Project load: values come only from the new project, matched by number against the catalog.
    const pv = asSaved
      ? projectValues(
          !Array.isArray(d) ? (d as { values?: unknown }).values : undefined,
          CATALOG.map((c) => c.num),
        )
      : null;
    const seen = new Set<number>();
    const clean: Attr[] = [];
    for (const raw of list as Partial<Attr>[]) {
      const num = Number(raw?.num);
      const cat = CATALOG.find((c) => c.num === num);
      if (!Number.isInteger(num) || seen.has(num)) continue;
      if (!cat) diagnostics.push({ code: "unknown-attribute", num, severity: "warning" });
      seen.add(num);
      const widget = (raw.widget && raw.widget in WIDGETS ? raw.widget : "entry") as Widget;
      const type = (
        raw.type && ALLOWED[widget].includes(raw.type) ? raw.type : (ALLOWED[widget][0] ?? "STR")
      ) as DataType;
      const options = Array.isArray(raw.options) ? raw.options.map(String) : [];
      const prevRow = rows.find((r) => r.num === num);
      const prev = pv
        ? valueAfterSwitch(pv.values, num)
        : incomingValue(vals, num, prevRow?.value ?? extraVals[num] ?? "");
      const value =
        widget === "checkbox" && ["true", "1", "false", "0"].includes(prev.toLowerCase())
          ? ["true", "1"].includes(prev.toLowerCase())
            ? "true"
            : "false"
          : prev;
      if (
        widget !== "checkbox" &&
        (checkValue(type, value) || (widget === "list" && value && !options.includes(value)))
      )
        diagnostics.push({ code: "invalid-value", num, severity: "warning" });
      const group = String(raw.group ?? "")
        .trim()
        .slice(0, 60);
      const rc = String((raw as { category?: unknown }).category ?? "").trim();
      clean.push({
        num,
        name: cat?.name ?? prevRow?.name ?? "",
        title: String(raw.title ?? cat?.name ?? prevRow?.title ?? "").slice(0, 120),
        widget,
        type,
        value,
        ...(group ? { group } : rc ? { cat: rc } : {}),
        ...(widget === "combo" || widget === "list" ? { options } : {}),
      });
    }
    setRows(clean);
    setAdding(false);
    setEditing(null);
    // Values of catalog attributes outside the presentation
    const ex: Record<number, string> = pv ? {} : { ...extraVals };
    for (const c of CATALOG) {
      if (seen.has(c.num)) continue;
      const v = pv
        ? valueAfterSwitch(pv.values, c.num)
        : incomingValue(
            vals,
            c.num,
            extraVals[c.num] ?? rows.find((r) => r.num === c.num)?.value ?? "",
          );
      if (pv && !Object.hasOwn(pv.values, c.num)) continue;
      ex[c.num] = v;
      if (checkValue(c.type, v) || (c.widget === "list" && v && !(c.options ?? []).includes(v)))
        diagnostics.push({ code: "invalid-value", num: c.num, severity: "warning" });
    }
    setExtraVals(ex);
    if (asSaved) setBaseExtra(ex);
    const dg =
      !Array.isArray(d) && Array.isArray((d as { groups?: unknown }).groups)
        ? (d as { groups: unknown[] }).groups
            .map((x) => String(x).trim().slice(0, 60))
            .filter(Boolean)
        : [];
    const ng = allGroups(clean, dg);
    setGroups(ng);
    if (asSaved) {
      setBase(clean);
      setBaseGroups(ng);
    }
    if (!Array.isArray(d)) {
      const dd = d as { categories?: unknown; groupCategories?: unknown; categoryIcons?: unknown };
      const ic: Record<string, string> = asSaved ? {} : { ...icons };
      if (dd.categoryIcons && typeof dd.categoryIcons === "object")
        for (const [k, v] of Object.entries(dd.categoryIcons as Record<string, unknown>))
          if (typeof v === "string" && v.startsWith("data:image/")) ic[k] = v;
      let nc: Cat[] = DEFAULT_CATS;
      if (Array.isArray(dd.categories)) {
        const seenC = new Set<string>();
        nc = [];
        for (const c of dd.categories as {
          id?: unknown;
          name?: unknown;
          icon?: unknown;
          iconData?: unknown;
        }[]) {
          const id = String(c?.id ?? "")
            .trim()
            .slice(0, 40);
          if (!id || seenC.has(id)) continue;
          seenC.add(id);
          const icon = typeof c.icon === "string" && c.icon ? c.icon : undefined;
          if (icon && typeof c.iconData === "string" && c.iconData.startsWith("data:image/"))
            ic[icon] = c.iconData;
          nc.push({ id, name: String(c?.name ?? "").slice(0, 60), ...(icon ? { icon } : {}) });
        }
        if (!seenC.has(GENERAL)) nc.unshift({ id: GENERAL, name: "" });
      }
      const ids = new Set(nc.map((c) => c.id));
      const gc: Record<string, string> = {};
      if (dd.groupCategories && typeof dd.groupCategories === "object")
        for (const [g, c] of Object.entries(dd.groupCategories as Record<string, unknown>))
          if (ng.includes(g) && ids.has(String(c))) gc[g] = String(c);
      setCats(nc);
      setGroupCat(gc);
      storeIcons(ic);
      if (asSaved) {
        setBaseCats(nc);
        setBaseGroupCat(gc);
      }
      const jv = (d as { view?: unknown }).view;
      const want = typeof jv === "string" ? jv : undefined;
      setView((v) => {
        const x = want ?? v;
        return x === "all" || x === "unlisted" || ids.has(x) ? x : "all";
      });
      const jc = (d as { collapsed?: unknown }).collapsed;
      if (Array.isArray(jc)) setAllCollapsed(jc.filter((k): k is string => typeof k === "string"));
    }
    if (!Array.isArray(d) && typeof d.showName === "boolean") toggleName(d.showName);
    if (!Array.isArray(d) && typeof (d as { showColors?: unknown }).showColors === "boolean")
      toggleColors((d as { showColors: boolean }).showColors);
    if (
      !Array.isArray(d) &&
      (d as { groupColors?: unknown }).groupColors &&
      typeof (d as { groupColors?: unknown }).groupColors === "object"
    ) {
      const gc: Record<string, string> = {};
      for (const [g, c] of Object.entries(
        (d as { groupColors: Record<string, unknown> }).groupColors,
      ))
        if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) gc[g] = c.toUpperCase();
      setColors(gc);
      if (asSaved) setBaseColors(gc);
    } else if (asSaved) {
      setColors({});
      setBaseColors({});
    }
    if (!Array.isArray(d)) {
      const l = normLang(d.lang);
      if (l) setLang(l);
      const col = d.sort?.column;
      void col;
    }
    if (pv) setProjectStatus(pv.hasAttributesFile ? "loaded" : "no-attributes");
    setHostState((state) => ({
      phase: asSaved ? (CATALOG.length ? "available" : "empty") : state.phase,
      diagnostics,
    }));
  };
  const importJson = (file: File | undefined) => {
    if (!file || organizedRef.current) return;
    file
      .text()
      .then((txt) => applyData(txt, false))
      .catch(() => alert(t.invalidFile));
  };
  const setCatIcon = (id: string, path: string, data: string) => {
    if (!id) return;
    setCats((l) => l.map((c) => (c.id === id ? { ...c, icon: path || undefined } : c)));
    if (path && data.startsWith("data:image/")) storeIcons({ ...icons, [path]: data });
  };
  const setIconRef = useRef(setCatIcon);
  setIconRef.current = setCatIcon;
  const pickIcon = (id: string) => {
    const wv = hostEnabled
      ? (window as unknown as { chrome?: { webview?: unknown } }).chrome?.webview
      : undefined;
    if (wv) {
      void sendToHost({ type: "pickIcon", category: id }).catch((error) =>
        setHostError(String(error)),
      );
      return;
    }
    setIconFor(id);
    document.getElementById("cat-icon-input")?.click();
  };
  const addCat = () => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    const id = "c" + Date.now().toString(36);
    setCats((l) => [...l, { id, name: t.catNew }]);
    setView(id);
    setEditingCat(id);
  };
  const renameCat = (id: string, name: string) => {
    const n = name.trim().slice(0, 60);
    if (n || id === GENERAL) setCats((l) => l.map((c) => (c.id === id ? { ...c, name: n } : c)));
  };
  const deleteCat = (id: string) => {
    if (id === GENERAL) return;
    setCats((l) => l.filter((c) => c.id !== id));
    setGroupCat((m) => Object.fromEntries(Object.entries(m).filter(([, c]) => c !== id)));
    commit((r) => r.map((x) => (x.cat === id ? { ...x, cat: undefined } : x)));
    if (view === id) setView("all");
  };
  /** Read error or failed switch: never keep or re-inject values of a previous project. */
  const clearProjectValues = () => {
    setRows((r) => r.map((x) => ({ ...x, value: "" })));
    setExtraVals({});
    setBaseExtra({});
  };
  const applyRef = useRef(applyData);
  applyRef.current = applyData;
  /** Replaces the whole project state with a contract snapshot: definitions, values, sources, diagnostics. Nothing inherited. */
  const applySnapshot = (snap: AimProjectSnapshot) => {
    // Contract 2: Python's attributes[] are displayed as received; no catalog/values merge in the browser.
    clearProjectValues();
    setAimSnapshot(snap);
    const status = snapshotStatus(snap);
    setProjectStatus(status);
    setHostState(snapshotHostState(status));
    setProjectName(snap.project?.name ?? "");
    setProjectPath(snap.project?.path ?? "");
    projectPathRef.current = snap.project?.path ?? "";
    setBackups([]);
    setLimitedNotice("");
    setSaveNotice("");
    setHostError("");
  };
  /** Snapshot-less failure of a switch: the previous project's values must not remain visible. */
  const failProject = () => {
    clearProjectValues();
    setCatalog([]);
    setCatCount(0);
    setAimSnapshot(null);
    setProjectName("");
    setProjectPath("");
    projectPathRef.current = "";
    setProjectStatus("read-error");
    setLimitedNotice("");
    setHostState({ phase: "error", diagnostics: [] });
  };
  const applySnapshotRef = useRef(applySnapshot);
  applySnapshotRef.current = applySnapshot;
  const adoptWork = (next: ConfirmedWorkingState) => {
    const previous = workRef.current;
    if (isWorkingStateV2(next) && previous && isWorkingStateV2(previous) && previous.sessionId === next.sessionId && (next.revision < previous.revision || next.projectRevision < previous.projectRevision)) return;
    workRef.current = next;
    setWork(next);
    if (isWorkingStateV2(next) && next.save.state !== "idle") lockSave(true);
    const snapshot = parseAimProjectSnapshot(next.source);
    if (!snapshot) return;
    applySnapshot(snapshot);
    // Effective attributes and organized rows are complete Python results, never merged with draftValues.
    setAimSnapshot({ ...snapshot, attributes: next.data.attributes });
    setOrganized(next.presentation as Presentation | null);
    rememberConfiguration(next.presentation?.configuration ?? null, `${isWorkingStateV2(next) ? next.sessionId : ""}:${next.source.project?.path ?? ""}:${next.presentation?.configuration.configurationId ?? ""}`);
    setOrganizedStatus("ready");
    setLayoutDraft(null);
  };
  const refreshWork = async (generation = initializationGeneration.current) => {
    const expected = workRef.current;
    const response = await callWorking("work.get", {});
    if (!isActiveGeneration(generation)) return null;
    if (!response.ok) { setSelectNotice(response.error.message); throw new Error(response.error.message); }
    if ("work" in response) {
      if (expected && isWorkingStateV2(expected) && isWorkingStateV2(response.work) && expected.sessionId !== response.work.sessionId && workRef.current !== expected) return null;
      adoptWork(response.work); return workRef.current;
    }
    return null;
  };
  const confirmWorkLoss = async () => (await askAimDiscard("Abandonner les modifications en mémoire ?")) === "discard";
  const runWorkingImpl = async <C extends keyof WorkingRequests>(command: C, payload: WorkingRequests[C]) => {
    if (saveLocked.current || (savePreparing.current && command !== "work.value.set") || workRunning.current) return null;
    const generation = initializationGeneration.current;
    workRunning.current = true; setWorkBusy(true);
    try {
      const response = await callWorking(command, payload);
      if (!isActiveGeneration(generation)) return null;
      if (!response.ok) {
        setSelectNotice(response.error.message);
        if (response.error.code === "stale_work" || response.error.code === "project_changed") await refreshWork(generation);
        return response;
      }
      if ("work" in response) adoptWork(response.work);
      if (command !== "work.close" && response.status !== "cancelled") await refreshWork(generation);
      return isActiveGeneration(generation) ? response : null;
    } catch (error) {
      if (isActiveGeneration(generation)) {
        setSelectNotice(error instanceof Error ? error.message : "Communication Python interrompue ; état précédent conservé.");
        try { await refreshWork(generation); } catch { /* keep the last confirmed work */ }
      }
      return null;
    } finally { if (isActiveGeneration(generation)) { workRunning.current = false; setWorkBusy(false); } }
  };
  const runWorking = <C extends keyof WorkingRequests>(command: C, payload: WorkingRequests[C]) => {
    if (workRunning.current || saveLocked.current) return Promise.resolve(null);
    const task = runWorkingImpl(command, payload);
    workTask.current = task;
    void task.finally(() => { if (workTask.current === task) workTask.current = null; });
    return task;
  };
  const transitionWork = async (intent: Omit<Extract<WorkingRequests["work.transition"], {command:"project.select"}>, "revision" | "discard"> | Omit<Extract<WorkingRequests["work.transition"], {command:"project.manager.open"}>, "revision" | "discard"> | Omit<Extract<WorkingRequests["work.transition"], {command:"presentation.import.apply"}>, "revision" | "discard">) => {
    const generation = initializationGeneration.current;
    const current = workRef.current;
    if (saveLocked.current || savePreparing.current || !current) return null;
    const loss = intent.command === "presentation.import.apply" ? current.dirty.presentation : current.dirty.any || !!pendingUpdate || localDrafts.current.size > 0;
    const discard = loss ? await confirmWorkLoss() : false;
    if (!isActiveGeneration(generation)) return null;
    if (loss && !discard) return null;
    if (workRef.current?.revision !== current.revision) { setSelectNotice("L’état a changé pendant la confirmation ; recommencez l’ouverture."); return null; }
    let response = await runWorking("work.transition", { ...intent, revision: current.revision, discard });
    if (response && !response.ok && response.error.code === "work_confirmation_required" && !discard && await confirmWorkLoss() && isActiveGeneration(generation) && workRef.current) {
      response = await runWorking("work.transition", { ...intent, revision: workRef.current.revision, discard: true });
    }
    return response;
  };
  /** value null = explicit "Non renseigné"; "" and "0" are sent as typed, never converted. */
  const commitWorkingValue = async (number: string, value: string | null) => {
    const current = workRef.current;
    if (!current || !workEditCap || saveLocked.current) return false;
    const result = await runWorking("work.value.set", { revision: current.revision, number, value });
    return !!result?.ok;
  };
  const renderWorkingValue = (row: OutsideAttribute | DisplayRow) => row.valueState === "unavailable"
    ? <ValueDisplay valueState={row.valueState} value={row.value} wrap />
    : <InlineWorkingValue row={row} source={workRef.current?.source.data.attributes.find(a => a.number === row.number)} disabled={!workEditCap || saveFrozen || workBusy || selecting || updating || importOpen} registerFlush={(key, flush) => { if (flush) valueFlushers.current.set(key, flush); else valueFlushers.current.delete(key); }} onPending={markLocalDraft} onCommit={commitWorkingValue} onInvalid={key => setSelectNotice(t[key])} />;
  useEffect(() => {
    if (!workCap || !onLeaveRequest) return;
    onLeaveRequest(async () => {
      if (saveLocked.current || savePreparing.current || workRunning.current || selectionBusy.current || updateRunning.current || importOpen || !workRef.current) return false;
      if (!await confirmWorkLoss()) return false;
      const result = await runWorking("work.discard", { revision: workRef.current.revision });
      return !!result?.ok && !workRef.current?.dirty.any;
    });
    return () => onLeaveRequest(null);
  }, [workCap, onLeaveRequest, importOpen]);
  useEffect(() => {
    if (!saveCap || !work || !isWorkingStateV2(work) || !work.save.request || savePreparing.current || saveFollowing.current) return;
    const request = work.save.request;
    if (!saveSeen.current.has(JSON.stringify(request))) void followSave(request, work.save.operationId);
  }, [work, saveCap, followTick]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveWake.current?.(); saveWake.current = null;
    };
  }, []);
  /**
   * After a project switch the organized model is requested again from Python; nothing from the previous project is kept.
   * current → new Python model; empty → no active organized model; transport/invalid/failure → explicit error,
   * old values hidden, in-memory configuration kept (export only), retry offered. No replacement model is built here.
   */
  const refreshOrganized = async () => {
    if (workCap) { try { await refreshWork(); } catch { setSelectNotice("Relecture du brouillon impossible ; état précédent conservé."); } return; }
    const seq = ++organizedSeq.current;
    updateSeq.current++;
    setOrganizedStatus("loading");
    let g: ReturnType<typeof parseGet> | null = null;
    try {
      g = parseGet(await callPresentation("presentation.get", {}));
    } catch {
      g = null;
    }
    if (!mountedRef.current || seq !== organizedSeq.current) return;
    if (g?.kind === "current" && (g.presentation.configuration.version === 1 || treeCap)) {
      if (
        organizedRef.current?.configuration.configurationId !==
        g.presentation.configuration.configurationId
      )
        setLayoutDraft(null);
      setOrganized(g.presentation);
      setOrganizedStatus("ready");
      return;
    }
    if (g?.kind === "empty") {
      setOrganized(null);
      setLayoutDraft(null);
      setOrganizedStatus("ready");
      setSelectNotice(
        "Aucune présentation organisée active pour ce projet dans l'application Python.",
      );
      return;
    }
    setOrganizedStatus("error");
  };
  /**
   * Submits the configuration only; Python validates and returns {configuration, report:null, model} adopted together.
   * Failure keeps the confirmed presentation and the draft for retry; a transport error makes the effect uncertain,
   * so presentation.get is fetched before any new update/export. Late replies (other generation, unmounted) are ignored.
   */
  const performConfigurationUpdate = async (configuration: Presentation["configuration"]) => {
    if (
      !canUpdate || saveLocked.current || savePreparing.current && !flushingEdits.current ||
      workRunning.current ||
      updateRunning.current ||
      selectionBusy.current ||
      (configuration.version === 2 && !treeCap)
    )
      return;
    updateRunning.current = true;
    const seq = ++updateSeq.current,
      generation = organizedSeq.current;
    setPendingUpdate({ configuration, status: "sending", message: "" });
    let raw: unknown,
      transport = false;
    try {
      raw = await callPresentation("presentation.update", { configuration });
    } catch {
      transport = true;
    }
    if (!mountedRef.current || seq !== updateSeq.current || generation !== organizedSeq.current)
      return;
    if (transport) {
      setPendingUpdate({
        configuration,
        status: "uncertain",
        message:
          "Connexion interrompue : résultat incertain. Relecture de la présentation en cours.",
      });
      await refreshOrganized();
      return;
    }
    if (workCap) {
      const reply = parseWorkingPresentation("presentation.update", raw);
      if (reply?.ok === true) {
        try { await refreshWork(); setPendingUpdate(null); } catch { setPendingUpdate({ configuration, status: "uncertain", message: "Relecture du brouillon impossible ; dernière version confirmée conservée." }); }
      } else {
        setPendingUpdate({ configuration, status: "failed", message: reply?.ok === false ? reply.error.message : "Réponse incompatible : presentation.update" });
        try { await refreshWork(); } catch { /* retain last confirmed work */ }
      }
      return;
    }
    const o = parseUpdate(raw);
    if (o.kind === "updated" && (o.presentation.configuration.version === 1 || treeCap)) {
      rememberConfiguration(o.presentation.configuration, `${projectPathRef.current}:${o.presentation.configuration.configurationId}`);
      organizedRef.current = o.presentation;
      setOrganized(o.presentation);
      setPendingUpdate(null);
      setSaveNotice("");
      return;
    }
    setPendingUpdate({
      configuration,
      status: "failed",
      message:
        o.kind === "failure"
          ? o.message
          : "Réponse de mise à jour invalide ; présentation précédente conservée.",
    });
  };
  const submitConfiguration = (configuration: Presentation["configuration"]) => {
    if (updateTask.current || exportDispatched.current) return Promise.resolve();
    const task = performConfigurationUpdate(configuration).finally(() => {
      updateRunning.current = false;
      if (updateTask.current === task) updateTask.current = null;
    });
    updateTask.current = task;
    return task;
  };
  const changeConfiguration = (c: Presentation["configuration"]) => {
    if (canUpdate) void submitConfiguration(c);
    else setLayoutDraft(c);
  };
  const pickOrganizedIcon = async (categoryId: string) => {
    if (!iconSelectCap || !iconSelectAvailable(getVerifiedAppInfo()) || iconSelecting.current || !canUpdate || saveLocked.current || savePreparing.current || closingRequest.current || selectionBusy.current || workRunning.current || updateTask.current || pendingUpdateRef.current || importOpen) return;
    const configuration = organizedRef.current?.configuration;
    const category = configuration?.categories.find(cat => cat.id === categoryId);
    if (!configuration || !category) return;
    const generation = organizedSeq.current;
    const key = `${configuration.configurationId}:${categoryId}`;
    const remembered = selectedIconPaths.current.get(key);
    const path = absoluteIconPath(category.icon) ? category.icon : remembered?.icon === category.icon ? remembered.path : undefined;
    iconSelecting.current = true; setIconSelectBusy(true);
    try {
      const response = await selectNativeIcon(path);
      if (!mountedRef.current || generation !== organizedSeq.current || organizedRef.current?.configuration !== configuration) return;
      if (!response.ok) { setSaveNotice(`${response.error.message} (${response.error.code})`); return; }
      if (response.status === "cancelled") return;
      selectedIconPaths.current.set(key, { icon: response.icon, path: response.path });
      const next = structuredClone(configuration);
      const selectedCategory = next.categories.find(cat => cat.id === categoryId);
      if (!selectedCategory) return;
      selectedCategory.icon = response.icon;
      await submitConfiguration(next);
    } catch (error) {
      if (mountedRef.current && generation === organizedSeq.current) setSaveNotice(error instanceof Error ? error.message : "Sélection d’icône impossible ; icône conservée.");
    } finally {
      iconSelecting.current = false;
      if (mountedRef.current) setIconSelectBusy(false);
    }
  };
  const travelConfiguration = async (direction: "undo" | "redo") => {
    const current = presentationHistory.current;
    if (!canUpdate || !current || saveLocked.current || savePreparing.current || closingRequest.current || selectionBusy.current || workRunning.current || updateTask.current || pendingUpdateRef.current || importOpen) return;
    const next = travelHistory(current, direction);
    if (next === current) return;
    historyDestination.current = next;
    try { await submitConfiguration(structuredClone(next.present)); }
    finally { historyDestination.current = null; }
  };
  const travelHandler = useRef(travel);
  travelHandler.current = travel;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || (event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y") {
        event.preventDefault();
        travelHandler.current(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const addOrganizedOccurrence = (number: string, groupId: string, configuration = organized?.configuration) => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    if (!canUpdate || !organized) return;
    const attribute = aimSnapshot?.attributes.find((a) => a.number === number);
    const next = attribute && configuration && addOccurrence(configuration, groupId, attribute);
    if (next) void submitConfiguration(next);
  };
  const addOrganizedOccurrences = (numbers: string[], target: string, before?: string) => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    const configuration = organizedRef.current?.configuration;
    if (!canUpdate || !configuration || updateTask.current || pendingUpdateRef.current) return;
    const supplied = aimSnapshot?.attributes ?? [];
    const attributes = numbers.map(number => supplied.find(attribute => attribute.number === number));
    if (attributes.some(attribute => !attribute)) { setSaveNotice("Dépôt refusé : certains attributs ne sont plus disponibles. Aucune ligne ajoutée."); return; }
    const next = addPresentationBatch(configuration, target, attributes.filter((attribute): attribute is NonNullable<typeof attribute> => !!attribute), before);
    if (!next) { setSaveNotice("Dépôt refusé : destination incompatible avec la sélection. Aucune ligne ajoutée."); return; }
    void submitConfiguration(next);
  };
  const [recent, setRecent] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    projects: AimRecentProject[];
    message: string;
  }>({ status: "idle", projects: [], message: "" });
  // Host-owned MRU only (project_history_contract 1): no browser history.
  const loadRecent = async () => {
    if (!contract.history) return;
    const api = (
      window as unknown as {
        pywebview?: {
          api?: { call?: (command: string, payload: Record<string, never>) => Promise<unknown> };
        };
      }
    ).pywebview?.api;
    if (typeof api?.call !== "function") return;
    setRecent((r) => ({ ...r, status: "loading" }));
    try {
      const o = parseRecentResponse(await api.call("project.recent", {}));
      if (!mountedRef.current) return;
      setRecent(
        o.kind === "list"
          ? { status: "ready", projects: o.projects, message: "" }
          : {
              status: "error",
              projects: [],
              message: o.kind === "refused" ? o.message : "Réponse de l’historique invalide.",
            },
      );
    } catch {
      if (mountedRef.current)
        setRecent({
          status: "error",
          projects: [],
          message: "Historique des projets indisponible.",
        });
    }
  };
  const loadSource = async () => {
    if (!managerCap) return;
    const n = ++sourceSeq.current;
    setDefinitionSource(null);
    try {
      const o = await callManager("project.source");
      if (mountedRef.current && n === sourceSeq.current && o.kind === "source")
        setDefinitionSource(o.source);
    } catch {
      /* unresolved, never inferred */
    }
  };
  useEffect(() => {
    void loadSource();
  }, [aimSnapshot]);
  const openManagerProject = async (path: string) => {
    if (workCap) {
      if (saveLocked.current || savePreparing.current || selectionBusy.current || updateRunning.current || workRunning.current || importOpen || exportBusy.current) return;
      selectionBusy.current = true;
      try {
        const active = await managerProjectIsActive(getVerifiedAppInfo(), path);
        if (!mountedRef.current) return;
        if (active) { setManagerOpen(false); return; }
        setSelecting(true);
        const reply = await transitionWork({ command: "project.manager.open", payload: { path, discardPresentation: false } });
        if (reply?.ok && reply.status !== "cancelled") { setPendingUpdate(null); setManagerOpen(false); void loadRecent(); }
      } catch (error) { setSelectNotice(error instanceof Error ? error.message : "Identité Python indisponible."); }
      finally { selectionBusy.current = false; if (mountedRef.current) setSelecting(false); }
      return;
    }
    if (!managerCap || selectionBusy.current || updateRunning.current || importOpen || exportBusy.current) return;
    let discardPresentation = false;
    if (pendingUpdate || organizedDirty) {
      const choice = await askAimDiscard("La présentation comporte une modification non confirmée. Abandonner et ouvrir le projet ?");
      if (choice !== "discard") return;
      if (!mountedRef.current || selectionBusy.current) return;
      discardPresentation = true;
    }
    selectionBusy.current = true;
    setSelecting(true);
    try {
      let o = await callManager("project.manager.open", { path, discardPresentation });
      if (!mountedRef.current) return;
      if (o.kind === "failure" && o.code === "presentation_confirmation_required") {
        const choice = await askAimDiscard("Changer de projet abandonnera la présentation courante.");
        if (!choice || !mountedRef.current) return;
        o = await callManager("project.manager.open", { path, discardPresentation: true });
        if (!mountedRef.current) return;
      }
      if (o.kind === "opened") {
        applySnapshot(o.snapshot);
        setPendingUpdate(null);
        await refreshOrganized();
        await loadSource();
        void loadRecent();
        setManagerOpen(false);
      } else
        setSelectNotice(
          o.kind === "failure" ? o.message : "Ouverture impossible : projet courant conservé.",
        );
    } catch {
      if (mountedRef.current) setSelectNotice("Ouverture impossible : projet courant conservé.");
    } finally {
      selectionBusy.current = false;
      if (mountedRef.current) setSelecting(false);
    }
  };
  const selectProject = async (entry?: AimRecentProject) => {
    if (workCap) {
      if (saveLocked.current || savePreparing.current || !mountedRef.current || !workRef.current || selectionBusy.current || updateRunning.current || workRunning.current || importOpen || exportBusy.current || (entry && !contract.history)) return;
      const generation = initializationGeneration.current;
      selectionBusy.current = true; setSelecting(true);
      try { const reply = await transitionWork({ command: "project.select", payload: entry ? {path:entry.path} : {} }); if (reply?.ok && reply.status !== "cancelled") { setPendingUpdate(null); void loadRecent(); } }
      finally { if (isActiveGeneration(generation)) { selectionBusy.current = false; setSelecting(false); } }
      return;
    }
    if (pendingUpdate) {
      setSelectNotice(
        "Appliquez ou abandonnez la modification de présentation en attente avant de changer de projet.",
      );
      return;
    }
    if (
      !contract.canSelect ||
      selectionBusy.current ||
      importOpen ||
      organizedStatus === "loading" ||
      projectStatus === "loading"
    )
      return;
    if (entry && !contract.history) return;
    const api = (
      window as unknown as {
        pywebview?: {
          api?: { call?: (command: string, payload: Record<string, unknown>) => Promise<unknown> };
        };
      }
    ).pywebview?.api;
    if (typeof api?.call !== "function") {
      setSelectNotice(projectText(lang, "selectRefused"));
      return;
    }
    selectionBusy.current = true;
    setSelecting(true);
    setSelectNotice("");
    setSelectDetails("");
    const previousOrganizedStatus = organizedStatus;
    try {
      const raw = await api.call("project.select", entry ? { path: entry.path } : {});
      if (!mountedRef.current) return;
      // Cancellation with a current state: nothing changes (project, values, presentation).
      if (isSelectCancelled(raw)) return;
      if (organizedRef.current && !!raw && typeof raw === "object" && "data" in raw)
        setOrganizedStatus("loading");
      const outcome = parseSelectResponse(raw);
      if (!mountedRef.current) return;
      const errorMessage = (raw as { error?: { message?: unknown } })?.error?.message;
      const message = typeof errorMessage === "string" ? errorMessage : undefined;
      if (outcome.kind === "snapshot") {
        applySnapshot(outcome.snapshot);
        if (outcome.error) {
          setSelectNotice(
            `${projectText(lang, "selectRefused")} : ${selectionReason(lang, outcome.error, outcome.snapshot, message)}`,
          );
          setSelectDetails(outcome.error);
        }
        if (organizedRef.current) await refreshOrganized();
        if (!outcome.error) void loadRecent();
      } else if (outcome.kind === "refused") {
        setSelectNotice(
          `${projectText(lang, "selectRefused")} : ${selectionReason(lang, outcome.error, undefined, message)}`,
        );
        setSelectDetails(outcome.error);
        setOrganizedStatus(previousOrganizedStatus);
      } else {
        failProject();
        setSelectNotice(projectText(lang, "read-error"));
        setSelectDetails("invalid_response");
        if (organizedRef.current) {
          organizedSeq.current++;
          setOrganizedStatus("error");
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        failProject();
        setSelectNotice(projectText(lang, "read-error"));
        setSelectDetails(`transport_error${error instanceof Error ? ` — ${error.message}` : ""}`);
        if (organizedRef.current) {
          organizedSeq.current++;
          setOrganizedStatus("error");
        }
      }
    } finally {
      selectionBusy.current = false;
      if (mountedRef.current) setSelecting(false);
    }
  };
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const generation = ++initializationGeneration.current;
    // Lifecycle invalidation only: Python's pending operations are not cancelled.
    workRef.current = null;
    saveFollowing.current = false;
    savePreparing.current = false;
    saveReference.current = null;
    saveSeen.current.clear();
    lockSave(false);
    workRunning.current = false;
    selectionBusy.current = false;
    setWork(null); setWorkBusy(false); setSelecting(false);
    // Window bound to another application: no aim_legacy globals, listener or ready message.
    if (!hostEnabled && limitedHost) {
      // Limited pywebview binding (identity already verified): get_initial_data only, bounded, strictly validated before applyData.
      // Late replies (after timeout or unmount) are ignored; no automatic retry; browser rows are never purged.
      let finished = false;
      const browserRows = () => latestRef.current.rows.length;
      const end = (
        outcome: AimLimitedOutcome,
        phase: HostPhase,
        diagnostics: HostDiagnostic[] = [],
        issues = 0,
      ) => {
        finished = true;
        clearTimeout(timer);
        if (outcome === "timeout" || outcome === "invalid" || outcome === "error") {
          clearProjectValues();
          setProjectStatus("read-error");
        } else if (outcome === "absent" && phase === "not-requested") setProjectStatus("none");
        setLimitedNotice(limitedOutcomeText(lang, outcome, browserRows(), issues));
        if (phase !== "available" && phase !== "empty") setHostState({ phase, diagnostics });
      };
      setHostState({ phase: "loading", diagnostics: [] });
      setProjectStatus("loading");
      setLimitedNotice(limitedOutcomeText(lang, "loading", 0));
      setShown(true);
      const timer = setTimeout(() => {
        if (!finished) end("timeout", "error", [{ code: "transport-error", severity: "error" }]);
      }, AIM_INITIAL_DATA_TIMEOUT_MS);
      const api = (
        window as unknown as { pywebview?: { api?: { get_initial_data?: () => Promise<unknown> } } }
      ).pywebview?.api;
      Promise.resolve()
        .then(() => (!finished && typeof api?.get_initial_data === "function" ? api.get_initial_data() : null))
        .then((raw) => {
          if (finished) return;
          if (contract.recognized) {
            const snap = isAimProjectSnapshot(raw) ? parseAimProjectSnapshot(raw) : null;
            if (!snap) {
              end("invalid", "unsupported", [{ code: "invalid-message", severity: "error" }]);
              return;
            }
            finished = true;
            clearTimeout(timer);
            applySnapshotRef.current(snap);
            if (workCap) void refreshWork(generation).then((initialWork) => {
              // This continuation runs once, after adoption has made workRef available.
              if (isActiveGeneration(generation) && initialWork && snap.selection === "required" && initialWork.source.selection === "required") void selectProject();
            }).catch(() => { if (isActiveGeneration(generation)) setSelectNotice("Initialisation du brouillon impossible ; aucune édition autorisée."); });
            return;
          }
          const parsed = parseAimInitialContainer(raw);
          if (parsed.kind === "absent") {
            end("absent", "not-requested");
            return;
          }
          if (parsed.kind === "invalid") {
            end("invalid", "unsupported", [{ code: "invalid-message", severity: "error" }]);
            return;
          }
          const check = validateAimContent(parsed.data);
          if (!check.ok) {
            console.warn("Information Manager : données de l’hôte rejetées", check.issues);
            end(
              "invalid",
              "unsupported",
              [{ code: "invalid-message", severity: "error" }],
              check.issues.length,
            );
            return;
          }
          try {
            applyRef.current(parsed.data, true);
            const pn = parsed.data["projectName"];
            if (typeof pn === "string") setProjectRef.current(pn.trim());
            end(
              check.catalogEmpty ? "empty" : "absent",
              check.catalogEmpty ? "empty" : "available",
            );
            if (!check.catalogEmpty) setLimitedNotice("");
          } catch {
            end("invalid", "unsupported", [{ code: "invalid-message", severity: "error" }]);
          }
        })
        .catch(() => {
          if (!finished) end("error", "error", [{ code: "transport-error", severity: "error" }]);
        });
      return () => {
        finished = true;
        clearTimeout(timer);
        if (initializationGeneration.current === generation) initializationGeneration.current++;
      };
    }
    if (!hostEnabled || !isAimLegacyEstablished()) {
      setHostState({ phase: "disconnected", diagnostics: [] });
      requestAnimationFrame(() => setShown(true));
      return;
    }
    const w = window as unknown as {
      loadPresentation?: (data: unknown) => boolean;
      chrome?: {
        webview?: {
          addEventListener: (t: string, f: (e: { data: unknown }) => void) => void;
          removeEventListener: (t: string, f: (e: { data: unknown }) => void) => void;
        };
      };
    };
    const load = (data: unknown) => {
      try {
        const decoded = typeof data === "string" ? JSON.parse(data) : data;
        if (!decoded || typeof decoded !== "object" || !Array.isArray(decoded.catalog))
          throw new Error("missing-catalog");
        applyRef.current(decoded, true);
        data = decoded;
        const pn =
          data && typeof data === "object"
            ? (data as { projectName?: unknown }).projectName
            : undefined;
        const pp =
          data && typeof data === "object"
            ? (data as { projectPath?: unknown }).projectPath
            : undefined;
        if (typeof pp === "string") {
          setProjectPath(pp);
          projectPathRef.current = pp;
          setBackups([]);
        }
        if (typeof pn === "string") setProjectRef.current(pn.trim());
        setHostError("");
        setSaveNotice("");
        requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
        return true;
      } catch (err) {
        console.error("Présentation reçue invalide :", err);
        clearProjectValues();
        setProjectStatus("read-error");
        setCatalog([]);
        setCatCount(0);
        setHostState({
          phase: "error",
          diagnostics: [{ code: "missing-catalog", severity: "error" }],
        });
        setShown(true);
        return false;
      }
    };
    // Option 1 : ExecuteScript("window.loadPresentation({...})")
    w.loadPresentation = load;
    // Language: ExecuteScript("window.setLanguage('en')") or {"type":"lang","lang":"en"}
    (w as { setLanguage?: (l: string) => boolean }).setLanguage = (l: string) => {
      const n = normLang(l);
      if (n) setLangRef.current(n);
      return !!n;
    };
    // Project name: {"type":"project","name":"..."}, ExecuteScript("window.setProjectName('...')") or data.projectName in load
    (w as { setProjectName?: (n: string) => void }).setProjectName = (n: string) =>
      setProjectRef.current(String(n ?? "").trim());
    // Category icon: {"type":"icon","category":"id","path":"C:/.../x.png","data":"data:image/png;base64,..."} or window.setCategoryIcon(id, path, data)
    (w as { setCategoryIcon?: (c: string, p: string, d: string) => void }).setCategoryIcon = (
      c,
      p,
      d,
    ) => setIconRef.current(String(c), String(p), String(d));
    // Option 2 : PostWebMessageAsJson('{"type":"load","data":{...}}')
    const onMsg = (e: { data: unknown }) => {
      try {
        // aim_legacy adapter: strict parsing, `ok` strictly boolean
        const m = parseLegacyMessage(e.data);
        if (m?.type === "project.result") {
          const pending = pendingHost.current.get(m.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingHost.current.delete(m.requestId);
            if (m.ok === true) pending.resolve(m.data);
            else pending.reject(new Error(m.error || "Allplan"));
          }
        }
        if (m?.type === "load") load(m.data);
        if (m?.type === "icon") setIconRef.current(m.category, m.path, m.data);
        if (m?.type === "project") setProjectRef.current(m.name);
        if (m?.type === "lang") {
          const n = normLang(m.lang);
          if (n) setLangRef.current(n);
        }
      } catch {
        setHostState({
          phase: "error",
          diagnostics: [{ code: "invalid-message", severity: "error" }],
        });
      }
    };
    w.chrome?.webview?.addEventListener("message", onMsg);
    setHostState({ phase: w.chrome?.webview ? "loading" : "disconnected", diagnostics: [] });
    if (w.chrome?.webview) setProjectStatus("loading");
    void sendToHost({ type: "ready" }).catch(() =>
      setHostState({
        phase: "error",
        diagnostics: [{ code: "transport-error", severity: "error" }],
      }),
    );
    if (!w.chrome?.webview) requestAnimationFrame(() => setShown(true));
    const reveal = setTimeout(() => setShown(true), 1500);
    const tm = setTimeout(() => {
      if (w.chrome?.webview)
        setHostState((state) =>
          state.phase === "loading" ? { phase: "error", diagnostics: [] } : state,
        );
    }, 8000);
    return () => {
      clearTimeout(reveal);
      clearTimeout(tm);
      for (const pending of pendingHost.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Session closed"));
      }
      pendingHost.current.clear();
      w.chrome?.webview?.removeEventListener("message", onMsg);
      delete w.loadPresentation;
      delete (w as { setLanguage?: unknown }).setLanguage;
      delete (w as { setProjectName?: unknown }).setProjectName;
      delete (w as { setCategoryIcon?: unknown }).setCategoryIcon;
    };
  }, [hostEnabled, limitedHost]);

  const commit = (fn: (r: Attr[]) => Attr[]) => setRows((r) => fn(r));
  const update = (num: number, patch: Partial<Attr>) =>
    commit((r) => r.map((x) => (x.num === num ? { ...x, ...patch } : x)));
  const setNewGroupCat = (g: string | undefined, cat: string) => {
    if (g && !groups.includes(g) && !rows.some((x) => x.group === g))
      setGroupCat((m) => {
        const { [g]: _, ...rest } = m;
        return cat === GENERAL ? rest : { ...rest, [g]: cat };
      });
  };
  const replace = (oldNum: number, a: Attr, cat: string) => {
    setNewGroupCat(a.group, cat);
    commit((r) =>
      r.map((x) =>
        x.num === oldNum ? { ...a, ...(!a.group && cat !== GENERAL ? { cat } : {}) } : x,
      ),
    );
  };
  const add = (a: Attr, cat: string) => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    const prev = extraVals[a.num];
    let value = a.value;
    if (prev !== undefined && !a.value) {
      if (a.widget === "checkbox")
        value = ["true", "1"].includes(prev.toLowerCase()) ? "true" : "false";
      else if (
        !checkValue(a.type, prev) &&
        !(a.widget === "list" && prev && !(a.options ?? []).includes(prev))
      )
        value = prev;
    }
    setNewGroupCat(a.group, cat);
    const item = { ...a, value, ...(!a.group && cat !== GENERAL ? { cat } : {}) };
    commit((r) => insertAttribute(r, item, selectedGroup, selectedRow));
    setSelectedRow(a.num);
    setSelectedGroup(null);
  };
  const remove = (num: number) => {
    const row = rows.find((x) => x.num === num);
    if (row && CATALOG.some((c) => c.num === num))
      setExtraVals((x) => ({ ...x, [num]: row.value ?? "" }));
    commit((r) => r.filter((x) => x.num !== num));
    setConfirmDel(null);
  };
  const editRow = rows.find((r) => r.num === editing);

  const [sort] = useState<Sort>({ key: "manual", dir: 1 });
  // User ordering is fully manual: headers no longer re-sort the table.
  const toggleSort = (_key: SortKey) => {};
  const sortList = (src: Attr[], key: SortKey, dir: 1 | -1) => {
    const list = src.filter((r) =>
      matchesSearch(
        {
          num: String(r.num),
          name: r.name,
          title: r.title,
          value: r.value,
          group: r.group ?? "",
          category: catName(cats.find((c) => c.id === catOf(r)) ?? { id: GENERAL, name: "" }),
        },
        q,
        searchOptions,
      ),
    );
    if (key === "manual") return list;
    const val = (r: Attr): string | number => {
      if (key === "num") return r.num;
      if (key === "widget") return Object.keys(WIDGETS).indexOf(r.widget);
      if (key === "type")
        return r.widget === "checkbox"
          ? Object.keys(TYPES).indexOf("INT")
          : Object.keys(TYPES).indexOf(r.type);
      return String(r[key as Exclude<SortKey, "manual">]).toLowerCase();
    };
    return [...list].sort((x, y) => {
      const a = val(x),
        b = val(y);
      return (a < b ? -1 : a > b ? 1 : x.num - y.num) * dir;
    });
  };
  const filtered = useMemo(
    () => sortList(rows, sort.key, sort.dir),
    [rows, q, sort, searchOptions, cats, groupCat],
  );
  const unlisted = useMemo<Attr[]>(() => {
    const used = new Set(rows.map((r) => r.num));
    return CATALOG.filter((c) => !used.has(c.num)).map((c) => ({
      num: c.num,
      name: c.name,
      title: c.name,
      widget: c.widget,
      type: c.type,
      value: extraVals[c.num] ?? "",
      ...(c.widget === "list" ? { options: c.options ?? [] } : {}),
    }));
  }, [rows, extraVals, catCount]);
  latestRef.current = {
    rows,
    unlisted,
    toPresentation,
    extraVals,
    groups,
    cats,
    groupCat,
    groupColors,
  };
  const unlistedFiltered = useMemo(
    () =>
      sort.key === "manual" ? sortList(unlisted, "num", 1) : sortList(unlisted, sort.key, sort.dir),
    [unlisted, q, sort, searchOptions, cats, groupCat],
  );
  const manual = sort.key === "manual";
  const groupNames = useMemo(() => {
    const g = allGroups(rows, groups);
    return manual ? g : [...g].sort((a, b) => a.localeCompare(b));
  }, [rows, groups, manual]);
  const viewFiltered = useMemo(
    () =>
      view === "unlisted"
        ? []
        : view === "all"
          ? filtered
          : filtered.filter((r) => catOf(r) === view),
    [filtered, view, cats, groupCat],
  );
  const viewGroups = useMemo(
    () =>
      view === "unlisted"
        ? []
        : view === "all"
          ? groupNames
          : groupNames.filter((g) => validCat(groupCat[g]) === view),
    [groupNames, view, cats, groupCat],
  );
  const showUnlistedHere = view === "unlisted" || view === "all";
  const sections = useMemo(() => {
    if (view === "unlisted") return [];
    if (viewGroups.length === 0) return [{ g: "", items: viewFiltered }];
    return [...viewGroups, ""]
      .map((g) => ({ g, items: viewFiltered.filter((r) => (r.group ?? "") === g) }))
      .filter((s) => s.items.length > 0 || (s.g !== "" && !q));
  }, [viewFiltered, viewGroups, q, view]);
  const catCountOf = (id: string) => rows.filter((r) => catOf(r) === id).length;
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [newColor, setNewColor] = useState(GROUP_COLORS[0]!);
  const [newGCat, setNewGCat] = useState(GENERAL);
  const [moveMenu, setMoveMenu] = useState<string | null>(null);
  const moveGroupToCat = (g: string, cat: string) => {
    setGroupCat((m) => {
      const { [g]: _, ...rest } = m;
      return cat === GENERAL ? rest : { ...rest, [g]: cat };
    });
    setMoveMenu(null);
  };
  const createCat = (name: string) => {
    if (searchActive) { setSaveNotice(searchAddReason); return null; }
    const id = "c" + Date.now().toString(36);
    setCats((l) => [...l, { id, name }]);
    return id;
  };
  const nextColor = () => GROUP_COLORS[Object.keys(groupColors).length % GROUP_COLORS.length]!;
  const rowToGroup = (num: number, g: string, isNew: boolean, cat: string) => {
    if (searchActive && isNew) { setSaveNotice(searchAddReason); return; }
    if (isNew) {
      setGroups((l) => (l.includes(g) ? l : [...l, g]));
      if (!groupColors[g]) setColors({ ...groupColors, [g]: nextColor() });
      if (cat !== GENERAL) setGroupCat((m) => ({ ...m, [g]: cat }));
    }
    commit((r) =>
      r.map((x) =>
        x.num === num
          ? { ...x, group: g || undefined, cat: g ? undefined : cat === GENERAL ? undefined : cat }
          : x,
      ),
    );
    setMoveMenu(null);
  };
  const addGroup = (name: string) => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    const n = name.trim().slice(0, 20);
    if (n) {
      setGroups((g) => (g.includes(n) ? g : [...g, n]));
      setColors({ ...groupColors, [n]: newColor.toUpperCase() });
      if (newGCat !== GENERAL) setGroupCat((m) => ({ ...m, [n]: newGCat }));
    }
    setNewGroup(null);
  };
  const deleteGroup = (g: string) => {
    const gc = groupCat[g];
    commit((r) => r.map((x) => (x.group === g ? { ...x, group: undefined, cat: gc } : x)));
    setGroupCat((m) => {
      const { [g]: _, ...rest } = m;
      return rest;
    });
    setGroups((l) => l.filter((x) => x !== g));
  };
  const colorOf = (g: string) =>
    g ? (groupColors[g] ?? GROUP_COLORS[groupNames.indexOf(g) % GROUP_COLORS.length]) : undefined;
  const renameGroup = (from: string, to: string) => {
    const n = to.trim().slice(0, 20);
    if (!from || n === from) return;
    commit((r) => r.map((x) => (x.group === from ? { ...x, group: n || undefined } : x)));
    setGroups((l) => [...new Set(l.map((x) => (x === from ? n : x)).filter(Boolean))]);
    if (n && from in groupCat)
      setGroupCat((m) => {
        const { [from]: c, ...rest } = m;
        return { ...rest, [n]: c! };
      });
    if (n && from in groupColors) {
      const { [from]: c, ...rest } = groupColors;
      setColors({ ...rest, [n]: c! });
    }
  };
  const pickColor = (g: string, c: string) => setColors({ ...groupColors, [g]: c.toUpperCase() });
  const [dragNum, setDragNum] = useState<number | null>(null);
  const [dropG, setDropG] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ num: number; after: boolean } | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [dropGroupAt, setDropGroupAt] = useState<string | null>(null);
  const canDrag = manual || groupNames.length > 0 || cats.length > 1;
  const [dragOut, setDragOut] = useState(false);
  const [promoteFor, setPromoteFor] = useState<number | null>(null);
  const [promoteNew, setPromoteNew] = useState("");
  const promoteTo = (num: number, g: string) => {
    const n = g.trim();
    if (n && !groups.includes(n)) {
      setGroups((l) => (l.includes(n) ? l : [...l, n]));
      if (isCatView) setGroupCat((m) => ({ ...m, [n]: view }));
      if (!groupColors[n])
        setColors({ ...groupColors, [n]: GROUP_COLORS[groupNames.length % GROUP_COLORS.length]! });
    }
    promote(num, null, false, n);
    setPromoteFor(null);
    setPromoteNew("");
  };
  /** Moves an attribute from outside the layout into the layout, keeping its value. */
  const promote = (
    num: number,
    target: number | null = null,
    after = false,
    g = "",
    cat?: string,
  ) => {
    const u = unlisted.find((x) => x.num === num);
    if (!u) return;
    const c = cat ?? (isCatView ? view : undefined);
    const item: Attr = { ...u, ...(g ? { group: g } : c ? { cat: c } : {}) };
    commit((r) => {
      if (r.some((x) => x.num === num)) return r;
      const out = [...r];
      const idx = target === null ? -1 : out.findIndex((x) => x.num === target);
      out.splice(idx < 0 ? out.length : idx + (after ? 1 : 0), 0, item);
      return out;
    });
  };
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [dropCatAt, setDropCatAt] = useState<string | null>(null);
  const catReorder = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (dropCatAt !== id) setDropCatAt(id);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const from = dragCat;
      setDragCat(null);
      setDropCatAt(null);
      if (!from || from === id) return;
      setCats((l) => {
        const a = l.filter((c) => c.id !== from);
        const f = l.find((c) => c.id === from)!;
        const i = id === "unlisted" ? a.length : a.findIndex((c) => c.id === id);
        a.splice(i < 0 ? a.length : i, 0, f);
        return a;
      });
    },
  });
  const catDrop = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (dragNum === null && dragGroup === null) return;
      if (id === "unlisted" && (dragOut || dragGroup !== null)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dropCat !== id) setDropCat(id);
    },
    onDragLeave: () => setDropCat(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragGroup !== null) {
        const g = dragGroup;
        setGroupCat((m) => ({ ...m, [g]: id }));
      } else if (dragNum !== null) {
        const n = dragNum;
        if (id === "unlisted") {
          if (!dragOut) remove(n);
        } else if (dragOut) promote(n, null, false, "", id);
        else
          commit((r) =>
            r.map((x) =>
              x.num === n
                ? {
                    ...x,
                    cat: id,
                    group: x.group && validCat(groupCat[x.group]) === id ? x.group : undefined,
                  }
                : x,
            ),
          );
      }
      setDropCat(null);
      endDrag();
    },
  });
  const endDrag = () => {
    setDragOut(false);
    setDragNum(null);
    setDropG(null);
    setDropAt(null);
    setDragGroup(null);
    setDropGroupAt(null);
  };
  /** Moves a row before/after another row (manual order) and into that row's group. */
  const moveRow = (num: number, target: number | null, after: boolean, g: string) =>
    commit((r) => {
      const item = r.find((x) => x.num === num);
      if (!item) return r;
      const moved = { ...item, group: g || undefined };
      const rest = r.filter((x) => x.num !== num);
      if (target === null || !manual) return r.map((x) => (x.num === num ? moved : x));
      const idx = rest.findIndex((x) => x.num === target);
      rest.splice(idx < 0 ? rest.length : idx + (after ? 1 : 0), 0, moved);
      return rest;
    });
  const moveGroup = (from: string, to: string) => {
    if (from === to) return;
    const fixed = { ...groupColors };
    groupNames.forEach((g, i) => {
      fixed[g] ??= GROUP_COLORS[i % GROUP_COLORS.length]!;
    });
    setColors(fixed);
    const l = groupNames.filter((x) => x !== from);
    l.splice(to === "" ? l.length : l.indexOf(to), 0, from);
    setGroups(l);
  };
  const dropProps = (g: string, rowNum?: number) =>
    !canDrag && !dragOut
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            if (dragGroup !== null && rowNum === undefined && g !== "") {
              e.preventDefault();
              if (dropGroupAt !== g) setDropGroupAt(g);
              return;
            }
            if (dragNum === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dropG !== g) setDropG(g);
            if (manual && rowNum !== undefined && rowNum !== dragNum) {
              const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const after = e.clientY > box.top + box.height / 2;
              if (dropAt?.num !== rowNum || dropAt.after !== after)
                setDropAt({ num: rowNum, after });
            } else if (dropAt) setDropAt(null);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragGroup !== null && rowNum === undefined) moveGroup(dragGroup, g);
            else if (dragNum !== null && dragOut)
              promote(dragNum, dropAt?.num ?? null, dropAt?.after ?? false, g);
            else if (dragNum !== null)
              moveRow(dragNum, dropAt?.num ?? null, dropAt?.after ?? false, g);
            endDrag();
          },
        };
  const cols =
    2 + (showNum ? 1 : 0) + (showTitle ? 1 : 0) + (showInput ? 1 : 0) + (showData ? 1 : 0);
  let rowIdx = -1;

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const t = e.target as HTMLElement;
    if ((t.tagName === "SELECT" || t.getAttribute("list")) && e.key !== "Enter") return;
    e.preventDefault();
    const col = t.dataset["col"];
    const row = Number(t.dataset["row"]);
    const dir = e.key === "ArrowUp" ? -1 : 1;
    document.querySelector<HTMLElement>(`[data-row="${row + dir}"][data-col="${col}"]`)?.focus();
  };

  const refreshBackups = async () => {
    if (!hostEnabled || !(window as unknown as { chrome?: { webview?: unknown } }).chrome?.webview)
      return;
    const data = await requestHost("project.backups.list");
    if (!Array.isArray(data)) throw new Error(t.invalidFile);
    setBackups(data.map((b) => parseBackup(b, projectPathRef.current)));
  };
  const persistBackup = async (backup: ProjectBackup) => {
    if (hostEnabled && (window as unknown as { chrome?: { webview?: unknown } }).chrome?.webview) {
      await requestHost("project.backups.create", { backup });
    }
    setBackups((list) => [backup, ...list.filter((b) => b.id !== backup.id)]);
  };
  const createBackup = async (name: string) => {
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const state = latestRef.current;
    await persistBackup(
      makeBackup(name, projectPathRef.current, state.toPresentation(state.rows), [
        ...state.rows,
        ...state.unlisted,
      ]),
    );
  };
  const restoreBackup = async (backup: ProjectBackup) => {
    const valid = parseBackup(backup, projectPathRef.current);
    await createBackup(ui.safety + " — " + new Date().toLocaleString());
    // Restore into the editable session. Project values are only written by the existing Save action.
    applyData({ ...valid.data, catalog: CATALOG, values: valid.values }, false);
  };
  const selected = selectedRow === null ? undefined : rows.find((row) => row.num === selectedRow);
  /** Rich tooltip text (AppTooltips format): first line bold = Allplan name, then real fields only. */
  const rowTip = (a: Attr, g: string) =>
    [
      `${ui.nameField} : ${a.name}`,
      `=${t.colNum}|${String(a.num).padStart(3, "0")}`,
      a.title && a.title !== a.name ? `=${t.colTitle}|${a.title}` : "",
      `=${t.colWidget}|${t[WIDGETS[a.widget]]}`,
      a.widget !== "checkbox" ? `=${t.colType}|${t[TYPES[a.type]]}` : "",
      g ? `=${ui.group}|${g}` : "",
      a.value ? `=${t.colValue}|${a.value}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  const keys = sections.map((section) => section.g || "\u0000");
  const action = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
    pressed?: boolean,
  ) => (
    <Button
      variant="ghost"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="aim-ribbon-button"
    >
      {icon}
    </Button>
  );
  const openAttributeForm = () => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    setEditing(null);
    setNewGroup(null);
    setAdding(!adding);
  };
  const openGroupForm = () => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    setAdding(false);
    setEditing(null);
    setNewGroup(newGroup === null ? "" : null);
    setNewGCat(isCatView ? view : GENERAL);
    setNewColor(GROUP_COLORS[groupNames.length % GROUP_COLORS.length] ?? GROUP_COLORS[0] ?? "");
  };
  const openLayoutAdd = (kind: "category" | "group" | "attribute") => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    if (!organized) {
      setSaveNotice("Importez une présentation organisée avant de modifier sa configuration.");
      return;
    }
    if (!activeConfiguration || layoutBusy) return;
    const category = activeConfiguration.categories.find(cat => cat.id === layoutView);
    if (kind !== "category" && !category) return;
    if (kind === "attribute") {
      setLayoutCategory(category?.id ?? "");
      setLayoutAttribute("");
      setOrganizedAdd(kind);
      return;
    }
    const next = structuredClone(activeConfiguration);
    const id = crypto.randomUUID();
    if (kind === "category") {
      const name = uniquePresentationName("Nouvelle catégorie", next.categories.map(cat => cat.name));
      if (next.version === 2) next.categories.push({ id, position: next.categories.length + 1, name, icon: "", children: [] });
      else next.categories.push({ id, position: next.categories.length + 1, name, icon: "", groups: [] });
      setLayoutView(id);
    } else {
      const title = uniquePresentationName("Nouveau groupe", configurationGroups(next).map(group => group.title));
      if (next.version === 2) {
        const target = next.categories.find(cat => cat.id === layoutView);
        if (!target) return;
        target.children.push({ kind: "group", id, position: target.children.length + 1, title, backgroundColor: GROUP_COLORS[0] ?? "", expanded: true, rows: [] });
      } else {
        const target = next.categories.find(cat => cat.id === layoutView);
        if (!target) return;
        target.groups.push({ id, position: target.groups.length + 1, title, backgroundColor: GROUP_COLORS[0] ?? "", expanded: true, rows: [] });
      }
    }
    setLayoutRename({ kind, id });
    changeConfiguration(next);
  };
  const addLayoutContainer = () => {
    if (searchActive) { setSaveNotice(searchAddReason); return; }
    if (organizedAdd === "attribute") {
      if (layoutAttribute && layoutCategory) {
        addOrganizedOccurrence(layoutAttribute, layoutCategory);
        setOrganizedAdd(null);
      }
      return;
    }
    if (!activeConfiguration || !layoutName.trim()) return;
    const id = crypto.randomUUID();
    if (activeConfiguration.version === 2) {
      const next = structuredClone(activeConfiguration);
      if (organizedAdd === "category")
        next.categories.push({
          id,
          position: next.categories.length + 1,
          name: layoutName.trim(),
          icon: "",
          children: [],
        });
      else {
        const cat = next.categories.find((x) => x.id === layoutCategory);
        if (!cat) return;
        cat.children.push({
          kind: "group",
          id,
          position: cat.children.length + 1,
          title: layoutName.trim(),
          backgroundColor: GROUP_COLORS[0] ?? "#FFFFFF",
          expanded: true,
          rows: [],
        });
      }
      changeConfiguration(next);
      setOrganizedAdd(null);
      return;
    }
    changeConfiguration(
      organizedAdd === "category"
        ? {
            ...activeConfiguration,
            categories: [
              ...activeConfiguration.categories,
              {
                id,
                position: activeConfiguration.categories.length + 1,
                name: layoutName.trim(),
                icon: "",
                groups: [],
              },
            ],
          }
        : {
            ...activeConfiguration,
            categories: activeConfiguration.categories.map((c) =>
              c.id === layoutCategory
                ? {
                    ...c,
                    groups: [
                      ...c.groups,
                      {
                        id,
                        position: c.groups.length + 1,
                        title: layoutName.trim(),
                        backgroundColor: c.groups[0]?.backgroundColor ?? GROUP_COLORS[0] ?? "",
                        expanded: true,
                        rows: [],
                      },
                    ],
                  }
                : c,
            ),
          },
    );
    setOrganizedAdd(null);
  };
  const nativeImportDisabled = !presentationCap
    ? PRESENTATION_UNAVAILABLE
    : saveFrozen || workBusy || selecting ||
        importOpen ||
        updating || exporting ||
        organizedStatus === "loading" ||
        projectStatus === "loading"
      ? "Une opération est en cours."
      : undefined;
  const importDisabled = limitedHost || organized ? nativeImportDisabled : undefined;
  const openNativeImport = () => {
    if (!saveLocked.current && !savePreparing.current && !nativeImportDisabled && !selectionBusy.current && !exportBusy.current) setImportOpen(true);
  };
  const openImport = () => {
    if (limitedHost || organized) openNativeImport();
    else document.getElementById("import-json")?.click();
  };
  const projectSummary = selecting
    ? projectText(lang, "selecting")
    : [projectText(lang, projectStatus), projectName, selectNotice].filter(Boolean).join(" · ");
  const footerStatus =
    hostError ||
    (saveNotice === "Importez une présentation organisée avant de modifier sa configuration." ? "" : saveNotice) ||
    limitedNotice ||
    (contract.recognized ? projectSummary : hostStateText(lang, hostState));
  const technicalDetails = [
    selectDetails,
    aimSnapshot
      ? JSON.stringify(
          {
            installation: aimSnapshot.installation,
            definitions: aimSnapshot.definitions,
            installationCandidates: aimSnapshot.installationCandidates,
            diagnostics: aimSnapshot.diagnostics,
          },
          null,
          2,
        )
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const layoutBusy = saveFrozen || workBusy || selecting || importOpen || organizedStatus !== "ready" || updating || exporting;
  const exportDisabled = !exportCap ? EXPORT_UNAVAILABLE
    : saveFrozen || updating || exporting || selecting || workBusy || importOpen || organizedStatus !== "ready"
      ? "Une opération ou une synchronisation est en cours."
      : pendingUpdate ? "La présentation affichée n'est pas synchronisée. Réessayez la mise à jour avant l’export."
      : !organized ? "Aucune présentation active." : "";
  const saveWork = work && isWorkingStateV2(work) ? work : null;
  const saveDisabled = !saveCap ? "Enregistrement sur disque indisponible dans ce profil."
    : !workEditCap ? "Lecture seule."
    : saveFrozen || selecting || importOpen || exporting ? "Enregistrement ou opération en cours ; modifications protégées."
    : pendingUpdate ? "Présentation non synchronisée."
    : saveWork?.dirty.presentation && !presentationSaveCap ? "Enregistrement de présentation indisponible dans ce profil."
    : presentationSaveCap && saveWork?.presentation && saveWork.save.state === "idle" && !saveWork.pendingImport ? ""
    : saveWork?.projectInstallation.status === "unknown" ? "Appartenance du projet à une installation Allplan non établie : enregistrement indisponible."
    : localDraftCount > 0 ? ""
    : !saveWork || !saveWork.fileSaveAvailable || saveWork.save.state !== "idle" || saveWork.pendingImport || saveWork.save.blockedReasons.length ? `Enregistrement indisponible : ${saveWork?.save.blockedReasons.join(", ") || "état Python non enregistrable"}.` : "";
  const toolWarning = saveWork?.projectInstallation.status === "associated" && !saveWork.prjtoolsAvailable && saveWork.fileSaveAvailable ? "Outil Allplan associé indisponible : le fichier peut être enregistré, mais la mise à jour Allplan pourra échouer (résultat partiel)." : "";
  const outside = aimSnapshot
    ? outsideAttributes(activeConfiguration, aimSnapshot.attributes)
    : null;
  const addOccurrenceDisabled = searchAddReason || (!canUpdate
    ? UPDATE_UNAVAILABLE
    : pendingUpdate
      ? "Modification en attente"
      : undefined);
  const organizedGroups = activeConfiguration ? configurationGroups(activeConfiguration) : [];
  const buttons = {
    project: action(
      projectText(lang, "choose"),
      <AimActionGlyph name="project" />,
      () => void selectProject(),
      !contract.canSelect ||
        updating ||
        selecting ||
        importOpen ||
        organizedStatus === "loading" ||
        projectStatus === "loading",
    ),
    import: action(
      importDisabled || ui.importPresentation,
      <SmartCatalogIcon name="import" />,
      openImport,
      !!importDisabled,
    ),
    export: action(exportDisabled || ui.exportPresentation, <SmartCatalogIcon name="export" />, () => void exportPresentation(), !!exportDisabled),
    expand: action(
      t.expandAll,
      <SmartCatalogIcon name="expand" />,
      () => {
        if (organized && activeConfiguration)
          changeConfiguration(setLayoutExpanded(activeConfiguration, true));
        else setAllCollapsed(collapsed.filter((key) => !keys.includes(key)));
      },
      organized ? layoutBusy || !organizedGroups.length : !keys.length,
    ),
    collapse: action(
      t.collapseAll,
      <SmartCatalogIcon name="collapse" />,
      () => {
        if (organized && activeConfiguration)
          changeConfiguration(setLayoutExpanded(activeConfiguration, false));
        else setAllCollapsed([...new Set([...collapsed, ...keys])]);
      },
      organized ? layoutBusy || !organizedGroups.length : !keys.length,
    ),
    category: action(
      searchAddReason || t.catAdd,
      <SmartCatalogIcon name="folder" />,
      () => {
        if (organized || contract.recognized) openLayoutAdd("category");
        else addCat();
      },
      searchActive || !!organized && layoutBusy,
    ),
    group: action(
      searchAddReason || t.addGroup,
      <AimActionGlyph name="group" />,
      () => {
        if (organized || contract.recognized) openLayoutAdd("group");
        else openGroupForm();
      },
      searchActive || (organized || contract.recognized ? layoutBusy || !activeConfiguration?.categories.some(cat => cat.id === layoutView) : !isCatView),
    ),
    attribute: action(
      searchAddReason || t.addRow,
      <SmartCatalogIcon name="attribute" />,
      () => {
        if (organized || contract.recognized) openLayoutAdd("attribute");
        else openAttributeForm();
      },
      searchActive || (organized || contract.recognized ? layoutBusy || !activeConfiguration?.categories.some(cat => cat.id === layoutView) : !isCatView),
    ),
    columns: (
      <ColumnsMenu
        label={toolbarText(lang).columns}
        value={columns}
        onChange={changeColumns}
        options={[
          ["num", t.colNum],
          ["title", t.colTitle],
          ["input", t.colWidget],
          ["data", t.colType],
        ]}
      />
    ),
  };
  formOpenRef.current = adding || newGroup !== null || !!editRow;
  return (
    <LangContext.Provider value={t}>
      <main
        style={{ opacity: shown ? 1 : 0, transition: "opacity 150ms ease-out" }}
        className="aim-suite flex h-screen min-w-0 select-none flex-col overflow-hidden bg-background [&_input]:select-text [&_textarea]:select-text"
      >
        <nav className="menubar shrink-0">
          <div className="relative flex h-8 w-full items-center gap-1 pr-2">
            <SuiteMenu
              t={t}
              text={ui}
              onImport={openImport}
              importDisabled={importDisabled}
              onExport={exportPresentation}
              exportDisabled={exportDisabled}
              onSave={() => void save()}
              saveDisabled={saveDisabled}
              onQuit={() => void cancel()}
              onAbout={() => setAboutOpen(true)}
              onBackups={() => {
                if (!organized && !contract.recognized) setBackupsOpen(true);
                else
                  setSaveNotice(
                    "Sauvegardes des valeurs projet indisponibles en lecture seule. Utilisez l’export de présentation.",
                  );
              }}
            />
            <Button
              variant="ghost"
              title="Project Information manager"
              aria-label="Gestionnaire de projets"
              aria-pressed={managerOpen}
              disabled={!managerCap || selecting || importOpen || updating || exporting}
              onClick={() => setManagerOpen((v) => !v)}
              className="suite-chrome-button h-7 w-7 p-0"
            >
              <LibraryBig strokeWidth={2.25} />
            </Button>
            <Button
              variant="ghost"
              title={saveDisabled || toolWarning || t.save}
              aria-label={t.save}
              disabled={!!saveDisabled}
              onClick={() => void save()}
              className="suite-chrome-button h-7 w-7 p-0"
            >
              <Save strokeWidth={2.25} />
            </Button>
            <Button
              variant="ghost"
              title={ui.undo}
              aria-label={ui.undo}
              disabled={organized ? !canUpdate || layoutBusy || !!pendingUpdate || !presentationHistoryCounts.undo : !historyCounts.undo}
              onClick={() => travel("undo")}
              className="suite-chrome-button h-7 w-7 p-0"
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              title={ui.redo}
              aria-label={ui.redo}
              disabled={organized ? !canUpdate || layoutBusy || !!pendingUpdate || !presentationHistoryCounts.redo : !historyCounts.redo}
              onClick={() => travel("redo")}
              className="suite-chrome-button h-7 w-7 p-0"
            >
              <Redo2 />
            </Button>
            <span className="min-w-0 flex-1 truncate px-3 text-center text-xs font-semibold text-foreground">
              Allplan information Manager
            </span>
            <SuiteLanguageMenu lang={lang} onChange={setLang} title={t.language} />
            <ThemeMenu lang={lang} />
          </div>
        </nav>
        <div className="aim-workspace flex min-h-0 w-full flex-1 flex-col">
          <AppTooltips />
          <AimMessageDialog closePrompt={closePrompt} />
          {!exportCap && <p className="px-3 py-1 text-xs text-muted-foreground">{EXPORT_UNAVAILABLE}</p>}
          {!managerOpen && <AimActionBar
            lang={lang}
            text={ui}
            buttons={buttons}
            query={q}
            onQuery={setQ}
            options={searchOptions}
            onOptions={setSearchOptions}
            placeholder={t.search}
          />}
          {managerOpen && (
            <ProjectManager
              activePath={aimSnapshot?.project?.path ?? null}
              lang={lang}
              onOpen={openManagerProject}
              onClose={() => setManagerOpen(false)}
              blocked={selecting || updating || importOpen}
            />
          )}
          <div
            hidden={managerOpen}
            className={managerOpen ? "hidden" : "relative flex min-h-0 flex-1 flex-col p-2"}
          >
            {organized && (
              <div className="absolute inset-2 z-20 flex bg-background">
                {organizedStatus === "ready" &&
                  organized.configuration.version === 2 &&
                  organized.model.version === 2 && (
                    <TreePresentationView
                      view={layoutView} onViewChange={setLayoutView} renameRequest={layoutRename} onRenameStarted={() => setLayoutRename(null)}
                      {...(workCap ? { renderValue: renderWorkingValue } : {})}
                      attributes={aimSnapshot?.attributes ?? []}
                      presentation={organized as TreePresentation}
                      columns={columns}
                      onConfigurationChange={changeConfiguration}
                      query={q}
                      searchOptions={searchOptions}
                      busy={layoutBusy || iconSelectBusy || !!pendingUpdate || !canUpdate}
                      {...(iconSelectCap ? { onPickIcon: pickOrganizedIcon } : {})}
                      outside={outside}
                      {...(canUpdate ? { onAddOccurrence: addOrganizedOccurrence, onAddOccurrences: addOrganizedOccurrences } : {})}
                    />
                  )}
                {organizedStatus === "ready" &&
                  organized.configuration.version === 1 &&
                  organized.model.version === 1 && (
                    <OrganizedPresentationView
                      view={layoutView} onViewChange={setLayoutView} renameRequest={layoutRename} onRenameStarted={() => setLayoutRename(null)}
                      {...(workCap ? { renderValue: renderWorkingValue } : {})}
                      attributes={aimSnapshot?.attributes ?? []}
                      key={organized.model.configurationId}
                      presentation={
                        organized as import("./lib/aim-presentation-contract").Presentation
                      }
                      configuration={
                        activeConfiguration?.version === 1
                          ? activeConfiguration
                          : organized.configuration
                      }
                      onConfigurationChange={changeConfiguration}
                      columns={columns}
                      lang={lang}
                      query={q}
                      searchOptions={searchOptions}
                      technicalDetails={technicalDetails}
                      footerDetails
                      busy={layoutBusy || iconSelectBusy || (canUpdate && !!pendingUpdate)}
                      {...(iconSelectCap ? { onPickIcon: pickOrganizedIcon } : {})}
                      outside={outside}
                      onAddOccurrence={addOrganizedOccurrence}
                      onAddOccurrences={addOrganizedOccurrences}
                      addDisabled={addOccurrenceDisabled}
                    />
                  )}
                {pendingUpdate && (
                  <div
                    role={pendingUpdate.status === "sending" ? "status" : "alert"}
                    aria-label="presentation-update"
                    className="absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow"
                  >
                    <span>
                      {pendingUpdate.status === "sending"
                        ? "Mise à jour de la présentation…"
                        : `Modification non appliquée : ${pendingUpdate.message}`}
                    </span>
                    {pendingUpdate.status !== "sending" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={organizedStatus !== "ready"}
                          onClick={() => void submitConfiguration(pendingUpdate.configuration)}
                        >
                          Réessayer
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPendingUpdate(null)}>
                          Abandonner
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {organizedStatus === "loading" && (
                  <p role="status" className="m-auto text-xs">
                    Récupération de la présentation organisée du projet…
                  </p>
                )}
                {organizedStatus === "error" && (
                  <div role="alert" className="m-auto max-w-md space-y-2 text-center text-xs">
                    <p className="font-semibold text-destructive">
                      Impossible de récupérer la présentation organisée pour ce projet.
                    </p>
                    <p>
                      Les valeurs de l'ancien projet sont masquées. La configuration importée reste
                      en mémoire.
                    </p>
                    <Button
                      size="sm"
                      disabled={selecting || importOpen}
                      onClick={() => void refreshOrganized()}
                    >
                      Réessayer
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div
              hidden={!!organized}
              aria-hidden={!!organized}
              inert={!!organized}
              className={organized ? "hidden" : "flex min-h-0 flex-1 gap-3"}
            >
              <div className="relative w-72 shrink-0">
                <aside className="suite-category-panel absolute inset-0 overflow-hidden rounded-sm border border-border bg-panel">
                  <div className="flex h-full flex-col gap-1">
                    <p
                      style={{ height: theadH || undefined }}
                      className="flex shrink-0 items-center rounded-t-lg bg-muted px-4 py-3 text-xs font-bold text-foreground"
                    >
                      {t.categories}
                    </p>
                    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 pt-1">
                      {[
                        { id: "all", name: t.catAll },
                        ...cats.filter(
                          (c) =>
                            c.id !== GENERAL ||
                            view === GENERAL ||
                            dragNum !== null ||
                            dragGroup !== null ||
                            catCountOf(GENERAL) > 0 ||
                            groupNames.some((g) => validCat(groupCat[g]) === GENERAL),
                        ),
                        { id: "unlisted", name: t.unlistedBtn },
                      ].map((c) => {
                        const fixed = c.id === "all" || c.id === "unlisted";
                        const active = view === c.id;
                        const count =
                          c.id === "all"
                            ? (contract.recognized ? aimSnapshot?.attributes.length ?? null : rows.length)
                            : c.id === "unlisted"
                              ? (contract.recognized ? outside?.length ?? null : unlisted.length)
                              : catCountOf(c.id);
                        const src = !fixed && (c as Cat).icon ? icons[(c as Cat).icon!] : undefined;
                        const I =
                          c.id === "all" ? LayoutGrid : c.id === "unlisted" ? Inbox : Folder;
                        return (
                          <div
                            key={c.id}
                            {...(dragCat
                              ? c.id !== "all"
                                ? catReorder(c.id)
                                : {}
                              : c.id !== "all"
                                ? catDrop(c.id)
                                : {})}
                            draggable={!fixed && editingCat !== c.id}
                            onDragStart={(e) => {
                              e.stopPropagation();
                              setDragCat(c.id);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", c.id);
                            }}
                            onDragEnd={() => {
                              setDragCat(null);
                              setDropCatAt(null);
                            }}
                            style={
                              dragCat && dropCatAt === c.id && dragCat !== c.id
                                ? { boxShadow: "inset 0 3px 0 var(--primary)" }
                                : undefined
                            }
                            onClick={() => {
                              setView(c.id);
                              setSelectedRow(null);
                              setSelectedGroup(null);
                            }}
                            onDoubleClick={() => {
                              if (!fixed) setEditingCat(c.id);
                            }}
                            className={`group/cat flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${c.id === "unlisted" ? "mt-1 border-t border-border pt-2" : ""} ${dragCat === c.id ? "opacity-40" : ""} ${dropCat === c.id ? "bg-accent ring-2 ring-primary" : active ? "bg-selection text-foreground catalog-selected-row" : "text-foreground hover:bg-accent"}`}
                          >
                            {src ? (
                              <img
                                src={src}
                                alt=""
                                className="size-5 shrink-0 rounded object-contain"
                              />
                            ) : (
                              <I
                                className={`size-4 shrink-0 ${active ? "" : "text-muted-foreground"}`}
                              />
                            )}
                            {editingCat === c.id ? (
                              <input
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                defaultValue={catName(c as Cat)}
                                maxLength={60}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => {
                                  renameCat(c.id, e.target.value);
                                  setEditingCat(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  if (e.key === "Escape") {
                                    (e.target as HTMLInputElement).value = catName(c as Cat);
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="h-6 min-w-0 flex-1 rounded bg-card px-1 text-sm text-foreground outline-none ring-1 ring-ring"
                              />
                            ) : (
                              <span className="min-w-0 flex-1 truncate">
                                {fixed ? c.name : catName(c as Cat)}
                              </span>
                            )}
                            <span className="aim-category-actions relative flex h-7 w-[76px] shrink-0 items-center justify-end">
                              {!fixed && editingCat !== c.id && (
                                <span className="absolute inset-0 flex items-center justify-end gap-0.5 opacity-0 pointer-events-none group-hover/cat:opacity-100 group-hover/cat:pointer-events-auto group-focus-within/cat:opacity-100 group-focus-within/cat:pointer-events-auto">
                                  <Button
                                    variant="native"
                                    size="native"
                                    type="button"
                                    title={t.catIconTip}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      pickIcon(c.id);
                                    }}
                                    className="suite-chrome-button flex size-6 items-center justify-center p-0"
                                  >
                                    <ImagePlus className="size-4" />
                                  </Button>
                                  <Button
                                    variant="native"
                                    size="native"
                                    type="button"
                                    title={t.renameTip}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingCat(c.id);
                                    }}
                                    className="suite-chrome-button flex size-6 items-center justify-center p-0"
                                  >
                                    <Pencil className="size-3" />
                                  </Button>
                                  {c.id !== GENERAL && (
                                    <Button
                                      variant="native"
                                      size="native"
                                      type="button"
                                      title={t.catDeleteTip}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteCat(c.id);
                                      }}
                                      className="suite-chrome-button flex size-6 items-center justify-center p-0 hover:text-destructive"
                                    >
                                      <Trash2 className="size-3" />
                                    </Button>
                                  )}
                                </span>
                              )}
                              <span
                                className={`font-mono text-[11px] tabular-nums ${active ? "opacity-90" : "text-muted-foreground"} ${!fixed && editingCat !== c.id ? "group-hover/cat:opacity-0 group-focus-within/cat:opacity-0" : ""}`}
                              >
                                {selecting || hostState.phase === "loading" ? "…" : count ?? "—"}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <input
                    id="cat-icon-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      const id = iconFor;
                      e.target.value = "";
                      if (!f || !id) return;
                      const rd = new FileReader();
                      rd.onload = () => setCatIcon(id, f.name, String(rd.result));
                      rd.readAsDataURL(f);
                    }}
                  />
                </aside>
              </div>
              <div ref={contentRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
                {adding && (
                  <AttrForm
                    key="add"
                    addDisabled={searchAddReason}
                    heading={t.newRow}
                    groups={groupNames}
                    used={rows.map((r) => r.num)}
                    cats={catOpts}
                    groupCat={groupCat}
                    defaultCat={isCatView ? view : GENERAL}
                    onSubmit={(a, c) => {
                      if (searchActive) { setSaveNotice(searchAddReason); return; }
                      add(a, c);
                      setAdding(false);
                    }}
                    onCancel={() => setAdding(false)}
                  />
                )}
                {newGroup !== null && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addGroup(newGroup);
                    }}
                    className="aim-edit-panel mb-2 flex shrink-0 flex-col gap-3 overflow-auto border border-border bg-card"
                  >
                    <h2 className="catalog-panel-heading flex h-7 items-center px-2 text-sm font-semibold">
                      {t.addGroup}
                    </h2>
                    <div className="flex max-w-[900px] items-center gap-2 px-3">
                      <input
                        autoFocus
                        value={newGroup}
                        maxLength={20}
                        onChange={(e) => setNewGroup(e.target.value)}
                        placeholder={t.fGroupPh}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setNewGroup(null);
                        }}
                        className="field w-full max-w-[360px]"
                      />
                    </div>
                    <div className="flex max-w-[900px] flex-wrap items-center gap-3 px-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-3">
                        {t.fColor}
                        <ColorSwatches value={newColor} onPick={(c) => setNewColor(c)} />
                      </span>
                      <div className="flex min-w-0 w-full max-w-[420px] items-center gap-2">
                        <span>{t.catShort}</span>
                        <GroupPicker
                          cats={catOpts}
                          category={newGCat}
                          label={t.catShort}
                          onChange={(cat) => setNewGCat(cat)}
                        />
                      </div>
                    </div>
                    <div className="aim-blue-band flex justify-start gap-2 px-2 py-1.5">
                      <Button
                        variant="native"
                        size="native"
                        type="submit"
                        disabled={searchActive || !newGroup.trim() || groupNames.includes(newGroup.trim())}
                        title={searchAddReason || undefined}
                        className="aim-dialog-button"
                      >
                        {t.add}
                      </Button>
                      <Button
                        variant="native"
                        size="native"
                        type="button"
                        onClick={() => setNewGroup(null)}
                        className="aim-dialog-button"
                      >
                        {t.cancel}
                      </Button>
                    </div>
                  </form>
                )}
                {editRow && (
                  <AttrForm
                    key={`edit-${editRow.num}`}
                    addDisabled={searchAddReason}
                    heading={`${t.editRow} ${String(editRow.num).padStart(3, "0")} · ${editRow.name}`}
                    initial={editRow}
                    groups={groupNames}
                    used={rows.filter((r) => r.num !== editRow.num).map((r) => r.num)}
                    cats={catOpts}
                    groupCat={groupCat}
                    defaultCat={catOf(editRow)}
                    onSubmit={(a, c) => {
                      replace(editRow.num, a, c);
                      setEditing(null);
                      focusRow(a.num);
                    }}
                    onCancel={() => {
                      const n = editRow.num;
                      setEditing(null);
                      focusRow(n);
                    }}
                  />
                )}
                {contract.recognized ? (
                  <div
                    ref={tableRef}
                    aria-label="aim-contract-attributes"
                    className="suite-table aim-initial-table min-h-[120px] flex-1 overflow-auto rounded-sm border border-border bg-panel"
                  >
                    <NativeAttributesTable
                      attributes={view === "unlisted" ? outside ?? [] : aimSnapshot?.attributes ?? []}
                      columns={columns} lang={lang}
                      {...(workCap ? { renderValue: renderWorkingValue } : {})}
                    />
                  </div>
                ) : (
                  <div
                    ref={tableRef}
                    className="suite-table min-h-[120px] flex-1 overflow-auto rounded-sm border border-border bg-panel"
                  >
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="catalog-panel-heading sticky top-0 z-10 text-left text-xs font-semibold text-foreground">
                        <tr>
                          {showNum && (
                            <SortTh k="num" sort={sort} onSort={toggleSort} className="w-16">
                              {t.colNum}
                            </SortTh>
                          )}
                          {showTitle && (
                            <SortTh k="title" sort={sort} onSort={toggleSort}>
                              {t.colTitle}
                            </SortTh>
                          )}
                          <SortTh k="value" sort={sort} onSort={toggleSort}>
                            {t.colValue}
                          </SortTh>
                          {showInput && (
                            <SortTh k="widget" sort={sort} onSort={toggleSort} className="w-16">
                              {t.colWidget}
                            </SortTh>
                          )}
                          {showData && (
                            <SortTh k="type" sort={sort} onSort={toggleSort} className="w-16">
                              {t.colType}
                            </SortTh>
                          )}
                          <th className="w-0 p-0" />
                        </tr>
                      </thead>
                      <tbody>
                        {sections.map(({ g, items }) => {
                          const color = colorOf(g);
                          const closed = collapsed.includes(g || "\u0000");
                          return [
                            viewGroups.length > 0 && (
                              <tr
                                key={`g-${g}`}
                                onClick={() => {
                                  setSelectedGroup(g || null);
                                  setSelectedRow(null);
                                }}
                                {...dropProps(g)}
                                onDoubleClick={(e) => {
                                  if (
                                    (e.target as HTMLElement).closest(
                                      "input,button,select,textarea",
                                    )
                                  )
                                    return;
                                  window.getSelection()?.removeAllRanges();
                                  toggleCollapse(g || "\u0000");
                                }}
                                draggable={!!g && editingGroup !== g}
                                onDragStart={(e) => {
                                  if ((e.target as HTMLElement).tagName === "INPUT") {
                                    e.preventDefault();
                                    return;
                                  }
                                  setDragGroup(g);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", g);
                                }}
                                onDragEnd={endDrag}
                                className={`border-t border-border ${manual && g ? "cursor-grab active:cursor-grabbing" : ""} ${dragGroup === g ? "opacity-40" : ""} ${dropG === g || dropGroupAt === g ? "bg-accent" : color ? "" : "bg-muted/60"}`}
                                style={
                                  dropGroupAt === g && dragGroup !== g
                                    ? { boxShadow: "inset 0 3px 0 var(--primary)" }
                                    : color && dropG !== g
                                      ? {
                                          backgroundColor: `color-mix(in srgb, ${color} 16%, var(--card))`,
                                        }
                                      : undefined
                                }
                              >
                                <td
                                  colSpan={cols}
                                  className="px-2 py-1.5"
                                  style={
                                    color ? { boxShadow: `inset 6px 0 0 ${color}` } : undefined
                                  }
                                >
                                  <div className="aim-group-heading grid grid-cols-[minmax(140px,1fr)_minmax(0,2fr)_minmax(140px,1fr)] items-center gap-2">
                                    <div className="flex items-center gap-1 pl-1">
                                      <Button
                                        variant="native"
                                        size="native"
                                        type="button"
                                        onClick={() => toggleCollapse(g || "\u0000")}
                                        title={t.collapseTip}
                                        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground"
                                      >
                                        {closed ? (
                                          <ChevronRight className="size-4" />
                                        ) : (
                                          <ChevronDown className="size-4" />
                                        )}
                                      </Button>
                                    </div>
                                    {g ? (
                                      editingGroup === g ? (
                                        <input
                                          key={g}
                                          autoFocus
                                          onFocus={(e) => e.target.select()}
                                          draggable={false}
                                          onDragStart={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                          }}
                                          defaultValue={g}
                                          title={t.renameTip}
                                          maxLength={20}
                                          onBlur={(e) => {
                                            renameGroup(g, e.target.value);
                                            setEditingGroup(null);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                              (e.target as HTMLInputElement).blur();
                                            if (e.key === "Escape") {
                                              (e.target as HTMLInputElement).value = g;
                                              (e.target as HTMLInputElement).blur();
                                            }
                                          }}
                                          style={{
                                            width: `${Math.max(8, g.length * 1.25 + 3)}ch`,
                                            ...(color
                                              ? {
                                                  color: `color-mix(in srgb, ${color} 70%, var(--foreground))`,
                                                }
                                              : {}),
                                          }}
                                          className="max-w-full justify-self-center rounded bg-transparent px-2 py-0.5 text-center text-sm font-bold uppercase tracking-wider text-foreground outline-none hover:bg-card/70 focus:bg-card focus:ring-1 focus:ring-ring"
                                        />
                                      ) : (
                                        <span
                                          onDoubleClick={() => setEditingGroup(g)}
                                          style={
                                            color
                                              ? {
                                                  color: `color-mix(in srgb, ${color} 70%, var(--foreground))`,
                                                }
                                              : undefined
                                          }
                                          className="min-w-0 w-full truncate px-2 py-0.5 text-center text-sm font-bold uppercase tracking-wider text-foreground"
                                        >
                                          {g}
                                        </span>
                                      )
                                    ) : (
                                      <span className="px-2 text-center text-sm font-semibold uppercase tracking-wider italic text-muted-foreground">
                                        {t.noGroup}
                                      </span>
                                    )}
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="mr-2 text-[11px] tabular-nums text-muted-foreground">
                                        {items.length}
                                      </span>
                                      {color && (
                                        <AimGroupColorMenu value={color} label={`${t.colorTip} ${g}`} lang={lang} onPick={selected => pickColor(g, selected)} />
                                      )}

                                      {g && showTools && (
                                        <span className="relative">
                                          <Button
                                            variant="native"
                                            size="native"
                                            type="button"
                                            onClick={() => setMoveMenu(moveMenu === g ? null : g)}
                                            title={t.moveToTip}
                                            aria-label={t.moveToTip}
                                            className={`flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-primary ${moveMenu === g ? "bg-card text-primary opacity-100" : "opacity-60 hover:opacity-100"}`}
                                          >
                                            <FolderInput className="size-3.5" />
                                          </Button>
                                          {moveMenu === g && (
                                            <>
                                              <span
                                                className="fixed inset-0 z-30"
                                                onClick={() => setMoveMenu(null)}
                                              />
                                              <span
                                                ref={placePop}
                                                className="absolute right-0 top-full z-40 mt-1 flex w-56 flex-col rounded-lg border border-border bg-popover p-1 text-left normal-case tracking-normal text-popover-foreground shadow-lg"
                                              >
                                                <span className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                  {t.moveTo}
                                                </span>
                                                {catOpts.map((c) => {
                                                  const cur =
                                                    (groupCat[g] &&
                                                    catOpts.some((x) => x.id === groupCat[g])
                                                      ? groupCat[g]
                                                      : GENERAL) === c.id;
                                                  return (
                                                    <Button
                                                      variant="native"
                                                      size="native"
                                                      key={c.id}
                                                      type="button"
                                                      disabled={cur}
                                                      onClick={() => moveGroupToCat(g, c.id)}
                                                      className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${cur ? "font-semibold text-primary" : "hover:bg-accent"}`}
                                                    >
                                                      <Folder className="size-3.5 shrink-0" />
                                                      <span className="min-w-0 flex-1 truncate">
                                                        {c.name}
                                                      </span>
                                                      {cur && <Check className="size-3.5" />}
                                                    </Button>
                                                  );
                                                })}
                                                <span className="my-1 border-t border-border" />
                                                <MenuNew
                                                  label={t.mNewCat}
                                                  disabledReason={searchAddReason}
                                                  onCreate={(n) => { const id = createCat(n); if (id) moveGroupToCat(g, id); }}
                                                />
                                              </span>
                                            </>
                                          )}
                                        </span>
                                      )}
                                      {g && showTools && (
                                        <Button
                                          variant="native"
                                          size="native"
                                          type="button"
                                          onClick={() => setEditingGroup(g)}
                                          title={t.renameTip}
                                          className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-card hover:text-primary hover:opacity-100"
                                        >
                                          <Pencil className="size-3.5" />
                                        </Button>
                                      )}
                                      {g && showTools && (
                                        <Button
                                          variant="native"
                                          size="native"
                                          type="button"
                                          onClick={() => deleteGroup(g)}
                                          title={t.deleteGroupTip}
                                          className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-card hover:text-destructive hover:opacity-100"
                                        >
                                          <Trash2 className="size-3.5" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ),
                            !closed && g && items.length === 0 && (
                              <tr
                                key={`e-${g}`}
                                {...dropProps(g)}
                                className={`border-t border-dashed border-border ${dropG === g ? "bg-accent/40" : ""}`}
                              >
                                <td
                                  colSpan={cols}
                                  className="px-4 py-3 text-center text-xs italic text-muted-foreground"
                                  style={
                                    color ? { boxShadow: `inset 4px 0 0 ${color}` } : undefined
                                  }
                                >
                                  {t.emptyGroup}
                                </td>
                              </tr>
                            ),
                            ...(closed
                              ? []
                              : items.map((a) => {
                                  const i = ++rowIdx;
                                  const err = validate(a);
                                  const WI = WIDGET_ICONS[a.widget];
                                  const TI =
                                    a.widget === "checkbox" ? IntGlyph : TYPE_ICONS[a.type];
                                  return (
                                    <tr
                                      key={a.num}
                                      data-num={a.num}
                                      aria-selected={selectedRow === a.num}
                                      data-tip={rowTip(a, g)}
                                      onFocus={() => {
                                        setSelectedRow(a.num);
                                        setSelectedGroup(null);
                                      }}
                                      onClick={() => {
                                        setSelectedRow(a.num);
                                        setSelectedGroup(null);
                                      }}
                                      {...dropProps(g, a.num)}
                                      style={
                                        dropAt?.num === a.num
                                          ? {
                                              boxShadow: `inset 0 ${dropAt.after ? "-3px" : "3px"} 0 var(--primary)`,
                                            }
                                          : undefined
                                      }
                                      className={`relative border-t border-border transition-colors ${selectedRow === a.num ? "aim-row-selected" : "hover:bg-accent/50"} ${editing === a.num ? "bg-accent/60" : ""} ${dragNum === a.num ? "opacity-40" : ""} ${dropG === g && dragNum !== null && !manual ? "bg-accent/40" : ""}`}
                                    >
                                      {showNum && (
                                        <td
                                          draggable={canDrag}
                                          onDragStart={(e) => {
                                            setDragNum(a.num);
                                            e.dataTransfer.effectAllowed = "move";
                                            e.dataTransfer.setData("text/plain", String(a.num));
                                          }}
                                          onDragEnd={endDrag}
                                          title={
                                            canDrag
                                              ? manual
                                                ? t.dragManualTip
                                                : t.dragTip
                                              : undefined
                                          }
                                          className={`group/drag ${viewGroups.length > 0 ? "pl-9 pr-4" : "px-4"} py-2 font-mono text-muted-foreground ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
                                          style={
                                            color
                                              ? { boxShadow: `inset 4px 0 0 ${color}` }
                                              : undefined
                                          }
                                        >
                                          <span className="inline-flex items-center gap-1">
                                            {canDrag && (
                                              <GripVertical className="-ml-3 size-3.5 opacity-0 transition-opacity group-hover/drag:opacity-60" />
                                            )}
                                            {String(a.num).padStart(3, "0")}
                                          </span>
                                        </td>
                                      )}
                                      {showTitle && (
                                        <td className="px-2 py-1.5">
                                          <input
                                            data-row={i}
                                            data-col="title"
                                            onKeyDown={onKey}
                                            value={a.title}
                                            maxLength={120}
                                            onChange={(e) =>
                                              update(a.num, { title: e.target.value })
                                            }
                                            className="cell"
                                          />
                                        </td>
                                      )}
                                      <td className="py-1.5 pl-2 pr-1">
                                        <div className="flex items-center gap-1">
                                          <div className="min-w-0 flex-1">
                                            <ValueEditor
                                              a={a}
                                              row={i}
                                              onKey={onKey}
                                              err={err}
                                              onChange={(v) => update(a.num, { value: v })}
                                            />
                                          </div>
                                          <ResetBtn
                                            a={a}
                                            onReset={() => update(a.num, { value: "" })}
                                          />
                                        </div>
                                        {err && (
                                          <p className="mt-0.5 px-2 text-[11px] text-destructive">
                                            {t[err]}
                                          </p>
                                        )}
                                      </td>
                                      {showInput && (
                                        <td className="px-4 py-2">
                                          <span className="type-icon" title={t[WIDGETS[a.widget]]}>
                                            <WI className="size-4" />
                                          </span>
                                        </td>
                                      )}
                                      {showData && (
                                        <td className="px-4 py-2">
                                          {TI ? (
                                            <span
                                              className="type-icon"
                                              title={
                                                t[TYPES[a.widget === "checkbox" ? "INT" : a.type]]
                                              }
                                            >
                                              <TI className="size-5" />
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground" title={t.none}>
                                              —
                                            </span>
                                          )}
                                        </td>
                                      )}
                                      <td className="w-0 p-0">
                                        <div
                                          className="aim-row-actions"
                                          data-open={
                                            confirmDel === a.num ||
                                            moveMenu === `#${a.num}` ||
                                            undefined
                                          }
                                        >
                                          {confirmDel === a.num ? (
                                            <span className="flex justify-end gap-1">
                                              <Button
                                                variant="native"
                                                size="native"
                                                onClick={() => remove(a.num)}
                                                className="btn-danger"
                                              >
                                                {t.delete}
                                              </Button>
                                              <Button
                                                variant="native"
                                                size="native"
                                                onClick={() => setConfirmDel(null)}
                                                className="btn-ghost"
                                              >
                                                {t.cancel}
                                              </Button>
                                            </span>
                                          ) : (
                                            <span className="flex items-center justify-end gap-1">
                                              <span className="relative">
                                                <Button
                                                  variant="native"
                                                  size="native"
                                                  type="button"
                                                  onClick={() =>
                                                    setMoveMenu(
                                                      moveMenu === `#${a.num}` ? null : `#${a.num}`,
                                                    )
                                                  }
                                                  title={t.moveToRowTip}
                                                  aria-label={t.moveToRowTip}
                                                  className={`flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary ${moveMenu === `#${a.num}` ? "bg-accent text-primary opacity-100" : "opacity-60 hover:opacity-100"}`}
                                                >
                                                  <FolderInput className="size-3.5" />
                                                </Button>
                                                {moveMenu === `#${a.num}` && (
                                                  <>
                                                    <span
                                                      className="fixed inset-0 z-30"
                                                      onClick={() => setMoveMenu(null)}
                                                    />
                                                    <span
                                                      ref={placePop}
                                                      className="absolute right-0 top-full z-40 mt-1 flex w-64 flex-col rounded-lg border border-border bg-popover p-1 text-left text-popover-foreground shadow-lg"
                                                    >
                                                      <span className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                        {t.moveTo} · {t.mGroups}
                                                      </span>
                                                      <span className="flex max-h-48 flex-col overflow-y-auto">
                                                        {(() => {
                                                          const rc = a.group
                                                            ? validCat(groupCat[a.group])
                                                            : validCat(a.cat);
                                                          return [
                                                            ...groupNames.map((gn) => {
                                                              const cur = a.group === gn;
                                                              const gc = groupColors[gn];
                                                              return (
                                                                <Button
                                                                  variant="native"
                                                                  size="native"
                                                                  key={gn}
                                                                  type="button"
                                                                  disabled={cur}
                                                                  onClick={() =>
                                                                    rowToGroup(a.num, gn, false, rc)
                                                                  }
                                                                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${cur ? "font-semibold text-primary" : "hover:bg-accent"}`}
                                                                >
                                                                  <Layers
                                                                    className="size-3.5 shrink-0"
                                                                    style={
                                                                      gc ? { color: gc } : undefined
                                                                    }
                                                                  />
                                                                  <span className="min-w-0 flex-1 truncate">
                                                                    {gn}
                                                                  </span>
                                                                  <span className="max-w-[40%] truncate text-[11px] text-muted-foreground">
                                                                    {
                                                                      catOpts.find(
                                                                        (c) =>
                                                                          c.id ===
                                                                          validCat(groupCat[gn]),
                                                                      )?.name
                                                                    }
                                                                  </span>
                                                                  {cur && (
                                                                    <Check className="size-3.5" />
                                                                  )}
                                                                </Button>
                                                              );
                                                            }),
                                                            <Button
                                                              variant="native"
                                                              size="native"
                                                              key="__none"
                                                              type="button"
                                                              disabled={!a.group}
                                                              onClick={() =>
                                                                rowToGroup(a.num, "", false, rc)
                                                              }
                                                              className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm italic ${!a.group ? "font-semibold text-primary" : "hover:bg-accent"}`}
                                                            >
                                                              <Layers className="size-3.5 shrink-0 opacity-40" />
                                                              <span className="min-w-0 flex-1 truncate">
                                                                {t.noGroup}
                                                              </span>
                                                              {!a.group && (
                                                                <Check className="size-3.5" />
                                                              )}
                                                            </Button>,
                                                            <MenuNew
                                                              key="__new"
                                                              label={t.mNewGroup}
                                                              disabledReason={searchAddReason}
                                                              max={20}
                                                              onCreate={(n) =>
                                                                rowToGroup(
                                                                  a.num,
                                                                  n,
                                                                  !groupNames.includes(n),
                                                                  rc,
                                                                )
                                                              }
                                                            />,
                                                          ];
                                                        })()}
                                                      </span>
                                                      <span className="my-1 border-t border-border" />
                                                      <span className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                        {t.mCats}
                                                      </span>
                                                      {catOpts.map((c) => {
                                                        const curCat = a.group
                                                          ? validCat(groupCat[a.group])
                                                          : validCat(a.cat);
                                                        const cur = curCat === c.id;
                                                        return (
                                                          <Button
                                                            variant="native"
                                                            size="native"
                                                            key={c.id}
                                                            type="button"
                                                            disabled={cur}
                                                            onClick={() => {
                                                              commit((r) =>
                                                                r.map((x) =>
                                                                  x.num === a.num
                                                                    ? {
                                                                        ...x,
                                                                        cat:
                                                                          c.id === GENERAL
                                                                            ? undefined
                                                                            : c.id,
                                                                        group: undefined,
                                                                      }
                                                                    : x,
                                                                ),
                                                              );
                                                              setMoveMenu(null);
                                                            }}
                                                            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${cur ? "font-semibold text-primary" : "hover:bg-accent"}`}
                                                          >
                                                            <Folder className="size-3.5 shrink-0" />
                                                            <span className="min-w-0 flex-1 truncate">
                                                              {c.name}
                                                            </span>
                                                            {cur && <Check className="size-3.5" />}
                                                          </Button>
                                                        );
                                                      })}
                                                      <MenuNew
                                                        label={t.mNewCat}
                                                        disabledReason={searchAddReason}
                                                        onCreate={(n) => {
                                                          const id = createCat(n);
                                                          if (!id) return;
                                                          commit((r) =>
                                                            r.map((x) =>
                                                              x.num === a.num
                                                                ? {
                                                                    ...x,
                                                                    cat: id,
                                                                    group: undefined,
                                                                  }
                                                                : x,
                                                            ),
                                                          );
                                                          setMoveMenu(null);
                                                        }}
                                                      />
                                                    </span>
                                                  </>
                                                )}
                                              </span>
                                              <Button
                                                variant="native"
                                                size="native"
                                                type="button"
                                                onClick={() => {
                                                  setAdding(false);
                                                  setEditing(a.num);
                                                }}
                                                title={t.editTip}
                                                className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-accent hover:text-primary hover:opacity-100"
                                              >
                                                <Pencil className="size-3.5" />
                                              </Button>
                                              <Button
                                                variant="native"
                                                size="native"
                                                type="button"
                                                onClick={() => setConfirmDel(a.num)}
                                                title={t.deleteTip}
                                                className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-accent hover:text-destructive hover:opacity-100"
                                              >
                                                <Trash2 className="size-3.5" />
                                              </Button>
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })),
                          ];
                        })}
                        {view !== "unlisted" &&
                          viewFiltered.length === 0 &&
                          viewGroups.length === 0 && (
                            <tr {...dropProps("")} className={dragOut ? "bg-accent/40" : ""}>
                              <td
                                colSpan={cols}
                                className="px-4 py-10 text-center text-muted-foreground"
                              >
                                <p>{t.noAttr}</p>
                                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                                  <Button
                                    variant="native"
                                    size="native"
                                    type="button"
                                    title={t.catAdd}
                                    onClick={addCat}
                                    className="aim-dialog-button inline-flex items-center justify-center gap-2"
                                  >
                                    <SmartCatalogIcon name="folder" />
                                    {t.catShort}
                                  </Button>
                                  <Button
                                    variant="native"
                                    size="native"
                                    type="button"
                                    title={t.addGroup}
                                    onClick={openGroupForm}
                                    className="aim-dialog-button inline-flex items-center justify-center gap-2"
                                  >
                                    <AimActionGlyph name="group" />
                                    {t.fGroup}
                                  </Button>
                                  <Button
                                    variant="native"
                                    size="native"
                                    type="button"
                                    title={t.addRow}
                                    onClick={openAttributeForm}
                                    className="aim-dialog-button inline-flex items-center justify-center gap-2"
                                  >
                                    <SmartCatalogIcon name="attribute" />
                                    {t.fAttr}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )}
                        {showUnlistedHere && unlistedFiltered.length > 0 && (
                          <tr className="border-t-2 border-border bg-muted/60">
                            <td colSpan={cols} className="px-2 py-1.5">
                              <div className="grid grid-cols-[minmax(140px,1fr)_minmax(0,2fr)_minmax(140px,1fr)] items-center gap-2">
                                <span />
                                <span className="px-2 py-0.5 text-center text-sm font-bold uppercase tracking-wider text-muted-foreground">
                                  {t.unlistedHeading}
                                </span>
                                <div className="flex justify-end">
                                  <span className="w-10 rounded-full bg-card py-0.5 text-center font-mono text-[11px] text-muted-foreground">
                                    {unlistedFiltered.length}
                                  </span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {showUnlistedHere &&
                          unlistedFiltered.map((a) => {
                            const i = ++rowIdx;
                            const err = validate(a);
                            const WI = WIDGET_ICONS[a.widget];
                            const TI = TYPE_ICONS[a.type];
                            return (
                              <tr
                                key={`u-${a.num}`}
                                data-tip={rowTip(a, "")}
                                className={`relative border-t border-border transition-colors hover:bg-accent/50 ${dragNum === a.num ? "opacity-40" : ""}`}
                              >
                                {showNum && (
                                  <td
                                    draggable
                                    onDragStart={(e) => {
                                      setDragOut(true);
                                      setDragNum(a.num);
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", String(a.num));
                                    }}
                                    onDragEnd={endDrag}
                                    title={t.dragInTip}
                                    className="group/drag cursor-grab px-4 py-2 font-mono text-muted-foreground active:cursor-grabbing"
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      <GripVertical className="-ml-3 size-3.5 opacity-0 transition-opacity group-hover/drag:opacity-60" />
                                      {String(a.num).padStart(3, "0")}
                                    </span>
                                  </td>
                                )}
                                {showTitle && (
                                  <td className="px-4 py-2 text-foreground/80">{a.title}</td>
                                )}
                                <td className="py-1.5 pl-2 pr-1">
                                  <div className="flex items-center gap-1">
                                    <div className="min-w-0 flex-1">
                                      <ValueEditor
                                        a={a}
                                        row={i}
                                        onKey={onKey}
                                        err={err}
                                        onChange={(v) =>
                                          setExtraVals((x) => ({ ...x, [a.num]: v }))
                                        }
                                      />
                                    </div>
                                    <ResetBtn
                                      a={a}
                                      onReset={() => setExtraVals((x) => ({ ...x, [a.num]: "" }))}
                                    />
                                  </div>
                                  {err && (
                                    <p className="mt-0.5 px-2 text-[11px] text-destructive">
                                      {t[err]}
                                    </p>
                                  )}
                                </td>
                                {showInput && (
                                  <td className="px-4 py-2">
                                    <span className="type-icon" title={t[WIDGETS[a.widget]]}>
                                      <WI className="size-4" />
                                    </span>
                                  </td>
                                )}
                                {showData && (
                                  <td className="px-4 py-2">
                                    <span className="type-icon" title={t[TYPES[a.type]]}>
                                      <TI className="size-5" />
                                    </span>
                                  </td>
                                )}
                                <td className="w-0 p-0">
                                  <div
                                    className="aim-row-actions"
                                    data-open={promoteFor === a.num || undefined}
                                  >
                                    <div className="relative inline-block">
                                      <Button
                                        variant="native"
                                        size="native"
                                        onClick={() => {
                                          setPromoteFor(promoteFor === a.num ? null : a.num);
                                          setPromoteNew("");
                                        }}
                                        title={t.promoteTip}
                                        className="btn-icon-edit"
                                      >
                                        <Plus className="size-3.5" />
                                      </Button>
                                      {promoteFor === a.num && (
                                        <>
                                          <div
                                            className="fixed inset-0 z-40"
                                            onClick={() => setPromoteFor(null)}
                                          />
                                          <div
                                            ref={placePop}
                                            className="absolute bottom-full right-0 z-50 mb-1 w-60 rounded-md border border-border bg-popover p-1.5 text-sm shadow-lg"
                                          >
                                            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                              {t.fGroup}
                                            </p>
                                            <div className="max-h-56 overflow-auto">
                                              {groupNames.map((g) => (
                                                <Button
                                                  variant="native"
                                                  size="native"
                                                  key={g}
                                                  type="button"
                                                  onClick={() => promoteTo(a.num, g)}
                                                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent"
                                                >
                                                  <span
                                                    className="size-2.5 shrink-0 rounded-full"
                                                    style={{ background: colorOf(g) }}
                                                  />
                                                  <span className="truncate">{g}</span>
                                                </Button>
                                              ))}
                                              <Button
                                                variant="native"
                                                size="native"
                                                type="button"
                                                onClick={() => promoteTo(a.num, "")}
                                                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left italic text-muted-foreground hover:bg-accent"
                                              >
                                                {t.noGroup}
                                              </Button>
                                            </div>
                                            <form
                                              className="mt-1 flex gap-1 border-t border-border pt-1.5"
                                              onSubmit={(e) => {
                                                e.preventDefault();
                                                if (promoteNew.trim()) promoteTo(a.num, promoteNew);
                                              }}
                                            >
                                              <input
                                                autoFocus
                                                value={promoteNew}
                                                onChange={(e) => setPromoteNew(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Escape") setPromoteFor(null);
                                                }}
                                                placeholder={t.newGroupNote + "…"}
                                                className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm outline-none focus:border-primary"
                                              />
                                              <Button
                                                variant="native"
                                                size="native"
                                                type="submit"
                                                disabled={!promoteNew.trim()}
                                                className="btn-icon-edit disabled:opacity-40"
                                              >
                                                <FolderPlus className="size-3.5" />
                                              </Button>
                                            </form>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {aboutOpen && <AboutDialog lang={lang} onClose={() => setAboutOpen(false)} />}
        {backupsOpen && (
          <ProjectBackupDialog
            lang={lang}
            text={ui}
            path={projectPath}
            backups={backups}
            onClose={() => setBackupsOpen(false)}
            onCreate={createBackup}
            onRefresh={refreshBackups}
            onRestore={restoreBackup}
            onImport={persistBackup}
          />
        )}
        {importOpen && (
          <PresentationImportDialog
            working={workCap}
            onSynchronize={workCap ? async () => { await refreshWork(); } : undefined}
            applyWorking={workCap ? async (token) => {
              const reply = await transitionWork({ command: "presentation.import.apply", payload: {token} });
              if (!reply || (reply.ok && reply.status === "cancelled")) return null;
              if (!reply.ok) return reply;
              return reply && "work" in reply && reply.work.presentation ? {ok:true as const, status:"applied" as const, presentation:reply.work.presentation} : null;
            } : undefined}
            onApplied={(p) => {
              organizedSeq.current++;
              setOrganized(p);
              setLayoutDraft(null);
              setOrganizedStatus("ready");
              setSaveNotice("");
              setHostError("");
            }}
            onClose={() => setImportOpen(false)}
          />
        )}
        {organizedAdd === "attribute" && activeConfiguration && !addOccurrenceDisabled && <div className="fixed inset-0 z-50 flex items-center justify-center bg-dialog-overlay/30"><div className="aim-restored-form aim-stable-form">
          <PresentationAttributeForm heading={t.addRow} attributes={(aimSnapshot?.attributes ?? []).map(a => ({ num: Number(a.number), name: a.label }))} used={[]} groups={organizedGroups.map(g => g.id)} groupLabels={Object.fromEntries(organizedGroups.map(g => [g.id, g.title]))} cats={activeConfiguration.categories} groupCat={Object.fromEntries(activeConfiguration.categories.flatMap(cat => (activeConfiguration.version === 1 ? ("groups" in cat ? cat.groups : []) : ("children" in cat ? cat.children.filter(g => g.kind === "group") : [])).map(g => [g.id, cat.id])))} defaultCat={layoutCategory} onCancel={() => setOrganizedAdd(null)} onSubmit={(fields, category) => {
            if (searchActive || !activeConfiguration.categories.some(cat => cat.id === layoutView) || !activeConfiguration.categories.some(cat => cat.id === category)) return;
            const attribute = aimSnapshot?.attributes.find(a => a.number === String(fields.num));
            if (!attribute) return;
            const base = structuredClone(activeConfiguration);
            let target = fields.group || category;
            if ((fields.group && !organizedGroups.some(g => g.id === fields.group)) || (!fields.group && base.version === 1)) {
              const id = crypto.randomUUID();
              const group = { id, position: 1, title: fields.group || t.noGroup, backgroundColor: GROUP_COLORS[0] ?? "#FFFFFF", expanded: true, rows: [] };
              if (base.version === 2) { const cat = base.categories.find(c => c.id === category); if (!cat) return; cat.children.push({ ...group, kind: "group", position: cat.children.length + 1 }); }
              else { const cat = base.categories.find(c => c.id === category); if (!cat) return; cat.groups.push({ ...group, position: cat.groups.length + 1 }); }
              target = id;
            }
            const id = crypto.randomUUID();
            const next = addOccurrence(base, target, attribute, () => id);
            const row = next && configurationRows(next).find(r => r.id === id);
            if (!next || !row) return;
            row.title = fields.title; row.widget = fields.widget; delete row.type; delete row.options;
            if (fields.widget !== "checkbox") row.type = fields.type;
            if (fields.widget === "combo" || fields.widget === "list") row.options = fields.options ?? [];
            changeConfiguration(next); setOrganizedAdd(null);
          }} />
        </div></div>}
        {organizedAdd && (organizedAdd !== "attribute" || !!addOccurrenceDisabled) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30">
            <form
              role="dialog"
              aria-modal="true"
              aria-label={
                organizedAdd === "category"
                  ? t.catAdd
                  : organizedAdd === "group"
                    ? t.addGroup
                    : t.addRow
              }
              onSubmit={(e) => {
                e.preventDefault();
                addLayoutContainer();
              }}
              className="w-96 border border-border bg-background text-sm"
            >
              <h2 className="catalog-panel-heading px-3 py-2">
                {organizedAdd === "category"
                  ? t.catAdd
                  : organizedAdd === "group"
                    ? t.addGroup
                    : t.addRow}
              </h2>
              <div className="space-y-3 p-3">
                {organizedAdd === "attribute" ? (
                  addOccurrenceDisabled ? (
                    <p>{addOccurrenceDisabled}</p>
                  ) : (
                    <>
                      <label className="flex flex-col gap-1">
                        {t.colTitle}
                        <select
                          autoFocus
                          required
                          aria-label="Attribut"
                          value={layoutAttribute}
                          onChange={(e) => setLayoutAttribute(e.target.value)}
                          className="field"
                        >
                          <option value="" />
                          {aimSnapshot?.attributes.map((a) => (
                            <option key={a.number} value={a.number}>
                              {a.number} — {a.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        {ui.group}
                        <select
                          aria-label="Groupe"
                          value={layoutCategory}
                          onChange={(e) => setLayoutCategory(e.target.value)}
                          className="field"
                        >
                          {activeConfiguration?.version === 2 &&
                            activeConfiguration.categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name} · Sans groupe
                              </option>
                            ))}
                          {organizedGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )
                ) : (
                  <>
                    <label className="flex flex-col gap-1">
                      {ui.name}
                      <input
                        autoFocus
                        required
                        value={layoutName}
                        onChange={(e) => setLayoutName(e.target.value)}
                        className="field"
                      />
                    </label>
                    {organizedAdd === "group" && (
                      <label className="flex flex-col gap-1">
                        {ui.category}
                        <select
                          value={layoutCategory}
                          onChange={(e) => setLayoutCategory(e.target.value)}
                          className="field"
                        >
                          {activeConfiguration?.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </div>
              <div className="secondary-dialog-footer flex justify-end gap-2 p-2">
                {(organizedAdd !== "attribute" || !addOccurrenceDisabled) && (
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={
                      searchActive || (organizedAdd === "attribute"
                        ? !layoutAttribute || !layoutCategory
                        : !layoutName.trim() || (organizedAdd === "group" && !layoutCategory))
                    }
                    title={searchAddReason || undefined}
                  >
                    {t.add}
                  </Button>
                )}
                <Button variant="ghost" type="button" onClick={() => setOrganizedAdd(null)}>
                  {t.cancel}
                </Button>
              </div>
            </form>
          </div>
        )}
        <input
          id="import-json"
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            importJson(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {(hostError || saveNotice || limitedNotice || toolWarning || selectNotice || projectStatus === "read-error" || projectStatus === "config-invalid") && (
          <div role="status" aria-label="Résultat des opérations" className="shrink-0 border-t border-border bg-background px-2 py-1 text-xs text-foreground">
            <p className="whitespace-pre-wrap break-words">{[hostError, saveNotice === "Importez une présentation organisée avant de modifier sa configuration." ? "" : saveNotice, limitedNotice, selectNotice, toolWarning].filter(Boolean).join(" ") || projectSummary}</p>
          </div>
        )}
        <footer
          className={`suite-footer bg-background flex shrink-0 items-center gap-2 overflow-hidden border-t border-border px-2 py-1.5 ${contract.recognized ? "aim-native-footer" : ""}`}
        >
          {aimSnapshot &&
            (() => {
              const ds = definitionsState(aimSnapshot);
              const inst = aimSnapshot.installation;
              const defs =
                "attr" in aimSnapshot.definitions
                  ? aimSnapshot.definitions
                  : {
                      attr: "",
                      language: null,
                      source: "",
                      systemFiles: [] as string[],
                      customFiles: [] as string[],
                    };
              const details = [
                inst
                  ? `Allplan ${inst.version ?? "?"}${inst.verificationVersion ? " (verification)" : ""} · ${inst.allplanLanguage ?? "?"}`
                  : "",
                ...Object.entries(inst?.paths ?? {}).map(([k, v]) => `${k}: ${v}`),
                defs.attr ? `ATTR=${defs.attr}` : "",
                defs.language ? `lang=${defs.language}` : "",
                defs.source ? `source: ${defs.source}` : "",
                ...defs.systemFiles.map((f) => `ETC: ${f}`),
                ...defs.customFiles.map((f) => `custom: ${f}`),
                ...aimSnapshot.installationCandidates.map(
                  (c) =>
                    `candidate: Allplan ${c.version ?? "?"} ${Object.values(c.paths).join(" | ")}`,
                ),
                ...aimSnapshot.diagnostics.map(
                  (d) =>
                    `[${d.severity}] ${d.code}${d.message ? ` — ${d.message}` : ""}${d.path ? ` (${d.path}${d.line !== null ? `:${d.line}` : ""})` : ""}`,
                ),
              ]
                .filter(Boolean)
                .join("\n");
              const key =
                ds === "available"
                  ? "defsAvailable"
                  : ds === "partial"
                    ? "defsPartial"
                    : ds === "unavailable"
                      ? "defsUnavailable"
                      : "defsNotLoaded";
              return (
                <>
                  <span
                    aria-label="project-definitions"
                    data-definitions-status={ds}
                    title={details}
                    className="sr-only"
                  >
                    {inst ? `Allplan ${inst.version ?? "?"} · ` : ""}
                    {projectText(lang, key)}
                    {aimSnapshot.diagnostics.length
                      ? ` · ${aimSnapshot.diagnostics.length} ${projectText(lang, "diagnostics")}`
                      : ""}
                    {!workEditCap && aimSnapshot.readOnly ? ` · ${projectText(lang, "readOnly")}` : ""}
                  </span>
                </>
              );
            })()}
          <span
            role="status"
            aria-label="project-status"
            data-project-status={projectStatus}
            title={projectSummary}
            className="sr-only"
          >
            {projectSummary}
          </span>
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) void loadRecent();
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                title={projectPath || ui.noPath}
                aria-label={labels.project}
                className="aim-project-path h-6 min-w-0 max-w-[45%] shrink justify-start rounded-sm border-border bg-background px-2 text-xs font-normal hover:bg-selection"
              >
                <span className="truncate">
                  {labels.project} : {projectPath || ui.noPath}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="max-w-[calc(100vw-16px)] rounded-sm text-xs"
            >
              <DropdownMenuLabel className="catalog-panel-heading text-xs">
                {labels.project}
              </DropdownMenuLabel>
              {contract.history && (
                <>
                  {recent.status === "loading" && (
                    <DropdownMenuItem disabled className="text-xs">
                      Chargement des projets récents…
                    </DropdownMenuItem>
                  )}
                  {recent.status === "error" && (
                    <DropdownMenuItem disabled className="text-xs text-destructive">
                      {recent.message}
                    </DropdownMenuItem>
                  )}
                  {recent.status === "ready" && !recent.projects.length && (
                    <DropdownMenuItem disabled className="text-xs">
                      Aucun projet récent
                    </DropdownMenuItem>
                  )}
                  {recent.status === "ready" &&
                    recent.projects.map((p) => (
                      <DropdownMenuItem
                        key={p.path}
                        title={p.path}
                        disabled={selecting || updating || importOpen}
                        aria-current={p.path === projectPath || undefined}
                        onSelect={() => void selectProject(p)}
                        className={`gap-2 text-xs ${p.path === projectPath ? "font-semibold" : ""}`}
                      >
                        <span className="truncate">{p.name}</span>
                        <span className="ml-auto max-w-80 truncate pl-3 text-muted-foreground">
                          {p.path}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                className="gap-2 text-xs"
                disabled={!contract.canSelect || selecting}
                onSelect={() => void selectProject()}
              >
                <FolderOpen className="h-4 w-4 text-ribbon-dark" />
                {projectText(lang, "choose")}
              </DropdownMenuItem>
              {!contract.recognized && projectPath && (
                <>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onSelect={() => void openProject("folder")}
                  >
                    <FolderOpen className="h-4 w-4 text-ribbon-dark" />
                    {ui.openFolder}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onSelect={() => void openProject("attributes")}
                  >
                    <ExternalLink className="h-4 w-4 text-ribbon-dark" />
                    {ui.openAttributes}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <span aria-label="allplan-data" className="shrink-0 px-1 text-xs text-muted-foreground">
            Allplan Data :{" "}
            {aimSnapshot?.installation?.version ?? (definitionSource?.status === "resolved" ? definitionSource.version : "non résolu")}
          </span>
          <span className="min-w-0 flex-1" aria-hidden="true" />
          <span
            role="status"
            data-host-phase={hostState.phase}
            className="sr-only"
            title={footerStatus}
          >
            {footerStatus}
          </span>
          <div
            className={
              contract.recognized ? "hidden" : "ml-auto flex shrink-0 items-center gap-2 pl-3"
            }
          >
            <p className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium">
              <span
                className={`aim-status-dot size-1.5 shrink-0 rounded-full ${dirty ? "bg-status-modified" : "bg-success"}`}
              />
              <span>{dirty ? ui.dirty : ui.clean}</span>
            </p>
            <Button variant="outline" disabled={!!saveDisabled} title={saveDisabled || toolWarning || t.save} onClick={() => void save()} className="aim-dialog-button">
              {t.save}
            </Button>
            <Button variant="ghost" onClick={() => void cancel()} className="aim-dialog-button">
              {t.quit}
            </Button>
          </div>
          {saveFrozen && saveReference.current && !saveFollowing.current && <Button variant="ghost" onClick={() => { const request = saveReference.current; if (request) void followSave(request); }}>Consulter le suivi</Button>}
          {contract.recognized && <p role="status" aria-label="État des modifications" data-edit-state={pendingUpdate ? "configuration-pending" : workCap && work ? (dirty ? "modified" : "clean") : organized ? (organizedDirty ? "modified" : "clean") : "unknown"} className="aim-edit-state flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden="true" className={`aim-status-dot size-1.5 shrink-0 ${pendingUpdate || dirty ? "bg-status-modified" : (workCap ? !!work : !!organized) ? "bg-success" : "bg-muted-foreground"}`} />
            <span>{pendingUpdate ? (work?.dirty.values ? "Modifications en mémoire · Configuration en attente" : "Configuration en attente") : (workCap ? !!work : !!organized) ? (dirty ? "Modifications en mémoire" : "Aucune modification en attente") : "État des modifications indisponible"}</span>
          </p>}
          {contract.recognized && (
            <Button variant="ghost" disabled={selecting || updating || importOpen} onClick={() => void cancel()} className="aim-dialog-button shrink-0">
              {t.quit}
            </Button>
          )}
        </footer>
      </main>
    </LangContext.Provider>
  );
}

/** Inline value cell: local draft, Enter/blur commits a changed value once, Escape cancels without a command.
 * Presentation rows reuse their configured control; rows without configuration (Hors présentation) edit as STR text.
 * Python's work.value.set reply is adopted by the caller; nothing is applied to the Allplan project. */
function InlineWorkingValue({ row, source, disabled, registerFlush, onPending, onCommit, onInvalid }: {
  row: OutsideAttribute | DisplayRow;
  source: { value: string | null; valueState: string } | undefined;
  disabled: boolean;
  registerFlush?: (key: symbol, flush: (() => Promise<boolean>) | null) => void;
  onPending?: (key: symbol, pending: boolean) => void;
  onCommit: (number: string, value: string | null) => Promise<boolean>;
  onInvalid: (key: TKey) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<TKey | null>(null);
  const [refused, setRefused] = useState(false);
  const sending = useRef(false);
  const sendingTask = useRef<Promise<boolean> | null>(null);
  const flushKey = useRef(Symbol("value-draft"));
  const restoring = useRef(false);
  const configured = "widget" in row;
  const type: DataType = configured ? (row.type ?? "STR") : "STR";
  const widget = configured ? row.widget : "entry";
  const options = configured && "options" in row && row.options ? { options: row.options } : {};
  const label = "title" in row ? row.title : row.label;
  const name = "label" in row ? row.label : row.title;
  const send = async (value: string | null) => {
    sending.current = true;
    try {
      const accepted = await onCommit(row.number, value);
      if (accepted) { pendingRef.current?.(flushKey.current, false); setDraft(null); setErr(null); setRefused(false); }
      else setRefused(true); // draft kept, never shown as saved, no automatic retry
      return accepted;
    } finally { sending.current = false; }
  };
  const commit = async () => {
    if (sendingTask.current) return sendingTask.current;
    if (refused) return false;
    if (draft === null) return !refused;
    if (sending.current || restoring.current) return false;
    // draft !== null means the user actually edited; null (unset) and "" stay distinct.
    if (draft === row.value) { setDraft(null); setErr(null); setRefused(false); return true; }
    const error = widget === "checkbox" ? null : checkValue(type, draft);
    if (error) { setErr(error); onInvalid(error); return false; }
    const task = send(draft); sendingTask.current = task;
    try { return await task; } finally { if (sendingTask.current === task) sendingTask.current = null; }
  };
  const flushRef = useRef(commit);
  flushRef.current = commit;
  useEffect(() => {
    if (!registerFlush) return;
    const key = flushKey.current;
    registerFlush(key, () => flushRef.current());
    return () => registerFlush(key, null);
  }, [registerFlush]);
  const pending = draft !== null && draft !== row.value;
  const pendingRef = useRef(onPending);
  pendingRef.current = onPending;
  useEffect(() => { pendingRef.current?.(flushKey.current, pending); }, [pending]);
  useEffect(() => () => pendingRef.current?.(flushKey.current, false), []);
  const reset = async () => {
    restoring.current = false;
    if (disabled || sending.current || !source || source.valueState === "unavailable" || row.value === source.value) return;
    setErr(null);
    await send(source.value);
  };
  return (
    <fieldset disabled={disabled} className="min-w-0 w-full" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void commit(); }}>
      <div className="flex min-w-0 items-center">
        <div className="min-w-0 flex-1">
          <ValueEditor
            a={{ num: Number(row.number), name, title: label, widget, type, ...options, value: draft ?? row.value ?? "" }}
            row={0}
            err={err}
            label={`Modifier la valeur ${row.number}`}
            onKey={e => {
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(null); setErr(null); setRefused(false); }
              else if (e.key === "Enter") { e.preventDefault(); void commit(); }
            }}
            onChange={v => { setDraft(v); setErr(null); setRefused(false); }}
          />
        </div>
        <span className="inline-flex w-6 shrink-0 items-center justify-center" data-reset-slot>
          {source && source.valueState !== "unavailable" && row.value !== source.value && <Button
            type="button" variant="native" size="native"
            className="px-1 text-muted-foreground hover:text-foreground"
            aria-label={`Reset ${row.number}`} title="Restaurer la valeur source initiale"
            disabled={disabled}
            onPointerDown={() => { restoring.current = true; }}
            onPointerLeave={() => { restoring.current = false; }}
            onClick={() => void reset()}
          ><RotateCcw className="size-3.5" /></Button>}
        </span>

      </div>
      {refused && <div role="alert" className="px-2 text-xs text-destructive">Modification non acceptée ; non enregistrée.</div>}
    </fieldset>
  );
}

function ValueEditor({
  a,
  row,
  onKey,
  err,
  onChange,
  label,
}: {
  a: Attr;
  row: number;
  err: TKey | null;
  label?: string;
  onKey: (e: React.KeyboardEvent<HTMLElement>) => void;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const common = { "data-row": row, "data-col": "value", onKeyDown: onKey, ...(label ? { "aria-label": label } : {}) };
  const cls = `cell ${err ? "cell-error" : ""} ${["FLOAT", "INT", "DATE", "TIME", "PHONE"].includes(a.type) ? "font-mono" : ""}`;
  const typed = (v: string) => {
    if (allowTyping(a.type, v)) onChange(v);
  };
  const listId = `opts-${a.num}`;

  switch (a.widget) {
    case "checkbox":
      return (
        <label className="flex h-9 cursor-pointer items-center gap-2 px-2">
          <input
            {...common}
            type="checkbox"
            checked={["1", "true", "True", "TRUE", "oui", "yes"].includes(a.value)}
            onChange={(e) => onChange(String(e.target.checked))}
            className="size-4 accent-primary"
          />
          <span className="text-muted-foreground">{a.value === "true" ? t.yes : t.no}</span>
        </label>
      );
    case "list":
      return (
        <select
          {...common}
          value={a.value}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        >
          <option value="">—</option>
          {a.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "combo":
      return (
        <ComboCell
          common={common}
          cls={cls}
          value={a.value}
          options={a.options ?? []}
          placeholder={t.comboPh}
          onType={typed}
          onPick={onChange}
          key={listId}
        />
      );
    default:
      if (a.type === "DATE")
        return (
          <input
            {...common}
            type="date"
            value={a.value}
            onChange={(e) => onChange(e.target.value)}
            className={cls}
          />
        );
      if (a.type === "TIME")
        return (
          <input
            {...common}
            type="time"
            value={a.value}
            onChange={(e) => onChange(e.target.value)}
            className={cls}
          />
        );
      return (
        <input
          {...common}
          value={a.value}
          inputMode={
            a.type === "INT"
              ? "numeric"
              : a.type === "FLOAT"
                ? "decimal"
                : a.type === "EMAIL"
                  ? "email"
                  : a.type === "PHONE"
                    ? "tel"
                    : a.type === "URL"
                      ? "url"
                      : "text"
          }
          onChange={(e) => typed(e.target.value)}
          className={cls}
        />
      );
  }
}

function AttrForm({
  heading,
  initial,
  used,
  groups,
  cats,
  groupCat,
  defaultCat,
  onSubmit,
  onCancel,
  addDisabled = "",
}: {
  heading: string;
  initial?: Attr;
  used: number[];
  groups: string[];
  cats: { id: string; name: string }[];
  groupCat: Record<string, string>;
  defaultCat: string;
  onSubmit: (a: Attr, cat: string) => void;
  onCancel: () => void;
  addDisabled?: string;
}) {
  const t = useT();
  const isEdit = !!initial;
  const available = CATALOG.filter((c) => !used.includes(c.num));
  const [sel, setSel] = useState<number | null>(initial?.num ?? null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [widget, setWidget] = useState<Widget>(initial?.widget ?? "entry");
  const [type, setType] = useState<DataType>(initial?.type ?? "STR");
  const [options, setOptions] = useState<string[]>(initial?.options ?? []);
  const [bulk, setBulk] = useState("");
  const [group, setGroup] = useState(initial?.group ?? "");
  const [cat, setCat] = useState(defaultCat);
  const gTrim = group.trim();
  const groupLocked = !!gTrim && groups.includes(gTrim);
  const validC = (c?: string) => (c && cats.some((x) => x.id === c) ? c : GENERAL);
  const shownCat = groupLocked ? validC(groupCat[gTrim]) : validC(cat);

  const entry =
    CATALOG.find((c) => c.num === sel) ??
    (initial && initial.num === sel ? { num: initial.num, name: initial.name } : undefined);
  const hasOptions = widget === "combo" || widget === "list";
  const badOpt = options.find((o) => checkValue(type, o));
  const error = addDisabled && (!isEdit || !!gTrim && !groupLocked)
    ? addDisabled
    : !entry
    ? t.errPick
    : hasOptions && options.length === 0
      ? t.errNoOpt
      : hasOptions && badOpt
        ? t.errBadOpt.replace("{o}", badOpt).replace("{t}", t[TYPES[type]])
        : null;

  const pushBulk = () => {
    const items = bulk
      .split(/[\n;,\t]+/)
      .map((s) => s.trim())
      .filter((s) => s && s.length <= 100);
    const next = [...options];
    for (const it of items) if (!next.includes(it)) next.push(it);
    setOptions(next.slice(0, 500));
    setBulk("");
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= options.length) return;
    const n = [...options];
    [n[i], n[j]] = [n[j]!, n[i]!];
    setOptions(n);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (error || !entry) return;
    let value = initial?.value ?? "";
    if (widget === "checkbox") value = value === "true" ? "true" : "false";
    else if (initial?.widget === "checkbox") value = "";
    else if (checkValue(type, value)) value = "";
    else if (widget === "list" && value && !options.includes(value)) value = "";
    onSubmit(
      {
        num: entry.num,
        name: entry.name,
        title: title.trim().slice(0, 120) || entry.name,
        widget,
        type,
        value,
        ...(hasOptions ? { options } : {}),
        ...(group.trim() ? { group: group.trim().slice(0, 20) } : {}),
      },
      shownCat,
    );
  };

  const choices =
    initial && !available.some((c) => c.num === initial.num)
      ? [{ num: initial.num, name: initial.name }, ...available]
      : available;

  return (
    <form
      onSubmit={submit}
      className="aim-edit-panel mb-2 shrink-0 overflow-auto border border-border bg-card"
    >
      <h2 className="catalog-panel-heading mb-3 flex h-7 items-center px-2 text-sm font-semibold text-foreground">
        {heading}
      </h2>
      <div className="grid max-w-[900px] grid-cols-1 gap-3 px-3 md:grid-cols-[360px_1fr]">
        <label className="lbl">
          {t.fAttr}
          <select
            autoFocus={!isEdit}
            value={sel ?? ""}
            onChange={(e) => setSel(e.target.value ? Number(e.target.value) : null)}
            className="field w-full max-w-[360px] font-mono"
          >
            <option value="">{t.fChoose}</option>
            {choices
              .sort((a, b) => a.num - b.num)
              .map((c) => (
                <option key={c.num} value={c.num}>
                  {String(c.num).padStart(3, "0")} · {c.name}
                </option>
              ))}
          </select>
          {choices.length === 0 && (
            <span className="normal-case tracking-normal text-destructive">{t.fAllUsed}</span>
          )}
        </label>
        <label className="lbl">
          <span className="inline-flex items-center gap-1">
            {t.fTitle}
            <span className="group relative inline-flex" tabIndex={0} aria-label={t.fTitleHelp}>
              <HelpCircle className="size-3.5 cursor-help text-primary" />
              <span
                role="tooltip"
                className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-80 rounded-md border border-border bg-popover p-3 text-xs font-normal normal-case leading-relaxed text-popover-foreground shadow-lg group-hover:block group-focus:block"
              >
                {t.fTitleHelp}
              </span>
            </span>
          </span>
          <input
            autoFocus={isEdit}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.fTitlePh}
            className="field"
          />
        </label>
        <div className="lbl col-span-full">
          {t.catShort} / {t.fGroup}
          <div className="flex flex-wrap items-center gap-2 [&>button:first-child]:w-[360px]">
            <GroupPicker
              cats={cats}
              groups={groups}
              groupCat={groupCat}
              category={shownCat}
              group={groupLocked ? gTrim : ""}
              noGroup={t.noGroup}
              label={t.catShort + " / " + t.fGroup}
              onChange={(category, chosen) => {
                setCat(category);
                setGroup(chosen);
              }}
            />
            <input
              aria-label={t.addGroup}
              className="field w-56 max-w-full font-normal"
              value={groupLocked ? "" : group}
              disabled={!!addDisabled}
              title={addDisabled || undefined}
              maxLength={20}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t.mNewGroup}
            />
            {group.trim() && !groupLocked && (
              <span className="text-xs font-normal text-primary">{t.newGroupNote}</span>
            )}
          </div>
        </div>
        <div className="lbl col-span-full">
          {t.fWidget}
          <div className="flex flex-wrap gap-1">
            {(Object.keys(WIDGETS) as Widget[]).map((w) => {
              const I = WIDGET_ICONS[w];
              return (
                <Button
                  variant="native"
                  size="native"
                  key={w}
                  type="button"
                  aria-pressed={widget === w}
                  onClick={() => {
                    setWidget(w);
                    if (!ALLOWED[w].includes(type)) setType(ALLOWED[w][0] ?? "STR");
                  }}
                  className={`${widget === w ? "pick pick-on" : "pick"} justify-center whitespace-nowrap`}
                >
                  <I className="size-4 shrink-0" />
                  {t[WIDGETS[w]]}
                </Button>
              );
            })}
          </div>
        </div>
        {ALLOWED[widget].length > 1 && (
          <div className="lbl col-span-full">
            {t.fType}
            <div className="flex flex-wrap gap-1.5">
              {ALLOWED[widget].map((k) => {
                const I = TYPE_ICONS[k];
                return (
                  <Button
                    variant="native"
                    size="native"
                    key={k}
                    type="button"
                    aria-pressed={type === k}
                    onClick={() => setType(k)}
                    className={type === k ? "pick pick-on" : "pick"}
                  >
                    <I className="size-4" />
                    {t[TYPES[k]]}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {hasOptions && (
        <div className="mt-4 px-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="lbl">
              {t.fOptions} ({options.length})
            </p>
            {options.length > 0 && (
              <Button
                variant="native"
                size="native"
                type="button"
                onClick={() => setOptions([])}
                className="btn-ghost h-7 text-xs"
              >
                {t.fRemoveAll}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {options.map((o, i) => (
              <span key={o} className={`chip ${checkValue(type, o) ? "chip-error" : ""}`}>
                <Button
                  variant="native"
                  size="native"
                  type="button"
                  onClick={() => move(i, -1)}
                  className="chip-btn"
                  title={t.fUp}
                >
                  ‹
                </Button>
                {o}
                <Button
                  variant="native"
                  size="native"
                  type="button"
                  onClick={() => move(i, 1)}
                  className="chip-btn"
                  title={t.fDown}
                >
                  ›
                </Button>
                <Button
                  variant="native"
                  size="native"
                  type="button"
                  onClick={() => setOptions(options.filter((x) => x !== o))}
                  className="chip-btn"
                  title={t.fRemove}
                >
                  ✕
                </Button>
              </span>
            ))}
            {options.length === 0 && (
              <span className="text-xs text-muted-foreground">{t.fNoOpt}</span>
            )}
          </div>
          <div className="mt-3 flex items-start gap-2">
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value.slice(0, 10000))}
              rows={8}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  pushBulk();
                }
              }}
              placeholder={t.fBulkPh}
              className="field h-auto flex-1 py-2"
            />
            <div className="flex flex-col gap-1">
              <Button
                variant="native"
                size="native"
                type="button"
                onClick={pushBulk}
                disabled={!bulk.trim()}
                className="btn-primary"
              >
                {t.add}
              </Button>
              <span className="text-[10px] text-muted-foreground">{t.ctrlEnter}</span>
            </div>
          </div>
        </div>
      )}

      {isEdit && <p className="mt-3 px-3 text-xs text-muted-foreground">{t.fResetNote}</p>}
      <div
        className={`aim-blue-band mt-3 flex flex-wrap items-center gap-2 px-2 py-1.5 ${isEdit ? "justify-end" : "justify-start"}`}
      >
        <Button
          variant="native"
          size="native"
          type="submit"
          disabled={!!error}
          className="aim-dialog-button"
        >
          {isEdit ? t.save : t.add}
        </Button>
        <Button
          variant="native"
          size="native"
          type="button"
          onClick={onCancel}
          className="aim-dialog-button"
        >
          {t.cancel}
        </Button>
        {error && (sel !== null || isEdit) && (
          <span className="text-xs text-destructive">{error}</span>
        )}
      </div>
    </form>
  );
}

function ComboCell({
  common,
  cls,
  value,
  options,
  placeholder,
  onType,
  onPick,
}: {
  common: Record<string, unknown>;
  cls: string;
  value: string;
  options: string[];
  placeholder: string;
  onType: (v: string) => void;
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  return (
    <div className="relative">
      <input
        {...common}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onType(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`${cls} pr-8`}
      />
      <Button
        variant="native"
        size="native"
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setUp(window.innerHeight - r.bottom < 240 && r.top > window.innerHeight - r.bottom);
          setOpen((o) => !o);
        }}
        className="absolute inset-y-0 right-0 flex w-7 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className="size-4" />
      </Button>
      {open && options.length > 0 && (
        <ul
          ref={placePop}
          className={`absolute left-0 right-0 z-30 max-h-56 overflow-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg ${up ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {options.map((o) => (
            <li key={o}>
              <Button
                variant="native"
                size="native"
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(o);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-accent ${o === value ? "font-semibold text-primary" : ""}`}
              >
                {o}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColorSwatches({
  value,
  onPick,
}: {
  value: string;
  onPick: (c: string, close: boolean) => void;
}) {
  const t = useT();
  return (
    <span className="flex w-max items-center gap-1.5">
      {GROUP_COLORS.map((c) => (
        <Button
          variant="native"
          size="native"
          key={c}
          type="button"
          onClick={() => onPick(c, true)}
          aria-label={c}
          className={`size-5 rounded-full transition-transform hover:scale-110 ${c.toUpperCase() === value.toUpperCase() ? "ring-2 ring-ring ring-offset-2 ring-offset-popover" : "ring-1 ring-border"}`}
          style={{ backgroundColor: c }}
        />
      ))}
      <label
        title={t.customColor}
        className="relative ml-1 flex size-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-muted-foreground text-muted-foreground hover:text-foreground"
        style={
          !GROUP_COLORS.includes(value.toUpperCase())
            ? { backgroundColor: value, borderStyle: "solid" }
            : undefined
        }
      >
        <Plus className="size-3" />
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.target.value, false)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </span>
  );
}

function focusRow(num: number) {
  setTimeout(() => {
    const tr = document.querySelector<HTMLElement>(`tr[data-num="${num}"]`);
    if (!tr) return;
    tr.scrollIntoView({ block: "center", behavior: "smooth" });
    tr.querySelector<HTMLElement>('[data-col="value"]:not([disabled]), [data-col="title"]')?.focus({
      preventScroll: true,
    });
  }, 50);
}

/** Positions a popover with fixed coordinates next to its anchor so scroll containers never clip it. */
function placePop(el: HTMLElement | null) {
  if (!el || !el.parentElement) return;
  const a = el.parentElement.getBoundingClientRect();
  const full = el.classList.contains("left-0") && el.classList.contains("right-0");
  Object.assign(el.style, { position: "fixed", margin: "0", right: "auto", bottom: "auto" });
  if (full) el.style.width = `${a.width}px`;
  const w = el.offsetWidth,
    h = el.offsetHeight,
    gap = 4;
  const alignRight = el.classList.contains("right-0") && !full;
  const left = Math.max(4, Math.min(window.innerWidth - w - 4, alignRight ? a.right - w : a.left));
  const below = a.bottom + gap + h <= window.innerHeight - 4 || a.top - gap - h < 4;
  el.style.left = `${left}px`;
  el.style.top = `${below ? Math.min(a.bottom + gap, window.innerHeight - h - 4) : a.top - gap - h}px`;
}

function MenuNew({
  label,
  onCreate,
  max = 60,
  disabledReason = "",
}: {
  label: string;
  onCreate: (name: string) => void;
  max?: number;
  disabledReason?: string;
}) {
  const [v, setV] = useState<string | null>(null);
  if (v === null)
    return (
      <Button
        variant="native"
        size="native"
        type="button"
        disabled={!!disabledReason}
        title={disabledReason || undefined}
        onClick={() => setV("")}
        className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-accent"
      >
        <Plus className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </Button>
    );
  const ok = () => {
    if (disabledReason) return;
    const n = v.trim().slice(0, max);
    if (n) onCreate(n);
    setV(null);
  };
  return (
    <span className="flex items-center gap-1 px-1 py-1">
      <input
        autoFocus
        disabled={!!disabledReason}
        title={disabledReason || undefined}
        value={v}
        maxLength={max}
        placeholder={label.replace(/…$/, "")}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") ok();
          if (e.key === "Escape") setV(null);
        }}
        className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      <Button
        variant="native"
        size="native"
        type="button"
        onClick={ok}
        disabled={!!disabledReason}
        title={disabledReason || undefined}
        className="flex size-6 items-center justify-center rounded text-primary hover:bg-accent"
      >
        <Check className="size-3.5" />
      </Button>
    </span>
  );
}

function ResetBtn({ a, onReset }: { a: { value?: string; widget?: string }; onReset: () => void }) {
  const t = useT();
  const empty = !a.value || (a.widget === "checkbox" && (a.value === "false" || a.value === "0"));
  return (
    <Button
      variant="native"
      size="native"
      type="button"
      tabIndex={-1}
      onClick={onReset}
      disabled={empty}
      title={t.resetTip}
      aria-label={t.resetTip}
      className="inline-flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground opacity-50 transition hover:bg-accent hover:text-primary hover:opacity-100 disabled:opacity-0"
    >
      <RotateCcw className="size-3.5" />
    </Button>
  );
}
