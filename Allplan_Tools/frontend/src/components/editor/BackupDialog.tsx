import { useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DIALOG_BTN } from "./FormulaTools";
import { askConfirmation, showMessage } from "@/lib/app-dialog";
import { backupFileName, requestBackupRestore, restoreCatalogBackup, useCatalogBackups, type CatalogBackup } from "@/lib/catalog-backups";
import { useT } from "@/lib/i18n";
import { useCatalog } from "@/lib/catalog-store";

export async function confirmBackupRestore(backup: CatalogBackup) {
  const lang = useCatalog.getState().lang;
  const date = new Date(backup.createdAt).toLocaleString(lang);
  const fr = lang === "fr";
  const text = fr ? `Restaurer « ${backupFileName(backup)} » du ${date} ? Le catalogue actuel sera remplacé.` : `Restore “${backupFileName(backup)}” from ${date}? This replaces the current catalog.`;
  if (!(await askConfirmation(text))) return;
  if (requestBackupRestore(backup)) { showMessage(fr ? "La demande de restauration a été envoyée au PythonPart. Le catalogue sera mis à jour dès réception des nouvelles données." : "The restore request was sent to the PythonPart. The catalog will update when the new data arrives."); return; }
  if (restoreCatalogBackup(backup.id, true)) showMessage(fr ? "La sauvegarde a été restaurée. Enregistrez le catalogue pour conserver cette version." : "The backup has been restored. Save the catalog to keep this version.");
}

export function BackupDialog() {
  const t = useT();
  const lang = useCatalog((s) => s.lang);
  const fr = lang === "fr";
  const { backups, setOpen } = useCatalogBackups();
  const [selected, setSelected] = useState(backups[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const current = backups.find((b) => b.id === selected);
  const rows = backups.map((b, i) => ({ b, i: i + 1, file: backupFileName(b), date: new Date(b.createdAt).toLocaleString(lang) }));
  const filtered = rows.filter((r) => `${r.i} ${r.file} ${r.date}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const grid = "grid grid-cols-[64px_200px_1fr] items-center";
  return <Dialog layoutId="catalog-backups" title={t("backupManager")} width={760} height={520} onClose={() => setOpen(false)} footer={<>
    <Button variant="ghost" className={DIALOG_BTN} disabled={!current} onClick={() => { if (current) void confirmBackupRestore(current); }}><RotateCcw className="h-4 w-4" />{t("restoreBackup")}</Button>
    <Button variant="ghost" className={DIALOG_BTN} onClick={() => setOpen(false)}>{t("close")}</Button>
  </>}>
    <p className="my-3 border-l-2 border-ribbon-dark pl-3 text-xs leading-5 text-muted-foreground">{fr ? "Les sauvegardes sont créées automatiquement par le PythonPart. Sélectionnez-en une puis cliquez sur Restaurer." : "Backups are created automatically by the PythonPart. Select one, then click Restore."}</p>
    <div className="mb-2 flex items-center gap-1"><Search className="h-4 w-4 text-muted-foreground" /><Input aria-label={t("search")} placeholder={t("search")} className="h-7 flex-1 text-xs" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    <div className="min-h-0 flex-1 overflow-auto border border-border">
      <div className={`catalog-panel-heading ${grid} sticky top-0 z-10 px-3 py-2 text-xs font-semibold`}><span>Index</span><span>{fr ? "Date du fichier" : "File date"}</span><span className="flex justify-between">{fr ? "Nom du fichier" : "File name"}<span className="text-[10px] font-normal text-muted-foreground">{filtered.length}</span></span></div>
      {filtered.map(({ b, i, file, date }, n) => <button key={b.id} type="button" aria-pressed={selected === b.id} className={`${grid} w-full border-b border-border/60 px-3 py-2 text-left text-xs ${selected === b.id ? "catalog-selected-row bg-selection" : n % 2 ? "bg-row-alt" : "bg-background"}`} onClick={() => setSelected(b.id)} onDoubleClick={() => void confirmBackupRestore(b)}>
        <span className="tabular-nums text-muted-foreground">{i}</span><span className="tabular-nums">{date}</span><span className="truncate font-medium" title={file}>{file}</span>
      </button>)}
      {!filtered.length && <div className="p-8 text-center text-xs text-muted-foreground">{t("backupEmpty")}</div>}
    </div>
  </Dialog>;
}
