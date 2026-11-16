/** Move selected siblings without changing their relative order. */
export function moveSelectionInOrder<T>(items: T[], selected: (item: T) => boolean, dir: -1 | 1, edge = false): T[] {
  if (edge) {
    const moving = items.filter(selected), rest = items.filter((item) => !selected(item));
    return dir === -1 ? [...moving, ...rest] : [...rest, ...moving];
  }
  const next = [...items];
  const indices = next.map((_, i) => i);
  if (dir === 1) indices.reverse();
  for (const i of indices) {
    const a = next[i], b = next[i + dir];
    if (a !== undefined && b !== undefined && selected(a) && !selected(b)) {
      next[i] = b; next[i + dir] = a;
    }
  }
  return next;
}
