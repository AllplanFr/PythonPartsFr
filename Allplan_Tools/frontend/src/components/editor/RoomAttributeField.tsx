import { useState, type ReactNode } from "react";
import { useCatalog } from "@/lib/catalog-store";
import { useT } from "@/lib/i18n";
import { AREA_INFO, ENCLOSURE_INFO, LIVING_INFO, ROOM_ATTRIBUTES, ROOM_PRESETS, roomChoiceIndex, roomOptions, txt, USE_CATS, USE_INFO, type RoomPreset } from "@/lib/room-attributes";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { Button } from "@/components/ui/button";
import roomIcon from "@/assets/icons/room.svg.asset.json";

type Commit = (num: number, value: string) => void;

/** Room options dialog: clickable building section on the left, explained choices on the right. */
export function RoomOptionsDialog({ attrs, onApply, onClose }: { attrs: Record<number, string>; onApply: (values: Record<number, string>) => void; onClose: () => void }) {
  const t = useT();
  const lang = useCatalog((s) => s.lang);
  const [v, setV] = useState<Record<number, string>>(() => Object.fromEntries(ROOM_ATTRIBUTES.map((n) => [n, attrs[n] ?? ""])));
  const [hover, setHover] = useState<string | null>(null);
  const set = (n: number, x: string) => setV((o) => ({ ...o, [n]: x }));
  const uses = roomOptions(235, lang), living = roomOptions(233, lang), areas = roomOptions(232, lang);
  const save = () => { onApply(v); onClose(); };
  const useIdx = roomChoiceIndex(235, v[235] ?? "", lang);
  const card = (n: number, title: string, children: ReactNode) => <section data-room-section={n} className={`min-h-0 overflow-hidden rounded-md border border-border ${n === 235 ? "room-use-section" : ""}`}>
    <div className="catalog-panel-heading flex h-8 items-center gap-2 px-3 text-xs font-semibold"><span className="attribute-number rounded-sm border px-1 font-mono text-[10px]">{n}</span><span className="mr-auto">{title}</span></div>
    <div className="p-2">{children}</div></section>;
  const pick = (on: boolean) => `relative cursor-pointer rounded-sm border text-left text-xs transition-colors ${on ? "catalog-selected-row border-ribbon-dark bg-selection" : "border-border bg-background hover:bg-selection/50"}`;
  const factor = (n: number) => card(n, t(n === 266 ? "roomFactor" : "roomLivingFactor"), <div className="relative">
    <input value={v[n]} inputMode="decimal" aria-label={`${n}`} onChange={(e) => set(n, e.target.value.replace(",", "."))} className="h-7 w-full border border-border bg-background pl-2 pr-10 text-xs tabular-nums text-foreground outline-none focus:border-ribbon-dark" /><span className="pointer-events-none absolute right-2 top-1.5 text-[10px] text-muted-foreground">123</span></div>);
  const presetOn = (p: RoomPreset) => v[231] === p.enclosure && useIdx === p.use && v[233] === String(p.living);
  const shown = ROOM_PRESETS.find((p) => p.id === hover);
  let lastCat = "";
  return <Dialog layoutId="room-options-v3" title={t("roomOptions")} icon={roomIcon.url} width={1380} height={740} onClose={onClose} footer={<>
    <span className="mr-auto self-center text-xs text-muted-foreground">{t("roomHint")}</span>
    <Button variant="outline" className={DIALOG_BTN} onClick={save}>{t("saveBtn")}</Button><Button variant="outline" className={DIALOG_BTN} onClick={onClose}>{t("cancel")}</Button></>}>
    <div className="room-options-layout" onKeyDown={(e) => { if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) save(); }}>
      <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto_auto] gap-2.5">
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border">
        <div className="catalog-panel-heading flex h-8 shrink-0 items-center gap-2 px-3 text-xs font-semibold"><span className="mr-auto">{t("roomQuick")}</span></div>
        <div className="relative flex-1 bg-background p-2">
          <svg viewBox="0 0 580 500" className="h-full w-full" role="group" aria-label={t("roomQuick")}>
            <g className="stroke-foreground" fill="none" strokeLinecap="round">
              <path d="M130 172 L310 30 L485 172" strokeWidth="6" /><path d="M265 68 V172" strokeWidth="5" /><path d="M375 100 V172" strokeWidth="1.5" />
              <path d="M130 172 H485 M40 250 H485 M40 328 H485 M130 408 H485" strokeWidth="5" />
              <path d="M130 172 V492 M375 172 V492" strokeWidth="6" /><path d="M485 172 V408" strokeWidth="1.5" />
              <path d="M40 212 V250 M40 292 V328 M40 408 V492" strokeWidth="5" /><path d="M40 492 H575" strokeWidth="6" />
              {[420, 432, 444, 456].map((y) => <path key={y} d={`M44 ${y} H128`} strokeWidth="1.5" />)}
            </g>
            {ROOM_PRESETS.map((p) => { const on = presetOn(p); return <g key={p.id} role="button" aria-label={txt(p.label, lang)} aria-pressed={on} className="cursor-pointer"
              onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}
              onClick={() => setV((o) => ({ ...o, 231: p.enclosure, 235: uses[p.use] ?? "", 233: String(p.living) }))}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="3" className={on ? "fill-selection stroke-ribbon-dark" : hover === p.id ? "fill-selection/60 stroke-ribbon-dark/50" : "fill-transparent stroke-transparent"} strokeWidth="2" strokeDasharray={on ? undefined : "4 3"} />
              <text x={p.x + p.w / 2} y={p.y + p.h / 2 - 3} textAnchor="middle" className="fill-foreground text-[13px] font-semibold">{txt(p.label, lang)}</text>
              <text x={p.x + p.w / 2} y={p.y + p.h / 2 + 13} textAnchor="middle" className="fill-muted-foreground text-[11px]">{uses[p.use]} · {p.enclosure} · {living[p.living]}</text>
            </g>; })}
          </svg>
          {shown && <div className="pointer-events-none absolute bottom-2 left-2 right-2 rounded-sm border border-border bg-popover px-2 py-1 text-[11px] shadow-md">
            <b>{txt(shown.label, lang)}</b> — 231 {shown.enclosure} · 235 {uses[shown.use]} · 233 {living[shown.living]}</div>}
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-border bg-panel p-2 text-[11px]">
          {ROOM_ATTRIBUTES.map((n) => <span key={n} className="rounded-sm border border-border bg-background px-1.5 py-0.5"><span className="font-mono text-muted-foreground">{n}</span> <b>{n === 233 ? living[Number(v[233])] ?? "—" : v[n] || "—"}</b></span>)}
        </div>
      </section>
      {factor(266)}
      {factor(264)}
      </div>
      <div className="room-options-choices">
        {card(231, t("roomEnclosure"), <div className="grid grid-cols-2 gap-1.5">
          {roomOptions(231, lang).map((o, i) => <button key={o} onClick={() => set(231, o)} className={`${pick(v[231] === o)} flex items-start gap-2 p-2 ${i > 1 ? "py-1" : ""}`}>
            <span className={`flex h-7 w-9 shrink-0 items-center justify-center rounded-sm border border-border bg-panel font-mono text-sm font-semibold ${i > 1 ? "h-5 text-xs" : ""}`}>{o}</span>
            <span className="leading-snug">{ENCLOSURE_INFO[o] ? txt(ENCLOSURE_INFO[o], lang) : ""}<span className="ml-1 text-[9px] text-muted-foreground">[{i}]</span></span></button>)}
        </div>)}
        {card(235, t("roomUse"), <div className="rounded-sm border border-border">
          {USE_INFO.map((u, i) => { const category = USE_CATS[u.cat]; const head = u.cat !== lastCat ? (lastCat = u.cat, <div className="border-b border-border bg-panel-heading px-2 py-1 text-[11px] font-semibold text-muted-foreground">{category ? txt(category, lang) : u.cat}</div>) : null;
            const on = useIdx === i;
            return <div key={i}>{head}<button onClick={() => set(235, uses[i] ?? "")} className={`relative grid w-full grid-cols-[4.5rem_1fr_auto] items-center border-b border-border px-2 py-1 text-left text-xs ${on ? "catalog-selected-row bg-selection font-semibold" : i % 2 ? "bg-row-alt hover:bg-selection/50" : "bg-background hover:bg-selection/50"}`}>
              <span className="font-mono">{uses[i]}</span><span className="truncate">{txt(u.group, lang)}</span><span className="text-[9px] text-muted-foreground">[{i}]</span></button></div>; })}
        </div>)}
        {card(232, t("roomAreaType"), <div className="flex gap-1.5">
          {areas.map((o, i) => <button key={o + i} onClick={() => set(232, o)} className={`${pick(v[232] === o)} flex flex-1 items-center gap-2 p-2`}>
            <span className="flex h-6 w-7 items-center justify-center rounded-sm border border-border bg-panel font-mono font-semibold">{o}</span><span>{AREA_INFO[i] ? txt(AREA_INFO[i], lang) : ""}</span></button>)}
        </div>)}
        {card(233, t("roomLiving"), <div className="grid grid-cols-2 gap-1.5">
          {LIVING_INFO.map((l, i) => <button key={i} onClick={() => set(233, String(i))} className={`${pick(v[233] === String(i))} p-1.5`}>
            <div className="mb-0.5 flex items-center gap-1.5 font-semibold"><span className="rounded-sm border border-border bg-panel px-1 font-mono">{living[i]}</span>{txt(l.title, lang)}<span className="ml-auto text-[9px] font-normal text-muted-foreground">[{i}]</span></div>
            <div className="text-[11px] leading-snug text-muted-foreground">{txt(l.text, lang)}</div></button>)}
        </div>)}
      </div>
    </div>
  </Dialog>;
}

/** Room options button placed to the right of each room combo. */
export function RoomOptionsButton({ attrs, onCommit }: { attrs: Record<number, string>; onCommit: Commit }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="outline" size="icon" title={t("roomOptions")} aria-label={t("roomOptions")} onClick={() => setOpen(true)} className="flex h-7 w-9 shrink-0 items-center justify-center rounded-none border border-border bg-panel hover:bg-selection"><img src={roomIcon.url} alt="" className="h-4 w-4" /></Button>
    {open && <RoomOptionsDialog attrs={attrs} onClose={() => setOpen(false)} onApply={(vals) => { for (const n of ROOM_ATTRIBUTES) if ((vals[n] ?? "") !== (attrs[n] ?? "")) onCommit(n, vals[n] ?? ""); }} />}
  </>;
}
