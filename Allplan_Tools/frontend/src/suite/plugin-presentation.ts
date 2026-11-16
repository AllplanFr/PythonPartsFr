/** Editorial plugin sheets: src/suite/plugin-sheets/<plugin-id>.<fra|eng|ita|deu|spa> (UTF-8 JSON).
 * Chosen from the app interface language; a missing language falls back explicitly to .eng.
 * Versions, installation, capabilities and update state are host-owned and never read from sheets. */
const files = import.meta.glob("./plugin-sheets/*.*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const SHEET_LANGUAGE: Record<string, string> = { fr: "fra", en: "eng", it: "ita", de: "deu", es: "spa" };
export const SHEET_FALLBACK = "eng";

export type SheetLabels = Record<"overview" | "features" | "screenshots" | "credits" | "sources" | "git" | "lovable", string>;
export type PluginSheet = { language: string; fallback: boolean; labels: SheetLabels; summary?: string | undefined; overview?: string | undefined; features: { title: string; text: string }[]; credits: { role: string; name: string }[]; gitUrl?: string | undefined; lovableUrl?: string | undefined; screenshots: string[] };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const read = (id: string, code: string): Record<string, unknown> | null => {
  const raw = files[`./plugin-sheets/${id}.${code}`];
  if (raw === undefined) return null;
  try { const v: unknown = JSON.parse(raw); return v && typeof v === "object" ? v as Record<string, unknown> : null; } catch { return null; }
};

export function pluginSheet(id: string, lang: string): PluginSheet | null {
  const wanted = SHEET_LANGUAGE[lang];
  let data = wanted ? read(id, wanted) : null; let language = wanted ?? SHEET_FALLBACK;
  if (!data) { data = read(id, SHEET_FALLBACK); language = SHEET_FALLBACK; } // explicit fallback: missing language sheet -> .eng
  if (!data) return null;
  const labels = (data["labels"] ?? {}) as Record<string, unknown>;
  const label = (k: keyof SheetLabels) => str(labels[k]) ?? k;
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  return {
    language, fallback: language !== wanted,
    labels: { overview: label("overview"), features: label("features"), screenshots: label("screenshots"), credits: label("credits"), sources: label("sources"), git: label("git"), lovable: label("lovable") },
    summary: str(data["summary"]), overview: str(data["overview"]),
    features: list(data["features"]).flatMap((f) => { const title = str(f["title"]); return title ? [{ title, text: str(f["text"]) ?? "" }] : []; }),
    credits: list(data["credits"]).flatMap((c) => { const name = str(c["name"]); return name ? [{ role: str(c["role"]) ?? "", name }] : []; }),
    gitUrl: str(data["gitUrl"]), lovableUrl: str(data["lovableUrl"]),
    screenshots: (Array.isArray(data["screenshots"]) ? data["screenshots"] : []).filter((s): s is string => Boolean(str(s))).slice(0, 3),
  };
}
