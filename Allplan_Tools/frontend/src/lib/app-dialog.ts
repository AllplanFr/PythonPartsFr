import { create } from "zustand";

export type MessageTone = "info" | "dev" | "about";
type Pending = { kind: "message"; text: string; tone: MessageTone; resolve: () => void } | { kind: "prompt"; text: string; value: string; resolve: (v: string | null) => void } | { kind: "confirm"; text: string; resolve: (v: boolean) => void } | { kind: "choice"; text: string; options: { value: string; label: string }[]; hideCancel?: boolean; resolve: (v: string | null) => void };

/** In-app replacement for browser alert/prompt popups, rendered by AppMessageDialog. */
export const useAppDialog = create<{ queue: Pending[]; close: (value?: string | null) => void }>((set, get) => ({
  queue: [],
  close: (value) => { const [first, ...rest] = get().queue; set({ queue: rest }); if (!first) return; if (first.kind === "prompt" || first.kind === "choice") first.resolve(value ?? null); else if (first.kind === "confirm") first.resolve(value === "confirmed"); else first.resolve(); },
}));

export function showMessage(text: string, tone: MessageTone = "info"): void {
  useAppDialog.setState((s) => ({ queue: [...s.queue, { kind: "message", text, tone, resolve: () => {} }] }));
}

/** Friendly in-app notice for commands not yet connected to a module or the PythonPart. */
export function showInDevelopment(feature: string): void { showMessage(feature, "dev"); }

export function askText(text: string, value = ""): Promise<string | null> {
  return new Promise((resolve) => useAppDialog.setState((s) => ({ queue: [...s.queue, { kind: "prompt", text, value, resolve }] })));
}

export function askConfirmation(text: string): Promise<boolean> {
  return new Promise((resolve) => useAppDialog.setState((s) => ({ queue: [...s.queue, { kind: "confirm", text, resolve }] })));
}

export function askChoice(text: string, options: { value: string; label: string }[], hideCancel = false): Promise<string | null> {
  return new Promise((resolve) => useAppDialog.setState((s) => ({ queue: [...s.queue, { kind: "choice", text, options, hideCancel, resolve }] })));
}
