import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Info, Languages, Moon, Power, Sun, ArrowRight } from "lucide-react";
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
import { SUITE_MODULES, SUITE_NAME, UPCOMING_MODULES } from "./catalog";
import { useHomeHost } from "./use-home-host";
import { HomePluginIcon, resolveHomeIcon } from "./HomePluginIcon";
import { HOME_LANGUAGES, HOME_TEXT, HOME_SECTIONS, HOME_PLUGIN_TEXT, HOME_CATALOG_TEXT, HOME_CATALOG_HEADER, type CatalogText, type HomeLanguage } from "./home-text";
import { useHomeCatalog } from "./use-home-catalog";
import { isUpToDate } from "./contracts/plugin-catalog-validate";
import type { CatalogEntry } from "./contracts/PLUGIN_CATALOG_CONTRACT";
import { isCloseHomeReply, isPluginInventoryInfo, type HomeWindow } from "./contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

const upcomingIcons = [tradeIcon, layerIcon, attributeIcon];

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
  const [closeError, setCloseError] = useState<string | null>(null);
  const closing = useRef(false);
  const t = HOME_TEXT[lang];
  const hh = HOME_CATALOG_HEADER[lang];
  const pt = HOME_PLUGIN_TEXT[lang];
  const versionLabel = (version: string | null) => version === null ? pt.unknownVersion : `${pt.version} ${version}`;
  const host = useHomeHost(requireNative);
  const inventory = isPluginInventoryInfo(host.info) ? host.info.plugins : null;
  const ct = HOME_CATALOG_TEXT[lang];
  const catalog = useHomeCatalog(host.mode === "native" && inventory !== null);
  const installedIds = new Set(inventory?.map((p) => p.id) ?? []);
  const notInstalled = catalog.notInstalled.filter((e) => !installedIds.has(e.id));
  const rows = host.mode === "native" && inventory
    ? inventory.filter((plugin) => plugin.lifecycle !== "construction").map((plugin) => ({
      appId: plugin.id, name: plugin.name, description: plugin.description, route: undefined,
      installedVersion: plugin.installedVersion as string | null | undefined,
    }))
    : SUITE_MODULES.map((module, index) => ({
      ...module, description: t.descriptions[index], installedVersion: undefined,
    }));
  const constructionRows = host.mode === "native" && inventory ? inventory.filter((plugin) => plugin.lifecycle === "construction") : [];
  useEffect(() => {
    const previousDark = document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    return () => { document.documentElement.classList.toggle("dark", previousDark); };
  }, [dark]);
  const closeWindow = async () => {
    if (closing.current) return;
    const api = (window as HomeWindow).pywebview?.api;
    setCloseError(null);
    if (typeof api?.close_home !== "function") {
      setDialog("close");
      window.close();
      return;
    }
    closing.current = true;
    try {
      const reply: unknown = await api.close_home();
      if (!isCloseHomeReply(reply)) {
        setCloseError("Invalid close_home response; window state unknown.");
        setDialog("close");
      } else if (!reply.ok) {
        setCloseError(reply.error);
        setDialog("close");
      } else {
        setDialog(null);
      }
    } catch (error) {
      setCloseError(`close_home: ${error instanceof Error ? error.message : String(error)}`);
      setDialog("close");
    } finally {
      closing.current = false;
    }
  };
  const iconButton = "h-7 w-7 shrink-0 rounded-sm p-0 text-ribbon-dark hover:bg-background/60";
  return <div className="flex min-h-dvh flex-col bg-background text-[13px] text-foreground">
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
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-border pb-3">
        <div className="min-w-0"><h1 className="text-base font-semibold">{hh.title}</h1><p className="mt-1 text-xs text-muted-foreground">{hh.intro}</p></div>
        <span className="text-xs text-muted-foreground">{hh.count(rows.length)}</span>
      </div>
      {host.message && <p role={host.error ? "alert" : "status"} aria-live="polite" className={`mb-6 -mt-3 text-xs ${host.error ? "text-destructive" : "text-muted-foreground"}`}>{host.message}</p>}
      {catalog.phase === "pending" && <p role="status" className="-mt-5 mb-6 text-xs text-muted-foreground">{ct.checking}</p>}
      {(catalog.phase === "error" || catalog.data?.status === "unavailable") && <p className="-mt-5 mb-6 text-xs text-muted-foreground">{ct.unavailable}</p>}
      {catalog.message && <p role={catalog.error ? "alert" : "status"} className={`-mt-5 mb-6 text-xs ${catalog.error ? "text-destructive" : "text-muted-foreground"}`}>{catalog.message}</p>}
      <h2 className="catalog-panel-heading px-4 py-2 text-xs font-semibold">{HOME_SECTIONS[lang][0]}</h2>
      <ul aria-label={HOME_SECTIONS[lang][0]} className="grid gap-3 py-3 md:grid-cols-2">
        {rows.map((module) => {
          const plugin = host.info?.plugins.find((p) => p.id === module.appId);
          const entry = inventory ? catalog.entryFor(module.appId) : undefined;
          const disabled = host.mode !== "browser" && (host.mode !== "native" || host.launching || !plugin?.available);
          const content = <>
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center">
                <HomePluginIcon source={host.mode === "native" ? resolveHomeIcon(module.appId, plugin?.iconUrl, window.location.origin) : null}
                  fallback={module.appId === "vob_editor" ? vobIcon : module.appId === "information_manager" ? informationIcon : ascIcon} />
              </span>
              <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{module.name}</span><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{module.description}</span>{module.installedVersion !== undefined && <span className="block text-xs text-muted-foreground">{versionLabel(module.installedVersion)}</span>}{host.mode === "native" && inventory && plugin && !plugin.available && <span className="block text-xs text-destructive">{pt.unavailable} : {plugin.reason}</span>}{entry && catalog.data && <CatalogLines entry={entry} data={catalog.data} ct={ct} />}</span>
              {entry?.canUpdate && <span aria-hidden className="w-20 shrink-0" />}
              <ArrowRight aria-hidden className="size-4 shrink-0 text-ribbon-dark" />
          </>;
          const classes = "h-auto min-h-20 w-full justify-start gap-4 whitespace-normal rounded-none px-4 py-4 text-left hover:bg-selection disabled:opacity-60";
          return <li key={module.appId} className="relative overflow-hidden rounded-sm border border-border bg-panel">
            {host.mode === "browser" && module.route ? <Button variant="ghost" asChild className={classes}><Link to={module.route} preload={false}>{content}</Link></Button>
              : <Button variant="ghost" disabled={disabled} aria-busy={host.launching} title={plugin?.reason || undefined} onClick={() => void host.launch(module.appId)} className={classes}>{content}</Button>}
            {entry?.canUpdate && <Button size="sm" variant="outline" aria-label={`${ct.update} ${module.name}`}
              disabled={catalog.updating !== null} aria-busy={catalog.updating === module.appId}
              onClick={() => void catalog.update(module.appId)}
              className="absolute right-11 top-1/2 h-7 w-20 -translate-y-1/2 rounded-sm text-xs">{ct.update}</Button>}
          </li>;
        })}
      </ul>
      {constructionRows.length > 0 && <>
      <h2 className="catalog-panel-heading mt-8 px-4 py-2 text-xs font-semibold">{pt.installedConstruction}</h2>
      <ul aria-label={pt.installedConstruction} className="overflow-hidden border-b border-border">
        {constructionRows.map((plugin) =>
          <li key={plugin.id} className="bg-panel">
            <Button variant="ghost" disabled title={plugin.reason ?? undefined} className="h-auto min-h-20 w-full justify-start gap-4 whitespace-normal rounded-none px-4 py-4 text-left disabled:opacity-100">
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-muted-foreground">{plugin.name}</span><span className="block text-xs text-muted-foreground">{t.construction}</span><span className="block text-xs text-muted-foreground">{versionLabel(plugin.installedVersion)}</span>{(() => { const e = catalog.entryFor(plugin.id); return e && catalog.data ? <CatalogLines entry={e} data={catalog.data} ct={ct} /> : null; })()}</span>
            </Button>
          </li>)}
      </ul>
      </>}
      {notInstalled.length > 0 && catalog.data && <>
      <h2 className="catalog-panel-heading mt-8 px-4 py-2 text-xs font-semibold">{ct.notInstalled}</h2>
      <ul aria-label={ct.notInstalled} className="overflow-hidden border-b border-border">
        {notInstalled.map((e, index) => <li key={e.id} className={`min-h-16 px-4 py-3 ${index % 2 ? "bg-row-alt" : "bg-panel"}`}>
          <span className="block text-sm font-semibold">{e.name}</span>
          <CatalogLines entry={e} data={catalog.data!} ct={ct} />
        </li>)}
      </ul>
      </>}
      <h2 className="catalog-panel-heading mt-8 px-4 py-2 text-xs font-semibold">{HOME_SECTIONS[lang][1]}</h2>
      <ul aria-label={HOME_SECTIONS[lang][1]} className="overflow-hidden border-b border-border">
        {UPCOMING_MODULES.map((name, index) => <li key={name} className={index % 2 ? "bg-row-alt" : "bg-panel"}>
          <Button variant="ghost" disabled className="h-auto min-h-20 w-full justify-start gap-4 whitespace-normal rounded-none px-4 py-4 text-left disabled:opacity-100">
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center"><img src={upcomingIcons[index]} alt="" className="size-8 object-contain" draggable={false} /></span>
            <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm font-semibold text-muted-foreground">{name}</span><span className="border-l-2 border-panel-heading-border pl-3 text-xs font-normal text-muted-foreground">{t.construction}</span></span>
          </Button>
        </li>)}
      </ul>
    </main>
    <footer className="flex min-h-9 shrink-0 items-center justify-between gap-4 border-t border-panel-heading-border bg-titlebar px-4">
      <span className="text-xs font-semibold text-ribbon-dark">{SUITE_NAME}</span>
      <Button variant="outline" onClick={() => setDialog("quit")} className="h-7 text-xs">{t.quit}</Button>
    </footer>
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
      <DialogContent className={`${dialog === "about" ? "vob-about-dialog" : ""} max-w-[min(28rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-sm p-0`}>
        <DialogTitle className="catalog-panel-heading px-4 py-3 pr-10 text-sm">{dialog === "about" ? t.about : t.quit}</DialogTitle>
        {dialog === "about" ? <>
          <div className="relative flex flex-col items-center overflow-hidden bg-titlebar px-6 py-9">
            <span aria-hidden className="vob-about-scan pointer-events-none absolute inset-0" />
            <div className="vob-about-emblem relative flex size-24 items-center justify-center"><span aria-hidden className="vob-about-frame absolute inset-0 border-2 border-ribbon-dark/40" /><span aria-hidden className="flex size-14 items-center justify-center border-2 border-ribbon-dark text-4xl text-ribbon-dark">Λ</span></div>
            <h2 className="vob-about-name mt-5 text-xl font-semibold">{SUITE_NAME}</h2>
          </div>
          <DialogDescription className="vob-about-credits px-4 py-6 text-center text-xs leading-6 text-foreground">{t.createdBy}<br /><strong>MAUGER Jean-François</strong><br />Copyright (c) ALLPLAN GmbH - All rights reserved</DialogDescription>
        </> : <DialogDescription className="px-5 py-6 text-sm leading-6 text-foreground">{dialog === "quit" ? t.quitQuestion : t.closeHint}</DialogDescription>}
        {dialog === "close" && closeError !== null && <p role="alert" className="px-5 pb-4 text-sm text-destructive">{closeError}</p>}
        <div className="secondary-dialog-footer flex justify-end gap-2 px-4 py-2">
          {dialog === "quit" ? <><Button variant="outline" onClick={() => setDialog(null)} className="h-7 text-xs">{t.cancel}</Button><Button onClick={closeWindow} className="h-7 text-xs"><Power className="size-3" />{t.quit}</Button></> : <Button autoFocus onClick={() => setDialog(null)} className="h-7 min-w-20 text-xs">OK</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}