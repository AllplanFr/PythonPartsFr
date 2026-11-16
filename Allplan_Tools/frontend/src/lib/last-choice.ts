/** Last option picked in a long-press menu, replayed by a simple click (per button, for the session). */
const choices = new Map<string, { label: string; run: () => void }>();
const listeners = new Set<() => void>();
export function remember(key: string, label: string, run: () => void) { choices.set(key, { label, run }); listeners.forEach((l) => l()); }
export function lastChoice(key: string) { return choices.get(key); }
export function subscribeChoices(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
