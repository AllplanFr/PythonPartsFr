import { type ReactNode } from "react";
import { Archive, Clock, LibraryBig, Wrench, Folder, FolderOpen, Languages, Info, CircleHelp, Power, RotateCcw, Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCatalog } from "@/lib/catalog-store";
import { useCatalogRegistry, selectRegisteredCatalog } from "@/lib/catalog-registry";
import { useCatalogBackups } from "@/lib/catalog-backups";
import { confirmBackupRestore } from "./BackupDialog";
import { showMessage, showInDevelopment } from "@/lib/app-dialog";
import { useT, LANGS, type TKey } from "@/lib/i18n";
import saveIcon from "@/assets/icons/save.svg.asset.json";
import saveAsIcon from "@/assets/icons/save_as.svg.asset.json";
import { HELP_URLS } from "./FormulaTools";
import { MenuFlag } from "./MenuFlag";

const item = "gap-2 rounded-none text-xs";
const sub = "max-h-[70vh] w-80 overflow-auto rounded-sm text-xs";
const folders: TKey[] = ["folderApplication", "folderExports", "folderSettings", "folderCatalog", "folderData", "catalogTextEditor"];

export function MainMenu({ onSave, onSaveAs, tools }: { onSave: () => void; onSaveAs: () => void; tools: [string, string | ReactNode, (() => void) | null][] }) {
  const t = useT();
  const { lang, setLang, setView } = useCatalog();
  const backups = useCatalogBackups((s) => s.backups);
  const recentIds = useCatalogRegistry((s) => s.recentIds);
  const cats = useCatalogRegistry((s) => s.cats);
  const later = (name: string) => showInDevelopment(name);
  const fr = lang === "fr";
  const head = "px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";
  const ico = "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted text-ribbon-dark";
  const rich = "gap-3 rounded-none py-1.5 text-xs";
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" aria-label={t("mainMenu")} className="smartcatalog-tab flex h-full shrink-0 items-center gap-2 rounded-none pl-5 pr-6 text-xs font-semibold text-primary-foreground hover:bg-primary"><span className="flex h-[19px] w-[19px] items-center justify-center border-2 border-current text-base leading-none">Λ</span>SmartCatalog</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" sideOffset={0} className="w-80 rounded-sm text-xs">
      <DropdownMenuItem className={item} onSelect={() => setView("manager")}><LibraryBig className="text-ribbon-dark" />{t("open")}</DropdownMenuItem>
      <DropdownMenuSub><DropdownMenuSubTrigger className={item}><Clock className="text-ribbon-dark" />{t("recentCatalogs")}</DropdownMenuSubTrigger><DropdownMenuSubContent className={sub}>
        {recentIds.map((id) => cats.find((c) => c.id === id)).filter((c) => !!c).map((cat) => <DropdownMenuItem key={cat.id} className={item} onSelect={() => { if (selectRegisteredCatalog(cat.id)) { setView("editor"); showMessage(t("recentPending")); } }}><LibraryBig className="text-ribbon-dark" /><span className="min-w-0"><span className="block truncate">{cat.name}</span><span className="block truncate text-[10px] text-muted-foreground">{cat.path}</span></span></DropdownMenuItem>)}
        {!recentIds.length && <DropdownMenuItem disabled className={item}>{t("recentEmpty")}</DropdownMenuItem>}
      </DropdownMenuSubContent></DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem className={item} onSelect={onSave}><img src={saveIcon.url} alt="" className="h-4 w-4" />{t("save")}<span className="ml-auto text-[10px] text-muted-foreground">Ctrl+S</span></DropdownMenuItem>
      <DropdownMenuItem className={item} onSelect={onSaveAs}><img src={saveAsIcon.url} alt="" className="h-4 w-4" />{t("saveAs")}</DropdownMenuItem>
      <DropdownMenuSub><DropdownMenuSubTrigger className={item}><Archive className="text-ribbon-dark" />{t("restoreBackup")}</DropdownMenuSubTrigger><DropdownMenuSubContent className={sub}>
        <DropdownMenuItem className={item} onSelect={() => useCatalogBackups.getState().setOpen(true)}><Archive className="text-ribbon-dark" />{t("backupManager")}…</DropdownMenuItem><DropdownMenuSeparator />
        {backups.map((backup) => <DropdownMenuItem key={backup.id} className={item} onSelect={() => { void confirmBackupRestore(backup); }}><RotateCcw className="text-ribbon-dark" /><span className="min-w-0"><span className="block truncate">{backup.name}</span><span className="block text-[10px] text-muted-foreground">{new Date(backup.createdAt).toLocaleString(lang)}</span></span></DropdownMenuItem>)}
        {!backups.length && <DropdownMenuItem disabled className={item}>{t("backupEmpty")}</DropdownMenuItem>}
      </DropdownMenuSubContent></DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuSub><DropdownMenuSubTrigger className={item}><Languages className="text-ribbon-dark" />{t("lang")}</DropdownMenuSubTrigger><DropdownMenuSubContent className="w-52 rounded-sm">{LANGS.map((l) => <DropdownMenuItem key={l.code} className={item} onSelect={() => setLang(l.code)}><MenuFlag language={l.code} /><span className="w-6 uppercase text-muted-foreground">{l.code}</span>{l.label}{lang === l.code && <Check className="ml-auto text-ribbon-dark" />}</DropdownMenuItem>)}</DropdownMenuSubContent></DropdownMenuSub>
      <DropdownMenuSub><DropdownMenuSubTrigger className={item}><Wrench className="text-ribbon-dark" />{t("tools")}</DropdownMenuSubTrigger><DropdownMenuSubContent className={sub}>
        <DropdownMenuLabel className={head}>{t("tools")}</DropdownMenuLabel>
        {tools.slice(0, 8).map(([label, icon, action], i) => <div key={label}>{(i === 4 || i === 5 || i === 6) && <DropdownMenuSeparator />}<DropdownMenuItem className={rich} onSelect={() => action ? action() : later(label)}><span className={ico}>{icon}</span><span className="truncate">{label}</span></DropdownMenuItem></div>)}
      </DropdownMenuSubContent></DropdownMenuSub>
      <DropdownMenuSub><DropdownMenuSubTrigger className={item}><Folder className="text-ribbon-dark" />{t("foldersMenu")}</DropdownMenuSubTrigger><DropdownMenuSubContent className={sub}>
        <DropdownMenuLabel className={head}>SmartCatalog</DropdownMenuLabel>
        {folders.slice(0, 5).map((key) => <DropdownMenuItem key={key} className={rich} onSelect={() => later(t(key))}><span className={ico}><FolderOpen className="h-4 w-4" /></span>{t(key)}</DropdownMenuItem>)}
        <DropdownMenuItem className={rich} onSelect={() => later(t("catalogTextEditor"))}><span className={ico}><FileText className="h-4 w-4" /></span>{t("catalogTextEditor")}</DropdownMenuItem>
        <DropdownMenuSeparator /><DropdownMenuLabel className={head}>{fr ? "Dossiers Allplan" : "Allplan folders"}</DropdownMenuLabel>
        <div className="grid grid-cols-3 gap-1 px-1 pb-1">{["STD", "PRJ", "PRG", "ETC", "USR", "TMP"].map((name) => <DropdownMenuItem key={name} title={t("folderAllplan", { n: name })} className="flex-col gap-1 rounded-sm py-2 text-[11px] font-semibold" onSelect={() => later(t("folderAllplan", { n: name }))}><Folder className="h-5 w-5 text-ribbon-dark" />{name}</DropdownMenuItem>)}</div>
      </DropdownMenuSubContent></DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem className={item} onSelect={() => showMessage("", "about")}><Info className="text-ribbon-dark" />{t("about")}</DropdownMenuItem>
      <DropdownMenuItem className={item} onSelect={() => window.open(HELP_URLS.attributes, "_blank", "noopener,noreferrer")}><CircleHelp className="text-ribbon-dark" />{t("help")}</DropdownMenuItem>
      <DropdownMenuSeparator /><DropdownMenuItem className={item} onSelect={() => later(t("quit"))}><Power className="text-destructive" />{t("quit")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
