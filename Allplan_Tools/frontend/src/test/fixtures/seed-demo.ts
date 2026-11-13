/** Test-only fixture: never imported by the application. Seeds the stores that now start empty. */
import { useCatalog, type CatalogNode } from "@/lib/catalog-store";
import { useCatalogRegistry } from "@/lib/catalog-registry";
import { useExternalLibraries } from "@/lib/external-libraries";

type Nodes = Record<string, CatalogNode>; type NodeType = CatalogNode["type"];
type ExternalCatalog = { nodes: Record<string, CatalogNode>; rootIds: string[] };
let seq = 0; const uid = () => `s${(seq++).toString(36)}`;
function demoCatalog(): { nodes: Nodes; rootIds: string[] } {
  const nodes: Nodes = {};
  const add = (type: NodeType, name: string, description: string, parentId: string | null, attrs: Record<number, string> = {}) => {
    const id = uid();
    nodes[id] = { id, type, name, description, parentId, attrs, children: type === "component" ? undefined : [] };
    if (parentId) nodes[parentId]!.children!.push(id);
    return id;
  };
  const roots: string[] = [];
  roots.push(add("folder", "this catalog is only an example to show what could be possible with the SmartCatalog", "", null));
  const od = add("folder", "object dependend", "", null); roots.push(od);
  const cw = add("folder", "13 Concreting work", "", od);
  const g = add("group", "C20/25", "concrete strength C20/25", cw, { 118: "1", 111: "2", 141: "3802", 349: "0", 346: "1", 345: "1", 347: "1", 335: "", 231: "R", 235: "SU", 232: "N", 266: "1.000", 233: "1", 264: "1.000", 2005: "", 60010: "", 999999: "" });
  const comps: [string, string, string, string][] = [
    ["130105E", "foundation/ice wall concrete C20/25 up to a volume of 0,5 m3", "m3", "142.920"],
    ["130103S", "sideway casing for subconcrete", "m2", "18.500"],
    ["130105S", "casing for foundation/ice wall", "m2", "24.300"],
    ["130107C", "concrete baseplate C20/25 up to a thickness of 30 cm", "m3", "131.000"],
    ["130201E", "concrete wall C20/25 up to 20 cm thickness and 3,2 m lenght", "m3", "165.400"],
    ["130201S", "casing for concrete wall up to a lenght of 3,2 m", "m2", "29.800"],
    ["130214A", "concrete columns C20/25 up to a cross section of 0,05 m2 and a height of 3,2 m", "m3", "210.000"],
    ["130214N", "casing for rectangular concrete columns up to a height of 3,2 m", "m2", "41.200"],
    ["130219B", "concrete beam/beam grid C20/25 up to a height of 20 cm and a lenght of 3,2 m", "m3", "188.600"],
    ["130218S", "casing for concrete beam/beam grid up to a lenght of 3,2 m", "m2", "36.900"],
    ["130218A", "concrete beam/beam grid C20/25 up to a height of 20 cm and a lenght of 3,2 m", "m3", "192.100"],
    ["130218T", "casing for beam/beam grid up to a lenght of 3,2 m", "m2", "35.000"],
    ["130301A", "concrete slab/cantilever slab C20/25 up to a thickness of 25 cm and a lenght of 5 m", "m3", "154.700"],
    ["130301S", "casing for slab/cantilever slab bottom view up to a lenght of 3,2 m", "m2", "27.400"],
    ["130301T", "casing for slab/cantilever slab/beam grid up to a lenght of 3,2 m", "m2", "26.100"],
    ["130302E", "concrete stairs C20/25 straight flight", "m3", "245.000"],
    ["130302S", "casing for straight stair flight", "m2", "52.800"],
    ["130303E", "concrete landing slab C20/25", "m3", "171.300"],
    ["130303S", "casing for landing slab", "m2", "31.600"],
    ["130310A", "concrete parapet C20/25 up to 1,2 m height", "m3", "176.500"],
  ];
  for (const [code, desc, unit, price] of comps)
    add("component", code, desc, g, { 207: desc, 202: unit, 203: price, 209: "Concreting work", 267: "_IF_(@OBJ@=703)@100@" });
  add("group", "C25/30", "concrete strength C25/30", cw);
  for (const [n, sub] of [["walls", ["Masonry", "Partition walls"]], ["39 Dry construction work", ["Plasterboard"]], ["323 Exterior insulation finish systems", ["EPS 120 mm"]], ["finishings", ["Paint"]], ["exterior finishing", ["Render"]]] as const) {
    const f = add("folder", n, "", null); roots.push(f);
    for (const s of sub) {
      const gg = add("group", s, `${s} group`, f);
      add("component", `${320100 + seq}A`, `${s.toLowerCase()} standard position`, gg, { 207: `${s} standard position`, 202: "m2", 203: "45.000", 209: n });
    }
  }
  return { nodes, rootIds: roots };
}

function demoLibrary(): ExternalCatalog {
  const nodes: Record<string, CatalogNode> = {};
  const add = (id: string, type: CatalogNode["type"], name: string, description: string, parentId: string | null, attrs: Record<number, string> = {}) => {
    nodes[id] = { id, type, name, description, parentId, attrs, children: type === "folder" || type === "group" ? [] : undefined };
    if (parentId) nodes[parentId]?.children?.push(id);
  };
  add("ext-joinery", "folder", "08 · Menuiseries extérieures", "Portes et fenêtres", null);
  add("ext-wood", "folder", "05 · Charpente bois", "Structures et couverture", null);
  add("ext-window", "group", "EXT_PFN_1V", "Porte-fenêtre battante · 1 vantail", "ext-joinery", { 120: "0", 202: "u", 209: "Menuiserie", 267: "@221@*@222@" });
  add("ext-window-pvc", "component", "EXT_PFN_PVC", "Porte-fenêtre PVC blanc", "ext-window", { 207: "Porte-fenêtre PVC blanc", 120: "0", 202: "u", 203: "685.00", 209: "Menuiserie", 267: "@221@*@222@" });
  add("ext-window-alu", "component", "EXT_PFN_ALU", "Porte-fenêtre aluminium · rupture thermique", "ext-window", { 207: "Porte-fenêtre aluminium · rupture thermique", 120: "0", 202: "u", 203: "920.00", 209: "Menuiserie", 267: "@221@*@222@" });
  add("ext-door", "group", "EXT_PORTE", "Porte d’entrée isolante", "ext-joinery", { 202: "u", 209: "Menuiserie" });
  add("ext-door-comp", "component", "EXT_PORTE_BOIS", "Porte bois · finition naturelle", "ext-door", { 202: "u", 203: "1150.00", 267: "1" });
  add("ext-frame", "group", "EXT_CHEVRON", "Chevronnage en sapin du Nord traité", "ext-wood", { 202: "m", 209: "Charpente" });
  add("ext-frame-comp", "component", "EXT_CHEVRON_63", "Chevron sapin · section 63 × 75 mm", "ext-frame", { 202: "m", 203: "8.50", 267: "@220@" });
  return { nodes, rootIds: ["ext-joinery", "ext-wood"] };
}

const PATH = "D:\\fixture\\SmartCatalog";
export function seedDemo() {
  seq = 0; const cat = demoCatalog(); useCatalog.getState().load(cat);
  const group = Object.values(cat.nodes).find((n) => n.name === "C20/25")?.id;
  useCatalog.setState({ catalog: { name: "Allplan_en", path: PATH, version: "2027", source: "D:\\fixture\\Std", defAttr: 83 }, selected: group ? [group] : [], anchor: group ?? null, expanded: Object.fromEntries(Object.values(cat.nodes).filter((n) => ["object dependend", "13 Concreting work", "C20/25"].includes(n.name)).map((n) => [n.id, true])), past: [], future: [], dirty: false });
  useCatalogRegistry.setState({ recentIds: [], cats: [
    { id: "c1", name: "CMI", version: "2022", path: PATH, source: "D:\\fixture\\Prj", defAttr: 83, status: "ok" },
    { id: "c40", name: "Allplan_en", version: "2027", path: PATH, source: "D:\\fixture\\Std", defAttr: 83, status: "ok" },
    { id: "c6", name: "SmartCatalogCMI2", version: "", path: "D:\\old\\SmartCatalogCMI2.xml", source: "", defAttr: 83, status: "missing" },
  ] });
  useExternalLibraries.setState({ active: "external-example", sources: [{ id: "external-example", name: "Bibliothèque de démonstration", location: "", version: "2027", dataSource: "STD", defAttr: 83, favorite: false, demo: true, data: demoLibrary() }] });
}
