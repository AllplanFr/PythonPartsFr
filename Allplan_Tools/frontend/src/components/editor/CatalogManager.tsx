import { ChoiceCombo } from "./ChoiceCombo";
import { showMessage } from "@/lib/app-dialog";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshCw, Star, ChevronDown, ChevronRight, ChevronUp, CircleAlert, OctagonAlert, MoreHorizontal, Info, Filter } from "lucide-react";
import { useCatalog } from "@/lib/catalog-store";
import { useCatalogRegistry, selectRegisteredCatalog, ALLPLAN_VERSIONS as VERSIONS, type Cat, type Status } from "@/lib/catalog-registry";
import { useT } from "@/lib/i18n";
import { CustomToolbar } from "./CustomToolbar";
import { DIALOG_BTN } from "./FormulaTools";
import { DEFAULT_ATTRS } from "@/lib/default-attributes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { VobGroupingMenu } from "./VobViewMenus";
import addIcon from "@/assets/icons/add.svg.asset.json";
import convertIcon from "@/assets/icons/convert_bdd.svg.asset.json";
import openIcon from "@/assets/icons/open.svg.asset.json";
import delIcon from "@/assets/icons/delete-2.svg.asset.json";
import dupIcon from "@/assets/icons/copy-2.svg.asset.json";
import groupIcon from "@/assets/icons/hierarchy_show_item.svg.asset.json";
import ascIcon from "@/assets/icons/19-2.png.asset.json";
import descIcon from "@/assets/icons/91-2.png.asset.json";
import azIcon from "@/assets/icons/az.png.asset.json";
import zaIcon from "@/assets/icons/za.png.asset.json";
import importIcon from "@/assets/icons/favorite_open.svg.asset.json";
import exportIcon from "@/assets/icons/favorite_save.svg.asset.json";
import resetIcon from "@/assets/icons/reset.svg.asset.json";
import updateIcon from "@/assets/icons/update_cat.svg.asset.json";
import bookIcon from "@/assets/icons/catalog.svg.asset.json";
import folderIcon from "@/assets/icons/folder.png.asset.json";

const I = ({ src, s = 20 }: { src: string; s?: number }) => <img src={src} alt="" className="shrink-0 object-contain" style={{ width: s, height: s }} draggable={false} />;

type GroupKey = "none" | "name" | "path" | "version" | "source" | "defAttr";

/** Manager-only texts (EN + FR); other languages fall back to EN. */
export const TX = {
  en: {
    refresh: ["Refresh list", "Re-reads the catalogs registered on this computer."],
    newCat: ["New catalog", "Creates an empty catalog for the latest Allplan version."],
    convert: ["Convert a database", "Turns an existing Allplan database into a SmartCatalog."],
    addExisting: ["Add an existing catalog", "Adds a catalog file already on disk to this list."],
    remove: ["Remove from list", "Removes the selected catalog from the list. The file itself is kept."],
    duplicate: ["Duplicate", "Creates a copy of the selected catalog with the same settings."],
    groupBy: ["Group by", "Choose how catalogs are grouped in the list."],
    sortAZ: ["Sort A → Z", "Click to reverse the order."], sortZA: ["Sort Z → A", "Click to reverse the order."],
    sort19: ["Oldest version first", "Click to show the newest versions first."], sort91: ["Newest version first", "Click to show the oldest versions first."],
    importLayout: ["Import a layout", "Loads a saved list layout (grouping, sorting, favorites)."],
    exportLayout: ["Export this layout", "Saves the current grouping, sorting and favorites to a file to share or reuse."],
    restore: ["Restore a backup", "Brings back the last saved version of the selected catalog."],
    update: ["Update Allplan projects", "Copies this catalog into every Allplan project that has a catalog with the same name."],
    gNone: "None", gName: "Catalog name", gPath: "Catalog path", gVersion: "Allplan version", gSource: "Allplan data", gDefAttr: "Default attribute",
    noBackup: "No backup is available for this catalog.", restored: "Backup restored.", updated: "Catalogs with the same name will be updated in the Allplan projects.",
    tipName: ["Catalog name", "Name of your catalog."],
    tipPath: ["Catalog path", "Location of your catalog on disk."],
    tipStd: ["STD", "Your catalog will be saved in the STD (office standard)."],
    tipVersion: ["Allplan version", "The application will use the data of the chosen Allplan version."],
    tipSource: ["STD / Specific project", "The application will use the data of the STD or of the selected project."],
    tipDefAttr: ["Default attribute", "83 is the default. Determines in which Allplan attribute the title will be written."],
    favorite: "Favorite",
  },
  fr: {
    refresh: ["Rafraîchir la liste", "Relit les catalogues enregistrés sur cet ordinateur."],
    newCat: ["Nouveau catalogue", "Crée un catalogue vide pour la dernière version d'Allplan."],
    convert: ["Convertir une base de données", "Transforme une base de données Allplan existante en SmartCatalog."],
    addExisting: ["Ajouter un catalogue existant", "Ajoute à la liste un fichier catalogue déjà présent sur le disque."],
    remove: ["Supprimer de la liste", "Retire le catalogue sélectionné de la liste. Le fichier est conservé."],
    duplicate: ["Dupliquer", "Crée une copie du catalogue sélectionné avec les mêmes réglages."],
    groupBy: ["Grouper par", "Choisissez comment regrouper les catalogues dans la liste."],
    sortAZ: ["Classement A → Z", "Cliquez pour inverser l'ordre."], sortZA: ["Classement Z → A", "Cliquez pour inverser l'ordre."],
    sort19: ["Versions les plus anciennes d'abord", "Cliquez pour afficher les plus récentes d'abord."], sort91: ["Versions les plus récentes d'abord", "Cliquez pour afficher les plus anciennes d'abord."],
    importLayout: ["Importer une présentation", "Charge une présentation enregistrée (regroupement, classement, favoris)."],
    exportLayout: ["Exporter cette présentation", "Enregistre le regroupement, le classement et les favoris actuels dans un fichier à partager ou réutiliser."],
    restore: ["Restaurer une sauvegarde", "Récupère la dernière version sauvegardée du catalogue sélectionné."],
    update: ["Mettre à jour les projets Allplan", "Recopie ce catalogue dans tous les projets Allplan qui contiennent un catalogue du même nom."],
    gNone: "Aucun", gName: "Nom de catalogue", gPath: "Chemin du catalogue", gVersion: "Version Allplan", gSource: "Données Allplan", gDefAttr: "Attribut par défaut",
    noBackup: "Aucune sauvegarde n'existe pour ce catalogue.", restored: "Sauvegarde restaurée.", updated: "Les catalogues du même nom seront mis à jour dans les projets Allplan.",
    tipName: ["Nom du catalogue", "Nom de votre catalogue."],
    tipPath: ["Chemin du catalogue", "Emplacement de votre catalogue."],
    tipStd: ["STD", "Votre catalogue sera sauvegardé dans le STD (standard du bureau)."],
    tipVersion: ["Version Allplan", "L'application utilisera les données de la version d'Allplan choisie."],
    tipSource: ["STD / Projet spécifique", "L'application utilisera les données du STD ou du projet sélectionné."],
    tipDefAttr: ["Attribut par défaut", "83 est la valeur par défaut. Détermine dans quel attribut Allplan écrira le titre."],
    favorite: "Favori",
  },
};
type Tx = typeof TX.en;

export function Tip({ tip, children, side = "bottom" }: { tip: string[] | string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  const title = typeof tip === "string" ? tip : tip[0] ?? ""; const body = typeof tip === "string" ? "" : tip[1] ?? "";
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-72 rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-lg">
        <div className="flex gap-2 border-l-4 border-brand-bar px-3 py-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ribbon-dark" />
          <div><div className="text-xs font-semibold">{title}</div>{body && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{body}</div>}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Catalog & resource manager; replaces the tree and property panes while open. */
export function CatalogManager() {
  const t = useT();
  const { catalog, setCatalog, setView, lang } = useCatalog();
  const x: Tx = (TX as Record<string, Tx>)[lang] ?? TX.en;
  const { cats, setCats } = useCatalogRegistry();
  const [sel, setSel] = useState<string>(() => cats.find((c) => c.name === catalog.name && c.version === catalog.version)?.id ?? "c1");
  const [groupBy, setGroupBy] = useState<GroupKey>("version");
  const [filters, setFilters] = useState<string[]>([]);
  const [dir, setDir] = useState<1 | -1>(1);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [split, setSplit] = useState(48);
  const splitBox = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = Array.from(treeRef.current?.querySelectorAll<HTMLElement>("[data-manager-catalog-id]") ?? []).find((el) => el.dataset['managerCatalogId'] === sel);
    row?.scrollIntoView({ block: "nearest" });
  }, [sel, cats, closed, groupBy, dir]);
  const dragSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    const r = splitBox.current!.getBoundingClientRect();
    const mv = (ev: MouseEvent) => setSplit(Math.min(80, Math.max(20, 100 - ((ev.clientX - r.left) / r.width) * 100)));
    const up = () => { removeEventListener("mousemove", mv); removeEventListener("mouseup", up); document.body.style.cursor = ""; };
    document.body.style.cursor = "col-resize"; addEventListener("mousemove", mv); addEventListener("mouseup", up);
  };
  const cur = cats.find((c) => c.id === sel);
  const patch = (p: Partial<Cat>) => setCats((cs) => cs.map((c) => (c.id === sel ? { ...c, backup: c.backup ?? c, ...p, status: (p.version ?? c.version) && (p.path ?? c.path) ? "ok" : c.status } : c)));
  const leave = (fn: () => void) => { setLeaving(true); setTimeout(fn, 170); };

  const GROUPS: [GroupKey, string][] = [["none", x.gNone], ["name", x.gName], ["path", x.gPath], ["version", x.gVersion], ["source", x.gSource], ["defAttr", x.gDefAttr]];
  const byVersion = groupBy === "version";
  const groups = useMemo(() => {
    const list = cats.filter((c) => !filters.length || filters.includes(c.version)).sort((a, b) => dir * (byVersion ? (a.version || "9999").localeCompare(b.version || "9999") || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)));
    if (groupBy === "none") return [["", list]] as [string, Cat[]][];
    const m = new Map<string, Cat[]>();
    for (const c of list) { const k = String(c[groupBy] || "") || t("notSet"); m.set(k, [...(m.get(k) ?? []), c]); }
    return [...m.entries()].sort(([a], [b]) => (a === t("notSet") ? 1 : b === t("notSet") ? -1 : dir * a.localeCompare(b)));
  }, [cats, groupBy, dir, byVersion, t, filters]);

  const add = (copy: boolean) => {
    const base = copy && cur ? cur : { name: "New catalog", version: "", path: "", source: "", defAttr: 0, status: "incomplete" as Status };
    const id = `n${Date.now()}`;
    setCats((cs) => [...cs, { ...base, id, backup: undefined, name: copy ? `${base.name} (2)` : base.name }]); setSel(id);
    setClosed({});
  };
  const open = () => {
    if (!cur || cur.status !== "ok") return;
    leave(() => { selectRegisteredCatalog(cur.id); setView("editor"); });
  };
  const exportLayout = () => {
    const data = JSON.stringify({ groupBy, dir, favorites: cats.filter((c) => c.fav).map((c) => c.id), closed }, null, 2);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" })); a.download = "presentation.json"; a.click(); URL.revokeObjectURL(a.href);
  };
  const importLayout = async (f?: File) => {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.groupBy) setGroupBy(d.groupBy); if (d.dir) setDir(d.dir); if (d.closed) setClosed(d.closed);
      if (Array.isArray(d.favorites)) setCats((cs) => cs.map((c) => ({ ...c, fav: d.favorites.includes(c.id) })));
    } catch { showMessage("✗"); }
  };
  const restore = () => {
    if (!cur?.backup) return showMessage(x.noBackup);
    setCats((cs) => cs.map((c) => (c.id === sel ? { ...c.backup!, backup: undefined } : c))); showMessage(x.restored);
  };

  const B = ({ tip, onClick, on, children, disabled }: { tip: string[]; onClick?: () => void; on?: boolean; children: ReactNode; disabled?: boolean }) => (
    <Tip tip={tip}>
      <span className="inline-flex">
        <Button variant="ghost" size="icon" aria-label={tip[0] ?? ""} aria-pressed={on} onClick={onClick} disabled={disabled}
          className={`flex h-9 w-9 items-center justify-center rounded-md text-ribbon-dark hover:bg-selection disabled:opacity-40 [&>svg]:h-5 [&>svg]:w-5 ${on ? "bg-selection" : ""}`}>{children}</Button>
      </span>
    </Tip>
  );
  const status = (c: Cat) => c.status === "incomplete" ? <CircleAlert className="h-4 w-4 shrink-0 text-warning" /> : c.status === "missing" ? <OctagonAlert className="h-4 w-4 shrink-0 text-destructive" /> : <I src={bookIcon.url} s={16} />;
  const Lbl = ({ tip, children }: { tip: string[]; children: ReactNode }) => (
    <Tip tip={tip} side="left"><label className="mb-1 mt-4 flex w-fit cursor-help items-center gap-1 text-xs font-semibold first:mt-0">{children}<Info className="h-3 w-3 text-muted-foreground" /></label></Tip>
  );
  const inp = "h-8 min-w-0 flex-1 border border-border bg-background px-2 text-[13px] outline-none focus:border-ribbon-dark";
  const side = "flex h-8 items-center justify-center border border-l-0 border-border bg-panel px-2 text-xs font-semibold hover:bg-selection";
  const sortTip = byVersion ? (dir === 1 ? x.sort19 : x.sort91) : (dir === 1 ? x.sortAZ : x.sortZA);
  const sortSrc = byVersion ? (dir === 1 ? ascIcon.url : descIcon.url) : (dir === 1 ? azIcon.url : zaIcon.url);
  let row = 0;

  return (
    <TooltipProvider delayDuration={350}>
    <div className={`flex h-full min-h-0 flex-col ${leaving ? "mgr-out" : "mgr-in"}`}>
      <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => { importLayout(e.target.files?.[0]); e.target.value = ""; }} />
      <CustomToolbar id="manager" buttons={{
          refresh: (<B tip={x.refresh} onClick={() => setCats((cs) => [...cs])}><RefreshCw className="!text-success" /></B>),
          newCat: (<B tip={x.newCat} onClick={() => add(false)}><I src={addIcon.url} /></B>),
          convert: (<B tip={x.convert} onClick={() => showMessage(`${x.convert[0] ?? ""} — ${t("soon")}`)}><I src={convertIcon.url} /></B>),
          addExisting: (<B tip={x.addExisting} onClick={() => showMessage(`${x.addExisting[0] ?? ""} — ${t("soon")}`)}><I src={openIcon.url} /></B>),
          remove: (<B tip={x.remove} disabled={!cur} onClick={() => { setCats((cs) => cs.filter((c) => c.id !== sel)); setSel(""); }}><I src={delIcon.url} /></B>),
          duplicate: (<B tip={x.duplicate} disabled={!cur} onClick={() => add(true)}><I src={dupIcon.url} /></B>),
          sort: (<B tip={sortTip} onClick={() => setDir(dir === 1 ? -1 : 1)}><I src={sortSrc} /></B>),
          importLayout: (<B tip={x.importLayout} onClick={() => fileRef.current?.click()}><I src={importIcon.url} /></B>),
          exportLayout: (<B tip={x.exportLayout} onClick={exportLayout}><I src={exportIcon.url} /></B>),
          restore: (<B tip={x.restore} disabled={!cur} onClick={restore}><I src={resetIcon.url} /></B>),
          update: (<B tip={x.update} disabled={!cur} onClick={() => showMessage(x.updated)}><I src={updateIcon.url} /></B>),
          groupBy: <VobGroupingMenu columns={GROUPS} value={groupBy} onChange={setGroupBy} label={x.groupBy[0] ?? ""} />,
          filters: <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label={lang === "fr" ? "Afficher uniquement" : "Show only"} className={`h-8 gap-2 rounded-sm px-2 text-xs ${filters.length ? "bg-selection" : ""}`}><Filter className="h-4 w-4 text-ribbon-dark" />{lang === "fr" ? "Afficher uniquement" : "Show only"}{filters.length > 0 && <span className="text-[10px] text-muted-foreground">{filters.length}</span>}<ChevronDown className="h-3 w-3 text-muted-foreground" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-56 rounded-sm"><DropdownMenuLabel className="text-xs">{x.gVersion}</DropdownMenuLabel>{[...new Set(cats.map((c) => c.version))].sort().map((version) => <DropdownMenuCheckboxItem key={version} checked={filters.includes(version)} className="text-xs" onSelect={(e) => e.preventDefault()} onCheckedChange={(checked) => setFilters((old) => checked ? [...old, version] : old.filter((v) => v !== version))}>{version || t("notSet")}</DropdownMenuCheckboxItem>)}<DropdownMenuSeparator /><DropdownMenuItem disabled={!filters.length} className="text-xs" onSelect={() => setFilters([])}>{lang === "fr" ? "Effacer les filtres" : "Clear filters"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>,
        }} initial={[
          { id: "refresh", label: "refresh", color: "brand", buttons: ["refresh"] },
          { id: "add", label: "add", color: "brand", buttons: ["newCat", "convert", "addExisting"] },
          { id: "edit", label: "edit", color: "brand", buttons: ["remove", "duplicate"] },
          { id: "view", label: "view", color: "brand", buttons: ["groupBy", "filters", "sort"] },
          { id: "layout", label: "favorites", color: "brand", buttons: ["importLayout", "exportLayout"] },
          { id: "tools", label: "tools", color: "brand", buttons: ["restore", "update"] },
        ]} />

      <div ref={splitBox} className="flex min-h-0 flex-1 p-2">
        <div ref={treeRef} className="min-w-[200px] flex-1 overflow-auto border border-border bg-background">
          {groups.map(([g, list]) => {
            const gi = row++;
            return (
              <div key={g}>
                {g && (
                  <div onClick={() => setClosed({ ...closed, [g]: !closed[g] })} className={`flex h-[22px] cursor-default items-center gap-1 px-1 hover:bg-selection/50 ${gi % 2 ? "bg-row-alt" : ""}`}>
                    {closed[g] ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <I src={folderIcon.url} s={16} /><span className="truncate pl-1">{g}</span>
                    <span className="ml-1 text-[11px] text-muted-foreground">({list.length})</span>
                  </div>
                )}
                {!closed[g] && list.map((c) => {
                  const i = row++;
                  const isOpen = c.name === catalog.name && c.version === catalog.version;
                  return (
                    <div key={c.id} data-manager-catalog-id={c.id} onClick={() => setSel(c.id)} onDoubleClick={open}
                      className={`flex h-[22px] cursor-default items-center gap-1.5 ${g ? "pl-9" : "pl-2"} ${sel === c.id ? "bg-selection" : i % 2 ? "bg-row-alt" : ""} hover:bg-selection/60`}>
                      {status(c)}
                      <span className={`${c.status !== "ok" ? "italic" : ""} ${c.status === "missing" ? "text-destructive" : ""} ${isOpen ? "font-bold" : ""}`}>{c.name}</span>
                      {groupBy !== "version" && c.version && <span className="text-[11px] text-muted-foreground">{c.version}</span>}
                      <button title={x.favorite} onClick={(e) => { e.stopPropagation(); setCats((cs) => cs.map((k) => (k.id === c.id ? { ...k, fav: !k.fav } : k))); }}>
                        <Star className={`h-3 w-3 ${c.fav ? "fill-warning text-warning" : "text-transparent hover:text-muted-foreground"}`} />
                      </button>
                      {c.status !== "ok" && <span className="ml-auto pr-2 text-[11px] text-muted-foreground">{t(c.status === "missing" ? "missing" : "incomplete")}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div onMouseDown={dragSplit} title="↔" className="group flex w-3 shrink-0 cursor-col-resize items-center justify-center"><div className="h-10 w-1 rounded-full bg-border transition-colors group-hover:bg-ribbon-dark" /></div>
        <div style={{ width: `${100 - split}%` }} className="min-w-[300px] overflow-auto border border-border bg-background p-4">
          {cur ? (
            <>
              <Lbl tip={x.tipName}>{t("catName")}</Lbl>
              <div className="flex"><input className={inp} value={cur.name} onChange={(e) => patch({ name: e.target.value })} /></div>
              <Lbl tip={x.tipPath}>{t("catPath")}</Lbl>
              <div className="flex"><input className={inp} value={cur.path} onChange={(e) => patch({ path: e.target.value })} />
                <Tip tip={x.tipStd}><button className={side} disabled title="Python">STD</button></Tip>
                <button className={side}><MoreHorizontal className="h-4 w-4 text-ribbon-dark" /></button></div>
              <Lbl tip={x.tipVersion}>{t("allplanVersion")}</Lbl>
              <ChoiceCombo label={t("allplanVersion")} className="w-full" value={cur.version} onChange={(version) => patch({ version })} options={[{ value: "", label: "—" }, ...VERSIONS.map((v) => ({ value: v, label: v }))]} />
              <Lbl tip={x.tipSource}>{t("dataFrom")}</Lbl>
              <div className="flex"><input className={inp} value={cur.source} onChange={(e) => patch({ source: e.target.value })} />
                <Tip tip={x.tipSource}><button className={side} disabled title="Python">STD</button></Tip>
                <button className={side}><MoreHorizontal className="h-4 w-4 text-ribbon-dark" /></button></div>
              <button onClick={() => setMore(!more)} className="catalog-panel-heading mt-4 flex h-8 w-full items-center gap-2 border border-border px-2 text-xs font-semibold hover:bg-selection">
                {more ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{t("moreOptions")}
              </button>
              {more && (
                <div className="border border-t-0 border-border p-3">
                  <Lbl tip={x.tipDefAttr}>{t("defAttr")}</Lbl>
                  <ChoiceCombo label={t("defAttr")} className="w-full" value={String(cur.defAttr)} onChange={(value) => patch({ defAttr: Number(value) })} options={DEFAULT_ATTRS.map((a) => ({ value: String(a.num), label: a.num ? `${a.num} -- ${a.name}` : t("none") }))} />
                </div>
              )}
            </>
          ) : <div className="p-6 text-center text-muted-foreground">—</div>}
        </div>
      </div>

      <div className="secondary-dialog-footer flex justify-end gap-2 px-3 py-2.5">
        <Button variant="outline" disabled={!cur || cur.status !== "ok"} onClick={open} className={DIALOG_BTN}>{t("openBtn")}</Button>
        <Button variant="outline" className={DIALOG_BTN}>{t("saveBtn")}</Button>
        <Button variant="outline" onClick={() => leave(() => setView("editor"))} className={DIALOG_BTN}>{t("quit")}</Button>
      </div>
    </div>
    </TooltipProvider>
  );
}
