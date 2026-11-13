import { formulaArtwork } from "@/lib/formula-artwork";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, ChevronDown, CircleHelp, Database, LayoutGrid, Boxes, PaintRoller, HardHat, Info, Search, Square, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FINISH_INFOS, FINISH_TYPES, FUNCTION_GROUPS, OBJECTS, OPERATORS, TRADES } from "@/lib/allplan-data";
import { ATTRIBUTE_CATALOG, attrGroupNames } from "@/lib/catalog-store";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { fitDialogFrame, readDialogFrame, saveDialogFrame, type DialogFrame } from "@/lib/dialog-layout";
const ROOM_ICONS: Record<string, string> = { floor: formulaArtwork.roomFloor, baseboard: formulaArtwork.roomBaseboard, wall: formulaArtwork.roomWall, ceiling: formulaArtwork.roomCeiling, additional: formulaArtwork.roomOther };
const Img = ({ src }: { src: string }) => <img src={src} alt="" className="h-4 w-4 shrink-0 object-contain" />;
const FINISH_FN: Record<string, string> = { floor: "Obj_Floor", baseboard: "Obj_Baseboard", wall: "Obj_VSurface", ceiling: "Obj_Ceiling", additional: "Obj_Material" };
const NO_LAYER = new Set(["baseboard", "additional"]);
const DEFAULT_INFO_NUMS: Record<string, number> = { Height: 112, Area: 229, Length: 220, Thickness: 221, Material: 508, Volume: 223 };
const HELP = "https://help.allplan.com/Allplan/2026-0/1033/Allplan/index.htm#";
export const HELP_URLS = { functions: HELP + "10058_1.htm", attributes: HELP + "9899.htm", doors: HELP + "74158.htm" };
const openHelp = (u: string) => window.open(u, "_blank", "noopener,noreferrer");

const btn = "flex h-9 items-center justify-center hover:bg-selection data-[state=open]:bg-selection";
const head = "catalog-panel-heading px-3 py-1 text-center text-xs font-semibold";
const item = "flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-selection";
const Q = () => <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;

function Menu({ icon, title, header, children }: { icon: ReactNode; title: string; header: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button title={title} aria-label={title} className={btn} onMouseDown={(e) => e.preventDefault()}>{icon}</button></PopoverTrigger>
      <PopoverContent align="end" className="w-60 overflow-visible rounded-none p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className={head}>--- {header} ---</div>
        <div className="py-0.5">{children(() => setOpen(false))}</div>
      </PopoverContent>
    </Popover>
  );
}

export function OperatorMenu({ onInsert }: { onInsert: (s: string) => void }) {
  const t = useT();
  return <Menu title={t("fOperators")} header={t("fOperator")} icon={<img src={formulaArtwork.operator} alt="" className="h-4 w-4" />}>
    {(close) => OPERATORS.map((o) => <button key={o} className={item} title={o} onClick={() => { onInsert(o.endsWith("(") ? `${o})` : o); close(); }}><Q />{o}</button>)}
  </Menu>;
}

export function FunctionMenu({ onInsert, onHelp }: { onInsert: (s: string) => void; onHelp?: () => void }) {
  const t = useT();
  const [sub, setSub] = useState<string | null>(null);
  return <Menu title={t("fFunctions")} header={t("fFunctions")} icon={<LayoutGrid className="h-4 w-4 text-ribbon-dark" />}>
    {(close) => <>
      <button className={item} onClick={() => { close(); onHelp ? onHelp() : openHelp(HELP_URLS.functions); }}><LayoutGrid className="h-3.5 w-3.5 text-ribbon-dark" />{t("fOpenHelp")}</button>
      {FUNCTION_GROUPS.map((g) => (
        <div key={g.name} className="relative" onMouseEnter={() => setSub(g.name)} onMouseLeave={() => setSub(null)}>
          <div className={`${item} cursor-default ${sub === g.name ? "bg-selection" : ""}`}><Q /><span className="flex-1">{g.name}</span><ChevronRight className="h-3 w-3" /></div>
          {sub === g.name && <div className="absolute right-full top-0 z-50 max-h-96 w-60 overflow-auto border border-border bg-popover py-0.5 shadow-lg">
            {g.items.map((f) => { const [n, d] = f.split("|"); return <button key={n} title={d} className={`${item} font-mono`} onClick={() => { onInsert(n!.includes("(") ? n! : `${n}()`); close(); }}>{n}</button>; })}
          </div>}
        </div>
      ))}
    </>}
  </Menu>;
}

export function ObjectMenu({ onInsert }: { onInsert: (s: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <><Button variant="ghost" size="icon" title={t("fObjects")} aria-label={t("fObjects")} className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)}><Img src={formulaArtwork.object} /></Button>
    {open && <ObjectDialog onInsert={onInsert} onClose={() => setOpen(false)} />}</>;
}

export function HelpMenu() {
  const t = useT();
  const topics: [string, string][] = [[t("fFunctions"), HELP_URLS.functions], [t("attribute"), HELP_URLS.attributes], [t("fDoorsWindows"), HELP_URLS.doors]];
  return <Menu title={t("help")} header={t("help")} icon={<img src={formulaArtwork.help} alt="" className="h-4 w-4" />}>
    {(close) => topics.map(([x, u]) => <button key={x} className={item} title={x} onClick={() => { close(); openHelp(u); }}><Q />{x}</button>)}
  </Menu>;
}

/* ---------- Dialog shell (Allplan style) ---------- */
export function Dialog({ title, width = 340, height, onClose, children, footer, ghost = false, icon, nonModal = false, resizable = true, layoutId, header }: { header?: ReactNode; layoutId?: string; resizable?: boolean; nonModal?: boolean; icon?: string; title: string; width?: number; height?: number; onClose: () => void; children: ReactNode; footer?: ReactNode; ghost?: boolean }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<DialogFrame | null>(null);
  const gestureCleanup = useRef<(() => void) | null>(null);
  const key = layoutId ?? title;
  const fit = (f: DialogFrame) => fitDialogFrame(f, { width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const saved = resizable ? readDialogFrame(key) : null;
    if (saved) setFrame(fit(saved));
    const resize = () => setFrame((f) => f ? fit(f) : f);
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); gestureCleanup.current?.(); };
  }, [key, resizable]);
  useEffect(() => { if (resizable && frame) saveDialogFrame(key, frame); }, [frame, key, resizable]);
  const start = (e: React.MouseEvent, resizing = false) => {
    if (!resizing && (e.target as HTMLElement).closest("button")) return;
    if (resizing && !resizable) return;
    gestureCleanup.current?.();
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    e.preventDefault(); e.stopPropagation(); const x = e.clientX, y = e.clientY;
    const move = (ev: MouseEvent) => setFrame(fit(resizing ? { x: r.left, y: r.top, width: Math.max(Math.min(300, window.innerWidth - 16), r.width + ev.clientX - x), height: Math.max(Math.min(180, window.innerHeight - 16), r.height + ev.clientY - y) } : { x: r.left + ev.clientX - x, y: r.top + ev.clientY - y, width: r.width, height: r.height }));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    gestureCleanup.current = up;
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center transition-colors ${ghost || nonModal ? "pointer-events-none bg-transparent" : "bg-foreground/20"}`} onMouseDown={nonModal ? undefined : onClose}>
      <div ref={box} data-dialog-box role="dialog" aria-label={title} style={frame ? { position: "absolute", left: frame.x, top: frame.y, width: frame.width, height: frame.height } : { width, height }} className={`mgr-in relative flex max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-border bg-background shadow-2xl transition-opacity ${ghost ? "opacity-25" : nonModal ? "pointer-events-auto" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="catalog-panel-heading flex h-9 shrink-0 cursor-move select-none items-center gap-2 px-3 text-xs font-semibold" onMouseDown={(e) => start(e)} onDoubleClick={() => { const r = box.current?.getBoundingClientRect(); if (r) setFrame(fit({ x: (window.innerWidth - r.width) / 2, y: (window.innerHeight - r.height) / 2, width: r.width, height: r.height })); }}>
          {header ?? <>{icon ? <img src={icon} alt="" className="h-4 w-4 object-contain" /> : <img src={formulaArtwork.asc} alt="" className="h-4 w-4 object-contain" />}<span className="flex-1">{title}</span></>}
          <Button variant="ghost" size="icon" aria-label={t("close")} className="flex h-6 w-8 items-center justify-center hover:bg-destructive/15" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 flex flex-col">{children}</div>
        {resizable && <Button variant="ghost" size="icon" aria-label={t("resizeDialog")} title={t("resizeDialog")} onMouseDown={(e) => start(e, true)} className="absolute bottom-0 right-0 z-10 h-3 w-3 cursor-se-resize rounded-none p-0 text-muted-foreground"><span className="h-2 w-2 border-b-2 border-r-2 border-current" /></Button>}
        {footer && <div className="secondary-dialog-footer flex shrink-0 items-center justify-end gap-2 px-3 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}
/** Shared footer button style for every secondary dialog. */
export const DIALOG_BTN = "h-7 min-w-28 rounded-[4px] border border-ribbon-dark/35 bg-panel/85 px-4 text-xs font-medium text-foreground transition-colors hover:border-ribbon-dark hover:bg-panel active:bg-selection disabled:opacity-40";
const fbtn = DIALOG_BTN;

function Info2({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return <Dialog layoutId="formula-info" title="Allplan - SmartCatalog" width={520} onClose={onClose} footer={<button className={fbtn} onClick={onClose}>Ok</button>}>
    <div className="flex gap-4 py-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border bg-panel"><Info className="h-5 w-5 text-ribbon-dark" /></div>
      <div className="text-xs leading-5"><div>{title}</div><div className="whitespace-pre-line text-muted-foreground">{body}</div></div></div>
  </Dialog>;
}

type Opt = { id: string; name: string; icon?: ReactNode; num?: number | undefined; removable?: boolean };
function Select({ value, options, onChange, icon, onRemove }: { value: string; options: Opt[]; onChange: (v: string) => void; icon?: ReactNode; onRemove?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const t = useT();
  const matches = options.filter((o) => `${o.name} ${o.num ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const cur = options.find((o) => o.id === value);
  const num = (o?: Opt) => o?.num != null && <span className="ml-auto pl-2 font-mono text-[11px] text-muted-foreground">{o.num}</span>;
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); setQuery(""); }}>
    <PopoverTrigger asChild><button className="flex h-8 min-w-0 flex-1 items-center gap-2 border border-border bg-background pl-2 text-xs">
      {cur?.icon ?? icon}<span className="flex-1 truncate text-left">{cur?.name}</span>{num(cur)}<span className="ml-2 flex h-full w-7 items-center justify-center border-l border-border"><ChevronDown className="h-3.5 w-3.5 text-ribbon-dark" /></span></button></PopoverTrigger>
    <PopoverContent align="start" className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-auto rounded-none p-0 py-0.5">
      <input aria-label={`${t("search")} · ${cur?.name ?? ""}`} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { onChange(matches[0].id); setOpen(false); } }} className="h-8 w-full border-b border-border bg-background px-2 text-xs outline-none" />
      {matches.map((o) => <div key={o.id} className={`group flex items-center ${o.id === value ? "bg-selection" : ""}`}>
        <button className={`${item} flex-1`} onClick={() => { onChange(o.id); setOpen(false); }}>{o.icon ?? icon}<span className="truncate">{o.name}</span>{num(o)}</button>
        {o.removable && onRemove && <button title="✕" aria-label={`remove ${o.name}`} className="mr-1 flex h-6 w-6 items-center justify-center text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" onClick={() => onRemove(o.id)}><X className="h-3.5 w-3.5" /></button>}
      </div>)}
    </PopoverContent>
  </Popover>;
}

function AddAttr({ exclude, onAdd, title }: { exclude: Set<number>; onAdd: (num: number, name: string) => void; title: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = ATTRIBUTE_CATALOG.filter((a) => !exclude.has(a.num) && (`${a.num} ${a.name}`).toLowerCase().includes(q.toLowerCase())).slice(0, 80);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button title={title} aria-label={title} className="flex h-8 w-8 shrink-0 items-center justify-center border border-border hover:bg-selection"><Img src={formulaArtwork.attributeAdd} /></button></PopoverTrigger>
    <PopoverContent align="end" className="w-72 rounded-none p-1">
      <div className="mb-1 flex items-center gap-1 border border-border px-1.5"><Search className="h-3.5 w-3.5 text-muted-foreground" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="h-7 flex-1 bg-transparent text-xs outline-none" /></div>
      <div className="max-h-64 overflow-auto">
        {list.map((a) => <button key={a.num} title={[a.comment ?? a.name, attrGroupNames(a).join(", ")].filter(Boolean).join("\n")} className={item} onClick={() => { onAdd(a.num, a.name); setOpen(false); setQ(""); }}><Img src={formulaArtwork.attribute} /><span className="truncate">{a.name}</span><span className="ml-auto pl-2 font-mono text-[11px] text-muted-foreground">{a.num}</span></button>)}
      </div>
    </PopoverContent>
  </Popover>;
}

export function FinishingDialog({ onInsert, onClose }: { onInsert: (s: string) => void; onClose: () => void }) {
  const t = useT();
  const [type, setType] = useState("floor");
  const [info, setInfo] = useState(FINISH_INFOS[0]!);
  const [extra, setExtra] = useState<{ num: number; name: string }[]>([]);
  const infoOpts: Opt[] = [
    ...FINISH_INFOS.map((x) => ({ id: x, name: x, num: DEFAULT_INFO_NUMS[x], icon: <Img src={formulaArtwork.attribute} /> })),
    ...extra.map((a) => ({ id: `@${a.num}@`, name: a.name, num: a.num, removable: true, icon: <Img src={formulaArtwork.attribute} /> })),
  ];
  const [layers, setLayers] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<"sup" | "all" | null>("sup");
  const [help, setHelp] = useState(false);
  const toggle = (n: number) => { const s = new Set(layers); s.has(n) ? s.delete(n) : s.add(n); setLayers(s); setMode(null); };
  const lyr = mode === "sup" ? "SUP" : mode === "all" ? "ALL" : [...layers].sort((a, b) => a - b).join("/");
  const noLayer = NO_LAYER.has(type);
  const buildFinish = (): string | null => {
    const fn = FINISH_FN[type]; if (!fn) return null;
    const m = /^@(\d+)@$/.exec(info); const num = m ? Number(m[1]) : DEFAULT_INFO_NUMS[info];
    if (!num) return null;
    let f = `${fn}(@${num}@`;
    if (noLayer) return f + ";1)";
    if (mode === "sup") return f + " ;0)";
    const ls = mode === "all" ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [...layers].sort((a, b) => a - b);
    if (!ls.length) return null;
    return f + ls.map((n) => ` ;${n}`).join("") + ")";
  };
  const sq = "h-7 rounded-sm border border-border text-xs hover:bg-selection";
  const lbl = "mb-2 mt-3 text-xs font-semibold";
  return <>
    <Dialog title={t("fFinishing")} icon={formulaArtwork.finish} resizable={false} onClose={onClose} footer={<>
      <button className={fbtn} disabled={!buildFinish()} onClick={() => { const f = buildFinish(); if (f) { onInsert(f); onClose(); } }}>{t("add")}</button>
      <button className={fbtn} onClick={onClose}>{t("quit")}</button></>}>
      <div className={lbl}>{t("fFinishType")}</div>
      <div className="flex gap-1"><Select value={type} onChange={setType} options={FINISH_TYPES.map((o) => ({ ...o, icon: <Img src={ROOM_ICONS[o.id] ?? formulaArtwork.roomOther} /> }))} />
        <button title={t("help")} className="flex h-8 w-8 items-center justify-center border border-border hover:bg-selection" onClick={() => setHelp(true)}><CircleHelp className="h-4 w-4 text-muted-foreground" /></button></div>
      <div className={lbl}>{t("fFinishInfo")}</div>
      <div className="flex gap-1"><Select value={info} onChange={setInfo} options={infoOpts}
        onRemove={(id) => { setExtra((e) => e.filter((a) => `@${a.num}@` !== id)); if (id === info) setInfo(FINISH_INFOS[0]!); }} />
        <AddAttr title={t("addAttr")} exclude={new Set(infoOpts.map((o) => o.num!).filter(Boolean))} onAdd={(num, name) => { setExtra((e) => [...e, { num, name }]); setInfo(`@${num}@`); }} /></div>
      <div className={lbl}>{t("fLayers")}</div>
      <div className={`grid grid-cols-[repeat(5,2.25rem)_1fr] gap-1.5 ${noLayer ? "pointer-events-none opacity-40" : ""}`}>
        {[1, 2, 3, 4, 5].map((n) => <button key={n} className={`${sq} ${layers.has(n) ? "bg-selection border-ribbon-dark" : ""}`} onClick={() => toggle(n)}>{n}</button>)}
        <button className={`${sq} ${mode === "sup" ? "bg-selection border-ribbon-dark" : ""}`} onClick={() => { setMode("sup"); setLayers(new Set()); }}>{t("fSuperior")}</button>
        {[6, 7, 8, 9, 10].map((n) => <button key={n} className={`${sq} ${layers.has(n) ? "bg-selection border-ribbon-dark" : ""}`} onClick={() => toggle(n)}>{n}</button>)}
        <button className={`${sq} ${mode === "all" ? "bg-selection border-ribbon-dark" : ""}`} onClick={() => { setMode("all"); setLayers(new Set()); }}>{t("fAll")}</button>
      </div>
    </Dialog>
    {help && <Info2 title={t("fFinishRemarkT")} body={t("fFinishRemark")} onClose={() => setHelp(false)} />}
  </>;
}

function ReferenceDialog({ kind, onInsert, onClose }: { kind: "trades" | "objects"; onInsert: (s: string) => void; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [asc, setAsc] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const rows = kind === "trades" ? TRADES.map((x) => ({ name: x.code, formula: `@209@=${x.value}` })) : OBJECTS.map((x) => ({ name: x.name, formula: `@OBJ@=${x.code}` }));
  const query = q.trim().toLowerCase();
  const list = rows.filter((x) => `${x.name} ${x.formula}`.toLowerCase().includes(query)).sort((a, b) => (asc ? 1 : -1) * a.name.localeCompare(b.name, undefined, { numeric: true }));
  const add = (formula: string) => { onInsert(formula); onClose(); };
  return <Dialog layoutId={`formula-${kind}`} title={t(kind === "trades" ? "trade" : "fObjects")} icon={kind === "trades" ? formulaArtwork.trade : formulaArtwork.object} width={560} height={490} onClose={onClose} footer={<>
    <Button variant="outline" className={fbtn} disabled={sel === null} onClick={() => { if (sel) add(sel); }}>{t("add")}</Button>
    <Button variant="outline" className={fbtn} onClick={onClose}>{t("quit")}</Button></>}>
    <div className="mb-2 flex shrink-0 border border-border"><input autoFocus aria-label={t("search")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="h-7 min-w-0 flex-1 bg-background px-2 text-xs outline-none" />
      <span className="flex w-9 items-center justify-center border-l border-border bg-panel"><Search className="h-4 w-4 text-muted-foreground" /></span></div>
    <div className="min-h-0 flex-1 overflow-auto border border-border text-xs">
      <div className="catalog-panel-heading sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_10rem] font-semibold">
        <Button variant="ghost" className="h-7 rounded-none border-b border-r border-border text-xs" onClick={() => setAsc(!asc)}>{t(kind === "trades" ? "code" : "name")}<ChevronDown className={`h-3 w-3 ${asc ? "rotate-180" : ""}`} /></Button>
        <div className="border-b border-border py-1 text-center">{t("formulaCol")}</div>
      </div>
      {list.map((x, i) => <div key={x.formula} onClick={() => setSel(x.formula)} onDoubleClick={() => add(x.formula)}
        className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_10rem] border-b border-border ${sel === x.formula ? "bg-selection" : i % 2 ? "bg-row-alt" : ""}`}>
        <span className="break-words border-r border-border px-2 py-1.5">{x.name}</span><span className="px-2 py-1.5 font-mono">{x.formula}</span></div>)}
      {!list.length && <div className="p-4 text-center text-muted-foreground">{t("results", { n: 0 })}</div>}
    </div>
  </Dialog>;
}

export function TradeDialog(props: { onInsert: (s: string) => void; onClose: () => void }) {
  return <ReferenceDialog kind="trades" {...props} />;
}
export function ObjectDialog(props: { onInsert: (s: string) => void; onClose: () => void }) {
  return <ReferenceDialog kind="objects" {...props} />;
}

export function HelpDialog({ topic, onClose }: { topic: string; onClose: () => void }) {
  const t = useT();
  const rows: [string, string][] = topic === t("attribute")
    ? ATTRIBUTE_CATALOG.slice(0, 40).map((a) => [`@${a.num}@`, a.name])
    : topic === t("fDoorsWindows")
      ? [["@OBJ@=7", "Door"], ["@OBJ@=8", "Window"], ["@OPEN_W@", "Opening width"], ["@OPEN_H@", "Opening height"], ["@SILL@", "Sill height"], ["@REVEAL@", "Reveal depth"]]
      : FUNCTION_GROUPS.flatMap((g) => g.items.map((f) => [f.split("|")[0]!, f.split("|")[1] ?? g.name] as [string, string]));
  return <Dialog layoutId="formula-help" title={`${t("help")} — ${topic}`} width={460} onClose={onClose} footer={<button className={fbtn} onClick={onClose}>{t("close")}</button>}>
    <div className="max-h-96 overflow-auto border border-border text-xs">
      {rows.map(([a, b], i) => <div key={a + i} className={`flex gap-3 px-2 py-1 ${i % 2 ? "bg-row-alt" : ""}`}><span className="w-28 font-mono">{a}</span><span className="text-muted-foreground">{b}</span></div>)}
    </div>
  </Dialog>;
}

export const ToolIcons = { finish: formulaArtwork.finish, trade: formulaArtwork.trade, PaintRoller, HardHat };
