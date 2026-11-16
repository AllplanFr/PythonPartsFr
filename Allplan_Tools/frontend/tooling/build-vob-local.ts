// Host-local VOB Editor bundle (static HTML entry, no Nitro/SSR), modelled on build-tools-home.ts.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const outDir = process.argv[2];
if (!outDir) throw new Error("Usage: bun tooling/build-vob-local.ts <absolute-output-directory>");
const git = (a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
const revision = git(["rev-parse", "HEAD"]);
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("verified Git identity unavailable");
if (git(["status", "--porcelain", "--untracked-files=no"]).length > 0) throw new Error("tracked changes are not committed");
await build({
  configFile: false,
  root: resolve("src/modules/vob_editor/local-entry"),
  base: "./",
  publicDir: false,
  plugins: [react(), tailwind()],
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
await writeFile(resolve(outDir, "vob-manifest.json"), JSON.stringify({
  schema: "vob-editor-local/1", appId: "vob_editor", vobEditorCompatibility: "vob-editor-host/1",
  revision, revisionStatus: "git-rev-parse-HEAD", trackedChangesAtBuild: false,
  entry: "index.html", route: "/vob-editor", files,
}, null, 2) + "\n");
