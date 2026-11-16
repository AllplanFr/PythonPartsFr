import type { ReactNode } from "react";
import { FolderOpen, ExternalLink, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useVobEditor } from "@/lib/vob-editor";
import { useVobHost, vobRevealFile, vobSwitch } from "@/lib/vob-bridge";

/** VOB footer: only the open file path; clicking it offers folder/file opening through Python. */
export function VobStatusBar({ fr, children, leading }: { fr: boolean; children?: ReactNode; leading?: ReactNode }) {
  const text = (a: string, b: string) => fr ? a : b;
  const file = useVobEditor((s) => s.file);
  const dataVersion = useVobHost((s) => s.dataVersion);
  const recent = useVobHost((s) => s.recentFiles);
  return <div className="vob-status-bar flex shrink-0 items-center gap-1 overflow-hidden border-t py-1.5 border-border px-2 text-xs">
    {leading}
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!file && recent.length === 0}><Button variant="outline" title={file?.path ?? ""} aria-label={text("Fichier VOB ouvert", "Open VOB file")} className="h-6 min-w-0 shrink justify-start rounded-sm border-border bg-background px-2 text-xs font-normal hover:bg-selection"><span className="truncate">{file?.path || text("Aucun fichier ouvert", "No file open")}</span></Button></DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="max-w-[calc(100vw-16px)] rounded-sm text-xs">
        {file && <>
        <DropdownMenuLabel className="catalog-panel-heading text-xs">{file.name}</DropdownMenuLabel>
        <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void vobRevealFile(file.path, "folder")}><FolderOpen className="h-4 w-4 text-ribbon-dark" />{text("Ouvrir le dossier du fichier", "Open file folder")}</DropdownMenuItem>
        <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void vobRevealFile(file.path, "file")}><ExternalLink className="h-4 w-4 text-ribbon-dark" />{text("Ouvrir le fichier", "Open file")}</DropdownMenuItem>
        </>}
        {recent.length > 0 && <>
          {file && <DropdownMenuSeparator />}
          <DropdownMenuLabel className="catalog-panel-heading text-xs">{text("Fichiers récents", "Recent files")}</DropdownMenuLabel>
          {/* Opening reuses vobSwitch: unsaved-change guard, current document kept on cancel/failure. */}
          {recent.map((p) => <DropdownMenuItem key={p} title={p} disabled={p === file?.path} className="gap-2 text-xs" onSelect={() => void vobSwitch(p)}><History className="h-4 w-4 shrink-0 text-ribbon-dark" /><span className="truncate">{p}</span></DropdownMenuItem>)}
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
    {dataVersion && <span className="shrink-0 whitespace-nowrap px-2 text-muted-foreground">Allplan Data : {dataVersion}</span>}
    <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 pl-3">{children}</div>
  </div>;
}
