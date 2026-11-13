import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Layers, Search, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCatalog } from "@/lib/catalog-store";
import { useT } from "@/lib/i18n";
import { INHERIT_BITS, LAYERS, LINE_COLORS, LINE_TYPES, PEN_THICKNESSES, layerValue } from "@/lib/layer-attributes";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { NodeIcon } from "./NodeIcon";
import penIcon from "@/assets/icons/layer_pen.svg.asset.json";
import lineIcon from "@/assets/icons/layer_line.svg.asset.json";
import colorIcon from "@/assets/icons/layer_color.png.asset.json";

const STYLE_ICONS: Record<number, string> = { 346: penIcon.url, 345: lineIcon.url, 347: colorIcon.url };

export function LinePreview({ num, id }: { num: number; id: number }) {
  if (num === 347) return <svg viewBox="0 0 160 14" preserveAspectRatio="none" className="h-3.5! w-full! min-w-0 border border-border" aria-hidden><rect width="160" height="14" fill={LINE_COLORS[id] ?? "currentColor"} /></svg>;
  const pen = PEN_THICKNESSES.find((p) => p.id === id);
  const line = LINE_TYPES.find((l) => l.id === id);
  const dash = line?.segments.map((n) => Math.max(1, n / 3)).join(" ");
  return <svg viewBox="0 0 160 14" preserveAspectRatio="none" className="h-3.5! w-full! min-w-0 text-foreground" aria-hidden>
    <line x1="1" y1="7" x2="159" y2="7" stroke="currentColor" strokeWidth={num === 346 ? Math.max(0.7, (pen?.mm ?? 0.25) * 4) : 1} strokeDasharray={num === 345 && dash ? dash : undefined} />
    {num === 345 && line?.special && Array.from({ length: 5 }, (_, i) => <path key={i} d={`M${20 + i * 30} 3l8 8m-8 0l8-8`} stroke="currentColor" strokeWidth="0.8" />)}
  </svg>;
}

function LayerDialog({ value, onPick, onClose }: { value: string; onPick: (id: string) => void; onClose: () => void }) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "center" }); }, []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(value);
  const [closed, setClosed] = useState<string[]>([]);
  const q = query.trim().toLocaleLowerCase();
  const rows = LAYERS.filter((l) => !q || `${l.name} ${l.code} ${l.id} ${l.family} ${l.group}`.toLocaleLowerCase().includes(q));
  const families = [...new Set(rows.filter((l) => l.id !== 0).map((l) => l.family))];
  const toggle = (key: string) => setClosed((old) => old.includes(key) ? old.filter((v) => v !== key) : [...old, key]);
  const pick = () => { onPick(selected); onClose(); };
  const row = (l: typeof LAYERS[number]) => <Button key={l.id} variant="ghost" role="option" aria-selected={selected === String(l.id)} onClick={() => setSelected(String(l.id))} onDoubleClick={() => { onPick(String(l.id)); onClose(); }} className={`grid h-8 w-full grid-cols-[1.25rem_minmax(0,1fr)_4rem_7rem] gap-2 rounded-none px-3 text-left text-xs font-normal ${selected === String(l.id) ? "catalog-selected-row bg-selection" : ""}`} title={`${l.name}\n=${t("number")}|${l.id}\n=${t("code")}|${l.code}`}><Layers className="h-4 w-4 text-ribbon-dark" /><span className="truncate">{l.name}</span><span className="text-right font-mono text-muted-foreground">{l.id}</span><span className="truncate text-muted-foreground">{l.code}</span></Button>;
  const heading = (key: string, name: string, indent = false) => <Button variant="ghost" onClick={() => toggle(key)} aria-expanded={!closed.includes(key)} className={`h-8 w-full justify-start rounded-none text-xs ${indent ? "pl-7" : "bg-panel pl-3 font-semibold"}`}><ChevronDown className={`h-3 w-3 ${closed.includes(key) ? "-rotate-90" : ""}`} /><NodeIcon type="folder" /><span className="truncate">{name}</span></Button>;
  return <Dialog layoutId="layer-picker" title={t("layerChoose")} width={760} height={640} onClose={onClose} footer={<><Button variant="outline" className={`mr-auto ${DIALOG_BTN}`} onClick={() => { onPick("0"); onClose(); }}>{t("layerDefault")}</Button><Button variant="outline" className={DIALOG_BTN} onClick={pick}>OK</Button><Button variant="outline" className={DIALOG_BTN} onClick={onClose}>{t("cancel")}</Button></>}>
    <div className="my-3 flex h-8 shrink-0 items-center border border-border bg-background"><input autoFocus aria-label={t("layerSearch")} placeholder={t("layerSearch")} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") pick(); if (e.key === "Escape") onClose(); }} className="min-w-0 flex-1 bg-background px-2 text-xs outline-none" /><Search className="mx-2 h-4 w-4 text-ribbon-dark" /></div>
    <div className="catalog-panel-heading grid h-8 shrink-0 grid-cols-[1fr_4rem_7rem] items-center gap-2 px-3 text-xs font-semibold"><span>{t("name")}</span><span className="text-right">{t("number")}</span><span>{t("code")}</span></div>
    <div ref={listRef} role="listbox" aria-label={t("layerChoose")} className="min-h-0 flex-1 overflow-auto border-x border-b border-border">
      {rows.filter((l) => l.id === 0).map(row)}
      {families.map((family) => <div key={family}>{heading(family, family)}{(!closed.includes(family) || !!q) && [...new Set(rows.filter((l) => l.family === family).map((l) => l.group))].map((group) => { const key = `${family}/${group}`; return <div key={key}>{heading(key, group, true)}{(!closed.includes(key) || !!q) && <div className="pl-9">{rows.filter((l) => l.family === family && l.group === group).map(row)}</div>}</div>; })}</div>)}
    </div>
  </Dialog>;
}

export function LineStyleField({ attrs, onCommit, readOnly = false, renderRow }: { attrs: Record<number, string>; onCommit: (num: number, value: string) => void; readOnly?: boolean; renderRow?: (num: number, label: string, control: ReactNode) => ReactNode }) {
  const t = useT();
  const mask = Number(attrs[349] ?? 0);
  const defaultLayer = Number(attrs[141] ?? 0) === 0;
  const row = renderRow ?? ((num, label, control) => <div className="flex items-center gap-3 px-3 py-1.5"><span title={`${num} · ${label}\n${t("layerBundle")}`} className="attribute-number flex h-7 w-12 shrink-0 items-center justify-center rounded-sm border text-xs">{num}</span><div className="flex w-[min(36%,320px)] shrink-0 items-center justify-between gap-2"><span className="truncate font-semibold">{label}</span><span className="text-xs text-muted-foreground">123</span></div><div className="min-w-0 flex-1">{control}</div></div>);
  return <div role="group" aria-label={t("layerStyle")} className="min-w-0">{[349, 346, 345, 347].filter((num) => num === 349 || defaultLayer || !(mask & (INHERIT_BITS[num] ?? 0))).map((num) => <div key={num}>{row(num, t(num === 349 ? "layerFrom" : num === 346 ? "layerPen" : num === 345 ? "layerLine" : "layerColor"), <LayerAttributeField num={num} value={attrs[num] ?? "0"} attrs={attrs} onCommit={(value) => onCommit(num, value)} readOnly={readOnly} />)}</div>)}</div>;
}

export function LayerAttributeField({ num, value, onCommit, nodeId, attrs: supplied, readOnly = false }: { num: number; value: string; onCommit: (v: string) => void; nodeId?: string | undefined; attrs?: Record<number, string> | undefined; readOnly?: boolean }) {
  const t = useT();
  const nodeAttrs = useCatalog((s) => nodeId ? s.nodes[nodeId]?.attrs : undefined);
  const attrs = supplied ?? nodeAttrs ?? { [num]: value };
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const inherited = Number(attrs[141] ?? 0) !== 0 && !!((INHERIT_BITS[num] ?? 0) & Number(attrs[349] ?? 0));
  const effective = inherited ? value : layerValue(num, { ...attrs, [num]: value });
  const id = Number(effective);
  const title = num === 141 ? "Layer" : num === 346 ? t("layerPen") : num === 345 ? t("layerLine") : num === 347 ? t("layerColor") : t("layerFrom");
  if (num === 349) return <div className="attr-checkbox-row border border-border bg-background px-1">{[346, 345, 347].map((n) => { const bit = INHERIT_BITS[n] ?? 0; const label = n === 346 ? t("layerPen") : n === 345 ? t("layerLine") : t("layerColor"); const checked = !!(Number(value) & bit) && Number(attrs[141] ?? 0) !== 0; return <Button key={n} variant="ghost" role="checkbox" aria-label={`${t("layerFrom")} · ${label}`} aria-checked={checked} disabled={readOnly || Number(attrs[141] ?? 0) === 0} onClick={() => onCommit(String(Number(value || 0) ^ bit))} title={`${label}\n${t("layerInherited")}`} className="attr-checkbox-item h-6 gap-2 rounded-none disabled:opacity-50"><span aria-hidden className="app-checkbox-mark" data-state={checked ? "checked" : "unchecked"} /><img src={STYLE_ICONS[n]} alt="" className="h-5 w-5 shrink-0 object-contain" draggable={false} /></Button>; })}</div>;
  const layer = LAYERS.find((l) => l.id === id);
  const label = num === 141 ? layer?.name ?? effective : num === 346 ? PEN_THICKNESSES.find((p) => p.id === id)?.mm.toFixed(2) ?? effective : num === 345 ? String(id).padStart(2, "0") : effective;
  const content = <><span className="relative flex min-w-0 flex-1 items-center">{num !== 141 && <LinePreview num={num} id={id} />}<span className={num === 141 ? "truncate text-xs" : "absolute right-0 bg-background/90 px-1 text-[10px]"}>{num === 141 ? label : num === 346 ? `${label} mm` : ""}</span></span><span className="attribute-index">[{effective}]</span><span className="flex h-full w-9 shrink-0 items-center justify-center border-l border-border bg-panel"><ChevronDown className="h-3.5 w-3.5 text-ribbon-dark" /></span></>;
  const ctl = "flex h-7 w-full justify-start gap-2 rounded-none border border-border bg-background py-0 pl-2 pr-0 text-left font-normal disabled:opacity-100";
  if (num === 141) {
    const matches = LAYERS.filter((l) => `${l.name} ${l.code} ${l.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const pick = (next: string) => { onCommit(next); setOpen(false); setQuery(""); };
    return <><div className="relative flex min-w-0 items-center"><div className="relative min-w-0 flex-1"><input role="combobox" aria-label="141 · Layer" aria-expanded={open} aria-controls="layer-completions" aria-autocomplete="list" readOnly={readOnly} value={open ? query : label} onFocus={() => { if (!readOnly) { setOpen(true); setQuery(""); } }} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onBlur={() => { setOpen(false); setQuery(""); }} onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQuery(""); } if (e.key === "Enter" && matches[0]) { e.preventDefault(); pick(String(matches[0].id)); } }} title={`${label}\n=${t("number")}|${value}`} className="h-7 w-full min-w-0 border border-border bg-background pl-2 pr-14 text-[13px] text-foreground outline-none focus:border-ribbon-dark" /><span className="attribute-index absolute right-2 top-1.5">[{value}]</span></div><Button variant="outline" aria-label="Layer" disabled={readOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(!open); setQuery(""); }} className="h-7 w-9 shrink-0 rounded-none border-l-0 border-border bg-panel p-0"><ChevronDown className="h-3.5 w-3.5 text-ribbon-dark" /></Button><Button variant="outline" aria-label={t("layerChoose")} title={t("layerChoose")} disabled={readOnly} onClick={() => { setOpen(false); setBrowserOpen(true); }} className="h-7 w-9 shrink-0 rounded-none border-l-0 border-border bg-panel p-0"><Layers className="h-4 w-4 text-ribbon-dark" /></Button>{open && <div id="layer-completions" role="listbox" className="absolute left-0 right-0 top-7 z-30 max-h-56 overflow-auto border border-border bg-popover shadow-lg">{matches.map((l) => <Button key={l.id} variant="ghost" role="option" aria-selected={l.id === id} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(String(l.id))} className="flex h-8 w-full justify-between rounded-none px-2 text-xs font-normal"><span className="truncate">{l.name}</span><span className="text-muted-foreground">[{l.id}]</span></Button>)}</div>}</div>{browserOpen && <LayerDialog value={value} onPick={onCommit} onClose={() => setBrowserOpen(false)} />}</>;
  }
  if (inherited) return <div title={`${num} · ${title}\n${t("layerInherited")}`}><Button variant="ghost" aria-label={title} disabled className="flex h-7 w-full min-w-0 items-center justify-center gap-1 rounded-none border border-border bg-panel px-1 text-xs text-muted-foreground disabled:opacity-100"><LockKeyhole className="h-3 w-3 shrink-0" /><span className="truncate">Allplan</span></Button></div>;
  const choices = num === 346 ? PEN_THICKNESSES.map((p) => ({ id: p.id, label: `${p.mm.toFixed(2)} mm` })) : num === 345 ? LINE_TYPES.map((l) => ({ id: l.id, label: `${String(l.id).padStart(2, "0")}${l.special ? ` · ${l.name}` : ""}` })) : LINE_COLORS.map((_, i) => ({ id: i, label: String(i) }));
  return <Popover open={open} onOpenChange={(o) => { setOpen(o); setQuery(""); }}><PopoverTrigger asChild><Button variant="ghost" aria-label={title} disabled={readOnly || inherited} title={inherited ? t("layerInherited") : title} className={ctl}>{content}</Button></PopoverTrigger><PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 rounded-none p-0">
    <input aria-label={`${t("search")} · ${title}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="h-8 w-full border-b border-border bg-background px-2 text-xs outline-none" />
    <div role="listbox" aria-label={title} className="max-h-72 overflow-auto">{choices.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())).map((c) => <Button key={c.id} variant="ghost" role="option" aria-selected={c.id === id} onClick={() => { onCommit(String(c.id)); setOpen(false); }} title={num === 345 && LINE_TYPES.find((l) => l.id === c.id)?.special ? t("layerSpecial") : c.label} className={`relative flex h-8 w-full justify-start rounded-none px-2 text-xs font-normal ${c.id === id ? "catalog-selected-row bg-selection" : ""}`}><LinePreview num={num} id={c.id} /><span className="absolute right-2 max-w-[70%] truncate bg-popover/90 px-1">{c.label}</span></Button>)}</div>
  </PopoverContent></Popover>;
}