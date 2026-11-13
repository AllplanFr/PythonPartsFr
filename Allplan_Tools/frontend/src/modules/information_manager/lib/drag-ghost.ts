import type { DragEvent } from "react";

/**
 * Visible, non-interactive representation of the transported row/group/category.
 * Uses the native drag image so it follows the pointer and disappears on drop or
 * cancel; the dashed destination placeholder stays separate. Never touches configuration.
 */
export function setAimDragGhost(e: DragEvent, kind: "row" | "group" | "category", title: string, count = 1) {
  if (typeof document === "undefined") return;
  const grip = e.currentTarget as HTMLElement;
  const source = grip.closest("tr, [data-category-id]");
  const ghost = document.createElement("div");
  ghost.className = `aim-drag-ghost aim-drag-ghost-${kind}`;
  ghost.setAttribute("aria-hidden", "true");
  ghost.dataset["aimDragGhost"] = kind;
  const icon = source
    ? [...source.querySelectorAll("svg, img")].find(
        (x) => !grip.contains(x) && !/lucide-chevron/.test(x.getAttribute("class") ?? ""),
      )
    : undefined;
  if (icon) ghost.appendChild(icon.cloneNode(true));
  const label = document.createElement("span");
  label.textContent = count > 1 ? `${count} éléments · ${title}` : title;
  ghost.appendChild(label);
  document.body.appendChild(ghost);
  e.dataTransfer?.setDragImage?.(ghost, 12, 14);
  const cleanup = () => ghost.remove();
  setTimeout(cleanup, 0);
  grip.addEventListener("dragend", cleanup, { once: true });
}
