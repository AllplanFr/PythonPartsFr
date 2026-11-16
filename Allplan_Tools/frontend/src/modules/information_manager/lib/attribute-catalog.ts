/**
 * Liste des attributs disponibles, reçue d'Allplan (data.catalog).
 */
export type CatalogEntry = { num: number; name: string; widget: "entry" | "list"; type: "STR" | "INT" | "FLOAT" | "DATE"; options?: string[] };

/** Active catalog: replaced by the list received from Allplan (data.catalog), empty until received. */
export let CATALOG: CatalogEntry[] = [];

const CAT_TYPES = ["STR", "INT", "FLOAT", "DATE"] as const;

/** Sets the catalog from Allplan. Keeps the current list when input is not an array. */
export function setCatalog(input: unknown): void {
  if (!Array.isArray(input)) return;
  const seen = new Set<number>();
  const out: CatalogEntry[] = [];
  for (const e of input as { num?: unknown; name?: unknown; widget?: unknown; type?: unknown; options?: unknown }[]) {
    const num = Number(e?.num);
    if (!Number.isInteger(num) || seen.has(num)) continue;
    seen.add(num);
    const widget = e?.widget === "list" ? "list" : "entry";
    const t = String(e?.type ?? "").toUpperCase();
    const type = widget === "list" ? "STR" : ((CAT_TYPES as readonly string[]).includes(t) ? (t as CatalogEntry["type"]) : "STR");
    out.push({ num, name: String(e?.name ?? ""), widget, type,
      ...(widget === "list" ? { options: Array.isArray(e?.options) ? (e.options as unknown[]).map(String) : [] } : {}) });
  }
  CATALOG = out.sort((a, b) => a.num - b.num);
}
