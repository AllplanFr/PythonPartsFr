import { useState } from "react";
import { FileDown, FileUp, Plus, RotateCcw, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { downloadJson, parseBackup, type ProjectBackup, type InterfaceText } from "@/modules/information_manager/lib/aim-interface";
import { useT, type Lang } from "@/modules/information_manager/lib/i18n";

export function ProjectBackupDialog({ text, path, backups, onClose, onCreate, onRefresh, onRestore, onImport, lang }: { text: InterfaceText; path: string; backups: ProjectBackup[]; onClose: () => void; onCreate: (name: string) => Promise<void>; onRefresh: () => Promise<void>; onRestore: (b: ProjectBackup) => Promise<void>; onImport: (b: ProjectBackup) => Promise<void>; lang: Lang }) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = backups.find((b) => b.id === selected);
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (e) { setError(e instanceof Error && e.message === "wrongProject" ? text.wrongProject : e instanceof Error && e.message === "format" ? t.invalidFile : e instanceof Error ? e.message : text.hostError); } finally { setBusy(false); } };
  const restore = (b: ProjectBackup) => { if (window.confirm(text.confirmRestore)) void run(() => onRestore(b)); };
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="suite-menu flex h-[520px] max-h-[85vh] w-[760px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-sm p-0">
    <DialogTitle className="catalog-panel-heading px-3 py-2 text-sm">{text.backups}</DialogTitle>
    <DialogDescription className="truncate border-b border-border bg-toolbar-bg px-3 py-2 text-xs" title={path}>{path || text.noPath}</DialogDescription>
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-toolbar-bg p-2">
      <Button variant="ghost" disabled={busy} title={text.refresh} aria-label={text.refresh} onClick={() => void run(onRefresh)} className="h-7 w-7 p-0 text-ribbon-dark"><RefreshCw className="size-4" /></Button>
      <input aria-label={text.name} placeholder={text.name} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="field h-7 w-40" />
      <Button variant="ghost" disabled={busy} onClick={() => void run(() => onCreate(name.trim() || new Date().toLocaleString(lang)))} className="h-7 gap-1 text-xs text-ribbon-dark"><Plus className="size-4" />{text.createBackup}</Button>
      <Button variant="ghost" disabled={busy} title={text.importBackup} aria-label={text.importBackup} onClick={() => document.getElementById("project-backup-input")?.click()} className="h-7 w-7 p-0 text-ribbon-dark"><FileUp className="size-4" /></Button>
      <Button variant="ghost" disabled={busy || !current} title={text.exportBackup} aria-label={text.exportBackup} onClick={() => { if (current) downloadJson(current, "AIM-project-backup.json"); }} className="h-7 w-7 p-0 text-ribbon-dark"><FileDown className="size-4" /></Button>
      <input aria-label={text.search} placeholder={text.search} value={query} onChange={(e) => setQuery(e.target.value)} className="field ml-auto h-7 w-40" />
    </div>
    <div className="min-h-0 flex-1 overflow-auto"><table className="w-full text-left text-xs"><thead className="catalog-panel-heading sticky top-0"><tr><th className="w-12 px-3 py-2" /><th className="w-44 px-3 py-2">{text.date}</th><th className="px-3 py-2">{text.name}</th></tr></thead><tbody>{backups.filter((b) => `${b.name} ${b.createdAt}`.toLowerCase().includes(query.toLowerCase())).map((b) => <tr key={b.id} onClick={() => setSelected(b.id)} onDoubleClick={() => { if (!busy) restore(b); }} className={`h-9 cursor-pointer border-b border-border ${selected === b.id ? "bg-selection" : "hover:bg-accent"}`}><td className="px-3"><input aria-label={b.name} type="radio" checked={selected === b.id} onChange={() => setSelected(b.id)} /></td><td className="px-3">{new Date(b.createdAt).toLocaleString(lang)}</td><td className="px-3">{b.name}</td></tr>)}</tbody></table>{!backups.length && <p className="p-6 text-center text-xs text-muted-foreground">{text.noBackups}</p>}</div>
    {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
    <div className="aim-blue-band flex justify-end gap-2 p-2"><Button className="aim-dialog-button" disabled={busy || !current} onClick={() => { if (current) restore(current); }}><RotateCcw className="mr-1 size-3.5" />{text.restore}</Button><Button className="aim-dialog-button" disabled={busy} onClick={onClose}>{t.close}</Button></div>
    <input id="project-backup-input" type="file" accept=".json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void run(async () => onImport(parseBackup(JSON.parse(await file.text()), path))); }} />
  </DialogContent></Dialog>;
}