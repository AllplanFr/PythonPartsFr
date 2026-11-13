import { useMemo, useState } from "react";
import { create } from "zustand";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCatalog } from "@/lib/catalog-store";
import { linkUsage, nodePath, wouldCycle } from "@/lib/links";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";
import { DIALOG_BTN } from "./FormulaTools";

/** Open with a link id to retarget it, or with null to create a new link at the selection. */
export const useLinkDialog = create<{ open: boolean; linkId: string | null; show: (linkId?: string | null) => void; close: () => void }>((set) => ({
  open: false, linkId: null,
  show: (linkId = null) => set({ open: true, linkId }),
  close: () => set({ open: false, linkId: null }),
}));

export function LinkDialog() {
  const t = useT();
  const { open, linkId, close } = useLinkDialog();
  const nodes = useCatalog((s) => s.nodes);
  const selected = useCatalog((s) => s.selected);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  // Ouvrage that will contain the link: retargeted link's parent, or the selection's ouvrage.
  const host = useMemo(() => {
    const base = linkId ? nodes[linkId] : nodes[selected[0] ?? ""];
    if (!base) return null;
    if (linkId) return base.parentId;
    return base.type === "group" ? base.id : base.type === "component" || base.type === "link" ? base.parentId : null;
  }, [nodes, selected, linkId]);
  const current = linkId ? nodes[linkId]?.name.trim() : undefined;
  const usage = useMemo(() => linkUsage(nodes), [nodes]);
  const groups = useMemo(() => Object.values(nodes).filter((n) => n.type === "group"), [nodes]);
  const needle = q.trim().toLowerCase();
  const match = (n: (typeof groups)[number]) => !needle || n.name.toLowerCase().includes(needle) || (n.attrs[207] ?? n.description).toLowerCase().includes(needle);
  const used = groups.filter((g) => usage.has(g.name.trim()) && match(g)).sort((a, b) => (usage.get(b.name.trim()) ?? 0) - (usage.get(a.name.trim()) ?? 0));
  const others = groups.filter((g) => !usage.has(g.name.trim()) && match(g)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 300);
  const list = [...used, ...others];
  const blocked = (id: string) => !!host && wouldCycle(nodes, host, id);

  const pick = (id: string) => {
    if (blocked(id)) return;
    const s = useCatalog.getState();
    const ok = linkId ? s.setLinkTarget(linkId, id) : !!s.addLink(id);
    if (ok) { setQ(""); close(); }
  };
  const row = (g: (typeof groups)[number], i: number) => {
    const bad = blocked(g.id); const n = usage.get(g.name.trim()) ?? 0;
    return <button key={g.id} type="button" disabled={bad} onMouseEnter={() => setHi(i)} onClick={() => pick(g.id)}
      title={bad ? t("lnkCycle") : nodePath(nodes, g.id)}
      className={`relative flex h-8 w-full items-center gap-2 px-3 text-left text-xs ${i === hi ? "bg-selection" : ""} ${bad ? "cursor-not-allowed opacity-40" : ""} ${current === g.name.trim() ? "font-semibold" : ""}`}>
      {i === hi && <span className="absolute inset-y-0 left-0 w-[3px] bg-ribbon-dark" />}
      <NodeIcon type="group" /><span className="w-32 shrink-0 truncate font-semibold">{g.name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{g.attrs[207] ?? g.description}</span>
      {n > 0 && <span className="shrink-0 rounded-sm border border-border px-1 text-[10px] text-muted-foreground">{t("lnkUses", { n })}</span>}
    </button>;
  };
  const head = (label: string, n: number) => <div className="catalog-panel-heading flex h-6 items-center justify-between px-3 text-[11px]"><span>{label}</span><span className="text-muted-foreground">{n}</span></div>;
  return <Dialog open={open} onOpenChange={(o) => { if (!o) { setQ(""); close(); } }}>
    <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
      <DialogTitle className="catalog-panel-heading px-4 py-3 pr-10 text-sm">{linkId ? t("lnkRetarget") : t("lnkCreate")}</DialogTitle>
      <DialogDescription className="px-4 pt-3 text-xs">{host ? t("lnkHint", { n: nodes[host]?.name ?? "" }) : t("lnkNoHost")}</DialogDescription>
      <div className="p-3">
        <input autoFocus value={q} placeholder={t("lnkSearch")} onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === "Enter" && list[hi]) { e.preventDefault(); pick(list[hi]!.id); }
          }}
          className="h-7 w-full border border-border bg-background px-2 text-[13px] outline-none focus:border-ribbon-dark" />
      </div>
      <div className="h-80 overflow-auto border-y border-border">
        {used.length > 0 && <>{head(t("lnkExisting"), used.length)}{used.map((g, i) => row(g, i))}</>}
        {head(t("lnkAll"), others.length)}{others.map((g, i) => row(g, used.length + i))}
        {!list.length && <div className="p-6 text-center text-xs text-muted-foreground">{t("lnkNone")}</div>}
      </div>
      <div className="secondary-dialog-footer flex justify-end px-4 py-2"><button type="button" className={DIALOG_BTN} onClick={() => { setQ(""); close(); }}>{t("cancel")}</button></div>
    </DialogContent>
  </Dialog>;
}
