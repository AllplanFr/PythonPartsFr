import { useState } from "react";
import { VobRuleTree, VOB_COLUMN_WIDTHS } from "./VobRuleTree";
import { VOB_COLUMNS, type VobColumn } from "@/lib/vob-view";
import type { VobRule } from "@/lib/vob-editor";

/** Full read-only document; local geometry never changes editor settings. */
export function VobRulePreview({ rules, groupBy, columns, display, displayIndex }: {
  rules: VobRule[]; groupBy: VobColumn; columns: [VobColumn, string][];
  display: (rule: VobRule, column: VobColumn) => string;
  displayIndex: (rule: VobRule, column: VobColumn) => string;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<Partial<Record<VobColumn, number>>>({});
  return <VobRuleTree rows={rules} groupBy={groupBy} columns={columns} visible={VOB_COLUMNS.filter((c) => c !== "comment")}
    widths={VOB_COLUMN_WIDTHS} savedWidths={widths} onResize={(key, width) => setWidths((old) => ({ ...old, [key]: width }))}
    closed={closed} onToggle={(value) => setClosed((old) => { const next = new Set(old); if (next.has(value)) next.delete(value); else next.add(value); return next; })}
    selected={[]} onSelect={() => {}} display={display} displayIndex={displayIndex} unset="<undefined>" actions={false} />;
}