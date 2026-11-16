import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const outDir = process.argv[2];
const revision = process.argv[3];
if (!outDir || !revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Usage: bun tooling/build-tools-home.ts <absolute-output-directory> <revision-40-hex>");
await build({
  configFile: false,
  root: resolve("src/suite/local-home"),
  base: "./",
  publicDir: false,
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": resolve("src") } },
  build: { outDir: resolve(outDir), emptyOutDir: true, assetsInlineLimit: 0 },
});
// Global CSS exposes shared checkbox URLs; ship them only in the isolated home output.
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
await writeFile(resolve(outDir, "home-manifest.json"), JSON.stringify({ schema: "allplan-tools-home/1", revision, entry: "index.html", files }, null, 2) + "\n");