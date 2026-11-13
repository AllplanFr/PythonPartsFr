import type { Lang } from "./catalog-store";
import { translateRoomText } from "./room-translations";

/** Room bundle: 231 enclosure, 235 occupancy, 232 DIN 277 area type, 266 DIN 277 factor, 233 floor-space type (index), 264 floor-space factor. */
export const ROOM_ATTRIBUTES = [231, 235, 232, 266, 233, 264] as const;
export const isRoomAttribute = (num: number) => ROOM_ATTRIBUTES.some((n) => n === num);
export const ROOM_DEFAULTS: Record<number, string> = { 231: "R", 235: "", 232: "", 266: "1.000", 233: "0", 264: "1.000" };

type L = Exclude<Lang, never>;
const by = (o: Record<string, string[]>) => o as Record<L, string[]>;
const R231 = ["R", "S", "a", "b", "c", "bc"];
const R235 = by({
  fr: ["SU", "SIT", "SD", "SU 1", "SU 2", "SU 3", "SU 4", "SU 5", "SU 6", "SU 7", "SU", "SU 1", "SU 2", "SU 3", "SU 4", "SU 5", "SU 6", "SU 7"],
  en: ["USA", "TA", "CA", "USA 1", "USA 2", "USA 3", "USA 4", "USA 5", "USA 6", "USA 7", "UA", "UA 1", "UA 2", "UA 3", "UA 4", "UA 5", "UA 6", "UA 7"],
  de: ["NUF", "TF", "VF", "NUF 1", "NUF 2", "NUF 3", "NUF 4", "NUF 5", "NUF 6", "NUF 7", "NF", "NF 1", "NF 2", "NF 3", "NF 4", "NF 5", "NF 6", "NF 7"],
  it: ["SPU", "ST", "SC", "SPU 1", "SPU 2", "SPU 3", "SPU 4", "SPU 5", "SPU 6", "SPU 7", "SU", "SU 1", "SU 2", "SU 3", "SU 4", "SU 5", "SU 6", "SU 7"],
  es: ["SU", "SF", "ST", "SU 1", "SU 2", "SU 3", "SU 4", "SU 5", "SU 6", "SU 7", "SN", "SUP 1", "SUP 2", "SUP 3", "SUP 4", "SUP 5", "SUP 6", "SUP 7"],
  hr: ["NUF", "UP", "TP", "NUF 1", "NUF 2", "NUF 3", "NUF 4", "NUF 5", "NUF 6", "NUF 7", "NP", "GKP 1", "GKP 2", "GKP 3", "GKP 4", "GKP 5", "GKP 6", "GKP 7"],
  ro: ["AE", "ST", "CI", "AE 1", "AE 2", "AE 3", "AE 4", "AE 5", "AE 6", "AE 7", "SL", "ZFP 1", "ZFP 2", "ZFP 3", "ZFP 4", "ZFP 5", "ZFP 6", "ZFP 7"],
  ru: ["ПОП", "ТП", "ПД", "ПОП 1", "ПОП 2", "ПОП 3", "ПОП 4", "ПОП 5", "ПОП 6", "ПОП 7", "ХП", "ПП 1", "ПП 2", "ПП 3", "ПП 4", "ПП 5", "ПП 6", "ПП 7"],
  cs: ["NUP", "TP", "DP", "NUP 1", "NUP 2", "NUP 3", "NUP 4", "NUP 5", "NUP 6", "NUP 7", "UP", "UP1", "UP2", "UP3", "UP4", "UP5", "UP6", "UP7"],
  sl: ["UP", "TP", "KP", "UP 1", "UP 2", "UP 3", "UP 4", "UP 5", "UP 6", "UP 7", "GUP", "GUP1", "GUP2", "GUP3", "GUP4", "GUP5", "GUP6", "GUP7"],
  sk: ["NUP", "TP", "DP", "NUP 1", "NUP 2", "NUP 3", "NUP 4", "NUP 5", "NUP 6", "NUP 7", "UP", "UP1", "UP2", "UP3", "UP4", "UP5", "UP6", "UP7"],
});
const NML = ["N", "M", "L"];
const R232 = by({ fr: NML, en: NML, de: NML, it: NML, es: NML, hr: ["N", "M", "D"], ro: NML, ru: ["Н", "M", "Л"], cs: NML, sl: NML, sk: NML });
const R233 = by({
  fr: ["SH", "SA", "SE", "NH"], en: ["LI", "SS", "ES", "NL"], de: ["WO", "ZU", "WI", "KW"], it: ["WO", "ZU", "WI", "KW"], es: ["SH", "SA", "SU", "SS"],
  hr: ["PP", "DP", "EP", "NP"], ro: ["SL", "SA", "SC", "SN"], ru: ["ЖП", "ДП", "ХП", "НЖ"], cs: ["OP", "PP", "HP", "BP"], sl: ["SP", "DP", "NS", "KP"], sk: ["OP", "PP", "HP", "BP"],
});

/** Choice list of a room combo attribute for the interface language. */
export function roomOptions(num: number, lang: Lang): string[] {
  if (num === 231) return R231;
  const table = num === 235 ? R235 : num === 232 ? R232 : num === 233 ? R233 : null;
  return table ? table[lang] ?? table.en : [];
}

/** Resolve saved occupancy codes even when the interface language has changed. */
export function roomChoiceIndex(num: number, value: string, lang: Lang): number {
  const options = roomOptions(num, lang);
  const match = (items: string[]) => items.findIndex((item) => item.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  const local = match(options);
  if (local >= 0 || !value.trim()) return local;
  if (num === 235) {
    for (const items of Object.values(R235)) {
      const index = match(items);
      if (index >= 0) return index;
    }
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < options.length) return index;
  }
  return -1;
}

/** 233 is stored as its index; the others store the displayed code. */
export const ROOM_INDEXED = (num: number) => num === 233;

export function completeRoomAttributes(attrs: Record<number, string>): Record<number, string> {
  if (!ROOM_ATTRIBUTES.some((n) => attrs[n] !== undefined)) return attrs;
  const next = { ...attrs };
  for (const n of ROOM_ATTRIBUTES) if (next[n] === undefined) next[n] = ROOM_DEFAULTS[n] ?? "";
  return next;
}

type Txt = { en: string; fr: string };
/** Explanations from Allplan's 231 / 235 / 233 help dialogs. */
export const ENCLOSURE_INFO: Record<string, Txt> = {
  R: { en: "Rooms and floor areas completely enclosed on all sides", fr: "Pièces et surfaces entièrement fermées de tous côtés" },
  S: { en: "Connected with the structure but not completely enclosed on all sides", fr: "Reliées à la construction mais pas entièrement fermées" },
  a: { en: "Covered and enclosed on all sides at full height", fr: "Couvert et fermé sur toute la hauteur" },
  b: { en: "Covered but not enclosed at full height", fr: "Couvert mais pas fermé sur toute la hauteur" },
  c: { en: "Not covered", fr: "Non couvert" },
  bc: { en: "Partly covered", fr: "Partiellement couvert" },
};
/** 235 occupancy: index → category and group. */
export const USE_INFO: { cat: "usage" | "tech" | "circ" | "net"; group: Txt }[] = [
  { cat: "usage", group: { en: "Usage area (all groups)", fr: "Surface utile (tous groupes)" } },
  { cat: "tech", group: { en: "Technical facilities", fr: "Installations techniques" } },
  { cat: "circ", group: { en: "Horizontal and vertical infrastructure", fr: "Circulations horizontales et verticales" } },
  ...([["Living and recreation", "Habitation et séjour"], ["Office work", "Travail de bureau"], ["Production, manual and machine work, research", "Production, travail manuel et machine, recherche"], ["Storing, distributing and selling", "Stockage, distribution et vente"], ["Education, training and culture", "Éducation, formation et culture"], ["Nursing", "Soins"], ["Other usage", "Autres usages"]] as const)
    .map(([en, fr]) => ({ cat: "usage" as const, group: { en, fr } })),
  { cat: "net", group: { en: "Net area (all groups)", fr: "Surface nette (tous groupes)" } },
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ cat: "net" as const, group: { en: `Net area – group ${n}`, fr: `Surface nette – groupe ${n}` } })),
];
export const USE_CATS: Record<string, Txt> = { usage: { en: "Usage area", fr: "Surface utile" }, tech: { en: "Technical area", fr: "Surface technique" }, circ: { en: "Circulation area", fr: "Circulation" }, net: { en: "Net room area", fr: "Surface nette" } };
export const AREA_INFO: Txt[] = [{ en: "Normal height", fr: "Hauteur normale" }, { en: "Reduced height", fr: "Hauteur réduite" }, { en: "Low height (not counted)", fr: "Faible hauteur (non comptée)" }];
export const LIVING_INFO: { title: Txt; text: Txt }[] = [
  { title: { en: "Living space", fr: "Surface habitable" }, text: { en: "Living rooms, winter gardens, indoor pools, balconies, loggias, terraces. Excludes stairs > 3 rises and landings.", fr: "Pièces de vie, jardins d'hiver, piscines intérieures, balcons, loggias, terrasses. Hors escaliers > 3 marches et paliers." } },
  { title: { en: "Secondary space", fr: "Surface annexe" }, text: { en: "Cellars, laundries, storage outside the flat, attics, drying and heating rooms, garages.", fr: "Caves, buanderies, rangements hors logement, combles, séchoirs, chaufferies, garages." } },
  { title: { en: "Economic space", fr: "Surface économique" }, text: { en: "Storage rooms, bakeries, smoking chambers, stables, barns, closets (not valid in new regulations).", fr: "Réserves, fournils, fumoirs, étables, granges, placards (plus valable dans la nouvelle réglementation)." } },
  { title: { en: "No living space", fr: "Pas de surface habitable" }, text: { en: "Shops, business premises, offices (→ DIN 277). Quantity takeoff only.", fr: "Commerces, locaux d'activité, bureaux (→ DIN 277). Métré uniquement." } },
];
export const txt = (x: Txt, lang: Lang) => lang === "fr" ? x.fr : translateRoomText(x.en, lang) ?? x.en;

/** Clickable zones of the building section (SVG units 0-580 × 0-500); values applied: 231, 235 index, 233 index. */
export interface RoomPreset { id: string; label: Txt; x: number; y: number; w: number; h: number; enclosure: string; use: number; living: number }
export const ROOM_PRESETS: RoomPreset[] = [
  { id: "attic", label: { en: "Attic", fr: "Comble" }, x: 268, y: 95, w: 106, h: 75, enclosure: "R", use: 0, living: 1 },
  { id: "bath", label: { en: "Bathroom", fr: "Salle de bains" }, x: 175, y: 120, w: 90, h: 50, enclosure: "R", use: 3, living: 0 },
  { id: "store", label: { en: "Roof space", fr: "Sous-toiture" }, x: 385, y: 120, w: 100, h: 50, enclosure: "S", use: 0, living: 1 },
  { id: "living", label: { en: "Living room", fr: "Séjour" }, x: 135, y: 175, w: 238, h: 72, enclosure: "R", use: 3, living: 0 },
  { id: "loggia", label: { en: "Loggia", fr: "Loggia" }, x: 378, y: 175, w: 104, h: 72, enclosure: "S", use: 3, living: 0 },
  { id: "balcony1", label: { en: "Balcony", fr: "Balcon" }, x: 42, y: 205, w: 86, h: 42, enclosure: "S", use: 3, living: 0 },
  { id: "office", label: { en: "Office", fr: "Bureau" }, x: 135, y: 253, w: 238, h: 72, enclosure: "R", use: 4, living: 3 },
  { id: "terrace", label: { en: "Terrace", fr: "Terrasse" }, x: 378, y: 253, w: 104, h: 72, enclosure: "S", use: 3, living: 0 },
  { id: "balcony2", label: { en: "Balcony", fr: "Balcon" }, x: 42, y: 285, w: 86, h: 40, enclosure: "S", use: 3, living: 0 },
  { id: "corridor", label: { en: "Corridor", fr: "Couloir" }, x: 135, y: 331, w: 238, h: 74, enclosure: "R", use: 2, living: 0 },
  { id: "hall", label: { en: "Entrance", fr: "Entrée" }, x: 378, y: 331, w: 104, h: 74, enclosure: "S", use: 2, living: 3 },
  { id: "heating", label: { en: "Heating", fr: "Chauffage" }, x: 135, y: 411, w: 238, h: 76, enclosure: "R", use: 1, living: 1 },
  { id: "garage", label: { en: "Garage", fr: "Garage" }, x: 378, y: 411, w: 104, h: 76, enclosure: "S", use: 0, living: 1 },
  { id: "stairs", label: { en: "Stairs", fr: "Escalier" }, x: 42, y: 411, w: 86, h: 76, enclosure: "S", use: 2, living: 3 },
];
