import { showMessage } from "@/lib/app-dialog";
import { useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ATTRIBUTE_CATALOG, ATTRIBUTE_GROUPS, useCatalog, type AttrDef } from "@/lib/catalog-store";
import { dragNewAttrs, FAV_KINDS, isImportAttr, isUserAttr, parseFavorites, useAttrFavorites, type FavKind } from "@/lib/attr-favorites";
import { useT } from "@/lib/i18n";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import materialIcon from "@/assets/icons/material.png.asset.json";
import compIcon from "@/assets/icons/component.png.asset.json";
import fxIcon from "@/assets/icons/formula_fx.svg.asset.json";
import addAttrIcon from "@/assets/icons/attribute_add-2.png.asset.json";
import favOpenIcon from "@/assets/icons/favorite_open.svg.asset.json";
import favSaveIcon from "@/assets/icons/favorite_save.svg.asset.json";
import { RowDragGrip } from "./RowDragGrip";

const FAV_ICON: Record<FavKind, string> = { group: materialIcon.url, component: compIcon.url, formula: fxIcon.url };
const FAV_LABEL: Record<FavKind, "favGroup" | "favComponent" | "favFormula"> = { group: "favGroup", component: "favComponent", formula: "favFormula" };

const CTL: Record<string, string> = { edit: "LineEdit", combo: "ComboBox", check: "CheckBox", date: "Date", formula: "Formula" };
const TYPE: Record<string, string> = { text: "Text", int: "Integer", dec: "Float" };
/** Rich tooltip text understood by AppTooltips (= key|value, # section, ~ index|value). */
export function attrTip(a: AttrDef, t: ReturnType<typeof useT>) {
  const l = [`${a.num} — ${a.name}`];
  l.push(`=${t("attrTipType")}|${a.options?.length && a.type === "text" ? "ComboBox " + (a.readOnly ? "" : t("attrTipEditable")) + " - " : (CTL[a.control ?? "edit"] ?? "") + " - "}${TYPE[a.type]}`);
  if (a.unit) l.push(`=${t("attrTipUnit")}|${a.unit}`);
  if (a.min != null || a.max != null) l.push(`=Min / Max|${a.min ?? "—"} / ${a.max ?? "—"}`);
  l.push(`=${t("attrTipUser")}|${isUserAttr(a.num) ? t("yes") : t("no")}`);
  const g = (a.groups ?? []).map((i) => ATTRIBUTE_GROUPS[i]).filter(Boolean);
  if (g.length) l.push(`=${t("attrGroupsHeader")}|${g.join(", ")}`);
  if (a.comment && a.comment !== a.name) l.push(a.comment);
  if (a.options?.length) {
    l.push(`#${t("attrTipChoices")} (${a.options.length})`);
    a.options.slice(0, 15).forEach((o, i) => l.push(`~${String(i).padStart(2, "0")}|${o || "—"}`));
    if (a.options.length > 15) l.push(`~…|+${a.options.length - 15}`);
  }
  return l.join("\n");
}

/** Add one or more attributes. `context` picks the default list shown and which favourite is highlighted. */
export function AttrPickerDialog({ context, exclude = [], onAdd, onClose }: { context: FavKind; exclude?: number[]; onAdd: (nums: number[]) => void; onClose: () => void }) {
  const t = useT();
  const titleAttr = useCatalog((s) => s.catalog.defAttr);
  const blocked = context === "formula" ? exclude : [...exclude, 207, titleAttr];
  const { favs, toggle, setAll } = useAttrFavorites();
  const [cats, setCats] = useState<string[]>([`fav:${context}`]);
  const cat = cats[0] ?? "all";
  const [ghost, setGhost] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  const [dropFav, setDropFav] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [asc, setAsc] = useState<{ col: "num" | "name"; up: boolean }>({ col: "num", up: true });
  const [sel, setSel] = useState<number[]>([]);
  const anchor = useRef<number | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let base = ATTRIBUTE_CATALOG.filter((a) => !blocked.includes(a.num));
    const inCat = (a: AttrDef, c: string) => c === "all" ? true : c.startsWith("fav:") ? favs[c.slice(4) as FavKind].includes(a.num)
      : c === "user" ? isUserAttr(a.num) : c === "import" ? isImportAttr(a.num) : c.startsWith("g:") ? !!a.groups?.includes(Number(c.slice(2))) : false;
    if (!s) base = base.filter((a) => cats.some((c) => inCat(a, c)));
    else base = base.filter((a) => String(a.num).startsWith(s) || a.name.toLowerCase().includes(s));
    const d = asc.up ? 1 : -1;
    return [...base].sort((x, y) => d * (asc.col === "num" ? x.num - y.num : x.name.localeCompare(y.name)));
  }, [q, cats, favs, asc, exclude, titleAttr, context]);

  const click = (n: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor.current !== null) {
      const i = list.findIndex((a) => a.num === anchor.current), j = list.findIndex((a) => a.num === n);
      setSel(list.slice(Math.min(i, j), Math.max(i, j) + 1).map((a) => a.num));
    } else if (e.ctrlKey || e.metaKey) { setSel((s) => s.includes(n) ? s.filter((x) => x !== n) : [...s, n]); anchor.current = n; }
    else { setSel([n]); anchor.current = n; }
  };
  const exportFavs = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(favs, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "attribute-favorites.json"; a.click(); URL.revokeObjectURL(url);
  };
  const importFavs = async (f?: File) => {
    if (!f) return;
    try { const p = parseFavorites(JSON.parse(await f.text())); if (p) setAll(p); else showMessage(t("favImportErr")); } catch { showMessage(t("favImportErr")); }
  };
  const add = (nums: number[]) => { if (nums.length) { onAdd(nums); onClose(); } };


  const counts = useMemo(() => {
    const base = ATTRIBUTE_CATALOG.filter((a) => !blocked.includes(a.num));
    const c: Record<string, number> = { all: base.length, user: 0, import: 0 };
    for (const k of FAV_KINDS) c[`fav:${k}`] = favs[k].length;
    for (const a of base) {
      if (isUserAttr(a.num)) c["user"]!++;
      if (isImportAttr(a.num)) c["import"]!++;
      for (const g of a.groups ?? []) c[`g:${g}`] = (c[`g:${g}`] ?? 0) + 1;
    }
    return c;
  }, [favs, exclude, titleAttr, context]);
  const catLabel = !q.trim() && cats.length > 1 ? t("nGroupsSel", { n: cats.length }) : q.trim() ? `${t("search")} : « ${q.trim()} »`
    : cat === "all" ? t("allAttrs") : cat === "user" ? t("userAttrs") : cat === "import" ? t("importAttrs")
    : cat.startsWith("fav:") ? t(FAV_LABEL[cat.slice(4) as FavKind]) : ATTRIBUTE_GROUPS[Number(cat.slice(2))] ?? "";
  const catIcon = !q.trim() && cats.length === 1 && cat.startsWith("fav:") ? FAV_ICON[cat.slice(4) as FavKind] : undefined;

  const link = (id: string, label: string, extra = "", icon?: string) => <button key={id} title={id === "all" ? undefined : t("multiGroupHint")}
    onDragOver={id.startsWith("fav:") ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropFav(id); } : undefined}
    onDragLeave={() => setDropFav((d) => (d === id ? null : d))}
    onDrop={id.startsWith("fav:") ? (e) => { e.preventDefault(); setDropFav(null); const nums = dragNewAttrs.current ?? e.dataTransfer.getData("text/plain").split(",").map(Number).filter((n) => n > 0); useAttrFavorites.getState().add(id.slice(4) as FavKind, nums); } : undefined}
    onClick={(e) => { setQ("");
      if ((e.ctrlKey || e.metaKey) && id !== "all") setCats((c) => { const n = c.filter((x) => x !== "all"); return n.includes(id) ? (n.length > 1 ? n.filter((x) => x !== id) : n) : [...n, id]; });
      else setCats([id]); }}
    className={`relative mx-1 flex w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-selection/60 ${dropFav === id ? "drop-target" : ""} ${cats.includes(id) && !q ? "bg-selection font-medium before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-ribbon-dark" : ""} ${extra}`}>
    {icon && <img src={icon} alt="" className="h-3.5 w-3.5 object-contain" />}<span className="min-w-0 flex-1 truncate">{label}</span>
    <span className="shrink-0 text-[10px] font-normal not-italic tabular-nums text-muted-foreground">{counts[id] ?? 0}</span></button>;
  const sep = <div className="mx-2 my-1.5 border-t border-dashed border-border" />;
  const head = (col: "num" | "name", label: string) => <button className="flex items-center justify-center gap-1 border-b border-r border-border py-1 font-semibold"
    onClick={() => setAsc((a) => ({ col, up: a.col === col ? !a.up : true }))}>{label}{asc.col === col && <ChevronDown className={`h-3 w-3 ${asc.up ? "rotate-180" : ""}`} />}</button>;
  const hdr = "catalog-panel-heading flex h-8 shrink-0 items-center pl-3 text-xs font-semibold";

  return (
    <Dialog layoutId="attribute-picker" height={720} title={t("addAttr")} icon={addAttrIcon.url} width={900} ghost={ghost} onClose={onClose} footer={<>
      <span className="mr-auto self-center text-xs text-muted-foreground">{sel.length ? t("selectedAttrs", { n: sel.length }) + " · " : ""}{t("dragAttrHint")}</span>
      <button className={DIALOG_BTN} disabled={!sel.length} onClick={() => add(sel)}>{t("add")}</button>
      <button className={DIALOG_BTN} onClick={onClose}>{t("quit")}</button>
    </>}>
      <div className="mb-3 flex items-center gap-3 border-b border-border pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 border-l-2 border-ribbon-dark pl-2">
          {catIcon && <img src={catIcon} alt="" className="h-4 w-4 object-contain" />}
          <span className="truncate text-sm font-semibold">{catLabel}</span>
          <span className="shrink-0 text-xs text-muted-foreground">· {list.length}</span>
        </div>
        <div className="flex h-8 w-full max-w-sm items-center overflow-hidden rounded-md border border-border focus-within:border-ribbon-dark">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("attrSearchPh")} aria-label={t("search")} className="h-full flex-1 bg-background px-2 text-xs outline-none"
            onKeyDown={(e) => { if (e.key === "Enter" && list.length) add(sel.length ? sel : [list[0]!.num]); }} />
          <span className="flex h-full w-8 items-center justify-center border-l border-border bg-panel"><Search className="h-4 w-4 text-muted-foreground" /></span>
        </div>
      </div>
      <div className="flex h-[60vh] min-h-0 flex-1 gap-3">
        <div className="flex w-60 shrink-0 flex-col gap-3">
          <div className="shrink-0 overflow-hidden rounded-md border border-border shadow-sm">
            <div className={hdr}>
              <span className="mr-auto">{t("favHeader")}</span>
              <button className="flex h-full w-8 items-center justify-center rounded-sm hover:bg-selection" title={t("favImport")} aria-label={t("favImport")} onClick={() => file.current?.click()}><img src={favOpenIcon.url} alt="" className="h-4 w-4" /></button>
              <button className="flex h-full w-8 items-center justify-center rounded-sm hover:bg-selection" title={t("favExport")} aria-label={t("favExport")} onClick={exportFavs}><img src={favSaveIcon.url} alt="" className="h-4 w-4" /></button>
              <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { importFavs(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            <div className="py-1">
              {FAV_KINDS.map((k) => link(`fav:${k}`, t(FAV_LABEL[k]), "", FAV_ICON[k]))}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border shadow-sm">
            <div className={hdr}>{t("attrGroupsHeader")}</div>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {link("all", t("allAttrs"), "font-semibold")}
              {link("user", t("userAttrs"), "italic")}
              {link("import", t("importAttrs"), "italic")}
              {sep}
              {ATTRIBUTE_GROUPS.map((g, i) => g && counts[`g:${i}`] ? link(`g:${i}`, g) : null)}
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1 overflow-auto rounded-md border border-border text-xs shadow-sm">
          <div className="catalog-panel-heading sticky top-0 z-10 grid grid-cols-[5rem_1fr_auto]">{head("num", t("number"))}{head("name", t("name"))}
            <div className="flex items-center border-b border-border px-1 font-semibold">
              <span className="w-[5.25rem] text-center">{t("favorites")}</span>
            </div>
          </div>
          {list.map((a, i) => <div key={a.num} data-draggable-row onClick={(e) => click(a.num, e)} onDoubleClick={() => add([a.num])} data-tip={attrTip(a, t)} draggable
            onDragStart={(e) => { const nums = sel.includes(a.num) ? sel : [a.num]; if (!sel.includes(a.num)) setSel([a.num]); dragNewAttrs.current = nums; e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", nums.join(",")); const element = e.currentTarget.closest("[data-dialog-box]"); if (!element) return; const box = element.getBoundingClientRect();
              const over = (ev: DragEvent) => setGhost(!(ev.clientX >= box.left && ev.clientX <= box.right && ev.clientY >= box.top && ev.clientY <= box.bottom));
              const finish = () => { setGhost(false); setTimeout(() => { dragNewAttrs.current = null; }, 0); dragCleanup.current?.(); };
              document.addEventListener("dragover", over); document.addEventListener("drop", finish); document.addEventListener("dragend", finish);
              dragCleanup.current = () => { document.removeEventListener("dragover", over); document.removeEventListener("drop", finish); document.removeEventListener("dragend", finish); }; }}
            onDragEnd={() => { dragCleanup.current?.(); dragNewAttrs.current = null; setGhost(false); }}
            className={`relative grid cursor-pointer select-none grid-cols-[5rem_1fr_auto] border-b border-border ${sel.includes(a.num) ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : ""}`}>
            <RowDragGrip className="absolute left-0 top-0.5" />
            <span className="attribute-number border-r py-1 pl-4 pr-2 font-mono">{a.num}</span>
            <span className="truncate px-2 py-1">{a.name}</span>
            <span className="flex items-center px-1">
              {FAV_KINDS.map((k) => {
                const on = favs[k].includes(a.num);
                const nums = sel.includes(a.num) && sel.length > 1 ? sel : [a.num];
                return <button key={k} className={`flex h-6 w-7 items-center justify-center rounded-sm hover:bg-background ${k === context ? "" : ""}`}
                  data-tip={`${t(on ? "favRemove" : "favAdd")}\n${t(FAV_LABEL[k])}`} aria-label={`${t(on ? "favRemove" : "favAdd")} ${t(FAV_LABEL[k])} ${a.num}`} aria-pressed={on}
                  onClick={(e) => { e.stopPropagation(); toggle(k, nums); }} onDoubleClick={(e) => e.stopPropagation()}>
                  <img src={FAV_ICON[k]} alt="" className={`h-4 w-4 object-contain transition ${on ? "" : "opacity-20 grayscale hover:opacity-60"}`} />
                </button>;
              })}
            </span>
          </div>)}
          {!list.length && <div className="p-4 text-center text-muted-foreground">—</div>}
        </div>
      </div>
    </Dialog>
  );
}
