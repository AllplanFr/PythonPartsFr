import { Columns3, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const COLUMN_KEYS = ["num", "title", "input", "data"] as const;
export type ColumnKey = typeof COLUMN_KEYS[number];
/** The reference view shows Number, Title, Value, Input and Data; Value is always visible. */
export const DEFAULT_COLUMNS: ColumnKey[] = ["num", "title", "input", "data"];

/** VOB Editor style "Columns" menu: each column toggled separately, at least one stays visible. */
export function ColumnsMenu({ label, value, onChange, options }: { label: string; value: ColumnKey[]; onChange: (v: ColumnKey[]) => void; options: [ColumnKey, string][] }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label={label} title={label} className="h-8 gap-2 rounded-sm px-2 text-xs"><Columns3 className="h-4 w-4 text-ribbon-dark" />{label}<span className="text-[10px] text-muted-foreground">{value.length}/{options.length}</span><ChevronDown className="h-3 w-3 text-muted-foreground" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-52 rounded-sm"><DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>{options.map(([key, name]) => <DropdownMenuCheckboxItem key={key} className="text-xs" checked={value.includes(key)} disabled={value.length === 1 && value[0] === key} onSelect={(e) => e.preventDefault()} onCheckedChange={(checked) => onChange(options.map(([c]) => c).filter((c) => c === key ? checked : value.includes(c)))}>{name}</DropdownMenuCheckboxItem>)}</DropdownMenuContent>
  </DropdownMenu>;
}

type Row = { num: number; group?: string | undefined; cat?: string | undefined };
/**
 * Placement of a new attribute: selected group -> first child of that group;
 * selected row in the same container -> right after it; otherwise first position of its container.
 */
export function insertAttribute<T extends Row>(rows: T[], item: T, selectedGroup: string | null, selectedRow: number | null): T[] {
  const out = rows.filter((r) => r.num !== item.num);
  const g = item.group ?? "";
  const sel = selectedRow === null ? -1 : out.findIndex((r) => r.num === selectedRow);
  let at: number;
  if (selectedGroup && selectedGroup === g) at = out.findIndex((r) => (r.group ?? "") === g);
  else if (sel >= 0 && (out[sel]!.group ?? "") === g) at = sel + 1;
  else at = out.findIndex((r) => (r.group ?? "") === g && (g || r.cat === item.cat));
  out.splice(at < 0 ? 0 : at, 0, item);
  return out;
}
