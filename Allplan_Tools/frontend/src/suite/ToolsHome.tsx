import { productVersion } from "@/shared/product-version";
import { useEffect, useRef, useState } from "react";

/** Keeps both panes usable: list >= 300px, details >= 320px when the width is known. */
export function clampSplit(percent: number, width: number) {
  const min = width > 0 ? Math.max(20, (300 / width) * 100) : 20;
  const max = width > 0 ? Math.min(75, 100 - (324 / width) * 100) : 75;
  return Math.min(Math.max(percent, min), Math.max(min, max));
}
import { Link } from "@tanstack/react-router";
import { Check, Info, Languages, Moon, Power, Sun, ArrowRight, RefreshCw, ExternalLink, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MenuFlag } from "@/components/editor/MenuFlag";
import ascIcon from "./assets/asc.svg";
import vobIcon from "@/assets/app-icons/vob-editor-border.jpg";
import informationIcon from "@/assets/app-icons/information-manager-border.jpg";
import tradeIcon from "@/assets/app-icons/trade-editor-border.jpg";
import layerIcon from "@/assets/app-icons/layer-editor-border.jpg";
import attributeIcon from "@/assets/app-icons/attribute-editor-border.jpg";
import attributeSetIcon from "@/assets/app-icons/attribute-set-editor-border.jpg";
import { SUITE_MODULES, SUITE_NAME, UPCOMING_MODULES } from "./catalog";
import { useHomeHost } from "./use-home-host";
import { HomePluginIcon, resolveHomeIcon } from "./HomePluginIcon";
import { HOME_LANGUAGES, HOME_TEXT, HOME_CLOSE_TEXT, HOME_PLUGIN_TEXT, HOME_CATALOG_TEXT, HOME_MASTER_TEXT, type CatalogText, type HomeLanguage } from "./home-text";
import { pluginSheet } from "./plugin-presentation";
import { DIALOG_BTN } from "@/components/editor/FormulaTools";
import { useHomeCatalog } from "./use-home-catalog";
import { isUpToDate } from "./contracts/plugin-catalog-validate";
import type { CatalogEntry } from "./contracts/PLUGIN_CATALOG_CONTRACT";
import { isCloseHomeReply, isPluginInventoryInfo, type HomeWindow } from "./contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

const upcomingIcons = [tradeIcon, layerIcon, attributeIcon, attributeSetIcon];

/** Catalog lines never replace the installed name/version; remote construction is tied to latestKnownVersion. */
function CatalogLines({ entry, data, ct }: { entry: CatalogEntry; data: { status: string; source: string; superseded: boolean; verifiedAt: string | null }; ct: CatalogText }) {
  if (!entry.inCatalog) return null;
  const current = data.status === "available" && data.source === "remote" && !data.superseded;
  return <>
    {entry.latestKnownVersion !== null && <span className="block text-xs text-muted-foreground">{ct.latestKnown} : {entry.latestKnownVersion}{entry.catalogLifecycle === "construction" ? ` (${ct.construction})` : ""}</span>}
    {entry.proposedVersion !== null && entry.proposedVersion !== entry.latestKnownVersion && <span className="block text-xs text-muted-foreground">{ct.proposed} : {entry.proposedVersion}</span>}
    {isUpToDate(data, entry) && <span className="block text-xs text-ribbon-dark">{ct.upToDate}</span>}
    {!current && <span className="block text-xs text-muted-foreground">{ct.unverified}{data.verifiedAt ? ` (${ct.verifiedOn} ${data.verifiedAt})` : ""}</span>}
  </>;
}

/** UI only. No module state, settings bridge or business imports; binding detection only reads globals. */
export function ToolsHome({ requireNative = false }: { requireNative?: boolean }) {
  const [lang, setLang] = useState<HomeLanguage>("fr");
  const [dark, setDark] = useState(false);
  const [dialog, setDialog] = useState<"about" | "quit" | "close" | null>(null);
  const [closeMessage, setCloseMessage] = useState("");
  const [closeError, setCloseError] = useState(false);
  const closing = useRef(false);
  const [closePending, setClosePending] = useState(false);
  const t = HOME_TEXT[lang];
  const mt = HOME_MASTER_TEXT[lang];
  const [split, setSplit] = useState(42);
  const splitRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pt = HOME_PLUGIN_TEXT[lang];
  const versionLabel = (version: string | null) => { const v = productVersion(version); return v === null ? pt.unknownVersion : `${pt.version} ${v}`; };
  const host = useHomeHost(requireNative);
  const suiteVersion = host.mode === "native" ? productVersion(host.info?.version) : null;
  const inventory = isPluginInventoryInfo(host.info) ? host.info.plugins : null;
  const ct = HOME_CATALOG_TEXT[lang];
  const catalog = useHomeCatalog(host.mode === "native" && inventory !== null);
  const installedIds = new Set(inventory?.map((p) => p.id) ?? []);
  const notInstalled = catalog.notInstalled.filter((e) => !installedIds.has(e.id));
  type Row = { appId: string; name: string; description?: string; installedVersion?: string | null; route?: typeof SUITE_MODULES[number]["route"]; icon?: string; construction?: boolean; installed?: boolean };
  const localRows: Row[] = inventory
    ? inventory.map((p) => ({ appId: p.id, name: p.name, description: p.description, installedVersion: p.installedVersion, construction: p.lifecycle === "construction", installed: true }))
    : SUITE_MODULES.map((m, i) => ({ ...m, description: t.descriptions[i] ?? "", installed: host.mode === "native" }));
  const groups = [
    { hue: 250, label: mt.installed, rows: localRows.filter((r) => r.installed && !r.construction) },
    { hue: 150, label: mt.available, rows: [...localRows.filter((r) => !r.installed), ...notInstalled.filter((e) => e.catalogLifecycle !== "construction").map((e) => ({ appId: e.id, name: e.name }))] as Row[] },
    { hue: 330, label: mt.upcoming, rows: [...localRows.filter((r) => r.construction), ...notInstalled.filter((e) => e.catalogLifecycle === "construction").map((e) => ({ appId: e.id, name: e.name, construction: true })), ...UPCOMING_MODULES.filter((name) => !localRows.some((r) => r.name === name) && !notInstalled.some((e) => e.name === name)).map((name) => ({ appId: `upcoming_${name}`, name, construction: true, icon: upcomingIcons[UPCOMING_MODULES.indexOf(name)] }))] as Row[] },
  ];
  for (const g of groups) g.rows.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
  const allRows = groups.flatMap((g) => g.rows);
  const selected = allRows.find((r) => r.appId === selectedId) ?? allRows[0];
  const icon = (row: Row) => <HomePluginIcon source={host.mode === "native" ? resolveHomeIcon(row.appId, host.info?.plugins.find((p) => p.id === row.appId)?.iconUrl, window.location.origin) : null} fallback={row.icon ?? (row.appId === "vob_editor" ? vobIcon : row.appId === "information_manager" ? informationIcon : ascIcon)} />;
  useEffect(() => {
    const previousDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    return () => { document.documentElement.classList.toggle("dark", previousDark); };
  }, [dark]);
  const closeWindow = async () => {
    if (closing.current) return;
    const api = (window as HomeWindow).pywebview?.api;
    setCloseError(false);
    if (typeof api?.close_home !== "function") {
      setCloseMessage(t.closeHint);
      setDialog("close");
      window.close();
      return;
    }
    closing.current = true;
    setClosePending(true);
    const text = HOME_CLOSE_TEXT[lang];
    try {
      const reply: unknown = await api.close_home();
      if (!isCloseHomeReply(reply)) {
        setCloseError(true);
        setCloseMessage(text.failed);
      } else if (!reply.ok) {
        setCloseError(true);
        setCloseMessage(`${text.failed}\n${reply.error}`);
      } else {
        setCloseMessage(text.requested);
      }
    } catch (error: unknown) {
      setCloseError(true);
      setCloseMessage(`${text.failed}\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      closing.current = false;
      setClosePending(false);
      setDialog("close");
    }
  };
  const iconButton = "h-7 w-7 shrink-0 rounded-sm p-0 text-ribbon-dark hover:bg-background/60";
  return <div className="home-app flex h-dvh flex-col bg-background text-[13px] text-foreground">
    <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-titlebar pr-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" aria-label={SUITE_NAME} className="smartcatalog-tab h-full shrink-0 gap-2 rounded-none pl-5 pr-6 text-xs font-semibold text-primary-foreground hover:bg-app-tab">
          <span aria-hidden className="flex size-[19px] items-center justify-center border-2 border-current text-base leading-none">Λ</span>{SUITE_NAME}
        </Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={0} className="w-56 rounded-sm text-xs">
          <DropdownMenuItem className="gap-2 rounded-none text-xs" onSelect={() => setDialog("about")}><Info className="text-ribbon-dark" />{t.about}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 rounded-none text-xs" onSelect={() => setDialog("quit")}><Power className="text-destructive" />{t.quit}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" aria-label={t.language} title={t.language} className="h-7 gap-1 rounded-sm px-1.5 text-xs hover:bg-background/60"><Languages className="size-4 text-ribbon-dark" /><span className="text-[11px] uppercase">{lang}</span></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-sm text-xs">
            {HOME_LANGUAGES.map((l) => <DropdownMenuItem key={l.code} onSelect={() => setLang(l.code)} className={`gap-3 rounded-none text-xs ${lang === l.code ? "bg-selection font-semibold" : ""}`}><MenuFlag language={l.code} /><span className="w-5 uppercase text-muted-foreground">{l.code}</span>{l.label}{lang === l.code && <Check className="ml-auto size-3 text-ribbon-dark" />}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" aria-label={t.theme} title={t.theme} aria-pressed={dark} onClick={() => setDark((value) => !value)} className={iconButton}>{dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}</Button>
      </div>
    </header>
    <main className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-3">
      <div ref={splitRef} className="home-panes grid min-h-0 flex-1" style={{ gridTemplateColumns: `minmax(300px, ${split}fr) 12px minmax(320px, ${100 - split}fr)` }}>
      <section className="min-h-0 min-w-0 overflow-auto border border-border bg-background" aria-label={SUITE_NAME}>
        <div role="tree" aria-label={SUITE_NAME} className="flex min-h-full flex-col">
          {groups.map((group, groupIndex) => {
            if (groupIndex < 2 && group.rows.length === 0) return null;
            const eligible = group.rows.some((r) => r.installed && catalog.entryFor(r.appId)?.canUpdate);
            return <div key={group.label} role="treeitem" aria-label={group.label} aria-expanded className={`home-group ${groupIndex === 2 && groups.slice(0, 2).some((g) => g.rows.length > 0) ? "mt-11" : ""}`} style={{ ["--home-group-hue" as string]: group.hue }}>
            <div className="home-group-heading grid h-8 grid-cols-[32px_minmax(0,1fr)_32px_32px] items-center gap-1 px-2">
              <span />
              <span className="min-w-0 truncate text-center font-semibold">{group.label}</span>
              {eligible ? <Button variant="ghost" size="icon" disabled aria-label={`${mt.updateAll} — ${group.label}`} title={mt.batchUnavailable} className="size-7 rounded-sm"><RefreshCw className="size-4" /></Button> : <span />}
              <span />
            </div>
            <div role="group" aria-label={group.label}>{group.rows.map((row, index) => {
              const plugin = host.info?.plugins.find((p) => p.id === row.appId);
              const entry = row.installed ? catalog.entryFor(row.appId) : undefined;
              const launchable = !row.construction && (host.mode === "browser" ? Boolean(row.route) : host.mode === "native" && Boolean(plugin?.available) && !host.launching);
              return <div key={row.appId} role="treeitem" aria-label={row.name} aria-selected={selected?.appId === row.appId} tabIndex={0}
                onClick={() => setSelectedId(row.appId)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelectedId(row.appId); } }}
                className={`home-group-row grid min-h-11 cursor-default grid-cols-[minmax(0,1fr)_32px_32px] items-center gap-1 border-b border-border/60 px-2 text-[13px] ${selected?.appId === row.appId ? "catalog-selected-row bg-selection" : index % 2 ? "bg-row-alt hover:bg-selection" : "bg-background hover:bg-selection"}`}>
                <span className="flex min-w-0 items-center gap-2 pl-4"><span aria-hidden className="flex size-8 shrink-0 items-center justify-center">{icon(row)}</span><span className="min-w-0 break-words">{row.name}</span></span>
                {entry?.canUpdate ? <Button variant="ghost" size="icon" aria-label={`${ct.update} ${row.name}`} title={ct.update} disabled={catalog.updating !== null} onClick={(e) => { e.stopPropagation(); void catalog.update(row.appId); }} className="size-7 rounded-sm"><RefreshCw className="size-4" /></Button> : <span />}
                {host.mode === "browser" && row.route && launchable ? <Button variant="ghost" size="icon" asChild className="size-7 rounded-sm"><Link to={row.route} preload={false} aria-label={`${mt.launch} ${row.name}`} onClick={(e) => e.stopPropagation()}><ArrowRight className="size-4" /></Link></Button>
                  : <Button variant="ghost" size="icon" disabled={!launchable} title={plugin?.reason ?? undefined} aria-label={`${mt.launch} ${row.name}`} onClick={(e) => { e.stopPropagation(); void host.launch(row.appId); }} className="size-7 rounded-sm"><ArrowRight className="size-4" /></Button>}
              </div>;
            })}</div>
          </div>; })}
        </div>
      </section>
      <div role="separator" aria-orientation="vertical" aria-label={mt.details} aria-valuenow={Math.round(split)} aria-valuemin={20} aria-valuemax={75} tabIndex={0}
        onMouseDown={(e) => { e.preventDefault(); const el = splitRef.current; if (!el) return; const move = (ev: MouseEvent) => { const r = el.getBoundingClientRect(); if (r.width > 0) setSplit(clampSplit(((ev.clientX - r.left) / r.width) * 100, r.width)); }; const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", up); }}
        onDoubleClick={() => setSplit(42)}
        onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setSplit((v) => clampSplit(v + (e.key === "ArrowLeft" ? -2 : 2), splitRef.current?.getBoundingClientRect().width ?? 0)); } }}
        className="vob-splitter w-3 shrink-0 cursor-col-resize focus-visible:outline-none" />
      <section aria-label={mt.details} className="min-h-0 min-w-0 overflow-auto border border-border bg-background">
        {selected && (() => {
          const sheet = pluginSheet(selected.appId, lang);
          const summary = sheet?.summary ?? selected.description;
          const plugin = host.info?.plugins.find((p) => p.id === selected.appId);
          const entry = catalog.data?.entries.find((e) => e.id === selected.appId);
          const canUpdate = selected.installed && catalog.entryFor(selected.appId)?.canUpdate;
          const h3 = "mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
          return <article className="flex min-h-full flex-col" data-sheet-language={sheet?.language} data-sheet-fallback={sheet?.fallback || undefined}>
            <header className="home-sheet-header flex items-center gap-4 border-b border-border px-6 py-5">
              <span aria-hidden className="flex size-14 shrink-0 items-center justify-center">{icon(selected)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-lg font-semibold leading-tight">{selected.name}</h2>
                {summary && <p className="mt-1 text-[13px] text-muted-foreground">{summary}</p>}
                {(selected.installedVersion !== undefined || selected.construction) && <p className="mt-1.5 text-xs text-muted-foreground">{selected.installedVersion !== undefined ? versionLabel(selected.installedVersion) : t.construction}</p>}
              </div>
              {canUpdate && <Button variant="outline" disabled={catalog.updating !== null} onClick={() => void catalog.update(selected.appId)} className="h-7 shrink-0 gap-2 rounded-[4px] text-xs"><RefreshCw className="size-4" />{ct.update}</Button>}
            </header>
            <div className="flex-1 space-y-7 px-6 py-6">
              {(plugin && !plugin.available || (entry && catalog.data)) && <section className="space-y-1 rounded-sm border border-border bg-panel/50 px-4 py-3 empty:hidden">{plugin && !plugin.available && <p className="text-xs text-destructive">{pt.unavailable} : {plugin.reason}</p>}{entry && catalog.data && <CatalogLines entry={entry} data={catalog.data} ct={ct} />}</section>}
              {sheet?.overview && <section><h3 className={h3}>{sheet.labels.overview}</h3><p className="max-w-[68ch] text-sm leading-6">{sheet.overview}</p></section>}
              {sheet && sheet.features.length > 0 && <section><h3 className={h3}>{sheet.labels.features}</h3><ul className="grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-2">{sheet.features.map((f) => <li key={f.title} className="home-sheet-feature bg-background px-4 py-3 sm:odd:last:col-span-2"><span className="block text-[13px] font-semibold">{f.title}</span>{f.text && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{f.text}</span>}</li>)}</ul></section>}
              {sheet && sheet.screenshots.length > 0 && <section><h3 className={h3}>{sheet.labels.screenshots}</h3><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{sheet.screenshots.map((src) => <img key={src} src={src} alt={`${selected.name} — ${sheet.labels.screenshots}`} className="aspect-video w-full rounded-sm border border-border object-cover" />)}</div></section>}
              {host.message && (host.error || host.launching || host.mode !== "native") && <p role={host.error ? "alert" : "status"} aria-live="polite" className={`text-xs ${host.error ? "text-destructive" : "text-muted-foreground"}`}>{host.message}</p>}
              {catalog.phase === "pending" && <p role="status" className="text-xs text-muted-foreground">{ct.checking}</p>}
              {(catalog.phase === "error" || catalog.data?.status === "unavailable") && <p className="text-xs text-muted-foreground">{ct.unavailable}</p>}
              {catalog.message && <p role={catalog.error ? "alert" : "status"} className={`text-xs ${catalog.error ? "text-destructive" : "text-muted-foreground"}`}>{catalog.message}</p>}
            </div>
            {sheet && (sheet.credits.length > 0 || sheet.gitUrl || sheet.lovableUrl) && <footer className="home-sheet-credits grid gap-5 border-t border-border bg-panel/50 px-6 py-4 sm:grid-cols-2">
              {sheet.credits.length > 0 && <div><h3 className={h3}>{sheet.labels.credits}</h3>{sheet.credits.map((c) => <p key={c.name + c.role} className="text-[13px]"><span className="font-semibold">{c.name}</span>{c.role && <span className="block text-xs text-muted-foreground">{c.role}</span>}</p>)}</div>}
              {(sheet.gitUrl || sheet.lovableUrl) && <div><h3 className={h3}>{sheet.labels.sources}</h3><div className="space-y-1.5">
                {sheet.gitUrl && <a href={sheet.gitUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-[13px] text-ribbon-dark hover:underline"><GitBranch className="size-4 shrink-0" /><span className="truncate">{sheet.labels.git} — {sheet.gitUrl.replace(/^https?:\/\//, "")}</span></a>}
                {sheet.lovableUrl && <a href={sheet.lovableUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[13px] text-ribbon-dark hover:underline"><ExternalLink className="size-4 shrink-0" />{sheet.labels.lovable}</a>}
              </div></div>}
            </footer>}
          </article>;
        })()}
      </section>
      </div>
    </main>
    <footer className="vob-status-bar flex shrink-0 items-center justify-between gap-4 border-t border-border px-4 py-1.5 text-xs">
      <span className="text-muted-foreground" data-testid="suite-version">{suiteVersion ?? (host.mode === "browser" ? mt.previewVersion : "")}</span>
      <Button variant="ghost" onClick={() => setDialog("quit")} className={DIALOG_BTN}>{t.quit}</Button>
    </footer>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
      <DialogContent className={`${dialog === "about" ? "vob-about-dialog" : ""} max-w-[min(28rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-sm p-0`}>
        <DialogTitle className="catalog-panel-heading px-4 py-3 pr-10 text-sm">{dialog === "about" ? t.about : t.quit}</DialogTitle>
        {dialog === "about" ? <>
          <div className="relative flex flex-col items-center overflow-hidden bg-titlebar px-6 py-9">
            <span aria-hidden className="vob-about-scan pointer-events-none absolute inset-0" />
            <div className="vob-about-emblem relative flex size-24 items-center justify-center"><span aria-hidden className="vob-about-frame absolute inset-0 border-2 border-ribbon-dark/40" /><span aria-hidden className="flex size-14 items-center justify-center border-2 border-ribbon-dark text-4xl text-ribbon-dark">Λ</span></div>
            <h2 className="vob-about-name mt-5 text-xl font-semibold">{SUITE_NAME}</h2>
            {suiteVersion && <p className="mt-2 text-xs text-muted-foreground">{pt.version} {suiteVersion}</p>}
          </div>
          <DialogDescription className="vob-about-credits px-4 py-6 text-center text-xs leading-6 text-foreground">{t.createdBy}<br /><strong>MAUGER Jean-François</strong><br />Copyright (c) ALLPLAN GmbH - All rights reserved</DialogDescription>
        </> : <DialogDescription className="px-5 py-6 text-sm leading-6 text-foreground">{dialog === "quit" ? t.quitQuestion : <span role={closeError ? "alert" : "status"} className="whitespace-pre-line">{closeMessage}</span>}</DialogDescription>}
        <div className="secondary-dialog-footer flex justify-end gap-2 px-4 py-2">
          {dialog === "quit" ? <><Button variant="outline" onClick={() => setDialog(null)} className="h-7 text-xs">{t.cancel}</Button><Button disabled={closePending} onClick={() => void closeWindow()} className="h-7 text-xs"><Power className="size-3" />{t.quit}</Button></> : <Button autoFocus onClick={() => setDialog(null)} className="h-7 min-w-20 text-xs">OK</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}