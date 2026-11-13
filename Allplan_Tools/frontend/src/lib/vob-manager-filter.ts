import type { VobFile } from "./vob-editor";
import { isSupportedAllplanVersion, vobPathKey } from "./vob-resources";

/** Version selection cannot remove the open file's version; search remains independent. */
export const includeVobVersion = (version: string, selected: string, current: VobFile | null) =>
  isSupportedAllplanVersion(version) && (selected === "all" || version === selected || version === current?.version);
export function managerVobFiles(files: VobFile[], current: VobFile | null, query: string) {
  const inventory = current && isSupportedAllplanVersion(current.version) && !files.some((f) => vobPathKey(f.path) === vobPathKey(current.path)) ? [...files, current] : files;
  const q = query.toLocaleLowerCase();
  return inventory.filter((f) => isSupportedAllplanVersion(f.version) && `${f.path} ${f.name} ${f.projectName ?? ""}`.toLocaleLowerCase().includes(q));
}