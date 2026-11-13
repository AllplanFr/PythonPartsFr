import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCatalog, type InsertionPlacement } from "@/lib/catalog-store";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";
import { DIALOG_BTN } from "./FormulaTools";

/** Mini tree drawing so beginners can see where the new folder will land. */
function Preview({ target, child }: { target: string; child: boolean }) {
  const t = useT();
  const row = (label: string, depth: number, isNew = false, muted = false) => (
    <div className={`flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-xs ${isNew ? "drop-preview font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`} style={{ marginLeft: depth * 18 }}>
      <NodeIcon type="folder" /><span className="truncate">{label}</span>
    </div>
  );
  return <div className="space-y-1 rounded-sm border border-border bg-background p-2">
    {row(target, 0)}
    {child ? <>{row(t("insertionNew"), 1, true)}{row("…", 1, false, true)}</> : <>{row("…", 1, false, true)}{row(t("insertionNew"), 0, true)}</>}
  </div>;
}

export function InsertionDialog() {
  const pending = useCatalog((s) => s.insertionChoice);
  const target = useCatalog((s) => pending ? s.nodes[pending.targetId] : undefined);
  const choose = useCatalog((s) => s.chooseInsertion);
  const t = useT(); const name = target?.name ?? "";
  const card = (where: InsertionPlacement, key: string, title: string, hint: string) => (
    <button type="button" onClick={() => choose(where)}
      className="group flex flex-col gap-2 rounded-md border border-border bg-panel p-3 text-left transition-colors hover:border-ribbon-dark hover:bg-selection/40 focus-visible:border-ribbon-dark focus-visible:outline-none">
      <div className="flex items-center gap-2"><kbd className="rounded-sm border border-border bg-background px-1.5 text-[10px] text-muted-foreground">{key}</kbd><span className="text-sm font-semibold">{title}</span></div>
      <Preview target={name} child={where === "child"} />
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </button>
  );
  return <Dialog open={!!pending} onOpenChange={(open) => { if (!open) choose(null); }}>
    <DialogContent className="max-w-xl gap-0 overflow-hidden p-0" onKeyDown={(e) => { if (e.key === "1") choose("child"); else if (e.key === "2") choose("sibling"); }}>
      <DialogTitle className="catalog-panel-heading px-4 py-3 pr-10 text-sm">{t("insertionTitle")}</DialogTitle>
      <DialogDescription className="px-4 pt-3 text-xs">{t("insertionTarget", { n: name })}</DialogDescription>
      <div className="grid grid-cols-2 gap-3 p-4">
        {card("child", "1", t("insertionChild"), t("insertionChildHint", { n: name }))}
        {card("sibling", "2", t("insertionSibling"), t("insertionSiblingHint", { n: name }))}
      </div>
      <div className="secondary-dialog-footer flex justify-end px-4 py-2"><button type="button" className={DIALOG_BTN} onClick={() => choose(null)}>{t("cancel")}</button></div>
    </DialogContent>
  </Dialog>;
}
