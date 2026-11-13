import type { ReactNode } from "react";
import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { PressChoiceMark, PressMenu } from "./TemplateMenus";
import { remember } from "@/lib/last-choice";
import { useT } from "@/lib/i18n";
import type { CollapseMode, ExpandMode } from "@/lib/tree-expand";

const label = "border-b border-border bg-ribbon/35 px-3 py-2 text-[11px] text-muted-foreground";

/** Expand button: click = expand all, right-click = presets. */
export function ExpandButton({ icon, hasSelection, onMode, scope = "main" }: { icon: ReactNode; hasSelection: boolean; onMode: (m: ExpandMode) => void; scope?: string }) {
  const t = useT();
  const items: [ExpandMode, string][] = [["all", "expandAll"], ["folders", "expFolders"], ["level1", "expLevel1"], ["selection", "expSelection"]];
  return <PressMenu defaultChoice={t("expandAll")} choiceKey={`expand-${scope}`} title={`${t("expandAll")}\n${t("expTip")}`} icon={icon} onClick={() => onMode("all")}>
    <DropdownMenuLabel className={label}>{t("expandAll")}</DropdownMenuLabel>
    {items.map(([m, k]) => <DropdownMenuItem key={m} className="py-2 text-xs" disabled={m === "selection" && !hasSelection} onSelect={() => { remember(`expand-${scope}`, t(k as never), () => onMode(m)); onMode(m); }}>{t(k as never)}<PressChoiceMark label={t(k as never)} /></DropdownMenuItem>)}
  </PressMenu>;
}

export function CollapseButton({ icon, hasSelection, onMode, scope = "main" }: { icon: ReactNode; hasSelection: boolean; onMode: (m: CollapseMode) => void; scope?: string }) {
  const t = useT();
  const items: [CollapseMode, string][] = [["all", "collapseAll"], ["groups", "colGroups"], ["selection", "colSelection"], ["selectionChildren", "colChildren"]];
  return <PressMenu defaultChoice={t("collapseAll")} choiceKey={`collapse-${scope}`} title={`${t("collapseAll")}\n${t("expTip")}`} icon={icon} onClick={() => onMode("all")}>
    <DropdownMenuLabel className={label}>{t("collapseAll")}</DropdownMenuLabel>
    {items.map(([m, k]) => <DropdownMenuItem key={m} className="py-2 text-xs" disabled={m !== "all" && m !== "groups" && !hasSelection} onSelect={() => { remember(`collapse-${scope}`, t(k as never), () => onMode(m)); onMode(m); }}>{t(k as never)}<PressChoiceMark label={t(k as never)} /></DropdownMenuItem>)}
  </PressMenu>;
}
