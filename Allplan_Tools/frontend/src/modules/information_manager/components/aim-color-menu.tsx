import { useEffect, useRef, useState } from "react";
import { Palette, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MENU_COLORS } from "../lib/aim-interface";
import { toolbarText } from "../lib/aim-toolbar-text";
import type { Lang } from "../lib/i18n";

const isCustom = (color: string) => color.startsWith("#");
/** Resolve theme swatches to portable RGB only for presentation configuration. */
function swatchHex(element: HTMLElement): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = getComputedStyle(element).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  const pixel = context.getImageData(0, 0, 1, 1).data;
  return `#${Array.from(pixel).slice(0, 3).map(value => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function AimColorSwatches({ value, onPick, lang = "fr", hex = false }: {
  value: string; onPick: (color: string) => void; lang?: Lang; hex?: boolean;
}) {
  const mt = toolbarText(lang);
  const root = useRef<HTMLDivElement>(null);
  const customInput = useRef<HTMLInputElement>(null);
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    const resolved: Record<string, string> = {};
    root.current?.querySelectorAll<HTMLElement>("button[data-menu-color]").forEach(element => {
      const key = element.dataset["menuColor"];
      const color = swatchHex(element);
      if (key && color) resolved[key] = color;
    });
    setColors(resolved);
  }, []);
  const predefined = MENU_COLORS.find(color => color === value || colors[color] === value.toUpperCase());
  const custom = isCustom(value) && !predefined;
  return <div ref={root} className="flex w-max items-center gap-2">
    {MENU_COLORS.map(color => <Button key={color} variant="ghost" size="icon" data-menu-color={color}
      aria-label={mt[color]} title={mt[color]} aria-pressed={predefined === color}
      onClick={() => { const selected = hex ? colors[color] : color; if (selected) onPick(selected); }}
      className={`menu-swatch h-7 w-7 rounded-full border-2 ${predefined === color ? "border-foreground" : "border-transparent"}`} />)}
    <Button type="button" variant="ghost" size="icon" title={mt.custom} aria-label={mt.custom}
      aria-pressed={custom} data-menu-color="custom"
      style={{ ["--menu-accent" as string]: custom ? value : "var(--muted)" }}
      className={`menu-swatch h-7 w-7 shrink-0 rounded-full border-2 ${custom ? "border-foreground" : "border-dashed border-muted-foreground"}`}
      onClick={() => {
        const input = customInput.current;
        if (!input) return;
        input.value = isCustom(value) ? value : "#416596";
        if (typeof input.showPicker === "function") input.showPicker();
        else input.click();
      }}>
      <Plus className="h-3.5 w-3.5 text-foreground" />
    </Button>
    <input ref={customInput} type="color" aria-label={mt.custom} tabIndex={-1}
      defaultValue={isCustom(value) ? value : "#416596"}
      onChange={event => { if (event.target.value.toUpperCase() !== value.toUpperCase()) onPick(event.target.value); }}
      className="sr-only" />
  </div>;
}

export function AimGroupColorMenu({ value, onPick, disabled, label, lang = "fr" }: {
  value: string; onPick: (color: string) => void; disabled?: boolean; label: string; lang?: Lang;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="native" size="native" disabled={disabled} title="Couleur" aria-label={label}
      onClick={event => event.stopPropagation()}><Palette className="size-3.5" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="suite-menu w-auto rounded-sm p-2" onClick={event => event.stopPropagation()}>
      <AimColorSwatches value={value} lang={lang} hex onPick={color => { if (!disabled) onPick(color); setOpen(false); }} />
    </PopoverContent>
  </Popover>;
}