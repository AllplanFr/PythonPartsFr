import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ListOrdered, Plus } from "lucide-react";
import folderIcon from "@/assets/icons/folder.png.asset.json";
import copyIcon from "@/assets/icons/copy.svg.asset.json";
import { Button } from "@/components/ui/button";
import { ATTRIBUTE_CATALOG, useCatalog } from "@/lib/catalog-store";
import { applyCustomOrder, sortKeys, DEFAULT_FAVORITE, parseOrderFavorites, parseOrderFolders, useAttrOrder, type FallbackSort, type OrderFavorite } from "@/lib/attr-order";
import { moveSelectionInOrder } from "@/lib/selection-order";
import { useT } from "@/lib/i18n";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { AttrPickerDialog } from "./AttrPickerDialog";
import { CustomToolbar } from "./CustomToolbar";
import { RowDragGrip } from "./RowDragGrip";
import addIcon from "@/assets/icons/attribute_add.png.asset.json";
import upIcon from "@/assets/icons/move_up.svg.asset.json";
import downIcon from "@/assets/icons/move_down.svg.asset.json";
import delIcon from "@/assets/icons/delete.svg.asset.json";
import openIcon from "@/assets/icons/favorite_open.svg.asset.json";
import saveIcon from "@/assets/icons/favorite_save.svg.asset.json";
import customIcon from "@/assets/icons/order_custom.png.asset.json";
import azIcon from "@/assets/icons/az.png.asset.json";
import zaIcon from "@/assets/icons/za.png.asset.json";
import i19Icon from "@/assets/icons/19.png.asset.json";
import i91Icon from "@/assets/icons/91.png.asset.json";

export const FALLBACK: [FallbackSort, string, string][] = [["asc", i19Icon.url, "1 → 9"], ["desc", i91Icon.url, "9 → 1"], ["name", azIcon.url, "A → Z"], ["nameDesc", zaIcon.url, "Z → A"]];
export const attrName = (n: number) => ATTRIBUTE_CATALOG.find((a) => a.num === n)?.name ?? `Attr ${n}`;
const Img = ({ src }: { src: string }) => <img src={src} alt="" className="h-5 w-5 object-contain" draggable={false} />;

/** Manages personal attribute-order favorites; saved explicitly, the active one drives the details panel. */
export function AttrOrderDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const store = useAttrOrder();
  const titleAttr = useCatalog((s) => s.catalog.defAttr);
  const [favs, setFavs] = useState<OrderFavorite[]>(() => store.favorites.map((f) => ({ ...f, order: f.order.filter((n) => n !== titleAttr) })));
  const [folders, setFolders] = useState(() => store.folders ?? []);
  const [folderSelection, setFolderSelection] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [cur, setCur] = useState(store.active);
  const [renaming, setRenaming] = useState<string | null>(null);
  const fav = favs.find((f) => f.id === cur) ?? favs[0] ?? DEFAULT_FAVORITE;
  const order = fav.order;
  const patch = (p: Partial<OrderFavorite>) => setFavs((l) => l.map((f) => f.id === fav.id ? { ...f, ...p } : f));
  const setOrder = (fn: (o: number[]) => number[]) => patch({ order: fn(order) });
  const [sel, setSel] = useState<number[]>([]);
  const [picker, setPicker] = useState(false);
  const [drop, setDrop] = useState<number | null>(null);
  const [error, setError] = useState("");
  const anchor = useRef<number | null>(null);
  const drag = useRef<number[] | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const pick = (id: string) => { setCur(id); setFolderSelection(null); setSel([]); };
  const click = (n: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current !== null) { const a = order.indexOf(anchor.current), b = order.indexOf(n); setSel(order.slice(Math.min(a, b), Math.max(a, b) + 1)); return; }
    if (e.ctrlKey || e.metaKey) setSel((s) => s.includes(n) ? s.filter((x) => x !== n) : [...s, n]); else setSel([n]);
    anchor.current = n;
  };
  const move = (dir: -1 | 1, edge: boolean) => setOrder((o) => moveSelectionInOrder(o, (k) => sel.includes(k), dir, edge));
  const removeSel = () => { setOrder((o) => o.filter((k) => !sel.includes(k))); setSel([]); };
  const dropOn = (target: number | null) => {
    const batch = drag.current; drag.current = null; setDrop(null);
    if (!batch?.length || (target !== null && batch.includes(target))) return;
    setOrder((o) => { const rest = o.filter((k) => !batch.includes(k)); const moving = o.filter((k) => batch.includes(k)); const i = target === null ? rest.length : rest.indexOf(target); rest.splice(i, 0, ...moving); return rest; });
  };
  /** Attributes currently shown in the main details panel, in their displayed order (title and 207 excluded). */
  const currentAttrs = () => {
    const c = useCatalog.getState(); const node = c.selected[0] ? c.nodes[c.selected[0]] : undefined;
    if (!node || (node.type !== "group" && node.type !== "component")) return [];
    const isComp = node.type === "component"; const base = isComp ? [202, 203, 209] : [];
    const extra = Object.keys(node.attrs).map(Number).filter((n) => n !== 207 && n !== 267 && !base.includes(n));
    const present = [...base, ...extra, ...(isComp || node.attrs[267] !== undefined ? [267] : [])].filter((n) => n !== titleAttr && n !== 207);
    return store.sort === "custom" ? applyCustomOrder(present, store.order, store.fallback, attrName) : sortKeys(present, store.sort, attrName);
  };
  const newFav = () => { const id = crypto.randomUUID(); const order = currentAttrs(); setFavs((l) => [...l, { id, name: `${t("orderFavorite")} ${l.length + 1}`, order, fallback: "asc", ...(folderSelection || fav.folderId ? { folderId: folderSelection ?? fav.folderId } : {}) }]); pick(id); setRenaming(id); };
  const newFolder = () => { const id = crypto.randomUUID(); setFolders((l) => [...l, { id, name: t("folder") }]); setFolderSelection(id); setRenaming(id); };
  const duplicate = () => { const id = crypto.randomUUID(); setFavs((l) => [...l, { ...fav, id, name: `${fav.name} (${t("copy")})`, order: [...fav.order] }]); pick(id); setRenaming(id); };
  const delFav = () => {
    if (folderSelection) { setFolders((l) => l.filter((f) => f.id !== folderSelection)); setFavs((l) => l.map((f) => f.folderId === folderSelection ? { ...f, folderId: undefined } : f)); setFolderSelection(null); return; }
    if (favs.length < 2) return;
    const rest = favs.filter((f) => f.id !== fav.id); setFavs(rest); if (rest[0]) pick(rest[0].id);
  };
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ favorites: favs, folders }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "SmartCatalog-attribute-orders.json"; a.click(); URL.revokeObjectURL(url);
  };
  const importFile = async (f?: File) => {
    if (!f) return;
    try { const raw = JSON.parse(await f.text()); const list = parseOrderFavorites(raw); if (!list) throw 0; const ids = new Set(favs.map((x) => x.id)); const add = list.map((x) => ids.has(x.id) ? { ...x, id: crypto.randomUUID() } : x); const incomingFolders = parseOrderFolders(raw); const mapping = new Map(incomingFolders.map((f) => [f.id, crypto.randomUUID()])); setFolders((l) => [...l, ...incomingFolders.map((f) => ({ ...f, id: mapping.get(f.id) ?? f.id }))]); const imported = add.map((f) => ({ ...f, folderId: f.folderId ? mapping.get(f.folderId) : undefined })); setFavs((l) => [...l, ...imported]); if (imported[0]) pick(imported[0].id); setError(""); } catch { setError(t("orderImportErr")); }
  };
  const save = () => { store.saveAll(favs, folderSelection ? store.active : fav.id, folders); store.setSort("custom"); onClose(); };

  const tool = (title: string, icon: ReactNode, action: React.MouseEventHandler<HTMLButtonElement>, disabled = false) => <Button variant="ghost" size="icon" title={title} aria-label={title} onClick={action} disabled={disabled} className="h-9 w-9 rounded-md p-0 hover:bg-selection">{icon}</Button>;
  const buttons = {
    up: tool(t("moveUp"), <Img src={upIcon.url} />, (e) => move(-1, e.ctrlKey || e.metaKey), !sel.length),
    down: tool(t("moveDown"), <Img src={downIcon.url} />, (e) => move(1, e.ctrlKey || e.metaKey), !sel.length),
    addAttr: tool(t("addAttr"), <Img src={addIcon.url} />, () => setPicker(true)),
    del: tool(t("delete"), <Img src={delIcon.url} />, sel.length ? removeSel : delFav, !sel.length && !folderSelection && favs.length < 2),
    duplicate: tool(t("orderDuplicate"), <Img src={copyIcon.url} />, duplicate, !!folderSelection),
    newFolder: tool(t("orderNewFolder"), <Img src={folderIcon.url} />, newFolder),
    newFav: tool(t("orderNewFavorite"), <span className="relative"><ListOrdered className="h-5 w-5 text-ribbon-dark" /><Plus className="absolute -bottom-1 -right-1.5 h-3 w-3 rounded-full bg-background text-ribbon-dark" /></span>, newFav),
    delFav: tool(t("orderDeleteFavorite"), <span className="relative"><ListOrdered className="h-5 w-5 text-muted-foreground" /><img src={delIcon.url} alt="" className="absolute -bottom-1 -right-1.5 h-3 w-3" /></span>, delFav, favs.length < 2),
    open: tool(t("orderImport"), <Img src={openIcon.url} />, () => file.current?.click()),
    save: tool(t("orderExport"), <Img src={saveIcon.url} />, exportFile),
  };

  return (
    <Dialog layoutId="attribute-order" title={t("orderTitle")} icon={customIcon.url} width={820} height={620} onClose={onClose} footer={<>
      <span className="mr-auto pl-1 self-center text-[11px] text-muted-foreground">{t("results", { n: favs.length })}</span>
      <Button variant="outline" className={DIALOG_BTN} onClick={save}>{t("saveBtn")}</Button>
      <Button variant="outline" className={DIALOG_BTN} onClick={onClose}>{t("quit")}</Button>
    </>}>
      <CustomToolbar id="attribute-order-v3" className="px-0!" buttons={buttons} initial={[
        { id: "move", label: "move", color: "brand", buttons: ["up", "down"] },
        { id: "add", label: "add", color: "brand", buttons: ["newFolder", "newFav", "addAttr"] },
        { id: "edit", label: "edit", color: "brand", buttons: ["del", "duplicate"] },
        { id: "files", label: "favorites", color: "brand", buttons: ["open", "save"] },
      ]} />
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <div role="alert" className="mt-2 text-xs text-destructive">{error}</div>}
      <div className="mt-2 flex min-h-0 flex-1 gap-3">
        <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-md border border-border text-xs shadow-sm">
          <div className="catalog-panel-heading flex h-7 shrink-0 items-center px-2 font-semibold">{t("orderFavorites")}</div>
          <div className="min-h-0 flex-1 overflow-auto">
            {[
              ...favs.filter((f) => !f.folderId || !folders.some((d) => d.id === f.folderId)).map((f) => ({ ...f, kind: "favorite" as const })),
              ...folders.flatMap((d) => [{ ...d, kind: "folder" as const }, ...(!collapsed.includes(d.id) ? favs.filter((f) => f.folderId === d.id).map((f) => ({ ...f, kind: "favorite" as const })) : [])]),
            ].map((f, i) => <div key={f.id} data-order-item={f.id} onClick={() => { if (f.kind === "folder") { setFolderSelection(f.id); setSel([]); } else pick(f.id); }} onDoubleClick={() => setRenaming(f.id)}
              className={`flex h-8 cursor-pointer items-center gap-2 border-b border-border/50 px-2 ${(folderSelection ?? fav.id) === f.id ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : "bg-background"}`}>
              {f.kind === "folder" ? <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 p-0" aria-label={collapsed.includes(f.id) ? t("expandAll") : t("collapseAll")} onClick={(e) => { e.stopPropagation(); setCollapsed((l) => l.includes(f.id) ? l.filter((id) => id !== f.id) : [...l, f.id]); }}>{collapsed.includes(f.id) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</Button> : f.folderId ? <span className="w-5 shrink-0" /> : null}
              {f.kind === "folder" ? <img src={folderIcon.url} alt="" className="h-4 w-4 shrink-0 object-contain" /> : <ListOrdered className="h-4 w-4 shrink-0 text-ribbon-dark" />}
              {renaming === f.id ? <input autoFocus aria-label={t("name")} defaultValue={f.name} className="h-6 min-w-0 flex-1 rounded-sm border border-ribbon-dark bg-background px-1 outline-none"
                onBlur={(e) => { const v = e.target.value.trim(); if (v) { if (f.kind === "folder") setFolders((l) => l.map((x) => x.id === f.id ? { ...x, name: v } : x)); else setFavs((l) => l.map((x) => x.id === f.id ? { ...x, name: v } : x)); } setRenaming(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(null); }} />
                : <span className="min-w-0 flex-1 truncate">{f.name}</span>}
              {f.kind === "favorite" && f.id === store.active && <span title={t("orderCurrent")} className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-ribbon-dark"><Check className="h-3 w-3" />{t("orderActive")}</span>}
              <span className="text-[10px] tabular-nums text-muted-foreground">{f.kind === "favorite" ? f.order.length : favs.filter((x) => x.folderId === f.id).length}</span>
            </div>)}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border text-xs shadow-sm" onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDrop(null); }} onDragOver={(e) => { if (drag.current) { e.preventDefault(); setDrop((current) => current ?? -1); } }} onDrop={() => dropOn(drop === -1 ? null : drop)}
            onKeyDown={(e) => { if (e.key === "Delete" && sel.length) removeSel(); }} tabIndex={0}>
            <div className="catalog-panel-heading sticky top-0 z-10 grid grid-cols-[2.5rem_5rem_1fr] font-semibold">
              <span className="border-b border-r border-border py-1 text-center">#</span>
              <span className="border-b border-r border-border py-1 text-center">{t("number")}</span>
              <span className="border-b border-border py-1 text-center">{fav.name}</span>
            </div>
            {order.map((n, i) => <div key={n} data-draggable-row data-drop-position={drop === n ? "before" : undefined} draggable onClick={(e) => click(n, e)}
              onDragStart={(e) => { const b = sel.includes(n) ? order.filter((k) => sel.includes(k)) : [n]; if (!sel.includes(n)) setSel([n]); drag.current = b; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.join(",")); }}
              onDragOver={(e) => { if (!drag.current) return; e.preventDefault(); e.stopPropagation(); setDrop(n); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropOn(n); }} onDragEnd={() => { drag.current = null; setDrop(null); }}
              className={`relative grid cursor-pointer select-none grid-cols-[2.5rem_5rem_1fr] border-b border-border  ${sel.includes(n) ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : ""}`}>
              <RowDragGrip className="absolute left-0 top-0.5" />
              <span className="border-r border-border py-1 text-center tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="attribute-number border-r px-2 py-1 font-mono">{n}</span>
              <span className="truncate px-2 py-1">{attrName(n)}</span>
            </div>)}
            {drop === -1 && <div className="drop-gap" />}
            <div className="p-4 text-center text-muted-foreground">{order.length ? t("orderListHint") : t("orderEmpty")}</div>
          </div>
          <div className="mt-2 flex shrink-0 items-center gap-2 rounded-md border border-border bg-panel px-2 py-1 text-xs">
            <span className="font-semibold">{t("orderOthers")}</span>
            <span className="mr-auto text-muted-foreground">{t("orderOthersHint")}</span>
            {FALLBACK.map(([k, src, label]) => <Button key={k} variant="ghost" size="icon" aria-pressed={fav.fallback === k} title={label} aria-label={label} onClick={() => patch({ fallback: k })}
              className={`h-8 w-8 rounded-md p-0 hover:bg-selection ${fav.fallback === k ? "bg-selection" : ""}`}><Img src={src} /></Button>)}
          </div>
        </div>
      </div>
      {picker && <AttrPickerDialog context="component" exclude={order} onClose={() => setPicker(false)}
        onAdd={(nums) => { setOrder((o) => [...o, ...nums.filter((n) => !o.includes(n))]); setSel(nums); }} />}
    </Dialog>
  );
}
