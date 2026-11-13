import { z } from "zod";

export const FILL_ATTRIBUTES = [118, 111, 252, 336] as const;
export const isFillAttribute = (num: number) => FILL_ATTRIBUTES.some((n) => n === num);
export const fillRows = (type: string) => type === "6" ? [118, 336] : ["4", "2+3"].includes(type) ? [118, 111, 252] : [118, 111];
export const fillLabelKey = (type: string) => ["2", "2+3"].includes(type) ? "fillPattern" : type === "3" ? "fillColor" : type === "5" ? "fillStyle" : "fillHatching";
export function completeFillAttributes(attrs: Record<number, string>): Record<number, string> {
  if (attrs[118] === undefined) return attrs;
  const next: Record<number, string> = { ...attrs, 118: attrs[118] || "1" };
  if (next[118] === "0") return next;
  for (const num of fillRows(next[118] ?? "1")) if (next[num] === undefined || next[num] === "") next[num] = num === 336 ? "" : "0";
  return next;
}

// Allplan looks up these paths beneath STD/design or project/design, never the browser's fake path.
export const imagePathSchema = z.string().max(1024).refine((v) => !/[\x00-\x1f]/.test(v) && !/^(?:[a-z]:|[\\/]|[a-z]+:)/i.test(v) && !v.split(/[\\/]/).includes(".."));
export function shortImagePath(path: string): string | null {
  const clean = path.trim().replace(/\//g, "\\");
  const tail = clean.split(/\\design\\/i).pop() ?? clean;
  return imagePathSchema.safeParse(tail).success ? tail : null;
}
export function validFillValue(num: number, value: string, attrs: Record<number, string>): boolean {
  if (num === 336) return imagePathSchema.safeParse(value).success;
  // Portable compound mode; PythonPart must supply its Allplan enum mapping.
  if (num === 118 && value === "2+3") return true;
  if (!/^\d+$/.test(value)) return false;
  const id = Number(value);
  if (num === 118) return id >= 0 && id <= 6;
  if (num === 252 || num === 111 && ["1", "2", "3", "4", "2+3"].includes(attrs[118] ?? "1")) return id >= 0 && id <= 255;
  return num === 111 && Number.isSafeInteger(id) && id >= 0;
}
export function toggleFillMode(current: string, choice: string): string {
  const base = current === "4" ? "1" : current === "2+3" ? "2" : current;
  const combined = current === "4" || current === "2+3";
  if (choice === "3" && (base === "1" || base === "2")) return combined ? base : base === "1" ? "4" : "2+3";
  if ((choice === "1" || choice === "2") && (combined || base === "3")) return choice === "1" ? "4" : "2+3";
  return choice;
}
