import { askChoice, useAppDialog } from "@/lib/app-dialog";

/** AIM-only single request guard; other modules retain their existing shared queue semantics. */
export function askAimDiscard(text: string): Promise<string | null> {
  if (useAppDialog.getState().queue.length) return Promise.resolve(null);
  return askChoice(text, [{ value: "discard", label: "Abandonner" }]);
}