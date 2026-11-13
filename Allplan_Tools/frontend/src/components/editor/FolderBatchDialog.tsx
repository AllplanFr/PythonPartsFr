import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { FolderPlus, Folders, ImagePlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useCatalog, resolveInsertion } from "@/lib/catalog-store";
import { useFolderIcons } from "@/lib/folder-icons";
import { buildFolderDrafts } from "@/lib/folder-batch";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";
import { DIALOG_BTN } from "./FormulaTools";
import { PressChoiceMark, PressMenu } from "./TemplateMenus";
import { remember } from "@/lib/last-choice";
import { useTemplates, type AttributeTemplate } from "@/lib/templates";

export type BatchKind = "folder" | "group" | "component";
export const useFolderBatch = create<{ kind: BatchKind | null; show: (kind: BatchKind | null) => void }>((set) => ({ kind: null, show: (kind) => set({ kind }) }));
const DEFAULT_MODEL: Record<BatchKind, string> = { folder: "", group: "template-group", component: "template-component" };

export function FolderAddButton({ icon }: { icon: ReactNode }) {
  const t = useT(); const add = useCatalog((s) => s.addNode);
  return <PressMenu title={`${t("folder")}\n${t("fbTip")}`} icon={icon} defaultChoice={t("fbSingle")} choiceKey="add-folder" onClick={() => add("folder")}>
    <DropdownMenuItem className="gap-2 py-2 text-xs" onSelect={() => { remember("add-folder", t("fbSingle"), () => useCatalog.getState().addNode("folder")); add("folder"); }}><FolderPlus className="text-ribbon-dark" />{t("fbSingle")}<PressChoiceMark label={t("fbSingle")} /></DropdownMenuItem>
    <DropdownMenuItem className="gap-2 py-2 text-xs" onSelect={() => { const run = () => useFolderBatch.getState().show("folder"); remember("add-folder", t("fbMany"), run); run(); }}><Folders className="text-ribbon-dark" />{t("fbMany")}<PressChoiceMark label={t("fbMany")} /></DropdownMenuItem>
  </PressMenu>;
}

export function FolderBatchDialog() {
  const t = useT(); const kind = useFolderBatch((s) => s.kind); const open = !!kind; const k: BatchKind = kind ?? "folder";
  const setOpen = (v: boolean) => { if (!v) useFolderBatch.getState().show(null); };
  const models = useTemplates((s) => s.models).filter((m) => m.type === k);
  const [rowModels, setRowModels] = useState<Record<number, string>>({});
  const catalog = useCatalog(); const icons = useFolderIcons((s) => s.entries);
  const [count, setCount] = useState(1); const [text, setText] = useState("");
  const [withDesc, setWithDesc] = useState(true); const [sep, setSep] = useState("|");
  const [rowIcons, setRowIcons] = useState<Record<number, string | undefined>>({});
  useEffect(() => { if (open) void useFolderIcons.persist.rehydrate(); }, [open]);
  const drafts = useMemo(() => buildFolderDrafts(text, count, withDesc, sep, k === "folder" ? t("folder") : k === "group" ? "NEW_GROUP" : "NEW"), [text, count, withDesc, sep, t, k]);
  const siblings = useMemo(() => {
    const target = catalog.selected[0] ?? null; const p = resolveInsertion(catalog.nodes, catalog.rootIds, target, [k]);
    const parent = p && p !== "choice" ? p.parentId : null; const ids = parent ? catalog.nodes[parent]?.children ?? [] : catalog.rootIds;
    if (k === "group") return new Set(Object.values(catalog.nodes).filter((n) => n.type === "group").map((n) => n.name.toLowerCase()));
    return new Set(ids.map((id) => catalog.nodes[id]?.name.toLowerCase()));
  }, [catalog.nodes, catalog.rootIds, catalog.selected, k]);
  const seen = new Map<string, number>(); drafts.forEach((d) => seen.set(d.name.toLowerCase(), (seen.get(d.name.toLowerCase()) ?? 0) + 1));
  const recent = [...icons].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 9);
  const create = () => {
    if (!drafts.length) return;
    setOpen(false);
    const modelOf = (i: number) => { const id = rowModels[i] ?? DEFAULT_MODEL[k]; return models.find((m) => m.id === id) ?? null; };
    catalog.addBatch(k, drafts.map((d, i) => k === "folder" ? { ...d, icon: rowIcons[i] } : { ...d, model: modelOf(i) }));
    for (const src of new Set(Object.values(rowIcons))) if (src) useFolderIcons.getState().record(src, icons.find((e) => e.src === src)?.name ?? "icon");
    setText(""); setCount(1); setRowIcons({}); setRowModels({});
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="max-w-lg gap-0 overflow-hidden p-0" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); create(); } }}>
      <DialogTitle className="catalog-panel-heading px-4 py-3 pr-10 text-sm">{t(k === "folder" ? "fbTitle" : k === "group" ? "fbTitleGroup" : "fbTitleComp")}</DialogTitle>
      <DialogDescription className="sr-only">{t("fbListHint")}</DialogDescription>
      <div className="space-y-3 p-4 text-xs">
        <div className="flex items-end gap-3">
          <label className="w-24 space-y-1"><span className="font-semibold">{t("fbCount")}</span>
            <Input type="number" min={0} max={500} value={count} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCount(Number(e.target.value) || 0)} className="h-8" /></label>
        </div>
        <div className="overflow-hidden rounded-sm border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-ribbon/35 px-2 py-1.5">
            <label className="flex items-center gap-2"><Checkbox checked={withDesc} onCheckedChange={(v) => setWithDesc(!!v)} />{t("description")} · {t("fbSep")}</label>
            <Input value={sep} disabled={!withDesc} onChange={(e) => setSep(e.target.value)} className="h-6 w-14 text-center font-mono" title="\t = Tab" />
            <span className="ml-auto text-[10px] text-muted-foreground">\t = {t("fbTab")}</span>
          </div>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={k === "folder" ? (withDesc ? `Gros œuvre ${sep} Fondations et murs\nSecond œuvre ${sep} Cloisons, doublages` : "Gros œuvre\nSecond œuvre") : k === "group" ? (withDesc ? `MUR_BA20 ${sep} Mur béton armé 20 cm\nCLOI_72 ${sep} Cloison 72/48` : "MUR_BA20\nCLOI_72") : (withDesc ? `BETON_C25 ${sep} Béton C25/30\nACIER_HA ${sep} Acier HA` : "BETON_C25\nACIER_HA")}
            className="block h-36 w-full resize-none bg-background p-2 font-mono text-xs outline-none" />
        </div>
        <p className="text-[11px] text-muted-foreground">{t("fbListHint")}</p>
        <div className="overflow-hidden rounded-sm border border-border">
          <div className="border-b border-border bg-ribbon/35 px-2 py-1 font-semibold">{t("fbPreview")} · {drafts.length}</div>
          <div className="max-h-40 overflow-auto">{drafts.map((d, i) => { const dup = siblings.has(d.name.toLowerCase()) || (seen.get(d.name.toLowerCase()) ?? 0) > 1; return (
            <div key={i} className="flex items-center gap-2 border-b border-border/50 px-2 py-1 last:border-0" title={dup ? t("fbDup") : undefined}>
              {k !== "folder" ? <RowModel kind={k} models={models} value={rowModels[i] ?? DEFAULT_MODEL[k]} onPick={(id, all) => setRowModels((r) => all ? Object.fromEntries(drafts.map((_, j) => [j, id])) : { ...r, [i]: id })} /> : <RowIcon icon={rowIcons[i]} recent={recent.map((e) => e.src)} onPick={(src, all) => setRowIcons((r) => all ? Object.fromEntries(drafts.map((_, j) => [j, src])) : { ...r, [i]: src })} />}
              <span className={`truncate font-medium ${dup ? "text-warning" : ""}`}>{d.name}</span>
              {d.description && <span className="truncate text-muted-foreground">— {d.description}</span>}
            </div>); })}</div>
        </div>
      </div>
      <div className="secondary-dialog-footer flex items-center justify-end gap-2 px-4 py-2">
        <span className="mr-auto text-[10px] opacity-80">Ctrl+Entrée</span>
        <button type="button" className={DIALOG_BTN} disabled={!drafts.length} onClick={create}>{t("fbCreate", { n: drafts.length })}</button>
        <button type="button" className={DIALOG_BTN} onClick={() => setOpen(false)}>{t("cancel")}</button>
      </div>
    </DialogContent>
  </Dialog>;
}

function RowIcon({ icon, recent, onPick }: { icon: string | undefined; recent: string[]; onPick: (src: string | undefined, all: boolean) => void }) {
  const t = useT(); const [open, setOpen] = useState(false); const [all, setAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (src: string | undefined) => { onPick(src, all); setOpen(false); };
  const load = (file: File) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => {
    const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); if (!x || !img.width) return;
    const k = Math.min(64 / img.width, 64 / img.height); x.drawImage(img, (64 - img.width * k) / 2, (64 - img.height * k) / 2, img.width * k, img.height * k);
    URL.revokeObjectURL(url); useFolderIcons.getState().record(c.toDataURL("image/png"), file.name); pick(c.toDataURL("image/png")); }; img.src = url; };
  const cell = (src: string | undefined) => <Button key={src ?? "default"} type="button" variant="outline" size="icon" className={`h-8 w-8 rounded-sm ${icon === src ? "border-ribbon-dark bg-selection" : ""}`} title={src ? undefined : t("defaultIcon")} onClick={() => pick(src)}>{src ? <img src={src} alt="" className="h-5 w-5 object-contain" /> : <NodeIcon type="folder" />}</Button>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm hover:bg-selection" title={t("chooseFolderIcon")}>{icon ? <img src={icon} alt="" className="h-4 w-4 object-contain" /> : <NodeIcon type="folder" />}</button></PopoverTrigger>
    <PopoverContent align="start" className="w-64 space-y-2 p-2 text-xs">
      <div className="grid grid-cols-6 gap-1">{cell(undefined)}{recent.map(cell)}</div>
      <Button type="button" variant="outline" size="sm" className="h-7 w-full" onClick={() => fileRef.current?.click()}><ImagePlus />{t("chooseIcon")}</Button>
      <label className="flex items-center gap-2"><Checkbox checked={all} onCheckedChange={(v) => setAll(!!v)} />{t("fbAllRows")}</label>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ""; }} />
    </PopoverContent>
  </Popover>;
}

function RowModel({ kind, models, value, onPick }: { kind: "group" | "component"; models: AttributeTemplate[]; value: string; onPick: (id: string, all: boolean) => void }) {
  const t = useT(); const [open, setOpen] = useState(false); const [all, setAll] = useState(false);
  const current = models.find((m) => m.id === value);
  const pick = (id: string) => { onPick(id, all); setOpen(false); };
  const item = (id: string, label: string, node: Parameters<typeof NodeIcon>[0]["node"], extra?: string) => <button key={id} type="button" onClick={() => pick(id)}
    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-selection ${value === id ? "bg-selection font-semibold" : ""}`}>
    <NodeIcon node={node} /><span className="flex-1 truncate">{label}</span>{extra && <span className="text-[10px] text-muted-foreground">{extra}</span>}</button>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" className="flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-sm border border-border bg-panel px-1.5 text-[11px] hover:border-ribbon-dark" title={t("templates")}>
      <NodeIcon node={current ?? { type: kind }} /><span className="truncate">{current?.name ?? t("tplEmpty")}</span></button></PopoverTrigger>
    <PopoverContent align="start" className="w-64 space-y-1 p-1 text-xs">
      <div className="border-b border-border bg-ribbon/35 px-2 py-1.5 text-[11px] text-muted-foreground">{t(kind)} · {t("templates")}</div>
      <div className="max-h-56 overflow-auto">{item("", t("tplEmpty"), { type: kind })}{models.map((m) => item(m.id, m.name, m, String(m.attrs.length)))}</div>
      <label className="flex items-center gap-2 border-t border-border px-2 py-1.5"><Checkbox checked={all} onCheckedChange={(v) => setAll(!!v)} />{t("fbAllRows")}</label>
    </PopoverContent>
  </Popover>;
}
