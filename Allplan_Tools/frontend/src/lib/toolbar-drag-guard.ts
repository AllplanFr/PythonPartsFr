/** Shared toolbar rule: a press inside an interactive field (search input, select, editable text) never starts a toolbar drag. */
export const FIELD_SELECTOR = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-no-toolbar-drag]";

export function isInteractiveField(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(FIELD_SELECTOR);
}
