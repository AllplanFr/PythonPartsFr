import type { Configuration } from "./aim-presentation-contract";

export type LayoutMove = {
  kind: "row" | "group" | "category";
  id: string;
  target: string;
  before?: string | undefined;
  /** Drop on a category: becomes its first group. */ first?: boolean;
};

/** Continuous hover over a category during a group drag before it is displayed. Hover alone never changes the configuration. */
export const CATEGORY_HOVER_DELAY_MS = 600;

/** Moves only configuration objects by occurrence ID. Never reads or changes a project value. */
export function moveLayout(configuration: Configuration, move: LayoutMove): Configuration {
  const next = structuredClone(configuration);
  if (move.id === move.before || move.id === move.target) return configuration;
  if (move.kind === "category") {
    const item = next.categories.find(cat => cat.id === move.id);
    if (!item || move.before && !next.categories.some(cat => cat.id === move.before)) return configuration;
    next.categories = next.categories.filter(cat => cat.id !== move.id);
    next.categories.splice(move.before ? next.categories.findIndex(cat => cat.id === move.before) : next.categories.length, 0, item);
    next.categories.forEach((cat, i) => { cat.position = i + 1; });
    return next;
  }
  if (move.kind === "row") {
    const groups = next.categories.flatMap((c) => c.groups);
    const source = groups.find((g) => g.rows.some((r) => r.id === move.id));
    const target = groups.find((g) => g.id === move.target);
    const row = source?.rows.find((r) => r.id === move.id);
    if (
      !source ||
      !target ||
      !row ||
      (move.before && !target.rows.some((r) => r.id === move.before))
    )
      return configuration;
    source.rows = source.rows.filter((r) => r.id !== move.id);
    const at = move.before
      ? target.rows.findIndex((r) => r.id === move.before)
      : target.rows.length;
    target.rows.splice(at, 0, row);
    groups.forEach((g) => {
      g.rows = g.rows.map((r, i) => ({ ...r, position: i + 1 }));
    });
  } else {
    const source = next.categories.find((c) => c.groups.some((g) => g.id === move.id));
    const target = next.categories.find((c) => c.id === move.target);
    const group = source?.groups.find((g) => g.id === move.id);
    if (
      !source ||
      !target ||
      !group ||
      (move.before && !target.groups.some((g) => g.id === move.before))
    )
      return configuration;
    source.groups = source.groups.filter((g) => g.id !== move.id);
    const at = move.before
      ? target.groups.findIndex((g) => g.id === move.before)
      : target.groups.length;
    target.groups.splice(at, 0, group);
    next.categories.forEach((c) => {
      c.groups = c.groups.map((g, i) => ({ ...g, position: i + 1 }));
    });
  }
  return next;
}

export function moveLayoutSelection(c: Configuration, move: LayoutMove, ids: string[]): Configuration {
  const groups = c.categories.flatMap(cat => cat.groups);
  const order = move.kind === "category" ? c.categories : move.kind === "group" ? groups : groups.flatMap(group => group.rows);
  const moving = order.filter(item => ids.includes(item.id)).map(item => item.id);
  // V1 cannot interleave groups/rows or place rows directly in a category.
  // Reject a mixed selection as a whole instead of silently dropping its rows/groups.
  if (ids.some(id => !order.some(item => item.id === id))) return c;
  if (!moving.length || moving.includes(move.target)) return c;
  const destination = move.kind === "category" ? c.categories : move.kind === "group"
    ? c.categories.find(cat => cat.id === move.target)?.groups : groups.find(group => group.id === move.target)?.rows;
  if (!destination) return c;
  const at = move.before ? destination.findIndex(item => item.id === move.before) : -1;
  if (move.before && at < 0) return c;
  const before = at < 0 ? undefined : destination.slice(at).find(item => !moving.includes(item.id))?.id;
  return moving.reduce((next, id) => moveLayout(next, { ...move, id, before }), c);
}
export function setLayoutExpanded(
  configuration: import("./presentation-tree").AnyConfiguration,
  expanded: boolean,
): import("./presentation-tree").AnyConfiguration {
  if (configuration.version === 2)
    return {
      ...configuration,
      categories: configuration.categories.map((c) => ({
        ...c,
        children: c.children.map((x) => (x.kind === "group" ? { ...x, expanded } : x)),
      })),
    };
  return {
    ...configuration,
    categories: configuration.categories.map((c) => ({
      ...c,
      groups: c.groups.map((g) => ({ ...g, expanded })),
    })),
  };
}
