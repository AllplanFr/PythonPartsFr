import { Info, Languages, Power } from "lucide-react";
import { MenuFlag } from "./menu-flag";
import { SmartCatalogIcon } from "./smartcatalog-icons";
import type { InterfaceText } from "@/modules/information_manager/lib/aim-interface";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LANGS, LANG_LABELS, type Dict, type Lang } from "@/modules/information_manager/lib/i18n";

export function SuiteMenu({ t, text, onImport, importDisabled, onExport, exportDisabled = "Export de fichier indisponible dans ce lot.", onSave, saveDisabled = "Enregistrement sur disque indisponible dans ce lot.", onQuit, onAbout, onBackups }: { t: Dict; text: InterfaceText; onImport: () => void; importDisabled?: string | undefined; onExport: () => void; exportDisabled?: string | undefined; onSave: () => void; saveDisabled?: string | undefined; onQuit: () => void; onAbout: () => void; onBackups: () => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" className="smartcatalog-tab h-full rounded-none pl-5 pr-6 text-xs font-semibold text-primary-foreground" aria-label={t.appName}><span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center border-2 border-current text-base leading-none">Λ</span>Information Manager</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" sideOffset={0} className="suite-menu w-64">
      <DropdownMenuItem className="gap-2 rounded-none text-xs" disabled={!!importDisabled} title={importDisabled} onSelect={onImport}><SmartCatalogIcon name="import" className="h-5 w-5" />{text.importPresentation}</DropdownMenuItem>
      <DropdownMenuItem className="gap-2 rounded-none text-xs" disabled={!!exportDisabled} title={exportDisabled} onSelect={onExport}><SmartCatalogIcon name="export" className="h-5 w-5" />{text.exportPresentation}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="gap-2 rounded-none text-xs" disabled={!!saveDisabled} title={saveDisabled} onSelect={onSave}><SmartCatalogIcon name="save" className="size-5" />{t.save}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="gap-2 rounded-none text-xs" disabled><SmartCatalogIcon name="save" className="size-5" />{text.backups}</DropdownMenuItem>
      <DropdownMenuItem className="gap-2 rounded-none text-xs" onSelect={onAbout}><Info className="h-4 w-4 text-ribbon-dark" />{t.about}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="gap-2 rounded-none text-xs" onSelect={onQuit}><Power className="h-4 w-4 text-destructive" />{t.quit}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function SuiteLanguageMenu({ lang, onChange, title }: { lang: Lang; onChange: (lang: Lang) => void; title: string }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" title={title} aria-label={title} className="suite-chrome-button gap-1 px-1.5"><Languages /><span className="text-[11px] uppercase text-foreground">{lang}</span></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="suite-menu">
      {LANGS.map((l) => <DropdownMenuItem key={l} onSelect={() => onChange(l)} className={`gap-3 ${lang === l ? "bg-selection font-semibold" : ""}`}><MenuFlag language={l} /><span className="w-5 uppercase text-muted-foreground">{l}</span>{LANG_LABELS[l]}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}