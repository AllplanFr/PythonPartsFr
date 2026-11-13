import type {
  Configuration,
  DisplayRow,
  Group,
  Model,
  Presentation,
  RowConfig,
} from "./aim-presentation-contract";

export type TreeRow = RowConfig & { kind: "row" };
export type TreeGroup = Group<TreeRow> & { kind: "group" };
export type TreeCategory<R, G> = {
  id: string;
  position: number;
  name: string;
  icon: string;
  children: (R | G)[];
};
export type TreeConfiguration = Omit<Configuration, "version" | "categories"> & {
  version: 2;
  categories: TreeCategory<TreeRow, TreeGroup>[];
};
export type TreeDisplayRow = DisplayRow & { kind: "row" };
export type TreeDisplayGroup = Group<TreeDisplayRow> & { kind: "group" };
export type TreeModel = Omit<Model, "version" | "categories"> & {
  version: 2;
  categories: TreeCategory<TreeDisplayRow, TreeDisplayGroup>[];
};
export type TreePresentation = {
  configuration: TreeConfiguration;
  model: TreeModel;
  report: Presentation["report"];
};
export type AnyConfiguration = Configuration | TreeConfiguration;
export type AnyPresentation = Presentation | TreePresentation;
export const configurationGroups = (c: AnyConfiguration) =>
  c.version === 1
    ? c.categories.flatMap((x) => x.groups)
    : c.categories.flatMap((x) => x.children.filter((y): y is TreeGroup => y.kind === "group"));
export const configurationRows = (c: AnyConfiguration) =>
  c.version === 1
    ? c.categories.flatMap((x) => x.groups.flatMap((g) => g.rows))
    : c.categories.flatMap((x) => x.children.flatMap((y) => (y.kind === "row" ? [y] : y.rows)));

export type TreeMove = {
  kind: "row" | "group" | "category";
  id: string;
  target: string;
  before?: string;
  end?: boolean;
};
const index = <T extends { position: number }>(rows: T[]) =>
  rows.forEach((r, i) => {
    r.position = i + 1;
  });
/** Configuration only: remove once, insert once, preserve occurrence identity and all native-free properties. */
export function moveTree(c: TreeConfiguration, move: TreeMove): TreeConfiguration {
  if (
    ["all", "unlisted"].includes(move.target) ||
    move.id === move.target ||
    move.id === move.before
  )
    return c;
  const n = structuredClone(c);
  if (move.kind === "category") {
    const source = n.categories.find((x) => x.id === move.id);
    if (!source || (move.before && !n.categories.some((x) => x.id === move.before))) return c;
    n.categories = n.categories.filter((x) => x.id !== move.id);
    n.categories.splice(
      move.before ? n.categories.findIndex((x) => x.id === move.before) : n.categories.length,
      0,
      source,
    );
    index(n.categories);
    return n;
  }
  let item: TreeRow | TreeGroup | undefined;
  let source: (TreeRow | TreeGroup)[] | undefined;
  for (const cat of n.categories) {
    const direct = cat.children.find((x) => x.id === move.id && x.kind === move.kind);
    if (direct) {
      item = direct;
      source = cat.children;
      break;
    }
    if (move.kind === "row")
      for (const child of cat.children) {
        if (child.kind !== "group") continue;
        const row = child.rows.find((x) => x.id === move.id);
        if (row) {
          item = row;
          source = child.rows;
          break;
        }
      }
  }
  const cat = n.categories.find((x) => x.id === move.target);
  const group = n.categories
    .flatMap((x) => x.children)
    .find((x): x is TreeGroup => x.kind === "group" && x.id === move.target);
  const destination = cat?.children ?? (move.kind === "row" ? group?.rows : undefined);
  if (
    !item ||
    !source ||
    !destination ||
    (move.before && !destination.some((x) => x.id === move.before))
  )
    return c;
  source.splice(
    source.findIndex((x) => x.id === move.id),
    1,
  );
  const at = move.before
    ? destination.findIndex((x) => x.id === move.before)
    : cat
      ? move.end
        ? destination.length
        : 0
      : destination.length;
  destination.splice(at, 0, item as TreeRow);
  index(source);
  index(destination);
  return n;
}

export function deleteTree(
  c: TreeConfiguration,
  kind: TreeMove["kind"],
  id: string,
): TreeConfiguration {
  const n = structuredClone(c);
  if (kind === "category") n.categories = n.categories.filter((x) => x.id !== id);
  else
    for (const cat of n.categories) {
      cat.children = cat.children.filter((x) => !(x.id === id && x.kind === kind));
      if (kind === "row")
        for (const x of cat.children)
          if (x.kind === "group") {
            x.rows = x.rows.filter((r) => r.id !== id);
            index(x.rows);
          }
      index(cat.children);
    }
  index(n.categories);
  return n;
}

export function addTreeOccurrence(
  c: TreeConfiguration,
  target: string,
  attribute: { number: string; label: string },
  newId: () => string = () => crypto.randomUUID(),
): TreeConfiguration | null {
  if (!/^(0|[1-9]\d*)$/.test(attribute.number)) return null;
  const n = structuredClone(c);
  const ids = new Set([
    ...n.categories.map((x) => x.id),
    ...configurationGroups(n).map((x) => x.id),
    ...configurationRows(n).map((x) => x.id),
  ]);
  let id = newId();
  while (ids.has(id)) id = newId();
  const cat = n.categories.find((x) => x.id === target);
  const group = configurationGroups(n).find((x) => x.id === target);
  const rows = cat?.children ?? group?.rows;
  if (!rows) return null;
  rows.push({
    kind: "row",
    id,
    position: rows.length + 1,
    num: Number(attribute.number),
    title: attribute.label,
    widget: "entry",
    type: "STR",
    resetDefault: { state: "absent" },
  });
  return n;
}
