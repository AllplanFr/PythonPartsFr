import type { CatalogNode } from "./catalog-store";

type Nodes = Record<string, CatalogNode>;
export type LinkStatus = "ok" | "dead" | "circular";

/** A link points to the ouvrage whose (unique) code equals the link title. */
export function linkTarget(nodes: Nodes, link: CatalogNode | undefined): CatalogNode | undefined {
  if (!link || link.type !== "link") return undefined;
  const name = link.name.trim();
  for (const n of Object.values(nodes)) if (n.type === "group" && n.name.trim() === name) return n;
  return undefined;
}

/** Ouvrages reachable by following links inside `groupId` (transitively). */
function reaches(nodes: Nodes, fromGroupId: string, goal: string, seen = new Set<string>()): boolean {
  if (fromGroupId === goal) return true;
  if (seen.has(fromGroupId)) return false;
  seen.add(fromGroupId);
  for (const cid of nodes[fromGroupId]?.children ?? []) {
    const target = linkTarget(nodes, nodes[cid]);
    if (target && reaches(nodes, target.id, goal, seen)) return true;
  }
  return false;
}

/** True when a link placed in `parentGroupId` towards `targetGroupId` would loop back. */
export function wouldCycle(nodes: Nodes, parentGroupId: string | null, targetGroupId: string): boolean {
  if (!parentGroupId) return false;
  return reaches(nodes, targetGroupId, parentGroupId);
}

export function linkStatus(nodes: Nodes, link: CatalogNode): LinkStatus {
  const target = linkTarget(nodes, link);
  if (!target) return "dead";
  return wouldCycle(nodes, link.parentId, target.id) ? "circular" : "ok";
}

/** Links that use the given ouvrage. */
export function linksTo(nodes: Nodes, groupId: string): CatalogNode[] {
  const g = nodes[groupId]; if (!g || g.type !== "group") return [];
  const name = g.name.trim();
  return Object.values(nodes).filter((n) => n.type === "link" && n.name.trim() === name);
}

/** Path of parent titles, for showing where a node lives. */
export function nodePath(nodes: Nodes, id: string): string {
  const out: string[] = [];
  for (let p = nodes[id]?.parentId ? nodes[nodes[id]!.parentId!] : undefined; p; p = p.parentId ? nodes[p.parentId] : undefined) out.unshift(p.name);
  return out.join(" / ");
}

/** Usage count per target ouvrage code, for "reuse an existing link". */
export function linkUsage(nodes: Nodes): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of Object.values(nodes)) if (n.type === "link") m.set(n.name.trim(), (m.get(n.name.trim()) ?? 0) + 1);
  return m;
}
