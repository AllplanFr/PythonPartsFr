import { useState } from "react";
import { RotateCcw, Search, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { useVobResources } from "@/lib/vob-resources";
import { vobListBackups, vobRestoreBackup, vobCreateBackup } from "@/lib/vob-bridge";
import { useCatalog } from "@/lib/catalog-store";
import { useVobEditor } from "@/lib/vob-editor";

export function VobBackupDialog() {
  const { backups } = useVobResources(); const lang = useCatalog((s) => s.lang); const fr = lang === "fr";
  const [selected, setSelected] = useState(""); const [query, setQuery] = useState(""); const [busy, setBusy] = useState(false);
  const current = backups.find((b) => b.id === selected); const file = useVobEditor((s) => s.file);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); } finally { setBusy(false); } };
  const grid = "grid grid-cols-[48px_180px_minmax(0,1fr)] items-center";
  return <Dialog layoutId="vob-backups" title={fr ? "Gestionnaire de sauvegardes VOB" : "VOB backup manager"} width={760} height={520} onClose={() => useVobResources.setState({ backupsOpen: false })} footer={<>
    <Button variant="ghost" className={DIALOG_BTN} disabled={!current || busy} onClick={() => { if (current) void run(() => vobRestoreBackup(current)); }}><RotateCcw className="h-4 w-4" />{fr ? "Restaurer" : "Restore"}</Button>
    <Button variant="ghost" className={DIALOG_BTN} onClick={() => useVobResources.setState({ backupsOpen: false })}>{fr ? "Fermer" : "Close"}</Button>
  </>}>
    <div className="my-3 truncate text-xs text-muted-foreground" title={file?.path}>{file?.path}</div>
    <div className="mb-2 flex items-center gap-2"><Search className="h-4 w-4 text-muted-foreground" /><Input aria-label={fr ? "Rechercher une sauvegarde" : "Search backups"} value={query} onChange={(e) => setQuery(e.target.value)} className="h-7 flex-1 text-xs" /><Button variant="ghost" size="icon" disabled={busy || !file} title={fr ? "Rafraîchir" : "Refresh"} onClick={() => void run(vobListBackups)}><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" disabled={busy || !file} title={fr ? "Créer une sauvegarde" : "Create backup"} onClick={() => void run(vobCreateBackup)}><Plus className="h-4 w-4" /></Button></div>
    <div className="min-h-0 flex-1 overflow-auto border border-border"><div className={`catalog-panel-heading sticky top-0 z-10 ${grid} px-3 py-2 text-xs font-semibold`}><span>Index</span><span>{fr ? "Date du fichier" : "File date"}</span><span>{fr ? "Nom du fichier" : "File name"}</span></div>
      {backups.filter((b) => `${b.name} ${b.createdAt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((b, i) => <Button variant="ghost" key={b.id} aria-pressed={selected === b.id} onClick={() => setSelected(b.id)} onDoubleClick={() => { if (!busy) void run(() => vobRestoreBackup(b)); }} className={`${grid} h-9 w-full justify-start rounded-none border-b border-border/60 px-3 text-left text-xs font-normal ${selected === b.id ? "catalog-selected-row bg-selection" : i % 2 ? "bg-row-alt" : "bg-background"}`}><span className="text-muted-foreground">{i + 1}</span><span>{new Date(b.createdAt).toLocaleString(lang)}</span><span className="truncate" title={b.path}>{b.name}</span></Button>)}
      {!backups.length && <div className="p-8 text-center text-xs text-muted-foreground">{fr ? "Aucune sauvegarde fournie" : "No backups supplied"}</div>}
    </div>
  </Dialog>;
}