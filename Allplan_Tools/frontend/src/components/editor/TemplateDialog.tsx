import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATTRIBUTE_CATALOG, useCatalog } from "@/lib/catalog-store";
import { addTemplateAttributes, reorderTemplateAttributes, dragTemplate, dragCatalogModel, findTemplate, parseTemplates, normalizeModels, isDefaultTemplate, modelAttributeAllowed, useTemplates, type AttributeTemplate } from "@/lib/templates";
import { dragNewAttrs } from "@/lib/attr-favorites";
import { useT } from "@/lib/i18n";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { AttributeValueRow } from "./PropertyPanel";
import { AttrPickerDialog, attrTip } from "./AttrPickerDialog";
import { NodeIcon } from "./NodeIcon";
import { RowDragGrip } from "./RowDragGrip";
import { moveSelectionInOrder } from "@/lib/selection-order";
import templateIcon from "@/assets/icons/attribute_model_show.svg.asset.json";
import addIcon from "@/assets/icons/attribute_add-2.png.asset.json";
import { CustomToolbar } from "./CustomToolbar";
import moveUpIcon from "@/assets/icons/move_up.svg.asset.json";
import moveDownIcon from "@/assets/icons/move_down.svg.asset.json";
import copyIcon from "@/assets/icons/copy.svg.asset.json";
import cutIcon from "@/assets/icons/cut.svg.asset.json";
import pasteIcon from "@/assets/icons/paste.svg.asset.json";
import deleteIcon from "@/assets/icons/delete.svg.asset.json";
import expandIcon from "@/assets/icons/expand_all.png.asset.json";
import collapseIcon from "@/assets/icons/collapse_all.png.asset.json";
import openIcon from "@/assets/icons/favorite_open.svg.asset.json";
import saveIcon from "@/assets/icons/favorite_save.svg.asset.json";

type Selection = { id: string; nums: number[] };
const Img = ({ src }: { src: string }) => <img src={src} alt="" className="h-4 w-4 shrink-0 object-contain" draggable={false} />;
export function TemplateDialog() {
  const t = useT();
  const { models, update, create, remove, move, setOpen, saveSettings, importCatalog } = useTemplates();
  const [selection, setSelection] = useState<Selection>({ id: models[0]?.id ?? "", nums: [] });
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [picker, setPicker] = useState(false);
  const [ghost, setGhost] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [split, setSplit] = useState(36);
  const splitRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = Array.from(treeRef.current?.querySelectorAll<HTMLElement>("[data-template-id]") ?? []).find((el) => el.dataset['templateId'] === selection.id);
    row?.scrollIntoView({ block: "nearest" });
  }, [selection.id, models, collapsed, q]);
  const anchor = useRef<number | null>(null);
  const dragSource = useRef<string | null>(null);
  const [clip, setClip] = useState<{ id: string; attrs: AttributeTemplate["attrs"]; cut: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const iconFile = useRef<HTMLInputElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const model = findTemplate(models, selection.id);
  const catalog = useCatalog();
  const close = () => { if (!saveSettings()) { setError(t("tplSettingsError")); return; } cleanup.current?.(); dragTemplate.current = null; setOpen(false); };
  const tool = (title: string, icon: ReactNode, action: React.MouseEventHandler<HTMLButtonElement>, disabled = false) => <Button variant="ghost" size="icon" title={title} aria-label={title} className="h-9 w-9 shrink-0 rounded-md hover:bg-selection [&>svg]:h-5 [&>svg]:w-5 [&>img]:h-5 [&>img]:w-5" onClick={action} disabled={disabled}>{icon}</Button>;
  const selectAttr = (m: AttributeTemplate, num: number, e: React.MouseEvent) => {
    let nums = [num];
    if (e.shiftKey && selection.id === m.id && anchor.current !== null) { const a = m.attrs.findIndex((x) => x.num === anchor.current), b = m.attrs.findIndex((x) => x.num === num); nums = m.attrs.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.num); }
    else if ((e.ctrlKey || e.metaKey) && selection.id === m.id) nums = selection.nums.includes(num) ? selection.nums.filter((n) => n !== num) : [...selection.nums, num];
    if (!e.shiftKey) anchor.current = num;
    setSelection({ id: m.id, nums });
  };
  const startDrag = (e: React.DragEvent, m: AttributeTemplate, num?: number) => {
    e.stopPropagation();
    dragSource.current = num === undefined ? null : m.id;
    const nums = num === undefined ? [] : selection.id === m.id && selection.nums.includes(num) ? selection.nums : [num];
    dragTemplate.current = num === undefined ? { model: m } : { attrs: m.attrs.filter((a) => nums.includes(a.num)) };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/smartcatalog-template", m.id);
    const box = e.currentTarget.closest("[data-dialog-box]"); if (!box) return;
    const rect = box.getBoundingClientRect();
    const onDrag = (ev: DragEvent) => { if (ev.clientX || ev.clientY) setGhost(ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom); };
    const finish = () => { setGhost(false); setOver(null); setTimeout(() => { dragTemplate.current = null; }, 0); cleanup.current?.(); };
    document.addEventListener("dragover", onDrag); document.addEventListener("drop", finish); document.addEventListener("dragend", finish);
    cleanup.current = () => { document.removeEventListener("dragover", onDrag); document.removeEventListener("drop", finish); document.removeEventListener("dragend", finish); };
  };
  const endDrag = () => { dragSource.current = null; cleanup.current?.(); dragTemplate.current = null; setGhost(false); setOver(null); };
  const warnReserved = (nums: number[]) => { const blocked = nums.filter((num) => !modelAttributeAllowed(num)); if (blocked.length) setError(t("tplReservedImport", { n: [...new Set(blocked)].join(", ") })); else setError(""); };
  const dropAttrs = (e: React.DragEvent, m: AttributeTemplate, before?: number) => {
    const attrs = dragTemplate.current?.attrs;
    const nums = dragNewAttrs.current ?? attrs?.map((a) => a.num);
    if (!nums) return;
    e.preventDefault(); e.stopPropagation();
    warnReserved(nums);
    update(m.id, (old) => { if (dragSource.current === m.id && attrs) return reorderTemplateAttributes(old, nums, before); const next = addTemplateAttributes(old, nums, before); return { ...next, attrs: next.attrs.map((a) => old.attrs.some((x) => x.num === a.num) ? a : attrs?.find((x) => x.num === a.num) ?? a) }; });
    setCollapsed((s) => s.filter((id) => id !== m.id)); setOver(null); setSelection({ id: m.id, nums });
  };
  const dropProps = (m: AttributeTemplate, before?: number) => ({
    onDragOver: (e: React.DragEvent) => {
      const incoming = dragCatalogModel.current ? catalog.nodes[dragCatalogModel.current] : undefined;
      const valid = incoming ? incoming.type === m.type || m.type === "group" && incoming.type === "component" : !!(dragNewAttrs.current || dragTemplate.current?.attrs);
      if (valid) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setOver((current) => before === undefined && current?.startsWith(`${m.id}:`) && current !== `${m.id}:model` ? current : `${m.id}:${before ?? "model"}`); }
    },
    onDrop: (e: React.DragEvent) => { if (dragCatalogModel.current) { dropCatalog(e, m.id); return; } const position = before ?? (over?.startsWith(`${m.id}:`) && over !== `${m.id}:model` ? Number(over.split(":").at(-1)) : undefined); dropAttrs(e, m, position); },
  });
  const dropCatalog = (e: React.DragEvent, parentId?: string) => { const id = dragCatalogModel.current; if (!id) return; e.preventDefault(); e.stopPropagation(); const created = importCatalog(catalog.nodes, id, parentId); dragCatalogModel.current = null; setOver(null); if (created) { setQ(""); setSelection({ id: created, nums: [] }); if (parentId) setCollapsed((s) => s.filter((id) => id !== parentId)); } };
  let modelRowIndex = 0;
  const renderModel = (m: AttributeTemplate, depth = 0): ReactNode => {
    const query = q.trim().toLowerCase();
    const matchesQuery = (item: AttributeTemplate): boolean => item.name.toLowerCase().includes(query) || item.children.some(matchesQuery);
    if (query && !matchesQuery(m)) return null;
    const open = !!query || !collapsed.includes(m.id);
    const stripe = modelRowIndex++ % 2 ? "bg-row-alt" : "bg-background";
    return <div key={m.id}>
      <div data-draggable-row data-template-id={m.id} data-drop-position={over === `${m.id}:model` && dragCatalogModel.current && catalog.nodes[dragCatalogModel.current]?.type !== m.type ? "after" : undefined} draggable onDragStart={(e) => startDrag(e, m)} onDragEnd={endDrag} {...dropProps(m)} onClick={() => { setSelection({ id: m.id, nums: [] }); setError(""); }} className={`relative flex h-8 cursor-default items-center gap-2 border-b border-border/50 pr-2 ${selection.id === m.id ? "catalog-selected-row bg-selection" : stripe} ${over === `${m.id}:model` ? "drop-target" : ""}`} style={{ paddingLeft: 16 + depth * 16 }}>
        <RowDragGrip className="absolute left-0 top-1" />
        {m.children.length > 0 ? <Button variant="ghost" size="icon" className="h-6 w-5 shrink-0" aria-label={t(open ? "collapseAll" : "expandAll")} onClick={(e) => { e.stopPropagation(); setCollapsed((s) => open ? [...s, m.id] : s.filter((id) => id !== m.id)); }}>{open ? <ChevronDown /> : <ChevronRight />}</Button> : <span className="w-5 shrink-0" />}
        <NodeIcon node={m} /><span className="min-w-0 flex-1 truncate font-semibold">{m.name}</span><span className="text-[10px] text-muted-foreground">{m.attrs.length}</span>
      </div>
      {open && m.children.map((c) => renderModel(c, depth + 1))}
      {over === `${m.id}:model` && dragCatalogModel.current && catalog.nodes[dragCatalogModel.current]?.type === m.type && <div className="drop-gap" />}
    </div>;
  };
  const save = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(models, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "SmartCatalog-models.json"; a.click(); URL.revokeObjectURL(url); };
  const importFile = async (f?: File) => { if (!f) return; try { const parsed = parseTemplates(JSON.parse(await f.text())); if (!parsed) throw new Error(); useTemplates.setState({ models: normalizeModels(parsed) }); setSelection({ id: parsed[0]?.id ?? "", nums: [] }); const nums = (items: AttributeTemplate[]): number[] => items.flatMap((m) => [...m.attrs.map((a) => a.num), ...nums(m.children)]); warnReserved(nums(parsed)); } catch { setError(t("tplImportError")); } };
  const addModel = (type: AttributeTemplate["type"], child = false) => { const id = create(type, `${t(type)} ${models.length + 1}`, child ? model?.id : undefined); setQ(""); if (child && model) setCollapsed((s) => s.filter((id) => id !== model.id)); setSelection({ id, nums: [] }); };
  const deleteSelection = () => { if (!model) return; if (selection.nums.length) { update(model.id, (m) => ({ ...m, attrs: m.attrs.filter((a) => !selection.nums.includes(a.num)) })); setSelection({ id: model.id, nums: [] }); } else { remove(model.id); setSelection({ id: "", nums: [] }); } };
  const deleteAttrs = () => { if (!model || !selection.nums.length) return; update(model.id, (m) => ({ ...m, attrs: m.attrs.filter((a) => !selection.nums.includes(a.num)) })); setSelection({ id: model.id, nums: [] }); };
  const copyAttrs = (cut: boolean) => { if (model) setClip({ id: model.id, attrs: model.attrs.filter((a) => selection.nums.includes(a.num)).map((a) => ({ ...a })), cut }); };
  const pasteAttrs = () => {
    if (!model || !clip) return;
    const fresh = clip.attrs.filter((a) => !model.attrs.some((x) => x.num === a.num));
    update(model.id, (m) => ({ ...m, attrs: [...m.attrs, ...fresh] }));
    warnReserved(clip.attrs.map((a) => a.num));
    if (clip.cut && clip.id !== model.id) { update(clip.id, (m) => ({ ...m, attrs: m.attrs.filter((a) => !fresh.some((x) => x.num === a.num)) })); setClip(null); }
    setSelection({ id: model.id, nums: fresh.map((a) => a.num) });
  };
  const moveSelection = (dir: -1 | 1, edge = false) => {
    if (!model) return;
    if (!selection.nums.length) { move(model.id, dir, edge); return; }
    update(model.id, (m) => ({ ...m, attrs: moveSelectionInOrder(m.attrs, (a) => selection.nums.includes(a.num), dir, edge) }));
  };
  const buttons: Record<string, ReactNode> = {
    expand: tool(t("expandAll"), <Img src={expandIcon.url} />, () => setCollapsed([])),
    collapse: tool(t("collapseAll"), <Img src={collapseIcon.url} />, () => setCollapsed(models.map((m) => m.id))),
    up: tool(t("up"), <Img src={moveUpIcon.url} />, (e) => moveSelection(-1, e.ctrlKey), !model),
    down: tool(t("down"), <Img src={moveDownIcon.url} />, (e) => moveSelection(1, e.ctrlKey), !model),
    group: tool(`${t("tplNew")} — ${t("group")}`, <NodeIcon type="group" />, () => addModel("group")),
    component: tool(`${t("tplNew")} — ${t("component")}`, <NodeIcon type="component" />, () => addModel("component")),
    child: tool(t("tplChild"), <Plus />, () => addModel("component", true), model?.type !== "group"),
    attribute: tool(t("addAttr"), <Img src={addIcon.url} />, () => setPicker(true), !model),
    del: tool(t("del"), <Img src={deleteIcon.url} />, deleteSelection, !model || !selection.nums.length && isDefaultTemplate(model)),
    cut: tool(t("cut"), <Img src={cutIcon.url} />, () => copyAttrs(true), !selection.nums.length),
    copy: tool(t("copy"), <Img src={copyIcon.url} />, () => copyAttrs(false), !selection.nums.length),
    paste: tool(t("paste"), <Img src={pasteIcon.url} />, pasteAttrs, !model || !clip?.attrs.length),
    open: tool(t("tplImport"), <Img src={openIcon.url} />, () => file.current?.click()),
    save: tool(t("tplExport"), <Img src={saveIcon.url} />, save),
  };
  const input = "h-8 w-full rounded-sm border border-border bg-background px-2 text-xs outline-none focus:border-ribbon-dark";
  return <>
    <Dialog layoutId="attribute-models" title={t("tplTitle")} icon={templateIcon.url} width={1060} height={720} ghost={ghost} nonModal onClose={close} footer={<>
      <span className="mr-auto min-w-0 truncate text-[11px] text-muted-foreground">{model ? t("tplCount", { n: model.attrs.length, v: model.attrs.filter((a) => a.enabled).length }) : t("tplTitle")}</span>
      <Button variant="outline" className={DIALOG_BTN} onClick={close}>{t("saveBtn")}</Button>
      <Button variant="outline" className={DIALOG_BTN} onClick={close}>{t("quit")}</Button>
    </>}>
      <CustomToolbar id="templates" buttons={buttons} initial={[
        { id: "view", label: "view", color: "brand", buttons: ["expand", "collapse"] },
        { id: "move", label: "move", color: "brand", buttons: ["up", "down"] },
        { id: "add", label: "add", color: "brand", buttons: ["group", "component", "child", "attribute"] },
        { id: "edit", label: "edit", color: "brand", buttons: ["del", "cut", "copy", "paste"] },
        { id: "files", label: "templates", color: "brand", buttons: ["open", "save"] },
      ]} />
      {error && <div role="alert" className="bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>}
      <div ref={splitRef} className="flex min-h-0 flex-1 pt-3">
        <div style={{ width: `${split}%` }} className="flex min-w-0 flex-col border border-border">
          <div className="catalog-panel-heading flex h-7 shrink-0 items-center px-2 text-xs font-semibold">{t("templates")}</div>
          <div className="relative shrink-0 border-b border-border p-2"><Search className="absolute left-4 top-4 h-3.5 w-3.5 text-muted-foreground" /><input aria-label={t("search")} placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} className={`${input} pl-7`} /></div>
          <div ref={treeRef} className="min-h-0 flex-1 overflow-auto" tabIndex={0} onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(null); }} onDragOver={(e) => { if (dragCatalogModel.current) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver("root"); } }} onDrop={(e) => dropCatalog(e)} onKeyDown={(e) => { if (e.key === "Delete" && model) { remove(model.id); setSelection({ id: "", nums: [] }); } }}>{models.map((m) => renderModel(m))}{over === "root" && <div className="drop-gap" />}</div>
        </div>
        <div role="separator" aria-orientation="vertical" className="w-3 shrink-0 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); const mv = (ev: MouseEvent) => { const r = splitRef.current?.getBoundingClientRect(); if (r) setSplit(Math.max(25, Math.min(55, (ev.clientX - r.left) / r.width * 100))); }; const up = () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up); }} />
        <div className={`flex min-w-0 flex-1 flex-col border border-border ${model && over === `${model.id}:model` && !dragCatalogModel.current ? "drop-target" : ""}`} onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(null); }} {...(model ? dropProps(model) : {})}>
          <div className="catalog-panel-heading flex h-7 shrink-0 items-center gap-2 px-2 text-xs font-semibold"><span className="min-w-0 flex-1 truncate">{model?.name ?? t("tplAttrs")}</span>{selection.nums.length > 0 && <span className="font-normal text-muted-foreground">{selection.nums.length}</span>}</div>
          <div className="min-h-0 flex-1 overflow-auto" tabIndex={0} onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest("input,textarea,select,button")) return;
            if (e.key === "Delete") { e.preventDefault(); deleteAttrs(); }
            if (e.ctrlKey || e.metaKey) {
              if (e.key.toLowerCase() === "a" && model) { e.preventDefault(); setSelection({ id: model.id, nums: model.attrs.map((a) => a.num) }); }
              if (e.key.toLowerCase() === "c") { e.preventDefault(); copyAttrs(false); }
              if (e.key.toLowerCase() === "x") { e.preventDefault(); copyAttrs(true); }
              if (e.key.toLowerCase() === "v") { e.preventDefault(); pasteAttrs(); }
            }
          }}>
            {!model ? <div className="p-6 text-center text-muted-foreground">{t("tplSelect")}</div> : <>
              <div className="space-y-3 border-b border-border p-3">
                {isDefaultTemplate(model) && <div role="note" className="border-l-2 border-ribbon-dark bg-ribbon/30 px-3 py-2 text-xs leading-5"><strong>{t("tplBuiltIn")}</strong><p>{t("tplBuiltInInfo")}</p></div>}
                <label className="flex items-center gap-3"><span className="w-28 shrink-0 text-xs font-semibold">{t("name")}</span><input disabled={isDefaultTemplate(model)} aria-label={t("name")} value={model.name} onChange={(e) => update(model.id, (m) => ({ ...m, name: e.target.value }))} className={input} /></label>
                <div className="flex items-center gap-3"><span className="w-28 shrink-0 text-xs font-semibold">{t("tplType")}</span><div className="flex rounded-sm border border-border">{(["group", "component"] as const).map((type) => <Button key={type} variant="ghost" className={`h-8 rounded-none px-3 text-xs ${model.type === type ? "bg-selection" : ""}`} aria-pressed={model.type === type} disabled={isDefaultTemplate(model) || type === "component" && model.children.length > 0 || type === "group" && models.some((root) => root.children.some((c) => c.id === model.id))} onClick={() => update(model.id, (m) => ({ ...m, type }))}><NodeIcon type={type} />{t(type)}</Button>)}</div></div>
                <div className="flex items-center gap-3"><span className="w-28 shrink-0 text-xs font-semibold">{t("tplIcon")}</span><NodeIcon node={model} size={24} /><Button variant="outline" size="sm" className="h-7" disabled={isDefaultTemplate(model)} onClick={() => iconFile.current?.click()}>{t("chooseIcon")}</Button>{model.icon && tool(t("defaultIcon"), <X />, () => update(model.id, (m) => ({ ...m, icon: undefined })))}</div>
                {model.type === "group" && <div className="flex items-center gap-3"><span className="w-28 shrink-0 text-xs font-semibold">{t("components")}</span><span className="flex-1 text-xs text-muted-foreground">{t("tplComponents", { n: model.children.length })}</span>{tool(t("tplChild"), <Plus />, () => addModel("component", true))}</div>}
              </div>
              <div className="catalog-panel-heading flex h-9 items-center">{tool(t("addAttr"), <Img src={addIcon.url} />, () => setPicker(true))}{tool(t("del"), <Img src={deleteIcon.url} />, deleteAttrs, !selection.nums.length)}<span className="min-w-0 flex-1 truncate px-2 text-xs font-semibold">{t("tplAttrs")}</span><span className="px-2 text-[10px] text-muted-foreground">{model.attrs.length}</span></div>
              {model.attrs.map((a, i) => <div key={`${model.id}:${a.num}`} data-draggable-row data-template-value={a.num} data-drop-position={over === `${model.id}:${a.num}` ? "before" : undefined} {...dropProps(model, a.num)} onClick={(e) => { if (!(e.target as HTMLElement).closest("input,textarea,select,button,label")) selectAttr(model, a.num, e); }} onDoubleClick={(e) => { if ((e.target as HTMLElement).closest("input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button,label")) return; update(model.id, (m) => ({ ...m, attrs: m.attrs.map((x) => x.num === a.num ? { ...x, enabled: !x.enabled } : x) })); }} className={`relative border-b border-border/60 pb-2 ${selection.nums.includes(a.num) ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : "bg-background"} `}>
                <RowDragGrip draggable onDragStart={(e) => startDrag(e, model, a.num)} onDragEnd={endDrag} className="absolute left-0 top-1.5" />
                <div className="flex items-center gap-2 px-3 pt-2"><label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground"><input type="checkbox" checked={a.enabled} onChange={(e) => update(model.id, (m) => ({ ...m, attrs: m.attrs.map((x) => x.num === a.num ? { ...x, enabled: e.target.checked } : x) }))} className="accent-primary" />{t("tplDefault")}</label>
                  <span className="flex-1" data-tip={(() => { const d = ATTRIBUTE_CATALOG.find((d) => d.num === a.num); return d ? attrTip(d, t) : undefined; })()} /><Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`${t("del")} ${a.num}`} title={`${t("del")} ${a.num}`} onClick={() => { update(model.id, (m) => ({ ...m, attrs: m.attrs.filter((x) => x.num !== a.num) })); setSelection((s) => ({ ...s, nums: s.nums.filter((num) => num !== a.num) })); }}><X className="h-3.5 w-3.5" /></Button></div>
                <div className={a.enabled ? "" : "opacity-50"}><fieldset disabled={!a.enabled}><AttributeValueRow attrs={Object.fromEntries(model.attrs.map((x) => [x.num, x.value]))} num={a.num} value={a.value} onCommit={(value) => update(model.id, (m) => ({ ...m, attrs: m.attrs.map((x) => x.num === a.num ? { ...x, value } : x) }))} /></fieldset></div>
              </div>)}
              {!model.attrs.length && <div className="flex items-center justify-center p-8"><Button variant="outline" size="sm" onClick={() => setPicker(true)}><Img src={addIcon.url} />{t("addAttr")}</Button></div>}
            </>}
          </div>
        </div>
      </div>
      <input ref={file} type="file" accept=".json" className="hidden" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={iconFile} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f || !model) return; const id = model.id; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === "string") { const icon = reader.result; update(id, (m) => ({ ...m, icon })); } }; reader.readAsDataURL(f); e.target.value = ""; }} />
    </Dialog>
    {picker && model && <AttrPickerDialog context={model.type} exclude={[207, catalog.catalog.defAttr, ...model.attrs.map((a) => a.num)]} onClose={() => setPicker(false)} onAdd={(nums) => { update(model.id, (m) => addTemplateAttributes(m, nums)); setSelection({ id: model.id, nums }); }} />}
  </>;
}