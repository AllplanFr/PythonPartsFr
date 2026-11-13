import { useEffect, useRef, useState, type ComponentType } from "react";
import { fitDialogFrame } from "@/lib/dialog-layout";
import { aimStorage } from "../lib/aim-storage";
import { CalendarDays, ChevronsUpDown, HelpCircle, Clock, AtSign, Phone, Link2, SquareCheck, TextCursorInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GroupPicker } from "./group-picker";
import { StrGlyph, IntGlyph, FloatGlyph, ListBoxGlyph } from "./type-glyphs";
import { useT, type TKey } from "../lib/i18n";
export type DataType = "STR" | "FLOAT" | "INT" | "DATE" | "TIME" | "EMAIL" | "PHONE" | "URL";
type Widget = "entry" | "combo" | "list" | "checkbox";
export type Attr = {
  num: number;
  name: string;
  title: string;
  widget: Widget;
  type: DataType;
  options?: string[] | undefined;
  value: string;
  group?: string | undefined;
  /** Category of a row without group. */
  cat?: string | undefined;
};

const GENERAL = "general";

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

const ALLOWED: Record<Widget, DataType[]> = { entry: ["STR", "FLOAT", "INT", "DATE", "TIME", "EMAIL", "PHONE", "URL"], combo: ["STR", "FLOAT", "INT"], list: ["STR"], checkbox: [] };
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
export function PresentationAttributeForm({
  heading,
  initial,
  used,
  groups,
  cats,
  groupCat,
  defaultCat,
  onSubmit,
  onCancel,
  attributes,
  busy = false,
  groupLabels,
  addDisabled = "",
  groupRequired = false,
}: {
  heading: string;
  initial?: Attr;
  attributes: { num: number; name: string }[];
  busy?: boolean;
  groupLabels?: Record<string, string>;
  addDisabled?: string;
  groupRequired?: boolean;
  used: number[];
  groups: string[];
  cats: { id: string; name: string }[];
  groupCat: Record<string, string>;
  defaultCat: string;
  onSubmit: (a: Attr, cat: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const frame = formRef.current?.closest<HTMLElement>(".aim-stable-form");
    if (!frame) return;
    const fit = (width: number, height: number) => {
      const bounded = fitDialogFrame({ x: 8, y: 8, width: Math.max(600, width), height: Math.max(600, height) }, { width: window.innerWidth - 16, height: window.innerHeight - 16 });
      frame.style.width = `${bounded.width}px`;
      frame.style.height = `${bounded.height}px`;
    };
    try {
      const saved: unknown = JSON.parse(aimStorage.getItem("attribute-form-size") ?? "null");
      if (saved && typeof saved === "object" && "width" in saved && "height" in saved && typeof saved.width === "number" && typeof saved.height === "number" && Number.isFinite(saved.width) && Number.isFinite(saved.height) && saved.width > 0 && saved.height > 0) fit(saved.width, saved.height);
    } catch { /* Personal window settings never prevent opening. */ }
    const persist = () => {
      const { width, height } = frame.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      try { aimStorage.setItem("attribute-form-size", JSON.stringify({ width, height })); } catch { /* Storage may be unavailable. */ }
    };
    const observer = new ResizeObserver(persist);
    observer.observe(frame);
    const resize = () => { const rect = frame.getBoundingClientRect(); fit(rect.width, rect.height); };
    window.addEventListener("resize", resize);
    return () => { persist(); observer.disconnect(); window.removeEventListener("resize", resize); };
  }, []);
  const isEdit = !!initial;
  const available = attributes.filter((c) => !used.includes(c.num));
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
    attributes.find((c) => c.num === sel) ??
    (initial && initial.num === sel ? { num: initial.num, name: initial.name } : undefined);
  const hasOptions = widget === "combo" || widget === "list";
  const badOpt = options.find((o) => checkValue(type, o));
  const error = addDisabled && (!isEdit || (groupRequired || !!gTrim) && !groupLocked)
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
    const left = n[i], right = n[j];
    if (left === undefined || right === undefined) return;
    [n[i], n[j]] = [right, left];
    setOptions(n);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || error || !entry) return;
    // This form edits presentation fields only. Native values are never converted here.
    const value = initial?.value ?? "";
    onSubmit(
      {
        num: entry.num,
        name: entry.name,
        title: title.trim().slice(0, 120) || entry.name,
        widget,
        type,
        value,
        ...(hasOptions ? { options } : {}),
        ...(gTrim ? { group: groupLocked ? gTrim : gTrim.slice(0, 20) } : {}),
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
      ref={formRef}
      onSubmit={submit}
      aria-label={entry ? `${heading} · ${entry.num} — ${entry.name}` : heading}
      className="aim-edit-panel mb-2 shrink-0 overflow-auto border border-border bg-card"
    >
      <h2 className="catalog-panel-heading mb-3 flex h-7 items-center px-2 text-sm font-semibold text-foreground">
        {entry ? `${heading} · ${entry.num} — ${entry.name}` : heading}
      </h2>
      <div className="aim-form-scroll">
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
              {...(groupLabels ? { groupLabels } : {})}
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
              maxLength={20}
              disabled={!!addDisabled}
              title={addDisabled || undefined}
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
        <div className="aim-form-proposals mt-4 px-3">
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
          <div className="aim-form-proposal-list flex flex-wrap content-start gap-2">
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

      </div>
      <div
        className={`aim-blue-band mt-3 flex flex-wrap items-center gap-2 px-2 py-1.5 ${isEdit ? "justify-end" : "justify-start"}`}
      >
        <Button
          variant="native"
          size="native"
          type="submit"
          disabled={busy || !!error}
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
