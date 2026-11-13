import type { CatalogNode, NodeType } from "@/lib/catalog-store";
import folderIcon from "@/assets/icons/folder.png.asset.json";
import groupIcon from "@/assets/icons/material.png.asset.json";
import compIcon from "@/assets/icons/component.png.asset.json";
import linkIcon from "@/assets/icons/link.png.asset.json";

const SRC: Record<NodeType, string> = { folder: folderIcon.url, group: groupIcon.url, component: compIcon.url, link: linkIcon.url };

/** Same artwork as the matching toolbar button; folders may carry a custom icon. */
export function NodeIcon({ node, type, size = 16 }: { node?: Pick<CatalogNode, "type" | "icon"> | undefined; type?: NodeType; size?: number }) {
  const t = node?.type ?? type ?? "folder";
  const src = node?.icon || SRC[t];
  return <img src={src} alt="" width={size} height={size} className="shrink-0 object-contain" style={{ width: size, height: size }} draggable={false} />;
}
