/** Browsers hide OS paths; pywebview can supply them through a native drop event. */
export function vobDroppedPaths(data: Pick<DataTransfer, "files" | "getData">): string[] {
  const files = Array.from(data.files);
  const native = files.map((f) => (f as File & { path?: string }).path).filter((p): p is string => typeof p === "string");
  if (native.length === files.length && native.length) return native;
  const uris = data.getData("text/uri-list").split(/\r?\n/).filter((s) => s && !s.startsWith("#"));
  return uris.flatMap((uri) => {
    try { const url = new URL(uri); if (url.protocol !== "file:") return []; const path = decodeURIComponent(url.pathname); return [url.hostname ? `//${url.hostname}${path}` : /^\/[a-z]:\//i.test(path) ? path.slice(1) : path]; }
    catch { return []; }
  });
}