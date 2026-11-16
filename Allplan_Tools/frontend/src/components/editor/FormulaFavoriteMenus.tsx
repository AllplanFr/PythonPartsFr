import { Settings, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { useCatalog } from "@/lib/catalog-store";
import { useFormulaFavorites, FORMULA_ATTRIBUTES, type FormulaFavorite, type FormulaAttribute } from "@/lib/formula-favorites";
import { useT } from "@/lib/i18n";
import { formulaFavoriteArtwork } from "@/lib/formula-favorite-artwork";

export function FormulaIcon({ favorite }: { favorite?: FormulaFavorite }) {
  return <img src={favorite?.icon ?? formulaFavoriteArtwork} alt="" draggable={false} className="h-5 w-5 shrink-0 object-contain" />;
}
const tip = (f: FormulaFavorite) => [f.name, f.description, `=${f.attribute}|${f.formula}`].filter(Boolean).join("\n");
export function FormulaFavoritesMenu({ nodeId, attribute, value, compact = false, onApply }: { nodeId?: string | undefined; attribute?: FormulaAttribute | undefined; value?: string | undefined; compact?: boolean; onApply?: ((formula: string) => void) | undefined }) {
  const t = useT(); const { favorites, folders } = useFormulaFavorites(); const catalog = useCatalog();
  const id = nodeId ?? catalog.selected[0]; const node = id ? catalog.nodes[id] : undefined;
  const allowed = !!onApply || node?.type === "group" || node?.type === "component";
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t("ffTitle")} title={t("ffTitle")} className={compact ? "h-9 w-full rounded-none p-0 hover:bg-selection" : "h-9 w-9 rounded-md p-0 hover:bg-selection"} onMouseDown={(e) => e.preventDefault()}><FormulaIcon /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-h-96 w-80 overflow-auto text-xs">
      {!allowed && <DropdownMenuLabel className="text-xs text-muted-foreground">{t("ffUnavailable")}</DropdownMenuLabel>}
      {[undefined, ...folders.map((f) => f.id)].map((folder) => {
        const items = favorites.filter((f) => f.folder === folder); if (!items.length) return null;
        return <div key={folder ?? "root"}><DropdownMenuLabel className="border-y border-border bg-panel text-xs">{folders.find((f) => f.id === folder)?.name ?? t("ffTitle")}</DropdownMenuLabel>{items.map((f) => <DropdownMenuItem key={f.id} disabled={!allowed || !f.formula.trim()} data-tip={tip(f)} className="gap-2 py-2 text-xs" onSelect={() => { if (onApply) onApply(f.formula); else if (id && allowed) useFormulaFavorites.getState().request(f, id, attribute); }}><FormulaIcon favorite={f} /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="text-[10px] text-muted-foreground">{f.attribute}</span></DropdownMenuItem>)}</div>;
      })}
      {!favorites.length && <DropdownMenuLabel className="text-xs text-muted-foreground">{t("ffEmpty")}</DropdownMenuLabel>}
      {!onApply && attribute && value?.trim() && allowed && <><DropdownMenuSeparator /><DropdownMenuItem className="text-xs" onSelect={() => { useFormulaFavorites.getState().create(`${node?.name ?? ""} · ${attribute}`, value, attribute); useFormulaFavorites.getState().setOpen(true); }}><Star />{t("ffSave")}</DropdownMenuItem></>}
      <DropdownMenuSeparator /><DropdownMenuItem className="text-xs" onSelect={() => useFormulaFavorites.getState().setOpen(true)}><Settings />{t("ffManage")}</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>;
}
export function FormulaContextActions({ nodeId }: { nodeId: string }) {
  const t = useT(); const { favorites } = useFormulaFavorites(); const node = useCatalog((s) => s.nodes[nodeId]);
  if (!node || (node.type !== "group" && node.type !== "component")) return null;
  return <><div className="border-y border-border bg-panel px-3 py-2 text-[11px] font-semibold text-muted-foreground">{t("ffTitle")}</div>
    {!!favorites.length && <ContextMenuSub><ContextMenuSubTrigger className="gap-2 text-xs"><FormulaIcon />{t("ffUse")}</ContextMenuSubTrigger><ContextMenuSubContent className="max-h-80 w-72 overflow-auto">{favorites.map((f) => <ContextMenuItem key={f.id} disabled={!f.formula.trim()} data-tip={tip(f)} className="gap-2 text-xs" onSelect={() => useFormulaFavorites.getState().request(f, nodeId)}><FormulaIcon favorite={f} /><span className="flex-1 truncate">{f.name}</span></ContextMenuItem>)}</ContextMenuSubContent></ContextMenuSub>}
    {FORMULA_ATTRIBUTES.filter((num) => node.attrs[num]?.trim()).map((num) => <ContextMenuItem key={num} className="gap-2 text-xs" onSelect={() => { useFormulaFavorites.getState().create(`${node.name} · ${num}`, node.attrs[num], num); useFormulaFavorites.getState().setOpen(true); }}><Star className="h-4 w-4" />{t("ffSave")} · {num}</ContextMenuItem>)}
    <ContextMenuItem className="gap-2 text-xs" onSelect={() => useFormulaFavorites.getState().setOpen(true)}><Settings className="h-4 w-4" />{t("ffManage")}</ContextMenuItem></>;
}