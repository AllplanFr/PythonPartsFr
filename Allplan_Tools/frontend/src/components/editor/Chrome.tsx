import { showMessage, askText } from "@/lib/app-dialog";
import { useAttrFavorites } from "@/lib/attr-favorites";
import { useTemplates } from "@/lib/templates";
import { useState, type ReactNode } from "react";
import {
  Languages, Moon, Redo2, Settings, TriangleAlert, Undo2, Sun, Boxes, ChevronDown, LibraryBig, RefreshCw, FileSpreadsheet, FolderCog, RotateCcw,
} from "lucide-react";
import { useCatalog, toJSON, toXML, ATTRIBUTE_CATALOG } from "@/lib/catalog-store";
import { useT, LANGS } from "@/lib/i18n";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SearchBox } from "./SearchBox";
import expandIcon from "@/assets/icons/expand_all.png.asset.json";
import { ExpandButton, CollapseButton } from "./ExpandMenus";
import { applyExpand, applyCollapse } from "@/lib/tree-expand";
import collapseIcon from "@/assets/icons/collapse_all.png.asset.json";
import cutIcon from "@/assets/icons/cut.svg.asset.json";
import tplIcon from "@/assets/icons/attribute_model_show.svg.asset.json";
import materialIcon from "@/assets/icons/material.png.asset.json";
import moveDownIcon from "@/assets/icons/move_down.svg.asset.json";
import moveUpIcon from "@/assets/icons/move_up.svg.asset.json";
import pasteIcon from "@/assets/icons/paste.svg.asset.json";
import duplicateIcon from "@/assets/icons/duplicate.svg";
import extBddIcon from "@/assets/icons/external_bdd_option.png.asset.json";
import formulaIcon from "@/assets/icons/formula_favorite.svg.asset.json";
import linkIcon from "@/assets/icons/link.png.asset.json";
import delIcon from "@/assets/icons/delete.svg.asset.json";
import attrIcon from "@/assets/icons/attribute_add-2.png.asset.json";
import compIcon from "@/assets/icons/component.png.asset.json";
import copyIIcon from "@/assets/icons/copy.svg.asset.json";
import folderIcon from "@/assets/icons/folder.png.asset.json";
import { Save, SaveAll, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomToolbar } from "./CustomToolbar";
import { DEFAULT_ATTRS } from "@/lib/default-attributes";
import { FolderAddButton } from "./FolderBatchDialog";
import { TemplateAddButton, TemplateDropdown } from "./TemplateMenus";
import { FormulaFavoritesMenu } from "./FormulaFavoriteMenus";
import { useExternalLibraries } from "@/lib/external-libraries";
import { useLinkDialog } from "./LinkDialog";
import { CatalogStatusBar } from "./CatalogStatusBar";
import { MainMenu } from "./MainMenu";
import { MenuFlag } from "./MenuFlag";
import openCatalogIcon from "@/assets/icons/open_catalog.svg.asset.json";
import saveIcon from "@/assets/icons/save.svg.asset.json";
import saveAsIcon from "@/assets/icons/save_as.svg.asset.json";

const Img = ({ src }: { src: string }) => <img src={src} alt="" className="h-5 w-5 object-contain" draggable={false} />;

function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export function saveJSON() {
  const s = useCatalog.getState();
  download(`${s.catalog.name || "catalog"}.json`, toJSON(s), "application/json");
  s.markSaved();
}

function QBtn({ title, onClick, children, disabled, className = "" }: { title: string; onClick?: () => void; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <Button variant="ghost" size="icon" title={title} onClick={onClick} disabled={disabled}
      className={`flex h-7 w-7 shrink-0 items-center justify-center gap-1 rounded-sm border border-transparent p-0 text-foreground hover:border-ribbon-dark/40 hover:bg-background/60 disabled:opacity-40 [&>img]:h-4 [&>img]:w-4 [&>img]:shrink-0 ${className}`}>
      {children}
    </Button>
  );
}

function exportExcel() {
  const s = useCatalog.getState();
  const nums = ATTRIBUTE_CATALOG.map((a) => a.num);
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["Type", "Path", "Title", "Description", ...ATTRIBUTE_CATALOG.map((a) => `${a.num} ${a.name}`)].map(q).join(";")];
  const walk = (ids: string[], path: string) => ids.forEach((id) => {
    const n = s.nodes[id]!;
    lines.push([n.type, path, n.name, n.description, ...nums.map((k) => n.attrs[k] ?? "")].map(q).join(";"));
    if (n.children) walk(n.children, path ? `${path} / ${n.name}` : n.name);
  });
  walk(s.rootIds, "");
  download(`${s.catalog.name}.csv`, "\uFEFF" + lines.join("\r\n"), "text/csv");
}

function HistoryMenu({ kind }: { kind: "undo" | "redo" }) {
  const t = useT();
  const { past, future, undo, redo } = useCatalog();
  const list = kind === "undo" ? [...past].reverse() : future;
  const [hover, setHover] = useState(-1);
  const Icon = kind === "undo" ? Undo2 : Redo2;
  const label = `${t(kind)} (${list.length})`;
  return (
    <div className={`flex h-7 shrink-0 items-center rounded-sm border border-transparent hover:border-ribbon-dark/40 ${list.length ? "" : "opacity-40"}`}>
      <button title={label} disabled={!list.length} onClick={() => (kind === "undo" ? undo() : redo())} className="flex h-7 w-7 items-center justify-center hover:bg-background/60">
        <Icon className="h-[18px] w-[18px] text-ribbon-dark" strokeWidth={2.75} />
      </button>
      <DropdownMenu onOpenChange={() => setHover(-1)}>
        <DropdownMenuTrigger asChild disabled={!list.length}>
          <button title={label} className="flex h-7 w-3.5 items-center justify-center hover:bg-background/60"><ChevronDown className="h-3 w-3 text-ribbon-dark" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 rounded-sm p-0 text-xs">
          <div className="max-h-72 overflow-auto py-1" onMouseLeave={() => setHover(-1)}>
            {list.map((h, i) => (
              <DropdownMenuItem key={i} onMouseEnter={() => setHover(i)} onSelect={() => (kind === "undo" ? undo(i + 1) : redo(i + 1))}
                className={`rounded-none px-3 py-1 text-xs ${i <= hover ? "bg-selection" : ""}`}>
                {t(h.label)}
              </DropdownMenuItem>
            ))}
          </div>
          <div className="border-t border-border bg-panel px-3 py-1 text-muted-foreground">
            {hover >= 0 ? t(kind === "undo" ? "undoN" : "redoN", { n: hover + 1 }) : list.length ? label : t("noHistory")}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function TitleBar() {
  const dirty = useCatalog((s) => s.dirty);
  const { lang, setLang, dark, setDark, stress, view, setView, catalog } = useCatalog();
  const t = useT();
  const saveAs = async () => {
    const name = await askText(t("saveAs"), `${catalog.name}.json`); if (!name) return;
    const s = useCatalog.getState();
    if (name.toLowerCase().endsWith(".xml")) download(name, toXML(s), "application/xml"); else download(name.endsWith(".json") ? name : `${name}.json`, toJSON(s), "application/json");
    s.markSaved();
  };
  const tools: [string, string | ReactNode, (() => void) | null][] = [
    [t("tRefresh"), "Λ", null], [t("tRules"), "Λ", () => window.open("/vob-editor", "_blank")], [t("tLibrary"), "Λ", null], [t("tReport"), "Λ", null],
    [t("tUpdate"), <RefreshCw className="h-3.5 w-3.5" />, null],
    [t("tExcel"), <FileSpreadsheet className="h-3.5 w-3.5 text-success" />, exportExcel],
    [t("tCustomize"), <FolderCog className="h-3.5 w-3.5" />, null], [t("tReset"), <RotateCcw className="h-3.5 w-3.5" />, null],
    [t("stress"), <Boxes className="h-3.5 w-3.5" />, stress],
  ];
  return (
    <>
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-titlebar pr-2">
      <MainMenu onSave={saveJSON} onSaveAs={saveAs} tools={tools} />
      <QBtn title={t("open")} onClick={() => setView(view === "manager" ? "editor" : "manager")} className={view === "manager" ? "!border-ribbon-dark/60 bg-background/70" : ""}>
        <LibraryBig className="h-[18px] w-[18px] text-ribbon-dark" strokeWidth={2.25} />
      </QBtn>
      {view !== "manager" && <>
      <QBtn title={t("save")} onClick={saveJSON}><Save className="h-[18px] w-[18px] text-ribbon-dark" strokeWidth={2.25} /></QBtn>
      <QBtn title={t("saveAs")} onClick={saveAs}>
        <SaveAll className="h-[18px] w-[18px] text-ribbon-dark" strokeWidth={2.25} />
      </QBtn>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" title={t("tools")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-transparent p-0 hover:border-ribbon-dark/40 hover:bg-background/60"><Wrench className="h-[18px] w-[18px] text-ribbon-dark" strokeWidth={2.25} /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 rounded-sm text-xs">
          {tools.map(([label, ic, fn], i) => (
            <div key={label}>
              {(i === 4 || i === 6 || i === 8) && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => fn ? fn() : showMessage(`${label} — ${t("soon")}`)} className="gap-2 rounded-none text-xs">
                <span className="flex h-4 w-4 items-center justify-center bg-icon-group text-[10px] font-bold text-background">{ic}</span>
                {label}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <HistoryMenu kind="undo" />
      <HistoryMenu kind="redo" />
      </>}
      <span data-app-title className="min-w-0 flex-1 truncate px-3 text-center text-xs font-semibold text-foreground">
        {t("appTitle")} - {view === "manager" ? t("mgrTitle") : catalog.name}
      </span>
      <div className="flex min-w-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" title={t("lang")} className="flex h-7 shrink-0 items-center gap-1 rounded-sm border border-transparent px-1.5 hover:border-ribbon-dark/40 hover:bg-background/60">
              <Languages className="h-4 w-4 text-ribbon-dark" strokeWidth={2.25} /><span className="text-[11px] uppercase">{lang}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-sm text-xs">
            {LANGS.map((l) => (
              <DropdownMenuItem key={l.code} onSelect={() => setLang(l.code)} className={`gap-3 rounded-none text-xs ${lang === l.code ? "bg-selection font-semibold" : ""}`}>
                <MenuFlag language={l.code} /><span className="w-5 uppercase text-muted-foreground">{l.code}</span>{l.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <QBtn title={t("dark")} onClick={() => setDark(!dark)}>{dark ? <Sun className="h-[18px] w-[18px] text-ribbon-dark" strokeWidth={2.25} /> : <Moon className="h-[18px] w-[18px] text-ribbon-dark" strokeWidth={2.25} />}</QBtn>
      </div>
    </div>
    </>
  );
}

function RBtn({ title, onClick, children, drop }: { title: string; onClick?: React.MouseEventHandler<HTMLButtonElement>; children: ReactNode; drop?: boolean }) {
  return (
    <Button variant="ghost" size="icon" title={title} onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-selection [&>svg]:h-5 [&>svg]:w-5 [&>span]:!h-[18px] [&>span]:!w-[18px]">
      {children}
    </Button>
  );
}

export function Ribbon() {
  const t = useT();
  const s = useCatalog();
  const buttons: Record<string, ReactNode> = {
    expandAll: (<ExpandButton icon={<Img src={expandIcon.url} />} hasSelection={!!s.selected.length} onMode={(m) => { const c = useCatalog.getState(); useCatalog.setState({ expanded: applyExpand(c.nodes, c.rootIds, c.expanded, m, c.selected) }); }} />),
    collapseAll: (<CollapseButton icon={<Img src={collapseIcon.url} />} hasSelection={!!s.selected.length} onMode={(m) => { const c = useCatalog.getState(); useCatalog.setState({ expanded: applyCollapse(c.nodes, c.expanded, m, c.selected) }); }} />),
    up: (<RBtn title={t("up")} onClick={(e) => s.moveSel(-1, e.ctrlKey)}><Img src={moveUpIcon.url} /></RBtn>),
    down: (<RBtn title={t("down")} onClick={(e) => s.moveSel(1, e.ctrlKey)}><Img src={moveDownIcon.url} /></RBtn>),
    folder: (<FolderAddButton icon={<Img src={folderIcon.url} />} />),
    group: (<TemplateAddButton type="group" onAdd={() => s.addNode("group")} icon={<Img src={materialIcon.url} />} />),
    component: (<TemplateAddButton type="component" onAdd={() => s.addNode("component")} icon={<Img src={compIcon.url} />} />),
    link: (<RBtn title={t("lnkBtnTip")} onClick={() => useLinkDialog.getState().show(null)}><Img src={linkIcon.url} /></RBtn>),
    attribute: (<TemplateAddButton type="attribute" onAdd={() => useAttrFavorites.getState().openPicker({ kind: "node" })} icon={<Img src={attrIcon.url} />} />),
    del: (<RBtn title={t("del")} onClick={s.remove}><Img src={delIcon.url} /></RBtn>),
    cut: (<RBtn title={t("cut")} onClick={() => s.copy(true)}><Img src={cutIcon.url} /></RBtn>),
    copy: (<RBtn title={t("copy")} onClick={() => s.copy(false)}><Img src={copyIIcon.url} /></RBtn>),
    paste: (<RBtn title={t("paste")} onClick={() => s.paste()}><Img src={pasteIcon.url} /></RBtn>),
    duplicate: (<RBtn title={t("duplicate")} onClick={() => s.duplicate()}><Img src={duplicateIcon} /></RBtn>),
    templates: <TemplateDropdown />,
    formulas: <FormulaFavoritesMenu />,
    search: <SearchBox />,
    extlib: (<RBtn title={t("extTitle")} onClick={() => useExternalLibraries.getState().setOpen(true)}><Img src={extBddIcon.url} /></RBtn>),
  };
  return <CustomToolbar id="editor" buttons={buttons} initial={[
    { id: "view", label: "view", color: "brand", buttons: ["expandAll", "collapseAll"] },
    { id: "move", label: "move", color: "brand", buttons: ["up", "down"] },
    { id: "add", label: "add", color: "brand", buttons: ["folder", "group", "component", "link", "attribute"] },
    { id: "edit", label: "edit", color: "brand", buttons: ["del", "cut", "copy", "paste", "duplicate"] },
    { id: "library", label: "templates", color: "brand", buttons: ["templates", "formulas", "extlib"] },
    { id: "search", label: "search", color: "brand", buttons: ["search"] },
  ]} />;
}

export function GroupIcon({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center bg-icon-group text-[10px] font-bold leading-none text-background ${className}`} style={{ width: 14, height: 14 }}>Λ</span>
  );
}

export function StatusBar() {
  return <CatalogStatusBar />;
}
