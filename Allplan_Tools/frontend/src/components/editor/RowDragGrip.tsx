import { GripVertical } from "lucide-react";
import type { ComponentProps } from "react";
import { useT } from "@/lib/i18n";

/** Six-dot row affordance; the parent owns the actual drag behavior. */
export function RowDragGrip({ className = "", ...props }: ComponentProps<"span">) {
  const t = useT();
  return <span {...props} title={t("dragHint")} data-row-drag-grip className={`row-drag-grip flex h-6 w-3 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing ${className}`}><GripVertical className="h-3.5 w-3.5" /></span>;
}