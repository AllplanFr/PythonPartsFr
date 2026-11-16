import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FolderPlus, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ATTRIBUTE_CATALOG, dragAttr, useCatalog, validateFormula } from "@/lib/catalog-store";
import { FORMULA_ATTRIBUTES, formulaChoices, dragFormula, isFormulaAttribute, parseFormulaSettings, useFormulaFavorites, type FormulaFavorite } from "@/lib/formula-favorites";
import { useT } from "@/lib/i18n";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { FormulaEditor, TextField } from "./PropertyPanel";
import { FormulaIcon } from "./FormulaFavoriteMenus";
import { CustomToolbar } from "./CustomToolbar";
import { RowDragGrip } from "./RowDragGrip";
import { NodeIcon } from "./NodeIcon";
import formulaIcon from "@/assets/icons/formula_favorite.svg.asset.json";
import upIcon from "@/assets/icons/move_up.svg.asset.json";
import downIcon from "@/assets/icons/move_down.svg.asset.json";
import delIcon from "@/assets/icons/delete.svg.asset.json";
import copyIcon from "@/assets/icons/copy.svg.asset.json";
import cutIcon from "@/assets/icons/cut.svg.asset.json";
import pasteIcon from "@/assets/icons/paste.svg.asset.json";
import openIcon from "@/assets/icons/favorite_open.svg.asset.json";
import saveIcon from "@/assets/icons/favorite_save.svg.asset.json";
import expandIcon from "@/assets/icons/expand_all.png.asset.json";
import collapseIcon from "@/assets/icons/collapse_all.png.asset.json";
const input = "h-8 w-full rounded-sm border border-border bg-background px-2 text-xs outline-none focus:border-ribbon-dark";
const Img = ({ src }: { src: string }) => <img src={src} alt="" className="h-5 w-5 object-contain" draggable={false} />;

export function FormulaFavoriteDialog() {
  const t = useT(); const store = useFormulaFavorites(); const { favorites, folders } = store;
  const [ids, setIds] = useState<string[]>(store.selected ? [store.selected] : favorites[0] ? [favorites[0].id] : []);
  const [folderId, setFolderId] = useState<string | undefined>();
  const [collapsed, setCollapsed] = useState<string[]>([]); const [q, setQ] = useState(""); const [error, setError] = useState("");
  const [split, setSplit] = useState(36); const box = useRef<HTMLDivElement>(null); const tree = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null); const iconFile = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState<string | null>(null); const [ghost, setGhost] = useState(false);
  const moving = useRef<string[]>([]); const anchor = useRef<string | null>(null);
  const [clip, setClip] = useState<{ items: FormulaFavorite[]; cut: boolean } | null>(null);
  const favorite = favorites.find((f) => f.id === ids[0]); const folder = folders.find((f) => f.id === folderId);
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => { const selectedId = ids[0] ?? folderId; if (!selectedId) return; const row = Array.from(tree.current?.querySelectorAll<HTMLElement>("[data-formula-id]") ?? []).find((el) => el.dataset['formulaId'] === selectedId); row?.scrollIntoView({ block: "nearest" }); }, [ids, folderId, favorites, folders, collapsed, q]);
  const close = () => { if (!store.saveSettings()) { setError(t("ffSettingsError")); return; } store.setOpen(false); dragFormula.current = null; };
  const add = () => { const id = store.create(`${t("formulaCol")} ${favorites.length + 1}`); if (folderId) store.update(id, { folder: folderId }); setQ(""); setCollapsed((s) => s.filter((id) => id !== folderId)); setIds([id]); setRenaming(id); };
  const addFolder = () => { const id = crypto.randomUUID(); useFormulaFavorites.setState({ folders: [...folders, { id, name: `${t("folder")} ${folders.length + 1}` }] }); setQ(""); setFolderId(id); setIds([]); setRenaming(id); };
  const remove = () => { if (ids.length) { store.remove(ids); setIds([]); } else if (folderId) { useFormulaFavorites.setState({ folders: folders.filter((f) => f.id !== folderId), favorites: favorites.map((f) => f.folder === folderId ? { ...f, folder: undefined } : f) }); setFolderId(undefined); } };
  const copy = (cut: boolean) => setClip({ items: favorites.filter((f) => ids.includes(f.id)).map((f) => ({ ...f })), cut });
  const paste = () => { if (!clip) return; if (clip.cut) { for (const f of clip.items) store.update(f.id, { folder: folderId }); setIds(clip.items.map((f) => f.id)); setClip(null); } else { const copies = clip.items.map((f) => ({ ...f, id: crypto.randomUUID(), folder: folderId })); useFormulaFavorites.setState({ favorites: [...favorites, ...copies] }); setIds(copies.map((f) => f.id)); } setQ(""); setCollapsed((s) => s.filter((id) => id !== folderId)); };
  const exportFile = () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ favorites, folders }, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "SmartCatalog-formulas.json"; a.click(); URL.revokeObjectURL(url); };
  const importFile = async (f?: File) => { if (!f) return; try { const data = parseFormulaSettings(JSON.parse(await f.text())); if (!data) throw new Error(); useFormulaFavorites.setState(data); setIds(data.favorites[0] ? [data.favorites[0].id] : []); setFolderId(undefined); setQ(""); setError(""); } catch { setError(t("ffImportError")); } };
  const select = (f: FormulaFavorite, e: React.MouseEvent) => { const list = favorites.filter((x) => !q || `${x.name} ${x.formula}`.toLowerCase().includes(q.toLowerCase())).map((x) => x.id); if (e.shiftKey && anchor.current && list.includes(anchor.current)) { const a = list.indexOf(anchor.current), b = list.indexOf(f.id); setIds(list.slice(Math.min(a, b), Math.max(a, b) + 1)); } else { setIds(e.ctrlKey || e.metaKey ? ids.includes(f.id) ? ids.filter((id) => id !== f.id) : [...ids, f.id] : [f.id]); anchor.current = f.id; } setFolderId(f.folder); };
  const startDrag = (e: React.DragEvent, f: FormulaFavorite) => { moving.current = ids.includes(f.id) ? ids : [f.id]; dragFormula.current = { ...f }; e.dataTransfer.setData("application/smartcatalog-formula", f.id); e.dataTransfer.effectAllowed = "copyMove"; setIds(moving.current); };
  const drop = (e: React.DragEvent, targetFolder?: string, before?: string) => { e.preventDefault(); e.stopPropagation(); if (dragAttr.current) { const source = dragAttr.current; const node = useCatalog.getState().nodes[source.fromId]; const nums = source.keys ?? [source.key]; for (const num of nums) { if (!isFormulaAttribute(num) || !node?.attrs[num]?.trim()) continue; const id = store.create(`${node.name} · ${num}`, node.attrs[num], num); store.update(id, { folder: targetFolder }); setIds([id]); } } else if (dragFormula.current) { for (const id of moving.current) store.update(id, { folder: targetFolder }); if (before) store.reorder(moving.current, before); } setCollapsed((s) => s.filter((id) => id !== targetFolder)); setOver(null); };
  const tool = (title: string, icon: ReactNode, action: React.MouseEventHandler<HTMLButtonElement>, disabled = false) => <Button variant="ghost" size="icon" title={title} aria-label={title} onClick={action} disabled={disabled} className="h-9 w-9 rounded-md p-0 hover:bg-selection">{icon}</Button>;
  const buttons = {
    expand: tool(t("expandAll"), <Img src={expandIcon.url} />, () => setCollapsed([])), collapse: tool(t("collapseAll"), <Img src={collapseIcon.url} />, () => setCollapsed(["root", ...folders.map((f) => f.id)])),
    up: tool(t("up"), <Img src={upIcon.url} />, (e) => store.move(ids, -1, e.ctrlKey), !ids.length), down: tool(t("down"), <Img src={downIcon.url} />, (e) => store.move(ids, 1, e.ctrlKey), !ids.length),
    folder: tool(t("folder"), <FolderPlus className="h-5 w-5 text-ribbon-dark" />, addFolder), formula: tool(t("ffNew"), <FormulaIcon />, add),
    del: tool(t("del"), <Img src={delIcon.url} />, remove, !ids.length && !folderId), cut: tool(t("cut"), <Img src={cutIcon.url} />, () => copy(true), !ids.length), copy: tool(t("copy"), <Img src={copyIcon.url} />, () => copy(false), !ids.length), paste: tool(t("paste"), <Img src={pasteIcon.url} />, paste, !clip),
    open: tool(t("ffOpen"), <Img src={openIcon.url} />, () => file.current?.click()), save: tool(t("ffExport"), <Img src={saveIcon.url} />, exportFile),
  };
  const renderFolder = (id?: string) => {
    const currentFolder = folders.find((f) => f.id === id); const label = currentFolder?.name ?? t("favorites"); const key = id ?? "root"; const open = !collapsed.includes(key) || !!q;
    const list = favorites.filter((f) => f.folder === id && (!q || `${f.name} ${f.formula} ${f.description}`.toLowerCase().includes(q.toLowerCase())));
    return <div key={key}><div data-formula-id={id} className={`flex h-8 items-center gap-2 border-b border-border/50 px-2 ${!ids.length && folderId === id ? "catalog-selected-row bg-selection" : "bg-panel"} ${over === key ? "drop-target" : ""}`} onClick={() => { setFolderId(id); setIds([]); }} onDragOver={(e) => { if (dragFormula.current || dragAttr.current) { e.preventDefault(); setOver(key); } }} onDrop={(e) => drop(e, id)}><Button variant="ghost" size="icon" className="h-6 w-5 p-0" aria-label={t(open ? "collapseAll" : "expandAll")} onClick={(e) => { e.stopPropagation(); setCollapsed((s) => open ? [...s, key] : s.filter((x) => x !== key)); }}>{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</Button><NodeIcon node={{ type: "folder", icon: currentFolder?.icon }} />{renaming === id && id ? <input autoFocus aria-label={t("name")} defaultValue={label} className={input} onBlur={(e) => { const name = e.target.value.trim(); if (name) useFormulaFavorites.setState({ folders: folders.map((f) => f.id === id ? { ...f, name } : f) }); setRenaming(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }} /> : <span className="min-w-0 flex-1 truncate font-semibold" onDoubleClick={() => id && setRenaming(id)}>{label}</span>}<span className="text-[10px] text-muted-foreground">{list.length}</span></div>
      {open && list.map((f, i) => <div key={f.id} data-formula-id={f.id} data-drop-position={over === f.id ? "before" : undefined} data-draggable-row className={`relative flex h-8 items-center gap-2 border-b border-border/50 pl-9 pr-2 ${ids.includes(f.id) ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : "bg-background"} `} onClick={(e) => select(f, e)} onDoubleClick={() => setRenaming(f.id)} onDragOver={(e) => { if (dragFormula.current) { e.preventDefault(); e.stopPropagation(); setOver(f.id); } }} onDrop={(e) => drop(e, f.folder, f.id)}><RowDragGrip draggable onDragStart={(e) => startDrag(e, f)} onDrag={(e) => { const r = box.current?.closest("[data-dialog-box]")?.getBoundingClientRect(); if (r && (e.clientX || e.clientY)) setGhost(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom); }} onDragEnd={() => { dragFormula.current = null; moving.current = []; setGhost(false); setOver(null); }} className="absolute left-4 top-1" /><FormulaIcon favorite={f} />{renaming === f.id ? <input autoFocus aria-label={t("name")} defaultValue={f.name} className={input} onClick={(e) => e.stopPropagation()} onBlur={(e) => { if (e.target.value.trim()) store.update(f.id, { name: e.target.value.trim() }); setRenaming(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }} /> : <span className="min-w-0 flex-1 truncate">{f.name}</span>}<span className="text-[10px] text-muted-foreground">{f.attribute}</span><Button variant="ghost" size="icon" title={t("del")} className="h-6 w-6 p-0 text-muted-foreground" onClick={(e) => { e.stopPropagation(); store.remove([f.id]); setIds(ids.filter((id) => id !== f.id)); }}><X className="h-3.5 w-3.5" /></Button></div>)}
      {over === key && <div className="drop-gap" />}
    </div>;
  };
  return <Dialog layoutId="formula-favorites" title={t("ffTitle")} icon={formulaIcon.url} width={1060} height={720} nonModal ghost={ghost} onClose={close} footer={<><span className="mr-auto text-[11px] text-muted-foreground">{t("results", { n: favorites.length })}</span><Button variant="outline" className={DIALOG_BTN} onClick={close}>{t("saveBtn")}</Button><Button variant="outline" className={DIALOG_BTN} onClick={close}>{t("quit")}</Button></>}>
    <CustomToolbar id="formula-favorites" buttons={buttons} initial={[{ id: "view", label: "view", color: "brand", buttons: ["expand", "collapse"] }, { id: "move", label: "move", color: "brand", buttons: ["up", "down"] }, { id: "add", label: "add", color: "brand", buttons: ["folder", "formula"] }, { id: "edit", label: "edit", color: "brand", buttons: ["del", "cut", "copy", "paste"] }, { id: "files", label: "favorites", color: "brand", buttons: ["open", "save"] }]} />
    {error && <div role="alert" className="bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
    <div ref={box} className="flex min-h-0 flex-1 pt-3"><div style={{ width: `${split}%` }} className="flex min-w-0 flex-col border border-border"><div className="catalog-panel-heading flex h-7 shrink-0 items-center px-2 text-xs font-semibold">{t("ffTitle")}</div><div className="relative border-b border-border p-2"><Search className="absolute left-4 top-4 h-3.5 w-3.5 text-muted-foreground" /><input aria-label={t("search")} placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} className={`${input} pl-7`} /></div><div ref={tree} tabIndex={0} className="min-h-0 flex-1 overflow-auto text-xs" onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(null); }} onKeyDown={(e) => { if ((e.target as HTMLElement).closest("input")) return; if (e.key === "Delete") remove(); if (e.ctrlKey || e.metaKey) { if (e.key === "a") { e.preventDefault(); setIds(favorites.map((f) => f.id)); } if (e.key === "c") copy(false); if (e.key === "x") copy(true); if (e.key === "v") paste(); } }}>{renderFolder()}{folders.map((f) => renderFolder(f.id))}{!favorites.length && <div className="flex flex-col items-center gap-3 p-6 text-center text-muted-foreground"><span>{t("ffEmpty")}</span><Button variant="outline" size="sm" onClick={add}><Plus />{t("ffNew")}</Button></div>}</div></div>
      <div role="separator" aria-orientation="vertical" className="w-3 shrink-0 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); const move = (ev: MouseEvent) => { const r = box.current?.getBoundingClientRect(); if (r) setSplit(Math.max(25, Math.min(55, (ev.clientX - r.left) / r.width * 100))); }; const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); }} />
      <div className="flex min-w-0 flex-1 flex-col border border-border"><div className="catalog-panel-heading flex h-7 shrink-0 items-center px-2 text-xs font-semibold">{favorite?.name ?? folder?.name ?? t("formulaCol")}</div><div className="min-h-0 flex-1 overflow-auto p-3">
        {favorite ? <div className="space-y-4"><label className="block space-y-1.5 text-xs font-semibold">{t("title")}<TextField value={favorite.name} caseBtn onCommit={(name) => { if (name.trim()) store.update(favorite.id, { name }); }} /></label><label className="block space-y-1.5 text-xs font-semibold">{t("description")}<input aria-label={t("description")} value={favorite.description} className={input} onChange={(e) => store.update(favorite.id, { description: e.target.value })} /></label>
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">{t("ffAttribute")}</span><div className="flex border border-border">{FORMULA_ATTRIBUTES.map((num) => <Button key={num} variant="ghost" aria-pressed={favorite.attribute === num} className={`h-7 rounded-none px-3 text-xs ${favorite.attribute === num ? "bg-selection" : ""}`} title={ATTRIBUTE_CATALOG.find((a) => a.num === num)?.name} onClick={() => store.update(favorite.id, { attribute: num })}>{num}</Button>)}</div><Button variant="ghost" size="icon" title={t("chooseIcon")} className="ml-auto h-7 w-7" onClick={() => iconFile.current?.click()}><FormulaIcon favorite={favorite} /></Button>{favorite.icon && <Button variant="ghost" size="icon" title={t("defaultIcon")} className="h-7 w-7" onClick={() => store.update(favorite.id, { icon: undefined })}><X /></Button>}</div>
          <div className="text-xs font-semibold">{t("formulaCol")}</div><FormulaEditor key={favorite.id} value={favorite.formula} onDraft={(formula) => store.update(favorite.id, { formula })} onCommit={(formula) => store.update(favorite.id, { formula })} showFavorites={false} />
        </div> : folder ? <div className="space-y-4"><label className="block space-y-2 text-xs font-semibold">{t("title")}<input aria-label={t("title")} value={folder.name} className={input} onChange={(e) => useFormulaFavorites.setState({ folders: folders.map((f) => f.id === folder.id ? { ...f, name: e.target.value } : f) })} /></label><div className="flex items-center gap-3"><span className="w-28 shrink-0 text-xs font-semibold">{t("tplIcon")}</span><NodeIcon node={{ type: "folder", icon: folder.icon }} size={24} /><Button variant="outline" size="sm" className="h-7" onClick={() => iconFile.current?.click()}>{t("chooseIcon")}</Button>{folder.icon && tool(t("defaultIcon"), <X />, () => useFormulaFavorites.setState((s) => ({ folders: s.folders.map((f) => f.id === folder.id ? { ...f, icon: undefined } : f) })))}</div></div> : <div className="p-6 text-center text-xs text-muted-foreground">{t("ffSelect")}</div>}
      </div></div></div>
    <input ref={file} type="file" accept=".json" className="hidden" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} /><input ref={iconFile} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; const target = favorite ?? folder; if (!f || !target) return; const id = target.id; const isFolder = !favorite; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result !== "string") return; const icon = reader.result; if (isFolder) useFormulaFavorites.setState((s) => ({ folders: s.folders.map((entry) => entry.id === id ? { ...entry, icon } : entry) })); else store.update(id, { icon }); }; reader.readAsDataURL(f); e.target.value = ""; }} />
  </Dialog>;
}

export function FormulaApplyDialog() {
  const t = useT(); const pending = useFormulaFavorites((s) => s.pending); const catalog = useCatalog();
  const node = pending ? catalog.nodes[pending.nodeId] : undefined;
  const choices = pending ? formulaChoices(node, pending.favorite.attribute, catalog.catalog.defAttr) : [];
  const [selected, setSelected] = useState<number | undefined>(() => pending?.attribute ?? choices[0]?.attribute);
  const [error, setError] = useState(""); const applyButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => applyButton.current?.focus(), 50);
    const onEnter = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing || e.repeat || !pending || selected === undefined) return;
      const current = useCatalog.getState();
      if (!formulaChoices(current.nodes[pending.nodeId], pending.favorite.attribute, current.catalog.defAttr).some((c) => c.attribute === selected) || !pending.favorite.formula.trim() || validateFormula(pending.favorite.formula)) return;
      e.preventDefault(); e.stopPropagation();
      if (current.applyFormulaFavorite(pending.nodeId, pending.favorite.formula, [selected])) {
        current.select(pending.nodeId); useFormulaFavorites.setState({ pending: null });
      } else setError(t("ffChanged"));
    };
    window.addEventListener("keydown", onEnter, true);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onEnter, true); };
  }, [pending, selected, t]);
  if (!pending) return null;
  const close = () => useFormulaFavorites.setState({ pending: null });
  const formulaError = validateFormula(pending.favorite.formula);
  const canApply = choices.some((choice) => choice.attribute === selected) && !formulaError && !!pending.favorite.formula.trim();
  const apply = () => {
    if (!canApply || selected === undefined) return;
    if (catalog.applyFormulaFavorite(pending.nodeId, pending.favorite.formula, [selected])) { catalog.select(pending.nodeId); close(); }
    else setError(t("ffChanged"));
  };
  return <Dialog layoutId="formula-apply" title={t("ffApply")} icon={formulaIcon.url} width={640} height={480} onClose={close} footer={<><Button ref={applyButton} variant="outline" className={DIALOG_BTN} disabled={!canApply} onClick={apply}>{t("ffApply")}</Button><Button variant="outline" className={DIALOG_BTN} onClick={close}>{t("close")}</Button></>}>
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="py-3 text-sm font-semibold">{node ? t("ffTarget", { n: node.name }) : t("ffUnavailable")}</div>
      <div className="mb-3 border-l-2 border-ribbon-dark bg-panel p-3"><div className="text-xs font-semibold">{pending.favorite.name} · {t("ffNewValue")}</div><pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-foreground">{pending.favorite.formula}</pre></div>
      {(error || formulaError) && <div role="alert" className="mb-2 text-xs text-destructive">{error || formulaError?.msg}</div>}
      <div role="radiogroup" aria-label={t("ffApply")} className="min-h-0 flex-1 overflow-auto border border-border">
        {choices.map(({ attribute, priority }) => <label key={attribute} className={`flex cursor-pointer items-start gap-3 border-b border-border p-3 text-xs ${selected === attribute ? "bg-selection" : "bg-background"}`}>
          <input type="radio" name="formula-target" className="mt-0.5 accent-primary" checked={selected === attribute} onChange={() => setSelected(attribute)} />
          <span className="min-w-0 flex-1"><span className="block font-semibold">{t(priority === 0 ? "ffUpdatePreferred" : priority === 1 ? "ffUpdateOther" : "ffCreatePreferred")}</span>
            <span className="mt-1 block text-muted-foreground"><span className="font-mono">{attribute}</span> · {ATTRIBUTE_CATALOG.find((a) => a.num === attribute)?.name}</span>
            {node?.attrs[attribute] !== undefined && <span className="mt-1 block whitespace-pre-wrap break-all font-mono text-muted-foreground">{node.attrs[attribute] || "—"}</span>}
          </span>
        </label>)}
        {!choices.length && <div className="p-3 text-xs text-muted-foreground">{t("ffUnavailable")}</div>}
      </div>
    </div>
  </Dialog>;
}
