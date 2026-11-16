import { Settings, CircleOff, ListPlus, Check } from "lucide-react";
import { useFolderBatch } from "./FolderBatchDialog";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { lastChoice, remember, subscribeChoices } from "@/lib/last-choice";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ATTRIBUTE_CATALOG, resolveInsertion, useCatalog } from "@/lib/catalog-store";
import { isDefaultTemplate, useTemplates, type AttributeTemplate } from "@/lib/templates";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";
import templateIcon from "@/assets/icons/attribute_model_show.svg.asset.json";
import { FormulaContextActions } from "./FormulaFavoriteMenus";

function modelTip(model: AttributeTemplate, t: ReturnType<typeof useT>): string {
  const lines = [model.name, t(model.type), `=${t("tplPreviewAttrs")}|${model.attrs.length}`, `=${t("tplPreviewDefaults")}|${model.attrs.filter((a) => a.enabled).length}`];
  if (model.type === "group") lines.push(`=${t("tplPreviewChildren")}|${model.children.length}`);
  if (isDefaultTemplate(model)) lines.push(t("tplBuiltInInfo"));
  if (model.attrs.length) {
    lines.push(`#${t("tplAttrs")}`);
    for (const a of model.attrs.slice(0, 5)) {
      const name = ATTRIBUTE_CATALOG.find((x) => x.num === a.num)?.name ?? String(a.num);
      const value = a.enabled ? a.value.replace(/\s+/g, " ").slice(0, 70) || "—" : t("tplNoDefault");
      lines.push(`${a.num} · ${name}: ${value}`);
    }
    if (model.attrs.length > 5) lines.push(`+ ${model.attrs.length - 5} ${t("tplPreviewAttrs").toLowerCase()}`);
  }
  if (model.children.length) lines.push(`#${t("tplPreviewChildren")}`, ...model.children.slice(0, 3).map((c) => `${c.name} · ${t("tplCount", { n: c.attrs.length, v: c.attrs.filter((a) => a.enabled).length })}`));
  return lines.join("\n");
}

const ActivePressChoice = createContext<string | undefined>(undefined);

export function PressChoiceMark({ label }: { label: string }) {
  const active = useContext(ActivePressChoice) === label;
  return <span data-active-choice={active ? "true" : undefined} className="ml-auto flex w-4 shrink-0 justify-center">{active && <Check aria-hidden className="h-4 w-4 text-ribbon-dark" />}</span>;
}

export function PressMenu({ title: baseTitle, icon, onClick: baseClick, children, clickMenu = false, choiceKey, defaultChoice }: { title: string; icon: ReactNode; onClick: () => void; children: ReactNode; clickMenu?: boolean; choiceKey?: string | undefined; defaultChoice?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const last = useSyncExternalStore(subscribeChoices, () => choiceKey ? lastChoice(choiceKey) : undefined, () => undefined);
  const onClick = last ? last.run : baseClick;
  const title = last ? `${baseTitle}\n${t("lastChoice")}: ${last.label}` : baseTitle;
  // Menus open by right-click (or keyboard) only, so every button drags the same way.
  return <DropdownMenu open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" title={title} aria-label={title}
        className="h-9 w-9 shrink-0 rounded-md p-0 hover:bg-selection data-[state=open]:bg-selection [&_img]:h-5 [&_img]:w-5"
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        onClick={(e) => { e.preventDefault(); if (clickMenu) setOpen(true); else onClick(); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); setOpen(true); } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) { if (clickMenu) setOpen(true); else onClick(); } } }}>
        {icon}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-72 p-1 text-xs"><ActivePressChoice.Provider value={last?.label ?? defaultChoice}>{choiceKey && <DropdownMenuLabel className="border-b border-border bg-ribbon/35 px-3 py-2 text-xs font-normal text-muted-foreground">{t("lastChoice")}: <span className="font-semibold text-foreground">{last?.label ?? defaultChoice}</span></DropdownMenuLabel>}{children}</ActivePressChoice.Provider></DropdownMenuContent>
  </DropdownMenu>;
}

export function TemplateDropdown() {
  return <TemplateAddButton type="manager" onAdd={() => useTemplates.getState().setOpen(true)} icon={<img src={templateIcon.url} alt="" className="h-5 w-5" draggable={false} />} />;
}

export function TemplateAddButton({ type, icon, onAdd }: { type: "group" | "component" | "attribute" | "manager"; icon: ReactNode; onAdd: () => void }) {
  const t = useT(); const catalog = useCatalog(); const models = useTemplates((s) => s.models);
  const selected = catalog.selected[0]; const node = selected ? catalog.nodes[selected] : undefined;
  const available = type === "attribute" ? (node?.type === "group" || node?.type === "component" ? models : []) : models.filter((m) => (type === "manager" || m.type === type) && !!resolveInsertion(catalog.nodes, catalog.rootIds, selected ?? null, [m.type]));
  const sections = type === "attribute" || type === "manager" ? ["group", "component"] as const : [type];
  const ck = type === "manager" ? undefined : `add-${type}`;
  const pick = (label: string, run: () => void) => { if (ck) remember(ck, label, run); run(); };
  return <PressMenu choiceKey={ck} defaultChoice={type === "attribute" ? t("addAttr") : models.find((m) => m.type === type && isDefaultTemplate(m))?.name} clickMenu={type === "manager"} title={type === "group" || type === "component" ? `${t(type)}\n${t("fbTip")}` : t(type === "manager" ? "tplManage" : type === "attribute" ? "addAttr" : type)} icon={icon} onClick={onAdd}>
        {(type === "group" || type === "component") && <><DropdownMenuLabel className="border-b border-border bg-ribbon/35 px-3 py-2 text-[11px] text-muted-foreground">{t(type)}</DropdownMenuLabel><DropdownMenuItem className="text-xs" onSelect={() => pick(t("tplEmpty"), () => useCatalog.getState().addNode(type, true))}><CircleOff />{t("tplEmpty")}<PressChoiceMark label={t("tplEmpty")} /></DropdownMenuItem><DropdownMenuItem className="text-xs" onSelect={() => pick(t(type === "group" ? "fbManyGroup" : "fbManyComp"), () => useFolderBatch.getState().show(type))}><ListPlus className="text-ribbon-dark" />{t(type === "group" ? "fbManyGroup" : "fbManyComp")}<PressChoiceMark label={t(type === "group" ? "fbManyGroup" : "fbManyComp")} /></DropdownMenuItem></>}
        {sections.filter((kind) => available.some((m) => m.type === kind)).map((kind) => <div key={kind}><DropdownMenuLabel className="border-y border-border bg-ribbon/35 px-3 py-2 text-[11px] text-muted-foreground">{t(kind)} · {t("templates")}</DropdownMenuLabel>{available.filter((m) => m.type === kind).map((m) => <DropdownMenuItem key={m.id} data-tip={modelTip(m, t)} className="gap-2 py-2 text-xs" onSelect={() => pick(m.name, () => { const c = useCatalog.getState(); const sel = c.selected[0]; const model = useTemplates.getState().models.find((x) => x.id === m.id) ?? m; if (type === "attribute") { if (sel) c.addTemplateAttrs(sel, model.attrs); } else c.insertTemplate(model, sel ?? null); })}><NodeIcon node={m} /><span className="flex-1 truncate">{m.name}</span><span className="text-[10px] text-muted-foreground">{isDefaultTemplate(m) ? t("tplBuiltIn") : m.attrs.length}</span><PressChoiceMark label={m.name} /></DropdownMenuItem>)}</div>)}
        <DropdownMenuSeparator /><DropdownMenuItem className="py-2 text-xs" onSelect={() => useTemplates.getState().setOpen(true)}><Settings className="text-ribbon-dark" />{t("tplManage")}</DropdownMenuItem>
  </PressMenu>;
}

export function TemplateContextActions({ nodeId, attributes = false, onDone }: { nodeId: string; attributes?: boolean; onDone?: () => void }) {
  const t = useT(); const models = useTemplates((s) => s.models); const catalog = useCatalog(); const node = catalog.nodes[nodeId];
  if (!node) return null;
  const valid = attributes ? (node.type === "group" || node.type === "component" ? models : []) : models.filter((m) => resolveInsertion(catalog.nodes, catalog.rootIds, nodeId, [m.type]));
  return <>
    <div className="border-y border-border bg-ribbon/35 px-3 py-2 text-[11px] font-semibold text-muted-foreground">{t("templates")}</div>
    {valid.length > 0 && <ContextMenuSub><ContextMenuSubTrigger className="gap-2 px-3 py-1.5 text-xs"><img src={templateIcon.url} alt="" className="h-4 w-4 shrink-0 object-contain" />{t(attributes ? "tplUseAttrs" : "tplUse")}</ContextMenuSubTrigger><ContextMenuSubContent className="max-h-80 overflow-auto">{valid.map((m) => <ContextMenuItem data-tip={modelTip(m, t)} className="gap-2 text-xs" key={m.id} onSelect={() => { if (attributes) catalog.addTemplateAttrs(nodeId, m.attrs); else catalog.insertTemplate(m, nodeId); onDone?.(); }}><NodeIcon node={m} />{m.name}<span className="ml-auto text-[10px] text-muted-foreground">{m.attrs.length}</span></ContextMenuItem>)}</ContextMenuSubContent></ContextMenuSub>}
    {(node.type === "group" || node.type === "component") && <ContextMenuItem className="gap-2 text-xs" onSelect={() => { useTemplates.getState().importCatalog(catalog.nodes, nodeId); if (!useTemplates.getState().saveSettings()) useTemplates.getState().setOpen(true); onDone?.(); }}><NodeIcon node={node} />{t("tplSaveNode")}</ContextMenuItem>}
    <ContextMenuSeparator /><ContextMenuItem className="gap-2 px-3 py-1.5 text-xs" onSelect={() => { useTemplates.getState().setOpen(true); onDone?.(); }}><Settings className="h-4 w-4 shrink-0 text-ribbon-dark" />{t("tplManage")}</ContextMenuItem>
    <FormulaContextActions nodeId={nodeId} />
  </>;
}

export function AttributeTemplateContext({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  return <ContextMenu><ContextMenuTrigger asChild>{children}</ContextMenuTrigger><ContextMenuContent><TemplateContextActions nodeId={nodeId} attributes /></ContextMenuContent></ContextMenu>;
}