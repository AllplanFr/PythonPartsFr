import { formulaArtwork } from "@/lib/formula-artwork";
import { showMessage } from "@/lib/app-dialog";
import { isLayerAttribute } from "@/lib/layer-attributes";
import { isRoomAttribute, ROOM_ATTRIBUTES, roomChoiceIndex, roomOptions } from "@/lib/room-attributes";
import { RoomOptionsButton } from "./RoomAttributeField";
import { isFillAttribute, FILL_ATTRIBUTES } from "@/lib/fill-attributes";
import { FillAttributeField, FillAttributeRows, ImagePathField } from "./FillAttributeField";
import { LayerAttributeField, LineStyleField } from "./LayerAttributeField";
import { dragNewAttrs } from "@/lib/attr-favorites";
import { dragExternalAttrs } from "@/lib/external-libraries";
import { dragTemplate } from "@/lib/templates";
import { dragFormula, isFormulaAttribute, useFormulaFavorites, type FormulaAttribute } from "@/lib/formula-favorites";
import { FormulaFavoritesMenu } from "./FormulaFavoriteMenus";
import { AttributeTemplateContext } from "./TemplateMenus";
import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import {
  Check, Palette, Wrench, Languages, Sigma, Variable, GripVertical, ClipboardPaste, ListFilter,
  Braces, Calculator, Ruler, CircleHelp, X, ChevronDown, AlertCircle, TriangleAlert, Sparkles, CalendarIcon,
} from "lucide-react";
import { ATTRIBUTE_BY_NUMBER, ATTRIBUTE_CATALOG, FUNCTIONS, VARIABLES, humanizeFormula, useCatalog, validateFormula, dragAttr, dragFolderIcon, TITLE, groupNameTaken, type AttrType, type CatalogNode } from "@/lib/catalog-store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";
import { RowDragGrip } from "./RowDragGrip";
import { FolderIconPicker } from "./FolderIconPicker";
import { AttrPickerDialog } from "./AttrPickerDialog";
import { useAttrFavorites } from "@/lib/attr-favorites";
import { FunctionMenu, OperatorMenu, ObjectMenu, HelpMenu, FinishingDialog, TradeDialog, HelpDialog, ToolIcons } from "./FormulaTools";
import azIcon from "@/assets/icons/az.png.asset.json";
import zaIcon from "@/assets/icons/za.png.asset.json";
import i19Icon from "@/assets/icons/19.png.asset.json";
import i91Icon from "@/assets/icons/91.png.asset.json";
import customIcon from "@/assets/icons/order_custom.png.asset.json";
import attrAddIcon from "@/assets/icons/attribute_add.png.asset.json";
import custom2Icon from "@/assets/icons/order_custom2.png.asset.json";
import { applyCustomOrder, mergeVisibleOrder, sortKeys, useAttrOrder } from "@/lib/attr-order";
import { AttrOrderDialog } from "./AttrOrderDialog";
import { linkStatus, linkTarget } from "@/lib/links";
import { useLinkDialog } from "./LinkDialog";
import { Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
const Ico = ({ src }: { src: string }) => <img src={src} alt="" className="h-4 w-4 object-contain" draggable={false} />;

const TYPE_TAG: Record<AttrType, string> = { text: "ABC", int: "123", dec: "0,0" };
const BASE_ATTRS = [207, 202, 203, 209, 267];

function Badge({ children, onClick, title }: { children: ReactNode; onClick?: (() => void) | undefined; title?: string | undefined }) {
  return <Button variant="ghost" onClick={onClick} title={title} aria-label={title} className="attribute-number flex h-7 w-12 shrink-0 items-center justify-center rounded-sm border text-xs hover:border-ribbon-dark">{children}</Button>;
}

function Row({ badge, label, type, children, onRemove, onBadgeClick, badgeTitle, align = "center" }: { badge: ReactNode; label: string; type: AttrType; children: ReactNode; onRemove?: (() => void) | undefined; onBadgeClick?: (() => void) | undefined; badgeTitle?: string | undefined; align?: "center" | "start" }) {
  return (
    <div data-dense-row className={`attribute-value-row group flex gap-3 px-3 py-1.5 ${align === "center" ? "items-center" : "items-start"}`}>
      <Badge onClick={onBadgeClick} title={badgeTitle}>{badge}</Badge>
      <div className="flex w-[min(36%,320px)] shrink-0 items-center justify-between gap-2">
        <span className="truncate font-semibold">{label}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {onRemove && <X onClick={onRemove} className="hidden h-3.5 w-3.5 cursor-pointer hover:text-destructive group-hover:block" />}
          {TYPE_TAG[type]}
        </span>
      </div>
      <div className="attribute-value-control min-w-0 flex-1">{children}</div>
    </div>
  );
}

const input = "h-7 w-full border border-border bg-background px-2 text-[13px] outline-none focus:border-ribbon-dark";

type CaseSrc = { label: string; value: string };
const fmt = (v: string, m: string) => m === "up" ? v.toUpperCase() : m === "low" ? v.toLowerCase()
  : m === "inv" ? [...v].map((c) => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join("")
  : m === "first" ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
  : v.toLowerCase().replace(/(^|[\s\-_/(])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

type Check = "warn" | "error" | null;
export function TextField({ value, onCommit, caseBtn, source, check, multiline }: { value: string; onCommit: (v: string) => void; caseBtn?: boolean; source?: CaseSrc; check?: (v: string) => Check; multiline?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(value); }
  const status = check?.(text) ?? null;
  const item = "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-selection";
  const head = "border-y border-border bg-panel px-3 py-0.5 text-center font-semibold text-muted-foreground";
  const commit = (v: string) => {
    if (v === value) return;
    if (check?.(v) === "error") { showMessage(t("dupError", { n: v })); setText(value); return; }
    onCommit(v);
  };
  const pick = (v: string) => { setOpen(false); setText(v); commit(v); };
  const tone = status === "error" ? "!bg-destructive/15 !border-destructive" : status === "warn" ? "!bg-warning/25 !border-warning" : "";
  const lines = Math.min(10, Math.max(1, text.split("\n").length, Math.ceil(text.length / 90)));
  return (
    <div className="relative flex">
      {multiline
        ? <textarea value={text} maxLength={2000} rows={lines} onChange={(e) => setText(e.target.value)} onBlur={() => commit(text)}
            className={`${input} h-auto min-h-7 resize-y py-1 leading-5 ${tone}`} />
        : <input value={text} className={`${input} ${status ? "pr-7" : ""} ${tone}`} onChange={(e) => setText(e.target.value)} onBlur={() => commit(text)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(value); } }} />}
      {status && <span title={t(status === "error" ? "dupError" : "dupWarn", { n: text })} className={`absolute top-1.5 ${caseBtn ? "right-11" : "right-2"}`}>
        <TriangleAlert className={`h-4 w-4 ${status === "error" ? "text-destructive" : "text-warning"}`} /></span>}
      {multiline && <span className="pointer-events-none absolute bottom-0.5 right-11 text-[10px] text-muted-foreground">{text.length}/2000</span>}
      {caseBtn && <button title={t("caseMenu")} onClick={() => setOpen((o) => !o)}
        className={`h-7 w-9 shrink-0 border border-l-0 border-border text-xs font-semibold text-ribbon-dark hover:bg-selection ${open ? "bg-selection" : "bg-panel"}`}>Aa</button>}
      {open && <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="absolute right-0 top-7 z-50 min-w-72 border border-border bg-popover py-0 text-xs shadow-lg">
          <div className={head}>--- {t("caseFormat")} ---</div>
          {(["up", "low", "inv", "first", "words"] as const).map((m) => <button key={m} className={item} onClick={() => pick(fmt(text, m))}><Wrench className="h-3.5 w-3.5 text-ribbon-dark" />{t(`case_${m}`)}</button>)}
          {source && <>
            <div className={head}>--- {source.label} ---</div>
            {(["", "up", "low"] as const).map((m) => <button key={m} disabled={!source.value} className={`${item} disabled:opacity-40`} onClick={() => pick(m ? fmt(source.value, m) : source.value)}>
              <span className="w-3.5 text-center font-bold text-ribbon-dark">A</span>{t(m ? `take_${m}` : "take", { n: source.label })}</button>)}
          </>}
        </div>
      </>}
    </div>
  );
}

function NumberField({ value, type, unit, min, max, onCommit }: { value: string; type: AttrType; unit?: string | undefined; min?: number | undefined; max?: number | undefined; onCommit: (v: string) => void }) {
  const t = useT();
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(value); }
  const n = Number(text.replace(",", "."));
  const bad = text !== "" && (isNaN(n) || (type === "int" && !Number.isInteger(n)) || (min !== undefined && n < min) || (max !== undefined && n > max));
  const range = min !== undefined || max !== undefined ? `${t("range")} : ${min ?? "-∞"} … ${max ?? "+∞"}` : undefined;
  return (
    <div className="relative" title={range}>
      <input value={text} inputMode={type === "int" ? "numeric" : "decimal"} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        onBlur={() => { if (bad) { setText(value); return; } const v = text.replace(",", "."); if (v !== value) onCommit(v); }}
        className={`${input} ${unit ? "pr-12" : ""} ${bad ? "!border-destructive !bg-destructive/10" : ""}`} />
      {unit && <span className="absolute right-2 top-1.5 text-xs font-semibold text-muted-foreground">{unit}</span>}
      {bad && range && <span className="absolute -bottom-4 left-0 z-10 text-[10px] text-destructive">{range}</span>}
    </div>
  );
}

function Combo({ value, options, onCommit, showIndex = true }: { value: string; options: string[]; onCommit: (v: string) => void; showIndex?: boolean }) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  if (prev !== value) { setPrev(value); setText(value); }
  const q = text.toLowerCase();
  const list = open ? options.filter((o) => !q || o.toLowerCase().includes(q) || text === value) : [];
  const idx = options.indexOf(text);
  const pick = (o: string) => { setText(o); setOpen(false); if (o !== value) onCommit(o); };
  return (
    <div className="relative flex">
      <input value={text} className={`${input} ${showIndex ? "pr-10" : ""}`}
        onFocus={() => { setOpen(true); setHi(0); }} onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
        onBlur={() => setTimeout(() => { setOpen(false); if (text !== value) onCommit(text); }, 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, Math.max(0, list.length - 1))); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === "Enter") { if (open && list[hi]) pick(list[hi] ?? value); e.currentTarget.blur(); }
          else if (e.key === "Escape") { setText(value); setOpen(false); }
        }} />
      {showIndex && idx >= 0 && <span title="Index" className="pointer-events-none absolute right-11 top-1.5 text-[10px] text-muted-foreground">[{idx}]</span>}
      <button tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); }} className="flex h-7 w-9 shrink-0 items-center justify-center border border-l-0 border-border bg-panel hover:bg-selection"><ChevronDown className="h-3.5 w-3.5 text-ribbon-dark" /></button>
      {list.length > 0 && <div className="absolute left-0 right-0 top-7 z-30 max-h-56 overflow-auto border border-border bg-popover py-0.5 text-xs shadow-lg">
        {list.map((o, i) => (
          <div key={o} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setHi(i)}
            className={`flex cursor-pointer justify-between px-2 py-1 ${i === hi ? "bg-selection" : ""} ${o === value ? "font-semibold" : ""}`}>
            <span>{o}</span>{showIndex && <span className="text-muted-foreground">{options.indexOf(o)}</span>}
          </div>
        ))}
      </div>}
    </div>
  );
}

function CheckField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const on = value === "1";
  return <div className="flex h-7 items-center"><Checkbox checked={on} onCheckedChange={(checked) => onCommit(checked === true ? "1" : "0")} /></div>;
}

function DateField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const t = useT();
  const parse = (v: string) => { const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? new Date(+m[3]!, +m[2]! - 1, +m[1]!) : undefined; };
  const out = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex">
      <input key={value} defaultValue={value} placeholder="jj/mm/aaaa" className={input} onBlur={(e) => e.target.value !== value && onCommit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><button title={t("pickDate")} className="flex h-7 w-9 shrink-0 items-center justify-center border border-l-0 border-border bg-panel hover:bg-selection"><CalendarIcon className="h-3.5 w-3.5 text-ribbon-dark" /></button></PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar mode="single" {...(parse(value) ? { selected: parse(value)!, defaultMonth: parse(value)! } : {})} onSelect={(d) => { if (d) { onCommit(out(d)); setOpen(false); } }} initialFocus className="pointer-events-auto p-3" />
        </PopoverContent>
      </Popover>
    </div>
  );
}

const DEPTH = ["text-syn-fn", "text-syn-attr", "text-syn-var", "text-syn-num"];
function highlight(src: string, errPos: number | null, color: boolean, caret: number) {
  const parts: ReactNode[] = [];
  // matching bracket pairs
  const pair = new Map<number, number>(); const stack: number[] = [];
  for (let i = 0; i < src.length; i++) { if (src[i] === "(") stack.push(i); else if (src[i] === ")") { const o = stack.pop(); if (o !== undefined) { pair.set(o, i); pair.set(i, o); } } }
  const hot = new Set<number>();
  for (const c of [caret, caret - 1]) if (pair.has(c)) { hot.add(c); hot.add(pair.get(c)!); break; }
  const re = /(_[A-Z]+_)|(@\d+@)|(@[A-Z]+@)|("[^"]*")|(\d+(?:[.,]\d+)?)|([()])|([=<>+\-*/;,])/g;
  let last = 0, m: RegExpExecArray | null, k = 0, depth = 0;
  const push = (txt: string, cls: string, at: number) => {
    const e = errPos !== null && errPos >= at && errPos < at + txt.length ? " underline decoration-destructive decoration-wavy" : "";
    parts.push(<span key={k++} className={(color ? cls : "") + e}>{txt}</span>);
  };
  while ((m = re.exec(src))) {
    if (m.index > last) push(src.slice(last, m.index), "", last);
    let cls = m[1] ? "text-syn-fn font-semibold" : m[2] ? "text-syn-attr" : m[3] ? "text-syn-var font-semibold" : m[4] ? "text-syn-num italic" : m[5] ? "text-syn-num" : "text-muted-foreground";
    if (m[6]) {
      const unmatched = !pair.has(m.index);
      if (m[6] === ")") depth--;
      cls = unmatched ? "text-destructive font-bold" : `${DEPTH[((depth % 4) + 4) % 4]} font-bold`;
      if (hot.has(m.index)) cls += " rounded-[2px] bg-selection outline outline-1 outline-ribbon-dark";
      if (m[6] === "(") depth++;
    }
    push(m[0], cls, m.index); last = m.index + m[0].length;
  }
  if (last < src.length) push(src.slice(last), "", last);
  return parts;
}

export function FormulaEditor({ value, onCommit, onDraft, nodeId, attribute, showFavorites = true, onFavoriteApply }: { value: string; onCommit: (v: string) => void; onDraft?: (v: string) => void; nodeId?: string | undefined; attribute?: FormulaAttribute | undefined; showFavorites?: boolean; onFavoriteApply?: ((formula: string) => void) | undefined }) {
  const t = useT();
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (prev !== value) { setPrev(value); setText(value); }
  const ref = useRef<HTMLTextAreaElement>(null);
  const [ac, setAc] = useState<{ items: string[]; idx: number; from: number } | null>(null);
  const [color, setColor] = useState(true);
  const [tools, setTools] = useState(true);
  const [trans, setTrans] = useState(true);
  const [dlg, setDlg] = useState<string | null>(null);
  const [caret, setCaret] = useState(-1);
  const err = validateFormula(text);

  const suggestions = (v: string, caretPos: number) => {
    const before = v.slice(0, caretPos);
    const m = before.match(/(_[A-Z]*|@[A-Z0-9]*)$/);
    if (!m) return setAc(null);
    const tok = m[1]!;
    const f = useAttrFavorites.getState().favs;
    const favAttrs = [...new Set([...f.formula, ...f.component, ...f.group])].map((n) => `@${n}@`);
    const all = [...new Set([...favAttrs, ...FUNCTIONS, ...VARIABLES, ...ATTRIBUTE_CATALOG.map((a) => `@${a.num}@`)])];
    const items = all.filter((x) => x.startsWith(tok) && x !== tok).slice(0, 8);
    setAc(items.length ? { items, idx: 0, from: caretPos - tok.length } : null);
  };
  const insertAt = (snippet: string, from?: number) => {
    const el = ref.current; if (!el) return; const s = from ?? el.selectionStart; const e = el.selectionEnd;
    const v = text.slice(0, s) + snippet + text.slice(e);
    setText(v); onDraft?.(v); setAc(null);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + snippet.length; setCaret(s + snippet.length); });
  };
  const label = (x: string) => { const a = ATTRIBUTE_CATALOG.find((a) => `@${a.num}@` === x); return a ? a.name : x.startsWith("_") ? "function" : "variable"; };

  const side = "flex h-8 w-8 items-center justify-center hover:bg-selection";
  const on = "bg-selection";
  const grid: [ReactNode, string, string, boolean?][] = [
    [<Ico src={formulaArtwork.fx} />, t("fFavorites"), ""],
    [<Ico src={formulaArtwork.attributeAdd} />, t("fInsertAttr"), "@attr"],
    [<Sparkles className="h-4 w-4 text-muted-foreground" />, t("fAI"), "", true],
  ];
  const track = () => setCaret(ref.current?.selectionStart ?? -1);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex flex-1 border border-border bg-background">
          <div className="relative flex-1">
            <pre aria-hidden className="pointer-events-none absolute inset-0 m-0 whitespace-pre-wrap break-all p-2 font-mono text-sm leading-6">{highlight(text, err?.pos ?? null, color, caret)}{"\n"}</pre>
            <textarea ref={ref} value={text} spellCheck={false} onSelect={track} onKeyUp={track} onClick={track}
              onChange={(e) => { setText(e.target.value); onDraft?.(e.target.value); setCaret(e.target.selectionStart); suggestions(e.target.value, e.target.selectionStart); }}
              onBlur={() => setTimeout(() => { setAc(null); setCaret(-1); if (text !== value) onCommit(text); }, 150)}
              onKeyDown={(e) => {
                if (!ac) {
                  if (e.key === "(") { e.preventDefault(); insertAt("()"); requestAnimationFrame(() => { const el = ref.current!; el.selectionStart = el.selectionEnd = el.selectionStart - 1; track(); }); }
                  return;
                }
                if (e.key === "ArrowDown") { e.preventDefault(); setAc({ ...ac, idx: (ac.idx + 1) % ac.items.length }); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setAc({ ...ac, idx: (ac.idx - 1 + ac.items.length) % ac.items.length }); }
                else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const el = ref.current!; el.selectionEnd = el.selectionStart; insertAt(ac.items[ac.idx]!, ac.from); }
                else if (e.key === "Escape") setAc(null);
              }}
              className={`relative h-32 w-full resize-none bg-transparent p-2 font-mono text-sm leading-6 caret-foreground outline-none ${color ? "text-transparent" : "text-transparent"}`} />
            {ac && (
              <div className="absolute left-2 top-8 z-20 min-w-52 border border-border bg-popover py-1 text-xs shadow-lg">
                {ac.items.map((x, i) => (
                  <div key={x} onMouseDown={(e) => { e.preventDefault(); insertAt(x, ac.from); }}
                    className={`flex cursor-pointer justify-between gap-4 px-2 py-0.5 ${i === ac.idx ? "bg-selection" : ""}`}>
                    <span className="font-mono">{x}</span><span className="text-muted-foreground">{label(x)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col border-l border-border bg-panel">
            <button className={side} title={err ? `${err.msg} (col ${err.pos + 1})` : t("valid")}>
              {err ? <AlertCircle className="h-4 w-4 text-destructive" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success"><Check className="h-3 w-3 text-background" strokeWidth={3} /></span>}
            </button>
            <button className={`${side} ${color ? on : ""}`} title={t("fColor")} aria-pressed={color} onClick={() => setColor(!color)}><Palette className="h-4 w-4 text-icon-link" /></button>
            <button className={`${side} ${tools ? on : ""}`} title={t("fTools")} aria-pressed={tools} onClick={() => setTools(!tools)}><Wrench className="h-4 w-4 text-muted-foreground" /></button>
            <button className={`${side} ${trans ? on : ""}`} title={t("fTranslate")} aria-pressed={trans} onClick={() => setTrans(!trans)}><Languages className="h-4 w-4 text-ribbon-dark" /></button>
          </div>
        </div>
        {tools && <div className="flex w-28 flex-col border border-border bg-panel">
          <div className="grid grid-cols-3">
            {grid.map(([ic, title, snip, disabled]) => (
              title === t("fFavorites") ? (showFavorites ? <FormulaFavoritesMenu key={title} nodeId={nodeId} attribute={attribute} value={text} onApply={onFavoriteApply} compact /> : <span key={title} className="flex h-9 items-center justify-center opacity-40">{ic}</span>) : <button key={title} title={title} disabled={disabled} className="flex h-9 items-center justify-center hover:bg-selection disabled:cursor-not-allowed disabled:opacity-40"
                onMouseDown={(e) => { e.preventDefault(); if (snip === "@attr") setDlg("attr"); else if (snip) insertAt(snip); else if (!disabled) showMessage(`${title} — ${t("soon")}`); }}>{ic}</button>
            ))}
            <FunctionMenu onInsert={insertAt} />
            <OperatorMenu onInsert={insertAt} />
            <ObjectMenu onInsert={insertAt} />
            <button title={t("fFinishing")} className="flex h-9 items-center justify-center hover:bg-selection" onMouseDown={(e) => { e.preventDefault(); setDlg("finish"); }}><img src={ToolIcons.finish} alt="" className="h-4 w-4" /></button>
            <button title={t("trade")} className="flex h-9 items-center justify-center hover:bg-selection" onMouseDown={(e) => { e.preventDefault(); setDlg("trade"); }}><img src={ToolIcons.trade} alt="" className="h-4 w-4" /></button>
            <HelpMenu />
          </div>
          <div className="mt-auto border-t border-border py-1 text-center text-[11px] text-muted-foreground">{text.length} {t("chars")}</div>
        </div>}
      </div>
      {err && <div className="flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" /> {err.msg} (col {err.pos + 1})</div>}
      {dlg === "finish" && <FinishingDialog onInsert={insertAt} onClose={() => setDlg(null)} />}
      {dlg === "attr" && <AttrPickerDialog context="formula" onAdd={(ns) => insertAt(ns.map((n) => `@${n}@`).join(" "))} onClose={() => setDlg(null)} />}
      {dlg === "trade" && <TradeDialog onInsert={insertAt} onClose={() => setDlg(null)} />}
      {dlg?.startsWith("help:") && <HelpDialog topic={dlg.slice(5)} onClose={() => setDlg(null)} />}
      {trans && <div className="min-h-24 border border-border bg-muted p-2 text-[13px] text-muted-foreground">{humanizeFormula(text)}</div>}
    </div>
  );
}


/** Shared value control for editable catalogs/models and read-only external sources. */
export function AttributeValueField({ num, value, onCommit = () => {}, nodeId, attrs, readOnly = false }: { num: number; value: string; onCommit?: (v: string) => void; nodeId?: string | undefined; attrs?: Record<number, string> | undefined; readOnly?: boolean }) {
  const t = useT();
  const d = ATTRIBUTE_CATALOG.find((a) => a.num === num) ?? { num, name: `Attribute ${num}`, type: "text" as AttrType };
  const control = d.control ?? "edit";
  if (isLayerAttribute(num)) return <LayerAttributeField num={num} value={value} onCommit={onCommit} nodeId={nodeId} attrs={attrs} readOnly={readOnly} />;
  if (isFillAttribute(num)) return <FillAttributeField num={num} value={value} onCommit={onCommit} nodeId={nodeId} attrs={attrs} readOnly={readOnly} />;
  if (num === 335) return <ImagePathField surf value={value} onCommit={onCommit} readOnly={readOnly} />;
  if (readOnly) {
    if (control === "formula") return <div className="space-y-1"><pre className="m-0 min-h-7 whitespace-pre-wrap break-words border border-border bg-background p-2 font-mono text-sm leading-6">{highlight(value, validateFormula(value)?.pos ?? null, true, -1)}</pre><div className="whitespace-pre-wrap text-[10px] leading-4 text-muted-foreground">{humanizeFormula(value)}</div></div>;
    if (control === "check") return <div className="flex h-7 items-center"><Checkbox aria-label={d.name} checked={value === "1"} disabled /></div>;
    if (control === "combo") {
      const idx = (d.options ?? []).indexOf(value);
      return <div className="relative flex"><input aria-label={d.name} role="combobox" aria-expanded={false} aria-readonly readOnly value={value} className={`${input} pr-10`} />{idx >= 0 && <span title="Index" className="pointer-events-none absolute right-11 top-1.5 text-[10px] text-muted-foreground">[{idx}]</span>}<Button variant="outline" size="icon" disabled aria-label={d.name} className="h-7 w-9 shrink-0 rounded-none border-l-0 bg-panel p-0 disabled:opacity-100"><ChevronDown className="h-3.5 w-3.5 text-ribbon-dark" /></Button></div>;
    }
    if (control === "date") return <div className="flex"><input aria-label={d.name} readOnly value={value} className={input} /><Button variant="outline" size="icon" disabled aria-label={t("pickDate")} className="h-7 w-9 shrink-0 rounded-none border-l-0 bg-panel p-0 disabled:opacity-100"><CalendarIcon className="h-3.5 w-3.5 text-ribbon-dark" /></Button></div>;
    if (d.type === "text") return <textarea aria-label={d.name} readOnly value={value} rows={Math.min(8, Math.max(1, value.split("\n").length))} className="min-h-7 w-full resize-none border border-border bg-background px-2 py-1 text-[13px] outline-none" />;
    return <div className="relative"><input aria-label={d.name} readOnly value={value} inputMode={d.type === "int" ? "numeric" : "decimal"} className={`${input} ${d.unit ? "pr-12" : ""}`} />{d.unit && <span className="absolute right-2 top-1.5 text-xs font-semibold text-muted-foreground">{d.unit}</span>}</div>;
  }
  return control === "formula" ? <FormulaEditor value={value} onCommit={onCommit} nodeId={nodeId} attribute={isFormulaAttribute(num) ? num : undefined} showFavorites={!!nodeId} />
    : control === "check" ? <CheckField value={value} onCommit={onCommit} />
    : control === "date" ? <DateField value={value} onCommit={onCommit} />
    : control === "combo" ? <Combo value={value} options={d.options ?? []} onCommit={onCommit} showIndex />
    : d.type !== "text" ? <NumberField value={value} type={d.type} unit={d.unit} min={d.min} max={d.max} onCommit={onCommit} />
    : <TextField value={value} onCommit={onCommit} caseBtn multiline />;
}

/** Draggable wrapper for one attribute row: reorder inside the panel, drop onto the tree, copy or cut. */
export function AttributeValueRow({ num, value, onCommit, onRemove, nodeId, attrs }: { num: number; value: string; onCommit: (v: string) => void; onRemove?: () => void; nodeId?: string; attrs?: Record<number, string> }) {
  const t = useT();
  const d = ATTRIBUTE_CATALOG.find((a) => a.num === num) ?? { num, name: t("unknownAttribute"), type: "text" as AttrType };
  return <Row badge={num} label={d.name} type={d.type} onRemove={onRemove} align={d.control === "formula" || d.type === "text" ? "start" : "center"}><AttributeValueField num={num} value={value} onCommit={onCommit} nodeId={nodeId} attrs={attrs} /></Row>;
}

/** Light tint marking unknown (not in the Allplan list), user (2000–11999) and import (55000–99000) attributes. */
function attrTint(k: number) {
  if (k === TITLE || k === 207) return "";
  if (k >= 2000 && k <= 11999) return "attr-row-user";
  if (k >= 55000 && k <= 99000) return "attr-row-import";
  return ATTRIBUTE_CATALOG.some((a) => a.num === k) ? "" : "attr-row-unknown";
}

function AttrLine({ nodeId, k, over, setOver, onDropOn, selectedKeys, onSelect, children, dropAfter = false }: {
  dropAfter?: boolean; nodeId: string; k: number; over: number | null; setOver: (k: number | null) => void; onDropOn?: ((k: number) => void) | undefined; children: ReactNode; selectedKeys: number[]; onSelect: (key: number, e?: MouseEvent) => void;
}) {
  const t = useT();
  const setAttrClip = useCatalog((s) => s.setAttrClip);
  const clip = useCatalog((s) => s.attrClip);
  const copyOnly = k === TITLE || k === 207;
  const isCut = !copyOnly && clip?.cut && clip.fromId === nodeId && (clip.keys ?? [clip.key]).includes(k);
  const chosen = selectedKeys.includes(k);
  const batch = [...new Set((chosen ? selectedKeys : [k]).flatMap((num) => isLayerAttribute(num) ? [141, 349, 346, 345, 347] : isRoomAttribute(num) ? [...ROOM_ATTRIBUTES] : isFillAttribute(num) ? FILL_ATTRIBUTES.filter((key) => useCatalog.getState().nodes[nodeId]?.attrs[key] !== undefined) : [num]))];
  const [editing, setEditing] = useState(false);
  return (
    <div data-draggable-row data-drop-position={over === k ? (dropAfter ? "after" : "before") : undefined} draggable={!editing} tabIndex={0}
      onPointerDownCapture={(e) => setEditing(!!(e.target as HTMLElement).closest("input,textarea,select,[contenteditable]"))}
      onFocusCapture={(e) => { if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) setEditing(true); }}
      onBlurCapture={() => setEditing(false)} aria-label={t("selectAttr", { n: k === TITLE ? t("title") : k })} data-attr-key={k} data-selected={chosen}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("input,textarea,select,button")) onSelect(k, e); }}
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest("input,textarea,select")) { e.preventDefault(); return; }
        dragFolderIcon.current = null;
        dragAttr.current = { fromId: nodeId, key: k, keys: batch, copy: e.ctrlKey || e.metaKey };
        if (!chosen) onSelect(k);
        e.dataTransfer.setData("text/plain", batch.join(",")); e.dataTransfer.effectAllowed = "copyMove";
      }}
      onDragEnd={() => { dragAttr.current = null; setOver(null); }}
      onDragOver={(e) => { if (onDropOn && dragAttr.current?.fromId === nodeId && !(dragAttr.current.keys ?? [dragAttr.current.key]).includes(k)) { e.preventDefault(); if (over !== k) setOver(k); } }}
      onDrop={(e) => { if (dragExternalAttrs.current || dragTemplate.current || dragNewAttrs.current) return; e.preventDefault(); setOver(null); if (onDropOn) onDropOn(k); dragAttr.current = null; }}
      className={`group/line relative flex items-start ${isCut ? "opacity-50" : ""} ${chosen ? "bg-selection" : attrTint(k)}`}>
      <RowDragGrip className="absolute left-0 top-1.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const pill = "flex h-7 shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-2 text-xs hover:border-ribbon-dark hover:bg-selection";

/** Special row of a link: target ouvrage, its status (dead / circular) and quick actions. */
function LinkTargetRow({ node }: { node: CatalogNode }) {
  const t = useT();
  const nodes = useCatalog((s) => s.nodes); const reveal = useCatalog((s) => s.reveal);
  const target = linkTarget(nodes, node); const status = linkStatus(nodes, node);
  return <Row badge={<NodeIcon type="link" size={14} />} label={t("lnkTarget")} type="text">
    <div className="flex items-center">
      <button type="button" onClick={() => useLinkDialog.getState().show(node.id)} title={t("lnkRetarget")}
        className={`flex h-7 min-w-0 flex-1 items-center gap-2 border bg-background px-2 text-left text-[13px] hover:border-ribbon-dark ${status === "ok" ? "border-border" : status === "dead" ? "border-destructive" : "border-warning"}`}>
        {target ? <NodeIcon node={target} /> : <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}
        <span className="truncate font-semibold">{node.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{target ? (target.attrs[207] ?? target.description) : ""}</span>
        {status === "dead" && <span className="shrink-0 text-xs text-destructive">{t("lnkDead")}</span>}
        {status === "circular" && <span className="flex shrink-0 items-center gap-1 text-xs text-warning"><TriangleAlert className="h-3.5 w-3.5" />{t("lnkCircular")}</span>}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ribbon-dark" />
      </button>
      <button type="button" disabled={!target} aria-label={t("lnkShow")} className="flex h-7 w-9 shrink-0 items-center justify-center border border-l-0 border-border bg-panel hover:bg-selection disabled:opacity-40" title={t("lnkShow")} onClick={() => target && reveal(target.id)}><Eye className="h-4 w-4 text-ribbon-dark" /></button>
    </div>
  </Row>;
}

/** Components of the linked ouvrage, read-only, each one clickable to show it. */
function LinkedComponents({ node }: { node: CatalogNode }) {
  const t = useT();
  const nodes = useCatalog((s) => s.nodes); const reveal = useCatalog((s) => s.reveal);
  const target = linkTarget(nodes, node); if (!target) return null;
  const kids = (target.children ?? []).map((id) => nodes[id]).filter((n): n is CatalogNode => !!n);
  return <div className="mt-2">
    <div className="catalog-panel-heading flex h-7 items-center justify-center px-3 text-xs font-semibold">{t("lnkContent", { n: target.name })} <span className="ml-2 font-normal text-muted-foreground">{kids.length}</span></div>
    <TooltipProvider delayDuration={250}>{kids.map((c, i) => { const forms = [96, 267, 76, 180].filter((k) => c.attrs[k]);
      const row = <button key={c.id} type="button" onClick={() => reveal(c.id)}
      className={`flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-selection ${i % 2 ? "bg-row-alt" : "bg-background"}`}>
      <span className="flex w-12 shrink-0 justify-center"><NodeIcon node={c} /></span>
      <span className="w-[min(36%,320px)] shrink-0 truncate font-semibold">{c.type === "component" ? (c.attrs[83] ?? c.name) : c.name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.type === "link" ? (linkTarget(nodes, c)?.description ?? "") : (c.attrs[207] ?? c.description)}</span>
    </button>;
      return <Tooltip key={c.id}><TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="left" align="start" className="max-w-md space-y-1.5 border border-border bg-panel p-2 text-xs text-foreground shadow-md">
          <div className="flex items-center gap-2 font-semibold"><NodeIcon node={c} size={14} />{c.name}</div>
          {(c.type === "link" ? linkTarget(nodes, c)?.description : (c.attrs[207] ?? c.description)) && <div className="text-muted-foreground">{c.type === "link" ? linkTarget(nodes, c)?.description : (c.attrs[207] ?? c.description)}</div>}
          {c.type === "link" && linkStatus(nodes, c) !== "ok" && <div className="text-warning">{t(linkStatus(nodes, c) === "dead" ? "lnkDead" : "lnkCircular")}</div>}
          {forms.map((k) => <div key={k} className="border-t border-border pt-1.5"><div className="mb-0.5 text-[10px] font-semibold text-muted-foreground">@{k}@</div><div className="whitespace-pre-wrap break-words font-mono text-[11px]">{c.attrs[k]}</div><div className="whitespace-pre-wrap text-[11px] text-muted-foreground">{humanizeFormula(c.attrs[k]!)}</div></div>)}
          <div className="border-t border-border pt-1 text-[10px] text-muted-foreground">{t("lnkShow")}</div>
        </TooltipContent></Tooltip>; })}</TooltipProvider>
    {!kids.length && <div className="px-3 py-2 text-center text-xs text-muted-foreground">{t("lnkEmpty")}</div>}
  </div>;
}

export function PropertyPanel() {
  const t = useT();
  const { nodes, selected, update, setAttr, attrClip, transferAttrs, setAttrClip, reorderAttr } = useCatalog();
  const rootIds = useCatalog((s) => s.rootIds);
  const titleCheck = (n: CatalogNode, v: string): "warn" | "error" | null => {
    const name = v.trim(); if (!name) return null;
    if (n.type === "group") return groupNameTaken(nodes, name, n.id) ? "error" : null;
    const sib = n.parentId ? nodes[n.parentId]?.children ?? [] : rootIds;
    return sib.some((id) => id !== n.id && nodes[id]?.type === n.type && nodes[id]!.name.trim() === name) ? "warn" : null;
  };
  const sort = useAttrOrder((s) => s.sort), setSort = useAttrOrder((s) => s.setSort);
  const customOrder = useAttrOrder((s) => s.order), fallback = useAttrOrder((s) => s.fallback);
  const orderFavs = useAttrOrder((s) => s.favorites), activeOrder = useAttrOrder((s) => s.active), chooseOrder = useAttrOrder((s) => s.choose);
  const activeFav = orderFavs.find((f) => f.id === activeOrder);
  const attrLabel = (n: number) => ATTRIBUTE_CATALOG.find((a) => a.num === n)?.name ?? "";
  const [orderDlg, setOrderDlg] = useState(false);
  const picker = useAttrFavorites((s) => s.picker);
  const openPicker = useAttrFavorites((s) => s.openPicker);
  const dlg = picker?.kind === "node";
  const setDlg = (v: boolean) => openPicker(v ? { kind: "node" } : null);
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [incoming, setIncoming] = useState(false);
  useEffect(() => {
    const clear = () => { setIncoming(false); setOver(null); };
    window.addEventListener("dragend", clear); window.addEventListener("drop", clear);
    return () => { window.removeEventListener("dragend", clear); window.removeEventListener("drop", clear); };
  }, []);
  const [attrSelection, setAttrSelection] = useState<{ id: string; keys: number[]; anchor: number | null }>({ id: "", keys: [], anchor: null });
  const node = selected[0] ? nodes[selected[0]] : undefined;

  const shell = (c: ReactNode) => { const content = <div tabIndex={0}
    onDragOverCapture={() => {
      const external = dragExternalAttrs.current;
      const validExternal = external && node && node.type !== "link" && (node.type !== "folder" || external.keys.every((k) => k === TITLE || k === 207));
      const validModel = node && (node.type === "group" || node.type === "component") && (dragFormula.current || dragNewAttrs.current || dragTemplate.current);
      setIncoming(!!(validExternal || validModel));
    }}
    onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) { setIncoming(false); setOver(null); } }}
    onDragOver={(e) => { if (!dragExternalAttrs.current || !node) return; const valid = node.type !== "link" && (node.type !== "folder" || dragExternalAttrs.current.keys.every((k) => k === TITLE || k === 207)); e.dataTransfer.dropEffect = valid ? "copy" : "none"; if (valid) e.preventDefault(); }} onDrop={(e) => { const payload = dragExternalAttrs.current; if (!payload || !node) return; e.preventDefault(); e.stopPropagation(); setIncoming(false); const count = useCatalog.getState().importExternalAttrs(payload.data, payload.nodeIds, payload.keys, node.id); dragExternalAttrs.current = null; if (count === null) showMessage(t("extAttrsBlocked")); }} onKeyDown={(e) => {
    if (!node || (e.target as HTMLElement).closest("input,textarea,select")) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (!["a", "c", "x", "v"].includes(key)) return;
    e.preventDefault(); e.stopPropagation();
    if (key === "a") setAttrSelection({ id: node.id, keys: visibleKeys, anchor: visibleKeys[0] ?? null });
    else if (key === "v") { if (attrClip && transferAttrs(attrClip.fromId, attrClip.keys ?? [attrClip.key], node.id, attrClip.cut)) setAttrClip(null); }
    else if (selectedKeys.length) setAttrClip({ fromId: node.id, key: selectedKeys[0] ?? TITLE, keys: selectedKeys, cut: key === "x" });
  }} className={`attribute-panel h-full overflow-auto border border-border bg-background ${incoming ? "drop-target" : ""}`}>{c}</div>; return node ? <AttributeTemplateContext nodeId={node.id}>{content}</AttributeTemplateContext> : content; };
  if (!node) return shell(<div className="p-6 text-center text-muted-foreground">{t("noSel")}</div>);

  const rawKeys = Object.keys(node.attrs).map(Number).filter((k) => k !== 207);
  const visibleKeys = [TITLE, 207, ...(node.type === "folder" || node.type === "link" ? [] : [...new Set([...(node.type === "component" ? [202, 203, 209] : []), ...rawKeys, ...(node.type === "component" ? [267] : [])])])];
  const selectedKeys = attrSelection.id === node.id ? attrSelection.keys.filter((k) => visibleKeys.includes(k)) : [];
  const onSelect = (key: number, e?: MouseEvent) => {
    let next: number[];
    if (e?.shiftKey && attrSelection.id === node.id && attrSelection.anchor !== null) {
      const a = selectionOrder.indexOf(attrSelection.anchor), b = selectionOrder.indexOf(key);
      next = selectionOrder.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else if (!e || e.ctrlKey || e.metaKey) next = selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key];
    else next = [key];
    setAttrSelection({ id: node.id, keys: next, anchor: e?.shiftKey ? attrSelection.anchor : key });
  };
  const selectionProps = { selectedKeys, onSelect };
  const clipKeys = attrClip ? attrClip.keys ?? [attrClip.key] : [];
  const canPaste = !!attrClip && !!nodes[attrClip.fromId] && attrClip.fromId !== node.id && node.type !== "link"
    && (node.type !== "folder" || clipKeys.every((key) => key === TITLE || key === 207));
  const pasteBtn = attrClip && (
    <Button variant="outline" size="sm" disabled={!canPaste} title={t("pasteAttr")} aria-label={t("pasteAttr")} onClick={() => { if (transferAttrs(attrClip.fromId, clipKeys, node.id, attrClip.cut)) setAttrClip(null); }} className="h-7">
      <ClipboardPaste className="h-3.5 w-3.5" />{clipKeys.length > 1 ? t("selectedAttrs", { n: clipKeys.length }) : attrClip.key === TITLE ? t("title") : attrClip.key}
    </Button>
  );
  const nodeCode = node.type === "component" ? (node.attrs?.[83] ?? node.name) : node.name;
  const headerLabel = node.type === "folder" || node.type === "link"
    ? `${node.type === "folder" ? t("nodeFolder") : t("link")} : "${nodeCode}"`
    : `${node.type === "component" ? t("component") : t("nodeGroup")} : "${nodeCode}"`;
  const iconBtn = "flex h-full w-8 items-center justify-center rounded-none p-0 hover:bg-selection";
  const hasExtra = node.type !== "folder" && node.type !== "link";
  const selectionBar = <div className="catalog-panel-heading flex h-7 shrink-0 items-stretch text-xs">
    {hasExtra && <Button variant="ghost" size="icon" className="flex h-full w-8 items-center justify-center rounded-none border-r border-border p-0 hover:bg-selection" onClick={() => setDlg(true)} title={t("addAttr")}>
      <img src={attrAddIcon.url} alt="" className="h-4 w-4 object-contain" draggable={false} />
    </Button>}
    {hasExtra && <div className="flex items-stretch border-r border-border">
      <Button variant="ghost" size="icon" className={`${iconBtn} ${sort === "name" ? "bg-selection" : ""}`} onClick={() => setSort("name")} title="A → Z"><Ico src={azIcon.url} /></Button>
      <Button variant="ghost" size="icon" className={`${iconBtn} ${sort === "nameDesc" ? "bg-selection" : ""}`} onClick={() => setSort("nameDesc")} title="Z → A"><Ico src={zaIcon.url} /></Button>
      <Button variant="ghost" size="icon" className={`${iconBtn} ${sort === "asc" ? "bg-selection" : ""}`} onClick={() => setSort("asc")} title="1 → 9"><Ico src={i19Icon.url} /></Button>
      <Button variant="ghost" size="icon" className={`${iconBtn} ${sort === "desc" ? "bg-selection" : ""}`} onClick={() => setSort("desc")} title="9 → 1"><Ico src={i91Icon.url} /></Button>
      <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" className={`${iconBtn} ${sort === "custom" ? "bg-selection" : ""}`} aria-pressed={sort === "custom"} aria-label={t("orderCustom")}
        data-tip={`${activeFav?.name ?? t("orderCustom")}\n${t("orderCustom")}\n#${t("orderFavorite")}\n${(activeFav?.order ?? []).slice(0, 12).map((n, i) => `~${i + 1}|${n} · ${attrLabel(n)}`).join("\n")}${(activeFav?.order.length ?? 0) > 12 ? "\n…" : ""}\n=${t("orderOthersAfter")}|${{ asc: "1 → 9", desc: "9 → 1", name: "A → Z", nameDesc: "Z → A" }[activeFav?.fallback ?? "asc"]}`}><Ico src={custom2Icon.url} /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1 text-xs">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("orderChoose")}</div>
          {orderFavs.map((f) => <button key={f.id} onClick={() => chooseOrder(f.id)} className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-selection ${sort === "custom" && f.id === activeOrder ? "bg-selection font-semibold" : ""}`}
            data-tip={`${f.name}\n${f.order.slice(0, 12).map((n, i) => `~${i + 1}|${n} · ${attrLabel(n)}`).join("\n")}`}><span className="flex-1 truncate">{f.name}</span><span className="text-[10px] text-muted-foreground">{f.order.length}</span></button>)}
          <div className="my-1 border-t border-border" />
          <button onClick={() => setOrderDlg(true)} className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-selection">{t("orderManage")}</button>
        </PopoverContent></Popover>
      <Button variant="ghost" size="icon" className={iconBtn} onClick={() => setOrderDlg(true)} title={t("orderSettings")}><Ico src={customIcon.url} /></Button>
    </div>}
    <span className="flex flex-1 items-center justify-center truncate px-2 font-semibold">{headerLabel}</span>
  </div>;
  let selectionOrder = visibleKeys;
  const titleRow = (
    <AttrLine {...selectionProps} nodeId={node.id} k={TITLE} over={null} setOver={setOver}>
      <Row badge={<NodeIcon node={node} />} label={t("title")} type="text" onBadgeClick={node.type === "folder" ? () => setIconPickerId(node.id) : undefined} badgeTitle={node.type === "folder" ? t("chooseFolderIcon") : undefined}>
        <TextField value={node.name} check={(v) => titleCheck(node, v)} onCommit={(v) => update(node.id, { name: v })} caseBtn source={{ label: t("designation"), value: node.type === "folder" ? node.description : (node.attrs[207] ?? node.description) }} />
      </Row>
    </AttrLine>
  );
  const multi = selected.length > 1 && <div className="bg-selection px-3 py-1 text-xs">{selected.length} {t("multi")}</div>;
  const descRow = (label: string) => (
    <AttrLine {...selectionProps} nodeId={node.id} k={207} over={over} setOver={setOver} dropAfter onDropOn={sort === "custom" ? () => { if (keys.length) dropOn(keys[0]!); } : undefined}>
      <Row badge="207" label={label} type="text"><TextField value={node.description} onCommit={(v) => update(node.id, { description: v })} caseBtn source={{ label: t("code"), value: node.name }} /></Row>
    </AttrLine>
  );

  if (node.type === "link") {
    return shell(
      <div className="pb-2">
        {multi}{selectionBar}<LinkTargetRow node={node} />{descRow(t("description"))}<LinkedComponents node={node} />
      </div>,
    );
  }
  if (node.type === "folder") {
    return shell(
      <div className="pb-2">
        {multi}{selectionBar}{titleRow}{descRow(t("description"))}
        {pasteBtn && <div className="px-8 py-1.5">{pasteBtn}</div>}
        {node.type === "folder" && <FolderIconPicker key={node.id} id={node.id} icon={node.icon} open={iconPickerId === node.id} onOpenChange={(open) => setIconPickerId(open ? node.id : null)} />}
      </div>,
    );
  }

  const a = node.attrs;
  const isComp = node.type === "component";
  const base = isComp ? [202, 203, 209] : [];
  const extra = Object.keys(a).map(Number).filter((n) => n !== 207 && n !== 267 && !base.includes(n));
  const def = (n: number) => ATTRIBUTE_BY_NUMBER.get(n) ?? { num: n, name: t("unknownAttribute"), type: "text" as AttrType };
  const present = [...base, ...extra, ...(isComp || a[267] !== undefined ? [267] : [])];
  const nameOf = (n: number) => def(n).name;
  const keys = sort === "custom" ? applyCustomOrder(present, customOrder, fallback, nameOf) : sortKeys(present, sort, nameOf);
  selectionOrder = [TITLE, 207, ...keys];
  const dropOn = (target: number) => {
    const batch = (dragAttr.current?.keys ?? (dragAttr.current ? [dragAttr.current.key] : [])).filter((k) => keys.includes(k));
    if (!batch.length || batch.includes(target)) return;
    const next = keys.filter((k) => !batch.includes(k)); next.splice(next.indexOf(target), 0, ...keys.filter((k) => batch.includes(k)));
    // Dragging always writes into the personal custom order, which then applies to every item.
    const st = useAttrOrder.getState(); st.save(mergeVisibleOrder(st.order, next), st.fallback); setSort("custom"); reorderAttr(node.id, next);
  };

  // Nested bundle rows (layer/fill) alternate across wrappers, like the room group.
  const field = (k: number): ReactNode => {
    if (k === 118) { let index = 0; return <div data-zebra><FillAttributeRows attrs={a} onCommit={(num, value) => setAttr(node.id, num, value)} renderRow={(num, label, control) => <div data-bundle-alt={index++ % 2 === 1 ? "true" : "false"}><Row badge={num} label={label} type={num === 336 ? "text" : "int"} badgeTitle={`${num} · ${label}\n${t("fillBundle")}`} onRemove={num === 118 ? () => setAttr(node.id, 118, null) : undefined}>{control}</Row></div>} /></div>; }
    if (isLayerAttribute(k)) { let index = 1; return <div data-zebra><div data-bundle-alt="false"><Row badge={141} label="Layer" type="int" badgeTitle={`141 · Layer\n${t("layerBundle")}`}><LayerAttributeField num={141} value={a[141] ?? "0"} attrs={a} onCommit={(value) => setAttr(node.id, 141, value)} /></Row></div><LineStyleField attrs={a} onCommit={(num, value) => setAttr(node.id, num, value)} renderRow={(num, label, control) => <div data-bundle-alt={index++ % 2 === 1 ? "true" : "false"}><Row badge={num} label={label} type="int" badgeTitle={`${num} · ${label}\n${t("layerBundle")}`}>{control}</Row></div>} /></div>; }
    if (k === 231) return <>{ROOM_ATTRIBUTES.map((num) => {
      const d = ATTRIBUTE_BY_NUMBER.get(num);
      const label = d?.name ?? String(num), tip = `${num} · ${label}\n${t("roomBundle")}`;
      const opts = roomOptions(num, useCatalog.getState().lang);
      const saved = a[num] ?? "";
      const index = roomChoiceIndex(num, saved, useCatalog.getState().lang);
      const displayed = num === 233 ? opts[Number(saved)] ?? "" : num === 235 && index >= 0 ? opts[index] ?? saved : saved;
      const commit = (v: string) => setAttr(node.id, num, num === 233 ? String(Math.max(0, opts.indexOf(v))) : v);
      const ctl = opts.length
        ? <div className="flex gap-1"><div className="min-w-0 flex-1"><Combo value={displayed} options={opts} onCommit={commit} /></div><RoomOptionsButton attrs={a} onCommit={(n, v) => setAttr(node.id, n, v)} /></div>
        : <div className="flex gap-1"><input key={a[num]} defaultValue={a[num] ?? ""} inputMode="decimal" className={input} onBlur={(e) => { const v = e.target.value.replace(",", "."); if (isNaN(Number(v))) { e.target.value = a[num] ?? ""; return; } if (v !== a[num]) setAttr(node.id, num, v); }} /><RoomOptionsButton attrs={a} onCommit={(n, v) => setAttr(node.id, n, v)} /></div>;
      return <Row key={num} badge={num} label={label} type={num === 233 ? "int" : d?.type ?? "text"} badgeTitle={tip} onRemove={num === 231 ? () => setAttr(node.id, 231, null) : undefined}>{ctl}</Row>;
    })}</>;
    if (k === 202) return <Row badge="202" label={t("unit")} type="text"><Combo value={a[202] ?? ""} options={["m", "m2", "m3", "pcs", "kg", "t", "h"]} onCommit={(v) => setAttr(node.id, 202, v)} /></Row>;
    if (k === 203) return (
      <Row badge="203" label={t("unitPrice")} type="dec">
        <div className="relative">
          <input key={a[203]} defaultValue={a[203] ?? ""} inputMode="decimal" className={`${input} pr-12`}
            onBlur={(e) => { const v = e.target.value.replace(",", "."); if (isNaN(Number(v))) { e.target.value = a[203] ?? ""; return; } if (v !== a[203]) setAttr(node.id, 203, v); }} />
          <span className="absolute right-2 top-1.5 text-xs font-semibold text-muted-foreground">EUR</span>
        </div>
      </Row>
    );
    if (k === 209) return <Row badge="209" label={t("trade")} type="int"><Combo value={a[209] ?? ""} options={["Concreting work", "Masonry work", "Dry construction work", "Exterior insulation finish systems", "Painting work"]} onCommit={(v) => setAttr(node.id, 209, v)} /></Row>;
    if (k === 267) return <Row badge="267" label={t("formula")} type="text" align="start" onRemove={isComp ? undefined : () => setAttr(node.id, 267, null)}><FormulaEditor value={a[267] ?? ""} onCommit={(v) => setAttr(node.id, 267, v)} nodeId={node.id} attribute={267} /></Row>;
    return <AttributeValueRow num={k} value={a[k] ?? ""} attrs={a} nodeId={node.id} onCommit={(v) => setAttr(node.id, k, v)} onRemove={() => setAttr(node.id, k, null)} />;
  };

  return shell(
    <div className="min-h-full pb-2" onDragOver={(e) => { if (dragFormula.current || dragNewAttrs.current || dragTemplate.current?.attrs || dragTemplate.current?.model) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDrop={(e) => { if (dragFormula.current) { e.preventDefault(); e.stopPropagation(); useFormulaFavorites.getState().request(dragFormula.current, node.id); return; } const attrs = dragTemplate.current?.attrs ?? dragTemplate.current?.model?.attrs ?? dragNewAttrs.current?.map((num) => ({ num, value: "", enabled: false })); if (!attrs) return; e.preventDefault(); e.stopPropagation(); useCatalog.getState().addTemplateAttrs(node.id, attrs); }}>
      {multi}{selectionBar}{titleRow}
      {isComp
        ? <AttrLine {...selectionProps} nodeId={node.id} k={207} over={null} setOver={setOver}><Row badge="207" label={t("shortText")} type="text"><TextField value={a[207] ?? ""} onCommit={(v) => setAttr(node.id, 207, v)} caseBtn source={{ label: t("code"), value: node.name }} /></Row></AttrLine>
        : descRow(t("description"))}

      {pasteBtn && <div className="px-3 py-1">{pasteBtn}</div>}
      {keys.filter((k) => (!isLayerAttribute(k) || k === 141) && (!isRoomAttribute(k) || k === 231) && (a[118] === undefined || !isFillAttribute(k) || k === 118)).map((k) => <AttrLine {...selectionProps} key={k} nodeId={node.id} k={k} over={over} setOver={setOver} onDropOn={sort === "custom" ? dropOn : undefined}>{field(k)}</AttrLine>)}
      {orderDlg && <AttrOrderDialog onClose={() => setOrderDlg(false)} />}
      {dlg && <AttrPickerDialog context={isComp ? "component" : "group"} exclude={[207, ...present]} onClose={() => setDlg(false)}
        onAdd={(ns) => { const targets = selected.filter((id) => nodes[id] && (nodes[id]!.type === "group" || nodes[id]!.type === "component")); for (const id of targets.length ? targets : [node.id]) useCatalog.getState().addTemplateAttrs(id, ns.map((num) => ({ num, value: "", enabled: false }))); }} />}
    </div>,
  );
}

