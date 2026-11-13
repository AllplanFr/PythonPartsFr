export interface DialogFrame { x: number; y: number; width: number; height: number }
const KEY = "smartcatalog-dialog-layouts";

export function fitDialogFrame(frame: DialogFrame, viewport: { width: number; height: number }): DialogFrame {
  const width = Math.max(1, Math.min(frame.width, viewport.width - 16));
  const height = Math.max(1, Math.min(frame.height, viewport.height - 16));
  return { width, height, x: Math.max(8, Math.min(frame.x, viewport.width - width - 8)), y: Math.max(8, Math.min(frame.y, viewport.height - height - 8)) };
}

export function readDialogFrame(id: string): DialogFrame | null {
  try {
    const frame = JSON.parse(localStorage.getItem(KEY) ?? "{}")[id];
    if (!frame || ![frame.x, frame.y, frame.width, frame.height].every((n) => typeof n === "number" && Number.isFinite(n)) || frame.width <= 0 || frame.height <= 0) return null;
    return frame;
  } catch { return null; }
}

export function saveDialogFrame(id: string, frame: DialogFrame): void {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    localStorage.setItem(KEY, JSON.stringify({ ...saved, [id]: frame }));
    window.dispatchEvent(new Event("smartcatalog-dialog-layout"));
  } catch { /* Window settings must not prevent closing a dialog. */ }
}