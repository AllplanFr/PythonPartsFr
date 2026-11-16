export interface FolderDraft { name: string; description: string }

/** Lines give titles (and optional description after the separator); empty slots up to `count` get numbered names. */
export function buildFolderDrafts(text: string, count: number, withDescription: boolean, separator: string, baseName: string): FolderDraft[] {
  const sep = separator === "\\t" ? "\t" : separator;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    if (!withDescription || !sep) return { name: line, description: "" };
    const at = line.indexOf(sep);
    return at < 0 ? { name: line, description: "" } : { name: line.slice(0, at).trim(), description: line.slice(at + sep.length).trim() };
  }).filter((d) => d.name);
  const total = Math.max(lines.length, Math.min(500, Math.max(0, Math.floor(count))));
  for (let i = lines.length; i < total; i++) lines.push({ name: `${baseName} ${i + 1}`, description: "" });
  return lines;
}
