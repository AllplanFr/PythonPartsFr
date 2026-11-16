import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Settings, Check, FolderOpen, ListTree, PanelsTopLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { useCatalog } from "@/lib/catalog-store";
import { useCatalogRegistry, ALLPLAN_VERSIONS, matchesCatalog, selectRegisteredCatalog, updateCurrentCatalog } from "@/lib/catalog-registry";
import { useT } from "@/lib/i18n";
import { askText } from "@/lib/app-dialog";
import { DEFAULT_ATTRS } from "@/lib/default-attributes";
import bookIcon from "@/assets/icons/catalog.svg.asset.json";
import { NodeIcon } from "./NodeIcon";

function QuickMenu({ label, value, children, className = "" }: { label: string; value: string; children: ReactNode; className?: string }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" title={`${label}\n${value}`} aria-label={label} className={`h-6 min-w-0 justify-start rounded-sm border-border bg-background px-2 text-xs font-normal hover:bg-selection ${className}`}><span className="truncate">{value}</span></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" className="max-w-[calc(100vw-16px)] rounded-sm text-xs">
      <DropdownMenuLabel className="catalog-panel-heading text-xs">{label}</DropdownMenuLabel>
      {children}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function Choice({ active, children, onSelect, disabled, title }: { active: boolean; children: ReactNode; onSelect: () => void; disabled?: boolean; title?: string }) {
  return <DropdownMenuItem disabled={disabled ?? false} title={title ?? ""} onSelect={onSelect} className={`rounded-sm text-xs ${active ? "bg-selection font-semibold" : ""}`}>
    <span className="flex w-4 shrink-0 justify-center">{active && <Check className="h-3.5 w-3.5 text-ribbon-dark" />}</span>{children}
  </DropdownMenuItem>;
}

export function CatalogStatusBar() {
  const t = useT();
  const c = useCatalog((s) => s.catalog);
  const nodes = useCatalog((s) => s.nodes);
  const selected = useCatalog((s) => s.selected);
  const [hierarchy, setHierarchy] = useState(false);
  const trailRef = useRef<HTMLElement>(null);
  const trail = useMemo(() => {
    const result = [];
    const visited = new Set<string>();
    let id = selected[0];
    while (id && !visited.has(id)) {
      visited.add(id);
      const node = nodes[id];
      if (!node) break;
      result.unshift(node);
      id = node.parentId ?? undefined;
    }
    return result;
  }, [nodes, selected]);
  useEffect(() => {
    if (hierarchy) trailRef.current?.querySelector('[aria-current="location"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [hierarchy, trail]);
  const cats = useCatalogRegistry((s) => s.cats);
  const [visible, setVisible] = useState({ catalog: true, version: true, source: true, defAttr: true });
  const fields = [["catalog", t("catPath")], ["version", t("allplanVersion")], ["source", t("dataFrom")], ["defAttr", t("defAttr")]] as const;
  const fullPath = !c.path && !c.name ? "" : /\.(xml|json)$/i.test(c.path) ? c.path : `${c.path}\\${c.name}.xml`;
  const defaultName = DEFAULT_ATTRS.find((a) => a.num === c.defAttr)?.name ?? "";
  const sources = [...new Set([c.source, ...cats.map((cat) => cat.source)].filter(Boolean))];
  const enterPath = async () => {
    const path = await askText(t("statusPath"), c.source);
    if (path?.trim()) updateCurrentCatalog({ source: path.trim() });
  };
  return <div className="flex h-8 shrink-0 items-center gap-1 overflow-hidden border-t border-border bg-ribbon/50 px-2 text-xs">
    <Button variant="outline" size="icon" aria-pressed={hierarchy} title={t(hierarchy ? "statusCatalogOptions" : "statusHierarchy")} aria-label={t(hierarchy ? "statusCatalogOptions" : "statusHierarchy")} onClick={() => setHierarchy((value) => !value)} className="h-6 w-7 shrink-0 rounded-sm bg-background text-ribbon-dark">{hierarchy ? <PanelsTopLeft className="h-4 w-4" /> : <ListTree className="h-4 w-4" />}</Button>
    {hierarchy ? <nav ref={trailRef} aria-label={t("statusNavigation")} onWheel={(event) => {
      const nav = event.currentTarget;
      if (nav.scrollWidth <= nav.clientWidth || event.deltaX !== 0) return;
      nav.scrollLeft += event.deltaY;
    }} className="catalog-status-trail flex h-6 min-w-0 max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" title={c.name} className="h-6 max-w-52 shrink-0 gap-1.5 rounded-sm bg-status-path px-1.5 text-xs font-normal text-status-path-foreground hover:bg-status-path hover:text-status-path-foreground"><img src={bookIcon.url} alt="" className="h-4 w-4" /><span className="truncate">{c.name}</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="rounded-sm text-xs"><DropdownMenuLabel className="catalog-panel-heading text-xs">{t("statusCatalog")}</DropdownMenuLabel>{cats.map((cat) => <Choice key={cat.id} active={matchesCatalog(cat, c)} disabled={cat.status !== "ok"} onSelect={() => selectRegisteredCatalog(cat.id)}><img src={bookIcon.url} alt="" className="h-4 w-4" />{cat.name}</Choice>)}</DropdownMenuContent>
      </DropdownMenu>
      {trail.map((node, index) => <Fragment key={node.id}><ChevronRight aria-hidden strokeWidth={3} className="h-3 w-3 shrink-0 text-ribbon-dark" /><Button variant="outline" data-breadcrumb-id={node.id} aria-current={index === trail.length - 1 ? "location" : undefined} title={`${node.name}\n${node.description}`} onClick={() => useCatalog.getState().reveal(node.id)} className={`h-6 max-w-60 shrink-0 gap-1.5 rounded-sm bg-status-path px-1.5 text-xs text-status-path-foreground hover:bg-status-path hover:text-status-path-foreground ${index === trail.length - 1 ? "font-semibold" : "font-normal"}`}><NodeIcon node={node} /><span className="truncate">{node.name}</span></Button></Fragment>)}
    </nav> : <div className="flex min-w-0 flex-1 items-center gap-1">
    {visible.catalog && <QuickMenu label={t("statusCatalog")} value={`${t("catalog")} : ${fullPath || t("notSet")}`} className="shrink">
      {!cats.some((cat) => matchesCatalog(cat, c)) && <Choice active onSelect={() => {}}><img src={bookIcon.url} alt="" className="h-4 w-4" /><span className="truncate">{c.name}</span></Choice>}
      {cats.map((cat) => <Choice key={cat.id} active={matchesCatalog(cat, c)} disabled={cat.status !== "ok"} title={`${cat.path}\n${cat.version}`} onSelect={() => selectRegisteredCatalog(cat.id)}>
        <img src={bookIcon.url} alt="" className="h-4 w-4" /><span className="truncate">{cat.name}</span><span className="ml-auto pl-4 text-muted-foreground">{cat.version || t("notSet")}</span>
      </Choice>)}
    </QuickMenu>}
    {visible.version && <QuickMenu label={t("statusVersion")} value={`${t("dataYear")} : ${c.version || t("notSet")}`} className="shrink">
      {ALLPLAN_VERSIONS.map((version) => <Choice key={version} active={c.version === version} onSelect={() => updateCurrentCatalog({ version })}>Allplan {version}</Choice>)}
    </QuickMenu>}
    {visible.source && <QuickMenu label={t("statusData")} value={`${t("source")} : ${c.source}`} className="shrink">
      {sources.map((source) => <Choice key={source} active={c.source === source} title={source} onSelect={() => updateCurrentCatalog({ source })}><FolderOpen className="h-4 w-4 text-ribbon-dark" /><span className="truncate">{source}</span></Choice>)}
      <DropdownMenuItem onSelect={() => void enterPath()} className="text-xs"><FolderOpen className="h-4 w-4 text-ribbon-dark" />{t("statusBrowse")}</DropdownMenuItem>
    </QuickMenu>}
    {visible.defAttr && <QuickMenu label={t("statusDefault")} value={`${t("defAttr")} : ${c.defAttr ? `${c.defAttr} — ${defaultName}` : t("none")}`} className="shrink">
      {DEFAULT_ATTRS.map((a) => <Choice key={a.num} active={c.defAttr === a.num} onSelect={() => updateCurrentCatalog({ defAttr: a.num })}>{a.num ? `${a.num} — ${a.name}` : t("none")}</Choice>)}
    </QuickMenu>}
    </div>}
    {!hierarchy && <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline" size="icon" title={t("statusOptions")} aria-label={t("statusOptions")} className="h-6 w-7 shrink-0 rounded-sm bg-background text-ribbon-dark"><Settings className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="rounded-sm">
        <DropdownMenuLabel className="catalog-panel-heading text-xs">{t("statusOptions")}</DropdownMenuLabel>
        {fields.map(([key, label]) => <DropdownMenuCheckboxItem key={key} checked={visible[key]} onSelect={(e) => e.preventDefault()} onCheckedChange={(checked) => setVisible((v) => ({ ...v, [key]: checked === true }))} className="text-xs">{label}</DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}