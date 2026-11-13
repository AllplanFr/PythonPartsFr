// Build identification only: after the client output is written to disk, emits
// build-manifest.json with the source revision actually built (git, at build time),
// compatibility and SHA256 of every written JS/CSS file (dynamic chunks
// included), hashed from the final on-disk bytes. The manifest never hashes itself.
// No runtime/application code is affected.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function buildIdentityPlugin(): Plugin {
  let developmentBuild = false;
  return {
    name: "build-identity",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      developmentBuild = config.mode === "development";
    },
    writeBundle(options, bundle) {
      if (this.environment && this.environment.name !== "client") return;
      const outDir = options.dir;
      if (!outDir) return;
      const revision = git(["rev-parse", "HEAD"]);
      const porcelain = revision ? git(["status", "--porcelain", "--untracked-files=no"]) : null;
      if (!revision || !/^[a-f0-9]{40}$/.test(revision) || porcelain === null) {
        const reason = "build-identity: verified Git identity unavailable";
        // Preview: build without a manifest; nothing is invented.
        if (developmentBuild) { this.warn(`${reason} (preview); no build-manifest.json emitted`); return; }
        // Publication: a valid manifest is mandatory; stop before replacing the public version.
        this.error(`${reason}; publication stopped`);
      }
      if (porcelain.length > 0) {
        const reason = "build-identity: tracked changes are not committed";
        if (developmentBuild) { this.warn(`${reason} (preview); no build-manifest.json emitted`); return; }
        this.error(`${reason}; publication stopped`);
      }
      const files = Object.values(bundle)
        .filter((f) => /\.(m?js|css)$/.test(f.fileName))
        .map((f) => ({
          file: "/" + f.fileName,
          kind: f.type === "chunk" ? (f.isEntry ? "entry" : f.isDynamicEntry ? "dynamic-chunk" : "chunk") : "asset",
          sha256: createHash("sha256").update(readFileSync(join(outDir, f.fileName))).digest("hex"),
        }))
        .sort((a, b) => a.file.localeCompare(b.file));
      const manifest = {
        schema: "build-identity/1",
        compatibility: "aim-workv2-presentation-save/1",
        vobEditorCompatibility: "vob-editor-host/1",
        revision,
        revisionStatus: "git-rev-parse-HEAD", // only reached when git rev-parse HEAD succeeded
        trackedChangesAtBuild: false, // only reached when git status reported no tracked changes
        builtAt: new Date().toISOString(),
        files,
      };
      writeFileSync(join(outDir, "build-manifest.json"), JSON.stringify(manifest, null, 2));
    },
  };
}
