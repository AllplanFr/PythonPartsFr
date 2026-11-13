import type { CatalogNode } from "./catalog-store";

export interface ExternalCatalog { nodes: Record<string, CatalogNode>; rootIds: string[] }

/** Boundary shared by formatted files and future PythonPart responses. */
export function parseExternalCatalog(input: unknown, maxAttribute = 99999): ExternalCatalog | null {
  if (!input || typeof input !== "object") return null;
  const data = input as Record<string, unknown>;
  if (!Array.isArray(data["rootIds"]) || !data["nodes"] || typeof data["nodes"] !== "object" || Array.isArray(data["nodes"])) return null;
  const nodes: Record<string, CatalogNode> = {};
  for (const [id, raw] of Object.entries(data["nodes"])) {
    if (!raw || typeof raw !== "object") return null;
    const n = raw as Record<string, unknown>;
    if (n["id"] !== id || !["folder", "group", "component", "link"].includes(String(n["type"])) || typeof n["name"] !== "string" || !n["name"].trim() || typeof n["description"] !== "string" || (n["parentId"] !== null && typeof n["parentId"] !== "string") || !n["attrs"] || typeof n["attrs"] !== "object" || Array.isArray(n["attrs"])) return null;
    if (Object.entries(n["attrs"]).some(([k, v]) => !/^\d+$/.test(k) || !Number.isSafeInteger(Number(k)) || Number(k) < 1 || Number(k) > maxAttribute || typeof v !== "string")) return null;
    const container = n["type"] === "folder" || n["type"] === "group";
    if (container ? !Array.isArray(n["children"]) : n["children"] !== undefined && (!Array.isArray(n["children"]) || n["children"].length > 0)) return null;
    if (n["children"] !== undefined && (!Array.isArray(n["children"]) || n["children"].some((c) => typeof c !== "string"))) return null;
    nodes[id] = { id, type: n["type"] as CatalogNode["type"], name: n["name"], description: n["description"], parentId: n["parentId"] as string | null, attrs: { ...n["attrs"] } as Record<number, string>, children: container ? [...n["children"] as string[]] : undefined, icon: typeof n["icon"] === "string" && /^(data:image\/|https:\/\/|\/__l5e\/)/.test(n["icon"]) ? n["icon"] : undefined, attrOrder: Array.isArray(n["attrOrder"]) ? n["attrOrder"].filter((k): k is number => Number.isSafeInteger(k) && typeof k === "number" && k > 0 && k <= maxAttribute) : undefined };
  }
  const visited = new Set<string>();
  const roots = data["rootIds"];
  if (roots.some((id) => typeof id !== "string" || !["folder", "group"].includes(nodes[id]?.type ?? "") || nodes[id]?.type !== nodes[String(roots[0])]?.type)) return null;
  if (Object.values(nodes).some((n) => n.type === "link" && Object.keys(n.attrs).length > 0 || n.type === "folder" && Object.keys(n.attrs).some((k) => Number(k) !== 207))) return null;
  const walk = (id: unknown, parent: string | null, depth: number): boolean => {
    if (typeof id !== "string" || depth > 100 || visited.has(id)) return false;
    const n = nodes[id]; if (!n || n["parentId"] !== parent) return false;
    visited.add(id);
    const kids = n["children"] ?? [];
    if (n["type"] === "folder" && kids.some((c) => !nodes[c] || !["folder", "group"].includes(nodes[c]?.type ?? "") || nodes[c]?.type !== nodes[kids[0] ?? ""]?.type)) return false;
    if (n["type"] === "group" && kids.some((c) => !["component", "link"].includes(nodes[c]?.type ?? ""))) return false;
    return kids.every((c) => walk(c, id, depth + 1));
  };
  if (!data["rootIds"].every((id) => walk(id, null, 0)) || visited.size !== Object.keys(nodes).length) return null;
  return { nodes, rootIds: [...data["rootIds"]] as string[] };
}

export function externalTopLevel(data: ExternalCatalog, ids: string[]): string[] {
  const chosen = new Set(ids);
  return [...chosen].filter((id) => {
    if (!data["nodes"][id]) return false;
    let parent = data["nodes"][id]?.parentId;
    while (parent) { if (chosen.has(parent)) return false; parent = data["nodes"][parent]?.parentId ?? null; }
    return true;
  });
}