/** Separate opt-in picker contract; never part of presentation/work capability lists. */
export function iconSelectAvailable(info: unknown): boolean {
  return !!info && typeof info === "object" && "icon_select_contract" in info && info.icon_select_contract === 1;
}
export function absoluteIconPath(value: unknown): value is string {
  return typeof value === "string" && (/^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value) || value.startsWith("/"));
}
export type IconSelection = { ok: true; status: "selected"; icon: string; path: string } | { ok: true; status: "cancelled" } | { ok: false; error: { code: string; message: string } };
export function parseIconSelection(value: unknown): IconSelection {
  if (value && typeof value === "object" && "ok" in value) {
    const v = value as Record<string, unknown>;
    if (v['ok'] === true && v['status'] === "cancelled" && Object.keys(v).length === 2) return { ok: true, status: "cancelled" };
    if (v['ok'] === true && v['status'] === "selected" && Object.keys(v).length === 4 && typeof v['icon'] === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(v['icon']) && absoluteIconPath(v['path'])) return { ok: true, status: "selected", icon: v['icon'], path: v['path'] };
    if (v['ok'] === false && Object.keys(v).length === 2 && v['error'] && typeof v['error'] === "object") {
      const error = v['error'] as Record<string, unknown>;
      if (Object.keys(error).length === 2 && typeof error['code'] === "string" && typeof error['message'] === "string") return { ok: false, error: { code: error['code'], message: error['message'] } };
    }
  }
  throw new Error("Réponse incompatible du sélecteur d’icône ; icône conservée.");
}
export async function selectNativeIcon(currentIconPath?: string): Promise<IconSelection> {
  const api = (globalThis as unknown as { pywebview?: { api?: { call?: (command: string, payload: Record<string, unknown>) => Promise<unknown> } } }).pywebview?.api;
  if (typeof api?.call !== "function") throw new Error("Sélecteur natif indisponible ; icône conservée.");
  return parseIconSelection(await api.call("aim.icon.select", absoluteIconPath(currentIconPath) ? { currentIconPath } : {}));
}