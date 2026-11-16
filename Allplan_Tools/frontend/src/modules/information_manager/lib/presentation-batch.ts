import { addOccurrence } from "./aim-presentation-contract";
import { configurationGroups, configurationRows, type AnyConfiguration } from "./presentation-tree";

/** One configuration intent; all-or-nothing, without changing Python project values. */
export function addPresentationBatch(
  configuration: AnyConfiguration,
  target: string,
  attributes: { number: string; label: string }[],
  before?: string,
): AnyConfiguration | null {
  if (!attributes.length || new Set(attributes.map(a => a.number)).size !== attributes.length) return null;
  let next = configuration;
  const added: string[] = [];
  const previousIds = new Set(configurationRows(configuration).map(row => row.id));
  for (const attribute of attributes) {
    const result = addOccurrence(next, target, attribute);
    if (!result) return null;
    const row = configurationRows(result).find(item => !previousIds.has(item.id));
    if (!row) return null;
    previousIds.add(row.id); added.push(row.id); next = result;
  }
  if (before) {
    const reorder = <T extends { id: string; position: number }>(rows: T[] | undefined) => {
      if (!rows || !rows.some(row => row.id === before)) return false;
      const inserted = rows.filter(row => added.includes(row.id));
      const remaining = rows.filter(row => !added.includes(row.id));
      remaining.splice(remaining.findIndex(row => row.id === before), 0, ...inserted);
      rows.splice(0, rows.length, ...remaining);
      rows.forEach((row, i) => { row.position = i + 1; });
      return true;
    };
    const reordered = next.version === 2
      ? reorder<{ id: string; position: number }>(next.categories.find(cat => cat.id === target)?.children ?? configurationGroups(next).find(group => group.id === target)?.rows)
      : reorder(next.categories.flatMap(cat => cat.groups).find(group => group.id === target)?.rows);
    if (!reordered) return null;
  }
  return next;
}