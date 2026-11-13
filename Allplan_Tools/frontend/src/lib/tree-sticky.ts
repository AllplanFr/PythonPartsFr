import type { CatalogNode } from "./catalog-store";
export type TreeContextRow = { id: string; depth: number };
/** Ancestors above the viewport, from the nearest folder to the direct parent. */
export function stickyParents(rows: TreeContextRow[], nodes: Record<string, CatalogNode>, indices: Map<string, number>, scrollTop: number, rowHeight: number, gapIndex = -1): TreeContextRow[] {
  const logicalTop = scrollTop - (gapIndex >= 0 && scrollTop >= gapIndex * rowHeight ? rowHeight : 0);
  const first = rows[Math.max(0, Math.floor(logicalTop / rowHeight))];
  const parents: TreeContextRow[] = [];
  const visited = new Set<string>();
  let id = first ? nodes[first.id]?.parentId : null;
  while (id && !visited.has(id)) {
    visited.add(id);
    const node = nodes[id];
    const index = indices.get(id);
    const row = index === undefined ? undefined : rows[index];
    if (!node || !row) break;
    parents.unshift(row);
    if (node.type === "folder") break;
    id = node.parentId;
  }
  return parents.filter((row, slot) => {
    const index = indices.get(row.id);
    return index !== undefined && (index + (gapIndex >= 0 && index >= gapIndex ? 1 : 0)) * rowHeight < scrollTop + slot * rowHeight;
  });
}
