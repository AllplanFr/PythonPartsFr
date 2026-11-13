import { useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n";

export function ChoiceCombo({ value, options, onChange, label, className = "", normalizeValue }: { normalizeValue?: (value: string) => string; value: string; options: { value: string; label: string; index?: string }[]; onChange: (value: string) => void; label: string; className?: string }) {
  const t = useT();
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = options.filter((o) => `${o.label} ${o.value} ${o.index ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const sameValue = (option: string) => normalizeValue ? normalizeValue(option) === normalizeValue(value) : option === value;
  const selected = options.find((o) => sameValue(o.value));
  const pick = (next: string) => { onChange(next); setOpen(false); };
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); setQuery(""); setActive(Math.max(0, options.findIndex((o) => sameValue(o.value)))); }}><PopoverTrigger asChild><Button variant="outline" role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} className={`flex h-7 min-w-0 justify-between gap-2 rounded-none border-border bg-background px-2 text-xs font-normal ${className}`}><span className="truncate">{selected?.label ?? value}</span>{selected?.index && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{selected.index}</span>}<ChevronDown className="h-3.5 w-3.5 shrink-0 text-ribbon-dark" /></Button></PopoverTrigger><PopoverContent onOpenAutoFocus={() => { requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })); }} align="start" className="w-[var(--radix-popover-trigger-width)] min-w-36 rounded-none p-0"><input aria-label={`${t("search")} · ${label}`} aria-autocomplete="list" aria-controls={id} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} placeholder={t("search")} className="h-8 w-full border-b border-border bg-background px-2 text-xs outline-none" onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive((old) => Math.max(0, Math.min(matches.length - 1, old + (e.key === "ArrowDown" ? 1 : -1)))); } if (e.key === "Enter" && matches[active]) { e.preventDefault(); pick(matches[active].value); } }} /><div ref={list} id={id} role="listbox" aria-label={label} className="max-h-56 overflow-auto">{matches.map((o, index) => <Button key={o.value} variant="ghost" role="option" aria-selected={sameValue(o.value)} onClick={() => pick(o.value)} className={`flex h-8 w-full justify-between gap-2 rounded-none px-2 text-xs font-normal ${index === active ? "bg-selection" : ""}`}><span className="truncate">{o.label}</span>{o.index && <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{o.index}</span>}{sameValue(o.value) && <Check className="h-3 w-3 shrink-0 text-ribbon-dark" />}</Button>)}</div></PopoverContent></Popover>;
}