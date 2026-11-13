import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Eye, MoreHorizontal, Search, ImagePlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Portal as HoverPortal } from "@radix-ui/react-hover-card";
import { designRelativeFilePath, textureChoices, textureFiles as IMAGE_FILES, useTextureLibrary, type TextureEntry } from "@/lib/texture-library";
import { useCatalog } from "@/lib/catalog-store";
import { useT } from "@/lib/i18n";
import { fillLabelKey, fillRows, shortImagePath, toggleFillMode } from "@/lib/fill-attributes";
import surfaceReference from "@/lib/allplan-surface-reference.json";
import { showMessage } from "@/lib/app-dialog";
import { surfPreviewUrl } from "@/lib/surf-preview";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { NodeIcon } from "./NodeIcon";
import { LinePreview } from "./LayerAttributeField";
import hatchingIcon from "@/assets/icons/fill_hatching.svg.asset.json";
import patternIcon from "@/assets/icons/fill_pattern.svg.asset.json";
import styleIcon from "@/assets/icons/fill_style.svg.asset.json";
import surfaceIcon from "@/assets/icons/fill_surface.svg.asset.json";
import colorIcon from "@/assets/icons/layer_color.png.asset.json";

const STYLES = surfaceReference.styles;
type DirHandle = { name: string; resolve: (h: unknown) => Promise<string[] | null> };
type PickerWindow = Window & { showDirectoryPicker?: (o?: object) => Promise<DirHandle>; showOpenFilePicker?: (o?: object) => Promise<{ getFile: () => Promise<File> }[]> };
let designDir: DirHandle | null = null;
// Browsers hide full paths; a granted Design folder lets us resolve the chosen file relative to it.
async function pickFromDesign(surf: boolean): Promise<{ path: string; file: File } | "outside" | "again" | "root" | null> {
  const w = window as PickerWindow;
  if (!w.showDirectoryPicker || !w.showOpenFilePicker) return null;
  let fresh = false;
  if (!designDir) { designDir = await w.showDirectoryPicker({ id: "allplan-design", mode: "read" }); fresh = true; }
  if (designDir.name.toLocaleLowerCase() !== "design") { designDir = null; return "root"; }
  const types = [surf ? { description: "Allplan surface", accept: { "application/octet-stream": [".surf"] } } : { description: "Image", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"] } }];
  let handles;
  try { handles = await w.showOpenFilePicker({ startIn: designDir, types, excludeAcceptAllOption: true }); }
  catch (e) { if (fresh && (e as Error).name === "SecurityError") return "again"; throw e; }
  const h = handles[0]; if (!h) return null;
  const rel = await designDir.resolve(h);
  if (!rel) { designDir = null; return "outside"; }
  return { path: rel.join("\\"), file: await h.getFile() };
}
const END_BUTTON = "h-7 w-9 shrink-0 rounded-none border-l-0 border-border bg-panel p-0";
const FIELD = "h-7 w-full min-w-0 border border-border bg-background px-2 text-[13px] outline-none focus:border-ribbon-dark";

function StyleBrowser({ value, onPick, onClose }: { value: string; onPick: (value: string) => void; onClose: () => void }) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "center" }); }, []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(value);
  const [closed, setClosed] = useState<string[]>([]);
  const rows = STYLES.filter((s) => `${s.name} ${s.id} ${s.folder}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pick = (id = selected) => { onPick(id); onClose(); };
  const row = (s: typeof STYLES[number]) => <Button key={s.id} variant="ghost" role="option" aria-selected={selected === String(s.id)} onClick={() => setSelected(String(s.id))} onDoubleClick={() => pick(String(s.id))} title={`${s.name}\n=${t("number")}|${s.id}`} className={`grid h-8 w-full grid-cols-[1.25rem_minmax(0,1fr)_4rem] gap-2 rounded-none px-3 text-left text-xs font-normal ${selected === String(s.id) ? "catalog-selected-row bg-selection" : ""}`}><img src={styleIcon.url} alt="" className="h-4 w-4" /><span className="truncate">{s.id === 0 ? t("none") : s.name}</span><span className="text-right font-mono text-muted-foreground">{s.id}</span></Button>;
  return <Dialog layoutId="surface-style-picker" icon={styleIcon.url} title={t("fillChooseStyle")} width={760} height={640} onClose={onClose} footer={<><Button variant="outline" className={`mr-auto ${DIALOG_BTN}`} onClick={() => pick("0")}>{t("none")}</Button><Button variant="outline" className={DIALOG_BTN} onClick={() => pick()}>OK</Button><Button variant="outline" className={DIALOG_BTN} onClick={onClose}>{t("cancel")}</Button></>}>
    <div className="my-3 flex h-8 shrink-0 items-center border border-border bg-background"><input autoFocus aria-label={t("fillStyleSearch")} placeholder={t("fillStyleSearch")} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") pick(); }} className="min-w-0 flex-1 bg-background px-2 text-xs outline-none" /><Search className="mx-2 h-4 w-4 text-ribbon-dark" /></div>
    <div className="catalog-panel-heading grid h-8 shrink-0 grid-cols-[1fr_4rem] items-center gap-2 px-3 text-xs font-semibold"><span>{t("name")}</span><span className="text-right">{t("number")}</span></div>
    <div ref={listRef} role="listbox" aria-label={t("fillChooseStyle")} className="min-h-0 flex-1 overflow-auto border-x border-b border-border">
      {rows.filter((s) => !s.folder).map(row)}
      {[...new Set(rows.map((s) => s.folder).filter(Boolean))].map((folder) => <div key={folder}><Button variant="ghost" aria-expanded={!closed.includes(folder)} onClick={() => setClosed((old) => old.includes(folder) ? old.filter((f) => f !== folder) : [...old, folder])} className="h-8 w-full justify-start rounded-none bg-panel px-3 text-xs font-semibold"><ChevronDown className={`h-3 w-3 ${closed.includes(folder) ? "-rotate-90" : ""}`} /><NodeIcon type="folder" /><span className="truncate">{folder}</span></Button>{(!closed.includes(folder) || query) && <div className="pl-6">{rows.filter((s) => s.folder === folder).map(row)}</div>}</div>)}
    </div>
  </Dialog>;
}

function TextureThumbnail({ entry }: { entry: TextureEntry }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const file = IMAGE_FILES.get(entry.path); if (!file) return;
    let live = true, objectUrl = "";
    if (entry.surf) void surfPreviewUrl(file).then((u) => { if (live) setUrl(u); }).catch(() => {});
    else { objectUrl = URL.createObjectURL(file); setUrl(objectUrl); }
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [entry.path, entry.surf]);
  return url ? <img src={url} alt="" className="h-9 w-9 object-contain" /> : <img src={surfaceIcon.url} alt="" className="h-5 w-5 object-contain" />;
}

export function ImagePathField({ value, onCommit, readOnly, surf = false }: { value: string; onCommit: (v: string) => void; readOnly: boolean; surf?: boolean }) {
  const t = useT();
  const num = surf ? 335 : 336;
  const fileInput = useRef<HTMLInputElement>(null);
  const { entries, record } = useTextureLibrary();
  const [menu, setMenu] = useState(false);
  const [files, setFiles] = useState<{ path: string; file: File }[]>([]);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [url, setUrl] = useState("");
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const file = IMAGE_FILES.get(value);
    let next = "", live = true;
    setFailed(false);
    if (file && surf) { setUrl(""); void surfPreviewUrl(file).then((u) => { if (live) { setUrl(u); setFailed(!u); } }).catch(() => { if (live) setFailed(true); }); }
    else { next = file ? URL.createObjectURL(file) : ""; setUrl(next); }
    return () => { live = false; if (next) URL.revokeObjectURL(next); };
  }, [value, revision, surf]);
  const apply = (path: string, file?: File) => {
    if (file) IMAGE_FILES.set(path, file);
    record(path, surf); setRevision((n) => n + 1); onCommit(path); setMenu(false); setFiles([]);
  };
  const validFile = (file: File) => (surf ? /\.surf$/i.test(file.name) : /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) && file.size <= 20 * 1024 * 1024;
  const browse = () => { setMenu(false); fileInput.current?.click(); };
  const commit = (raw: string, el: HTMLInputElement) => {
    const next = raw.trim();
    if (surf && next && !/\.surf$/i.test(next)) { el.value = value; showMessage(t(surf ? "surfInvalidPath" : "fillInvalidPath")); return; }
    el.value = next; if (next !== value) onCommit(next);
  };
  const gallery = (frequent: boolean) => {
    const items = textureChoices(entries, surf, frequent);
    const label = t(frequent ? "textureFrequent" : "textureRecent");
    return <section aria-label={label} className="space-y-2"><h3 className="text-xs font-semibold">{label}</h3>{items.length ? <div className="grid grid-cols-5 gap-2">{items.map((e) => <Button key={e.path} variant="outline" size="icon" aria-label={`${label} — ${e.path}`} aria-pressed={value === e.path} title={`${e.path}\n${t("iconUses", { n: e.uses })}`} onClick={() => apply(e.path)} className={`relative h-12 w-full rounded-sm ${value === e.path ? "border-ribbon-dark bg-selection" : ""}`}><TextureThumbnail entry={e} />{value === e.path && <Check className="absolute bottom-0 right-0 h-3 w-3 text-ribbon-dark" />}</Button>)}</div> : <div className="py-2 text-xs text-muted-foreground">{t("textureEmpty")}</div>}</section>;
  };
  const previewBody = url && !failed ? <img src={url} alt={value} onError={() => setFailed(true)} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">{t(surf && IMAGE_FILES.has(value) ? "surfPreviewUnreadable" : "fillPreviewMissing")}</div>;
  return <><div className="relative flex min-w-0 items-center">
    <input key={value} aria-label={`${num} · ${t(surf ? "surfPath" : "fillPath")}`} title={`${num} · ${t("textureDesignHint")}`} defaultValue={value} readOnly={readOnly} maxLength={1024} onBlur={(e) => { if (!readOnly) commit(e.currentTarget.value, e.currentTarget); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = value; e.currentTarget.blur(); } }} className={FIELD} />
    <Popover open={menu} onOpenChange={setMenu}><PopoverTrigger asChild><Button variant="outline" disabled={readOnly} aria-label={t(surf ? "surfBrowse" : "fillBrowse")} className={END_BUTTON}><MoreHorizontal className="h-4 w-4 text-ribbon-dark" /></Button></PopoverTrigger><PopoverContent align="end" className="w-80 max-w-[calc(100vw-24px)] space-y-4"><Button variant="outline" className="h-7 w-full justify-start rounded-sm text-xs" onClick={() => void browse()}><ImagePlus className="h-4 w-4" />{t("textureBrowse")}</Button><div className="border-t border-border" />{gallery(false)}{gallery(true)}</PopoverContent></Popover>
    <HoverCard open={hover && !!value && !preview && !menu} onOpenChange={setHover} openDelay={200} closeDelay={100}><HoverCardTrigger asChild><Button variant="outline" aria-label={t("fillPreview")} disabled={!value} className={END_BUTTON} onClick={() => { setHover(false); setPreview(true); }}><Eye className="h-4 w-4 text-ribbon-dark" /></Button></HoverCardTrigger><HoverPortal><HoverCardContent role="tooltip" align="end" className="w-56 p-2"><div className="h-48">{previewBody}</div><div className="truncate pt-1 text-[11px] text-muted-foreground">{value}</div></HoverCardContent></HoverPortal></HoverCard>
    <input ref={fileInput} type="file" accept={surf ? ".surf" : "image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp"} aria-label={t(surf ? "surfBrowse" : "fillBrowse")} className="hidden" onChange={(e) => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (!file) return;
      if (!validFile(file)) { showMessage(t(surf ? "surfInvalidPath" : "fillInvalidPath")); return; }
      const full = (file as File & { path?: string }).path || file.webkitRelativePath || file.name;
      apply(full, file);
    }} />
  </div>{files.length > 0 && <Dialog layoutId="design-texture-picker" icon={surfaceIcon.url} title={t("textureChoose")} width={760} height={600} onClose={() => setFiles([])} footer={<Button variant="outline" className={DIALOG_BTN} onClick={() => setFiles([])}>{t("cancel")}</Button>}><input autoFocus aria-label={t("textureSearch")} placeholder={t("textureSearch")} value={query} onChange={(e) => setQuery(e.target.value)} className={`${FIELD} my-3 shrink-0`} /><div className="catalog-panel-heading px-3 py-2 text-xs font-semibold">{t(surf ? "surfPath" : "fillPath")}</div><div className="min-h-0 flex-1 overflow-auto border border-border">{files.filter((f) => f.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((f) => <Button key={f.path} variant="ghost" onClick={() => apply(f.path, f.file)} className="h-9 w-full justify-start rounded-none px-3 text-xs font-normal"><img src={surfaceIcon.url} alt="" className="h-4 w-4" /><span className="truncate">{f.path}</span></Button>)}</div></Dialog>}{preview && <Dialog layoutId="fill-image-preview" icon={surfaceIcon.url} title={t("fillPreview")} width={480} height={360} onClose={() => setPreview(false)} footer={<Button variant="outline" className={DIALOG_BTN} onClick={() => setPreview(false)}>{t("close")}</Button>}><div className="my-3 min-h-0 flex-1 border border-border bg-background p-2">{previewBody}</div><div className="truncate pb-2 text-xs text-muted-foreground">{value}</div></Dialog>}</>;
}

export function FillAttributeField({ num, value, onCommit, nodeId, attrs: supplied, readOnly = false }: { num: number; value: string; onCommit: (value: string) => void; nodeId?: string | undefined; attrs?: Record<number, string> | undefined; readOnly?: boolean }) {
  const t = useT();
  const nodeAttrs = useCatalog((s) => nodeId ? s.nodes[nodeId]?.attrs : undefined);
  const attrs = supplied ?? nodeAttrs ?? { 118: "1" };
  const type = attrs[118] || "1";
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [browser, setBrowser] = useState(false);
  const modes = [
    { value: "1", label: t("fillHatching"), icon: hatchingIcon.url },
    { value: "2", label: t("fillPattern"), icon: patternIcon.url },
    { value: "3", label: t("fillColor"), icon: colorIcon.url },
    { value: "5", label: t("fillStyle"), icon: styleIcon.url },
    { value: "6", label: t("fillImage"), icon: surfaceIcon.url },
  ];
  if (num === 118) return <div role="group" aria-label={t("fillType")} title={t("fillBundle")} className="attr-checkbox-row border border-border bg-background px-1">{modes.map((m) => {
    const checked = value === m.value || value === "4" && ["1", "3"].includes(m.value) || value === "2+3" && ["2", "3"].includes(m.value);
    return <Button key={m.value} variant="ghost" role="checkbox" aria-label={m.label} aria-checked={checked} disabled={readOnly} title={`118 · ${m.label}`} onClick={() => onCommit(toggleFillMode(value, m.value))} className="fill-mode attr-checkbox-item h-6 gap-2 rounded-none disabled:opacity-100"><span aria-hidden className="app-checkbox-mark" data-state={checked ? "checked" : "unchecked"} /><img src={m.icon} alt="" draggable={false} className="h-4 w-4 shrink-0 object-contain" /></Button>;
  })}</div>;
  if (num === 336) return <ImagePathField value={value} onCommit={onCommit} readOnly={readOnly} />;
  const color = num === 252 || type === "3";
  const style = num === 111 && type === "5";
  const label = num === 252 ? t("fillColor") : t(fillLabelKey(type));
  const options = style ? STYLES.map((s) => ({ value: String(s.id), label: s.id === 0 ? t("none") : s.name })) : Array.from({ length: 256 }, (_, i) => ({ value: String(i), label: color ? String(i) : String(i).padStart(3, "0") }));
  const current = options.find((o) => o.value === value)?.label ?? value;
  const matches = options.filter((o) => `${o.label} ${o.value}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pick = (next: string) => { onCommit(next); setOpen(false); setQuery(""); };
  return <><div className="relative flex min-w-0 items-center" title={`${num} · ${label}\n${style || color ? t("fillBundle") : t("fillIndexHint")}`}>
    <div className="relative min-w-0 flex-1">{color && !open && <span className="pointer-events-none absolute inset-y-1.5 left-2 right-14"><LinePreview num={347} id={Number(value)} /></span>}<input role="combobox" aria-label={`${num} · ${label}`} aria-expanded={open} aria-controls={id} aria-autocomplete="list" readOnly={readOnly} value={open ? query : current} onFocus={() => { if (!readOnly) { setOpen(true); setQuery(""); setActive(0); } }} onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }} onBlur={() => { setOpen(false); setQuery(""); }} onKeyDown={(e) => { if (readOnly) return; if (e.key === "Escape") { setOpen(false); setQuery(""); } if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setActive((a) => Math.max(0, Math.min(matches.length - 1, a + (e.key === "ArrowDown" ? 1 : -1)))); } const match = matches[active]; if (e.key === "Enter" && open && match) { e.preventDefault(); pick(match.value); } }} className={`${FIELD} pr-14 ${color && !open ? "text-transparent" : ""}`} /><span className="attribute-index absolute right-2 top-1.5">[{value}]</span></div>
    <Button variant="outline" aria-label={label} disabled={readOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(!open); setQuery(""); setActive(0); }} className={END_BUTTON}><ChevronDown className="h-3.5 w-3.5 text-ribbon-dark" /></Button>
    {style && <Button variant="outline" aria-label={t("fillChooseStyle")} title={t("fillChooseStyle")} disabled={readOnly} className={END_BUTTON} onClick={() => { setOpen(false); setBrowser(true); }}><img src={styleIcon.url} alt="" className="h-4 w-4" /></Button>}
    {open && <div id={id} role="listbox" aria-label={label} className="absolute left-0 right-0 top-7 z-30 max-h-56 overflow-auto border border-border bg-popover shadow-lg">{matches.map((o, index) => <Button key={o.value} variant="ghost" role="option" aria-selected={value === o.value} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)} className={`relative flex h-8 w-full justify-between rounded-none px-2 text-xs font-normal ${index === active ? "bg-selection" : ""}`}>{color ? <><LinePreview num={347} id={Number(o.value)} /><span className="absolute right-2 bg-popover/90 px-1">{o.label}</span></> : <><span className="truncate">{o.label}</span>{style && <span className="text-muted-foreground">[{o.value}]</span>}</>}</Button>)}</div>}
  </div>{browser && <StyleBrowser value={value} onPick={onCommit} onClose={() => setBrowser(false)} />}</>;
}

export function FillAttributeRows({ attrs, onCommit, renderRow }: { attrs: Record<number, string>; onCommit: (num: number, value: string) => void; renderRow: (num: number, label: string, control: ReactNode) => ReactNode }) {
  const t = useT();
  const type = attrs[118] || "1";
  return <div role="group" aria-label={t("fillType")}>{(type === "0" ? [118] : fillRows(type)).map((num) => <div key={num}>{renderRow(num, num === 118 ? t("fillType") : num === 336 ? t("fillPath") : num === 252 ? t("fillColor") : t(fillLabelKey(type)), <FillAttributeField num={num} value={attrs[num] ?? (num === 336 ? "" : "0")} attrs={attrs} onCommit={(value) => onCommit(num, value)} />)}</div>)}</div>;
}