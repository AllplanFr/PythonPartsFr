import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CatalogNode } from "@/lib/catalog-store";
import type { TreeContextRow } from "@/lib/tree-sticky";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";

export function StickyTreeParents({ rows, nodes, column, selected, onSelect, onCollapse }: {
  rows: TreeContextRow[]; nodes: Record<string, CatalogNode>; scrollTop: number; column: string;
  selected: string[]; onSelect: (id: string) => void; onCollapse: (id: string) => void;
}) {
  const t = useT();
  if (!rows.length) return null;
  return <div className="sticky top-0 z-20 h-0">
    <div data-sticky-parents className="absolute left-0 right-0 top-0 isolate overflow-hidden border-b border-border bg-panel">
    {rows.map((row) => {
      const n = nodes[row.id];
      if (!n) return null;
      return <div key={row.id} data-sticky-parent={n.id} className={`relative flex h-8 items-center border-b border-border/50 ${selected.includes(n.id) ? "catalog-selected-row bg-selection" : "bg-panel"}`}>
        <div className="flex h-full min-w-0 shrink-0 items-center gap-1" style={{ width: column, paddingLeft: 4 + row.depth * 16 }}>
          <Button variant="ghost" size="icon" className="h-6 w-5 shrink-0 p-0" aria-label={`${t("collapseAll")} — ${n.name}`} onClick={() => onCollapse(n.id)}><ChevronDown className="h-3 w-3" /></Button>
          <NodeIcon node={n} />
          <Button variant="ghost" title={n.name} className="h-full min-w-0 flex-1 justify-start rounded-none px-1 text-xs font-semibold hover:bg-selection" onClick={() => onSelect(n.id)}><span className="truncate">{n.name}</span></Button>
        </div>
        <Button variant="ghost" title={n.description} className="h-full min-w-0 flex-1 justify-start rounded-none px-2 text-xs font-normal text-muted-foreground hover:bg-selection" onClick={() => onSelect(n.id)}><span className="truncate">{n.description}</span></Button>
        <span className="w-14 shrink-0 pr-2 text-right text-[10px] text-muted-foreground">{n.children?.length ?? 0}</span>
      </div>;
    })}
    </div>
  </div>;
}
