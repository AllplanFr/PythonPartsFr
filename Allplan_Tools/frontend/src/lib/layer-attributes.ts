import reference from "./allplan-layer-reference.json";
export const LAYER_ATTRIBUTES = [141, 349, 346, 345, 347] as const;
export const isLayerAttribute = (num: number) => LAYER_ATTRIBUTES.some((n) => n === num);
export const LAYERS = reference.layers;
export const PEN_THICKNESSES = reference.pens;
export const LINE_TYPES = reference.lines;
export const LINE_COLORS = reference.colors;
export const LAYER_DEFAULTS: Record<number, string> = { 141: "0", 349: "0", 346: "1", 345: "1", 347: "1" };
export const INHERIT_BITS: Record<number, number> = { 346: 1, 345: 2, 347: 4 };
export function completeLayerAttributes(attrs: Record<number, string>): Record<number, string> {
  if (!LAYER_ATTRIBUTES.some((num) => attrs[num] !== undefined)) return attrs;
  const next = { ...attrs };
  for (const num of LAYER_ATTRIBUTES) if (next[num] === undefined || next[num] === "") next[num] = LAYER_DEFAULTS[num] ?? "0";
  if (next[141] === "0") next[349] = "0";
  return next;
}
export function layerValue(num: number, attrs: Record<number, string>): string {
  const layer = LAYERS.find((l) => l.id === Number(attrs[141]));
  const bit = INHERIT_BITS[num] ?? 0;
  if (layer && layer.id !== 0 && bit && (Number(attrs[349]) & bit)) return String(num === 346 ? layer.pen : num === 345 ? layer.line : layer.color);
  return attrs[num] ?? LAYER_DEFAULTS[num] ?? "0";
}
export function validLayerValue(num: number, value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const id = Number(value);
  if (num === 141) return LAYERS.some((l) => l.id === id);
  if (num === 349) return id >= 0 && id <= 7;
  if (num === 346) return PEN_THICKNESSES.some((p) => p.id === id);
  if (num === 345) return LINE_TYPES.some((l) => l.id === id);
  return num === 347 && id >= 0 && id <= 255;
}