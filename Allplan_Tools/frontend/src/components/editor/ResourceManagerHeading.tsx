import type { ReactNode } from "react";
/** Shared presentation-only heading used by native resource managers; no business store or host I/O. */
export function ResourceManagerHeading({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="catalog-panel-heading flex h-10 shrink-0 items-center gap-2 px-2">
      {icon}
      <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
      {children}
    </div>
  );
}
