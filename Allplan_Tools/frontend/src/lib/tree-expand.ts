/** Expand/collapse presets shared by the main tree and the external library tree. */
export type ExpandMode = "all" | "folders" | "selection" | "level1";
export type CollapseMode = "all" | "groups" | "selection" | "selectionChildren";

interface TNode { id: string; type: string; children?: string[] | undefined; parentId?: string | null }
type Nodes = Record<string, TNode | undefined>;
type State = Record<string, boolean>;

const hasKids = (n: TNode | undefined) => !!n?.children?.length;
function descendants(nodes: Nodes, id: string, out: string[] = []): string[] {
  for (const c of nodes[id]?.children ?? []) { out.push(c); descendants(nodes, c, out); }
  return out;
}

export function applyExpand(nodes: Nodes, rootIds: string[], current: State, mode: ExpandMode, selected: string[]): State {
  const next = { ...current };
  const all = Object.values(nodes).filter((n): n is TNode => !!n && hasKids(n));
  if (mode === "all") for (const n of all) next[n.id] = true;
  if (mode === "folders") for (const n of all) next[n.id] = n.type === "folder";
  if (mode === "level1") { for (const n of all) delete next[n.id]; for (const id of rootIds) if (hasKids(nodes[id])) next[id] = true; }
  if (mode === "selection") for (const id of selected) for (const x of [id, ...descendants(nodes, id)]) if (hasKids(nodes[x])) next[x] = true;
  return next;
}

export function applyCollapse(nodes: Nodes, current: State, mode: CollapseMode, selected: string[]): State {
  if (mode === "all") return {};
  const next = { ...current };
  if (mode === "groups") for (const n of Object.values(nodes)) if (n && n.type === "group") delete next[n.id];
  if (mode === "selection" || mode === "selectionChildren")
    for (const id of selected) { for (const d of descendants(nodes, id)) delete next[d]; if (mode === "selection") delete next[id]; }
  return next;
}
