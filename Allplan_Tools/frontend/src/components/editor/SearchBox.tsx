import { ChoiceCombo } from "./ChoiceCombo";
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ATTRIBUTE_CATALOG, matchNode, makeTester, useCatalog, type NodeType, type SearchOpts } from "@/lib/catalog-store";
import { useT } from "@/lib/i18n";
import { NodeIcon } from "./NodeIcon";

const TYPES: NodeType[] = ["folder", "group", "component", "link"];

/** Search field with an options panel: element types, scope, mode, case, formula errors and replace. */
type Props = { value: string; onChange: (v: string) => void; opts: SearchOpts; onOpts: (o: Partial<SearchOpts>) => void; nodes: Record<string, import("@/lib/catalog-store").CatalogNode>; readOnly?: boolean };

export function SearchBox({ external }: { external?: Props } = {}) {
  const t = useT();
  const cat = useCatalog();
  const search = external?.value ?? cat.search, setSearch = external?.onChange ?? cat.setSearch, o = external?.opts ?? cat.searchOpts, setSearchOpts = external?.onOpts ?? cat.setSearchOpts, nodes = external?.nodes ?? cat.nodes, replaceAll = cat.replaceAll;
  const [repl, setRepl] = useState("");
  const [msg, setMsg] = useState("");
  const count = useMemo(() => {
    if (!search.trim() && !o.errorsOnly) return null;
    const test = makeTester(search.trim(), o);
    let c = 0; for (const n of Object.values(nodes)) if (matchNode(n, search, o, test)) c++;
    return c;
  }, [nodes, search, o]);
  const active = o.errorsOnly || o.scope !== "title" || o.mode !== "contains" || o.matchCase || o.types.length < 4;
  const toggleType = (ty: NodeType) => setSearchOpts({ types: o.types.includes(ty) ? o.types.filter((x) => x !== ty) : [...o.types, ty] });
  const radio = (v: SearchOpts["scope"], label: string, extra?: React.ReactNode) => (
    <label className="flex h-7 cursor-pointer items-center gap-2">
      <input type="radio" checked={o.scope === v} onChange={() => setSearchOpts({ scope: v })} className="accent-[var(--ribbon-dark)]" />
      <span className="flex-1">{label}</span>{extra}
    </label>
  );
  const h = "mb-1.5 mt-3 text-xs font-semibold first:mt-0";

  return (
    <div className="flex h-6 min-w-0 items-center border border-border bg-background">
      {o.errorsOnly && <TriangleAlert className="ml-1.5 h-3.5 w-3.5 shrink-0 text-destructive" />}
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search")}
        className="h-full w-56 min-w-0 bg-transparent px-2 text-xs outline-none" />
      {count !== null && <span className="shrink-0 px-1 text-[10px] text-muted-foreground">{t("results", { n: count })}</span>}
      {(search || o.errorsOnly) && <button title={t("reset")} onClick={() => { setSearch(""); setSearchOpts({ errorsOnly: false }); }} className="px-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
      <Search className="mx-1 h-4 w-4 shrink-0 text-muted-foreground" />
      <Popover>
        <PopoverTrigger asChild>
          <button title={t("searchOpts")} className={`flex h-full w-7 items-center justify-center border-l border-border hover:bg-selection ${active ? "bg-selection text-ribbon-dark" : "text-muted-foreground"}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] rounded-sm p-3 text-xs">
          <div className={h}>{t("elemType")}</div>
          <div className="flex gap-1">
            {TYPES.map((ty) => (
              <button key={ty} title={t(ty)} onClick={() => toggleType(ty)}
                className={`flex h-8 w-10 items-center justify-center rounded-sm border ${o.types.includes(ty) ? "border-ribbon-dark bg-selection" : "border-border opacity-40"}`}>
                <NodeIcon type={ty} />
              </button>
            ))}
          </div>

          <div className={h}>{t("searchIn")}</div>
          {radio("title", t("inTitles"))}
          {radio("all", t("inAll"))}
          {radio("attr", t("inAttr"), (
            <ChoiceCombo label={t("inAttr")} className="h-6 w-36" value={String(o.attrNum)} onChange={(value) => setSearchOpts({ attrNum: Number(value), scope: "attr" })} options={ATTRIBUTE_CATALOG.map((a) => ({ value: String(a.num), label: `${a.num} — ${a.name}` }))} />
          ))}
          {radio("attrNum", t("attrNumber"))}

          <div className={h}>{t("searchMode")}</div>
          <ChoiceCombo label={t("searchMode")} className="w-full" value={o.mode} onChange={(value) => { if (value === "contains" || value === "starts" || value === "equals" || value === "regex") setSearchOpts({ mode: value }); }} options={[{ value: "contains", label: t("mContains") }, { value: "starts", label: t("mStarts") }, { value: "equals", label: t("mEquals") }, { value: "regex", label: t("mRegex") }]} />
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={o.matchCase} onChange={(e) => setSearchOpts({ matchCase: e.target.checked })} />{t("matchCase")}</label>
          <label className="mt-1.5 flex items-center gap-2"><input type="checkbox" checked={o.errorsOnly} onChange={(e) => setSearchOpts({ errorsOnly: e.target.checked })} />
            <TriangleAlert className="h-3.5 w-3.5 text-destructive" />{t("errorsOnly")}</label>

          {!external?.readOnly && <><div className={h}>{t("replace")}</div>
          <div className="flex gap-1">
            <input value={repl} onChange={(e) => setRepl(e.target.value)} className="h-7 min-w-0 flex-1 border border-border bg-background px-2 outline-none focus:border-ribbon-dark" />
            <button disabled={!search.trim() || o.scope === "attrNum"} onClick={() => setMsg(t("replaced", { n: replaceAll(search.trim(), repl) }))}
              className="h-7 border border-border bg-panel px-3 hover:bg-selection disabled:opacity-40">{t("replaceAll")}</button>
          </div>
          {msg && <div className="mt-1 text-muted-foreground">{msg}</div>}</>}

          <div className="mt-3 flex justify-end border-t border-border pt-2">
            <button onClick={() => setSearchOpts({ types: TYPES, scope: "title", mode: "contains", matchCase: false, errorsOnly: false })}
              className="h-7 border border-border bg-panel px-3 hover:bg-selection">{t("reset")}</button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
