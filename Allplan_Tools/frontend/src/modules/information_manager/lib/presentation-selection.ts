import { useRef, useState } from "react";

export function usePresentationSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const select = (id: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, order: string[]) => {
    const from = anchor.current;
    const range = event.shiftKey && from && order.includes(from) && order.includes(id)
      ? order.slice(Math.min(order.indexOf(from), order.indexOf(id)), Math.max(order.indexOf(from), order.indexOf(id)) + 1)
      : null;
    if (!range) anchor.current = id;
    setSelected(previous => {
      if (range) return new Set([...previous, ...range]);
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  };
  const children = (ids: string[], checked: boolean) => setSelected(previous => {
    const next = new Set(previous);
    for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
    return next;
  });
  const dragIds = (id: string, order: string[]) => {
    const ids = selected.has(id) ? order.filter(key => selected.has(key)) : [id];
    if (!selected.has(id)) setSelected(new Set([id]));
    return ids;
  };
  return { selected, select, children, dragIds };
}
