import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCatalog, dragFolderIcon, dragAttr } from "@/lib/catalog-store";
import { useFolderIcons, type FolderIconEntry } from "@/lib/folder-icons";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";
import { RowDragGrip } from "./RowDragGrip";

export function FolderIconPicker({ id, icon, open, onOpenChange, compact = false }: { compact?: boolean; id: string; icon?: string | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const update = useCatalog((s) => s.update);
  const { entries, record } = useFolderIcons();
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => { void useFolderIcons.persist.rehydrate(); }, []);
  const apply = (src: string, name: string) => {
    if (src !== icon) { update(id, { icon: src }); record(src, name); }
    setError(false); onOpenChange(false);
  };
  const pick = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); setError(true); onOpenChange(true); };
    img.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d");
      if (!context || !img.width || !img.height) { URL.revokeObjectURL(url); setError(true); return; }
      const scale = Math.min(64 / img.width, 64 / img.height);
      context.drawImage(img, (64 - img.width * scale) / 2, (64 - img.height * scale) / 2, img.width * scale, img.height * scale);
      URL.revokeObjectURL(url);
      apply(canvas.toDataURL("image/png"), file.name);
    };
    img.src = url;
  };
  const gallery = (items: FolderIconEntry[], label: string) => (
    <section className="space-y-2" aria-label={label}>
      <h3 className="text-xs font-semibold">{label}</h3>
      {items.length ? <div className="grid grid-cols-5 gap-2">{items.map((entry) => (
        <Button key={entry.src} variant="outline" size="icon" className={`relative h-11 w-full rounded-sm ${icon === entry.src ? "border-ribbon-dark bg-selection" : ""}`}
          title={`${entry.name} · ${t("iconUses", { n: entry.uses })}`} aria-label={`${label} — ${entry.name}`} aria-pressed={icon === entry.src} onClick={() => apply(entry.src, entry.name)}>
          <img src={entry.src} alt="" className="h-7 w-7 object-contain" />
          {icon === entry.src && <Check className="absolute bottom-0 right-0 h-3 w-3 text-ribbon-dark" />}
        </Button>
      ))}</div> : <div className="py-2 text-xs text-muted-foreground">{t("noCustomIcons")}</div>}
    </section>
  );
  const pickerContent = (
            <PopoverContent align="start" className="w-80 max-w-[calc(100vw-24px)] space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t("folderIcon")}</h2>
                <Button variant="outline" size="sm" onClick={() => ref.current?.click()}><ImagePlus />{t("chooseIcon")}</Button>
              </div>
              <Button variant="ghost" size="sm" className="w-full justify-start" aria-pressed={!icon} onClick={() => { update(id, { icon: undefined }); onOpenChange(false); }}><NodeIcon type="folder" />{t("defaultIcon")}{!icon && <Check className="ml-auto" />}</Button>
              <div className="border-t border-border" />
              {gallery([...entries].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 10), t("recentIcons"))}
              {gallery([...entries].sort((a, b) => b.uses - a.uses || b.lastUsed - a.lastUsed).slice(0, 10), t("frequentIcons"))}
              {error && <p role="alert" className="text-xs text-destructive">{t("iconLoadError")}</p>}
            </PopoverContent>
  );
  const fileInput = <input ref={ref} type="file" accept="image/*" aria-label={t("chooseIcon")} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) pick(file); e.target.value = ""; }} />;
  if (compact) return <div className="flex shrink-0" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onDragStart={(e) => e.stopPropagation()}>
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 rounded-sm p-0 hover:bg-selection" title={t("chooseFolderIcon")} aria-label={t("chooseFolderIcon")}><NodeIcon node={{ type: "folder", icon }} /></Button></PopoverTrigger>
      {pickerContent}
    </Popover>{fileInput}
  </div>;
  return (
    <div className="group/icon relative flex items-start" data-draggable-row data-folder-icon-row draggable
      onDragStart={(e) => {
        dragAttr.current = null;
        dragFolderIcon.current = id;
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "copy";
        onOpenChange(false);
      }}
      onDragEnd={() => { dragFolderIcon.current = null; }}>
      <RowDragGrip className="absolute left-0 top-1.5" />
      <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5">
        <Button variant="outline" size="icon" className="h-7 w-12 shrink-0 rounded-sm border-2 border-ribbon bg-panel" title={t("folderIcon")} aria-label={t("folderIcon")} onClick={() => onOpenChange(!open)}><NodeIcon node={{ type: "folder", icon }} /></Button>
        <div className="flex w-[min(36%,320px)] shrink-0 items-center"><span className="truncate font-semibold">{t("folderIcon")}</span></div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-7 rounded-sm" title={t("chooseFolderIcon")}><ImagePlus />{t("chooseFolderIcon")}</Button></PopoverTrigger>
            {pickerContent}
          </Popover>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={!icon} title={t("defaultIcon")} aria-label={t("defaultIcon")} onClick={() => update(id, { icon: undefined })}><RotateCcw /></Button>
        </div>
      </div>
      <div className="mr-1 w-6 shrink-0" />
      {fileInput}
    </div>
  );
}