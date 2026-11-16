/**
 * Shared leave guard for module changes and browser exit.
 * Outcomes: "stay" (cancel), "leave" (confirmed leave/discard), or a save whose
 * success is re-verified. Failed, cancelled or uncertain saves keep the user on the page.
 * No automatic retry; a browser download is never treated as a native save.
 */
import { useBlocker } from "@tanstack/react-router";

export type LeaveDecision = "save" | "leave" | "stay";
export type LeavePolicy = {
  isDirty: () => boolean;
  /** Asks the user; null/"stay" = cancel. */
  ask: () => Promise<LeaveDecision | null>;
  /** Real save; must resolve true only on confirmed success. Absent = Save not offered. */
  save?: (() => Promise<boolean>) | undefined;
};

/** Pure decision used by the hook (testable): true = block the navigation. */
export async function shouldBlockLeave(policy: LeavePolicy): Promise<boolean> {
  if (!policy.isDirty()) return false;
  const choice = await policy.ask();
  if (choice === "leave") return false;
  if (choice === "save" && policy.save) {
    let ok = false;
    try { ok = await policy.save(); } catch { ok = false; }
    // Edits made during the save, or a partial save, still block.
    return !ok || policy.isDirty();
  }
  return true;
}

export function useLeaveGuard(policy: LeavePolicy, enabled = true) {
  useBlocker({
    shouldBlockFn: ({ current, next }) => (current.pathname === next.pathname ? false : shouldBlockLeave(policy)),
    enableBeforeUnload: () => enabled && policy.isDirty(),
    disabled: !enabled,
  });
}
