import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChoiceCombo } from "./ChoiceCombo";
import { defaultVobSearch, type VobColumn, type VobSearchOptions } from "@/lib/vob-view";
import { useT } from "@/lib/i18n";

export function VobSearchBox({ query, onQuery, options, onOptions, columns }: { query: string; onQuery: (value: string) => void; options: VobSearchOptions; onOptions: (options: VobSearchOptions) => void; columns: [VobColumn, string][] }) {
  const t = useT();
  const active = options.columns.length !== columns.length || options.mode !== "contains" || options.matchCase || options.errorsOnly;
  const patch = (value: Partial<VobSearchOptions>) => onOptions({ ...options, ...value });
  return <div className="flex h-9 w-64 max-w-full items-center border border-border bg-background">
    <Search className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" /><Input aria-label={t("search")} placeholder={`${t("search")}…`} value={query} onChange={(e) => onQuery(e.target.value)} className="h-8 min-w-0 border-0 bg-transparent px-2 text-xs shadow-none" />
    {query && <Button variant="ghost" size="icon" className="h-8 w-6 shrink-0" aria-label={t("reset")} onClick={() => onQuery("")}><X className="h-3.5 w-3.5" /></Button>}
    <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" title={t("searchOpts")} aria-label={t("searchOpts")} className={`h-full w-8 shrink-0 rounded-none border-l border-border ${active ? "bg-selection text-ribbon-dark" : "text-muted-foreground"}`}><SlidersHorizontal className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 rounded-sm p-3 text-xs">
        <div className="font-semibold">{t("searchIn")}</div><div className="grid grid-cols-2 gap-2">{columns.map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={options.columns.includes(key)} onChange={(e) => patch({ columns: e.target.checked ? [...options.columns, key] : options.columns.filter((c) => c !== key) })} />{label}</label>)}</div>
        <div className="border-t border-border pt-3 font-semibold">{t("searchMode")}</div><ChoiceCombo label={t("searchMode")} value={options.mode} onChange={(mode) => { if (mode === "contains" || mode === "starts" || mode === "equals" || mode === "regex") patch({ mode }); }} options={[{ value: "contains", label: t("mContains") }, { value: "starts", label: t("mStarts") }, { value: "equals", label: t("mEquals") }, { value: "regex", label: t("mRegex") }]} className="w-full" />
        <label className="flex items-center gap-2"><input type="checkbox" checked={options.matchCase} onChange={(e) => patch({ matchCase: e.target.checked })} />{t("matchCase")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={options.errorsOnly} onChange={(e) => patch({ errorsOnly: e.target.checked })} />{t("errorsOnly")}</label>
        <div className="flex justify-end border-t border-border pt-2"><Button variant="outline" size="sm" onClick={() => { onQuery(""); onOptions(defaultVobSearch()); }}>{t("reset")}</Button></div>
      </PopoverContent>
    </Popover>
  </div>;
}