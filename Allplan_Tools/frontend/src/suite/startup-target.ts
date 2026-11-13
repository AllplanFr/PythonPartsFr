/**
 * Startup rule shared by SmartCatalog and VOB (pure, no native call):
 * explicit launch target → last successfully opened item → internal managers.
 * An inaccessible target opens the resource manager; success is never assumed.
 */
export type StartupDecision =
  | { kind: "open"; path: string; source: "explicit" | "last" }
  | { kind: "manager"; reason: "no-target" | "inaccessible"; path?: string };

export function resolveStartupTarget(input: {
  explicit?: string | null | undefined;
  lastOpened?: string | null | undefined;
  /** Accessibility as reported by the backend; undefined = not yet known, treated as inaccessible. */
  isAccessible: (path: string) => boolean | undefined;
}): StartupDecision {
  const explicit = input.explicit?.trim();
  const last = input.lastOpened?.trim();
  const candidate = explicit ? { path: explicit, source: "explicit" as const } : last ? { path: last, source: "last" as const } : null;
  if (!candidate) return { kind: "manager", reason: "no-target" };
  if (input.isAccessible(candidate.path) !== true) return { kind: "manager", reason: "inaccessible", path: candidate.path };
  return { kind: "open", ...candidate };
}
