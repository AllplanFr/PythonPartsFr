// Host-local SmartCatalog Editor bundle (static HTML entry, no Nitro/SSR), modelled on build-tools-home.ts.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const outDir = process.argv[2];
if (!outDir) throw new Error("Usage: bun tooling/build-smartcatalog-local.ts <absolute-output-directory>");
const git = (a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
const revision = git(["rev-parse", "HEAD"]);
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("verified Git identity unavailable");
if (git(["status", "--porcelain", "--untracked-files=no"]).length > 0) throw new Error("tracked changes are not committed");
// Lovable asset pointers (.asset.json) reference CDN files absent from Git: fetch them once from the
// project preview host, check size/type against the pointer and bundle them as local files.
const ASSET_HOST = "https://id-preview--297630a7-1565-46a1-be88-827e783d171d.lovable.app";
const cacheDir = resolve("/tmp/smartcatalog-local-asset-cache");
await mkdir(cacheDir, { recursive: true });
const externalAssets: Record<string, { pointer: string; source: string; sha256: string; size: number }> = {};
const lovableAssets = {
  name: "smartcatalog-local-lovable-assets",
  enforce: "pre" as const,
  async resolveId(this: any, source: string, importer: string | undefined) {
    if (!source.endsWith(".asset.json")) return null;
    const r = await this.resolve(source, importer, { skipSelf: true });
    return r ? "\0lovable-asset:" + r.id + ".mjs" : null;
  },
  async load(vid: string) {
    if (!vid.startsWith("\0lovable-asset:")) return null;
    const id = vid.slice("\0lovable-asset:".length, -".mjs".length);
    const pointer = JSON.parse(await readFile(id, "utf8"));
    const source = ASSET_HOST + pointer.url;
    const res = await fetch(source);
    if (!res.ok) throw new Error(`asset ${pointer.url}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length !== pointer.size) throw new Error(`asset ${pointer.url}: size ${bytes.length} != ${pointer.size}`);
    const local = resolve(cacheDir, `${pointer.asset_id}-${pointer.original_filename}`);
    await writeFile(local, bytes);
    externalAssets[pointer.original_filename + "@" + pointer.asset_id] = {
      pointer: id.slice(resolve(".").length + 1), source: pointer.url,
      sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length,
    };
    return `import u from ${JSON.stringify(local + "?url")};\nexport default { ...${JSON.stringify(pointer)}, url: u };`;
  },
};
await build({
  configFile: false,
  root: resolve("src/modules/smartcatalog/local-entry"),
  base: "./",
  publicDir: false,
  plugins: [lovableAssets, react(), tailwind()],
  resolve: { alias: { "@": resolve("src") } },
  build: { outDir: resolve(outDir), emptyOutDir: true, assetsInlineLimit: 0 },
});
await cp(resolve("public/aim-assets/checkbox"), resolve(outDir, "aim-assets/checkbox"), { recursive: true });
await cp(resolve("public/favicon.png"), resolve(outDir, "favicon.png"));
const files: Record<string, string> = {};
async function inventory(directory: string, prefix = "") {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${item.name}`;
    if (item.isDirectory()) await inventory(resolve(directory, item.name), `${relative}/`);
    else files[relative] = createHash("sha256").update(await readFile(resolve(directory, item.name))).digest("hex");
  }
}
await inventory(resolve(outDir));
await writeFile(resolve(outDir, "smartcatalog-manifest.json"), JSON.stringify({
  schema: "smartcatalog-local/1", appId: "smartcatalog", smartcatalogCompatibility: "smartcatalog-host/1",
  revision, revisionStatus: "git-rev-parse-HEAD", trackedChangesAtBuild: false,
  entry: "index.html", route: "/smartcatalog", files,
  externalAssetsProvenance: "lovable-asset-cdn-via-preview-host", externalAssets,
}, null, 2) + "\n");
