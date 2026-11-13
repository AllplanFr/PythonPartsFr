import expand from "@/modules/information_manager/assets/expand_all.png";
import collapse from "@/modules/information_manager/assets/collapse_all.png";
import remove from "@/modules/information_manager/assets/delete.svg";
import save from "@/modules/information_manager/assets/save.svg";
import folder from "@/modules/information_manager/assets/folder.png";
import vobImport from "@/modules/information_manager/assets/favorite_open.svg";
import vobExport from "@/modules/information_manager/assets/favorite_save.svg";
import attribute from "@/modules/information_manager/assets/attribute_add-2.png";

const icons = { expand, collapse, remove, save, folder, attribute, import: vobImport, export: vobExport };
export function SmartCatalogIcon({ name, className = "size-5" }: { name: keyof typeof icons; className?: string }) {
  return <img src={icons[name]} alt="" draggable={false} className={`${className} shrink-0 object-contain`} />;
}