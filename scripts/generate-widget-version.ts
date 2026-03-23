/**
 * Post-build script: generates dist/widget-version.json with a content hash
 * of all built widget HTML files. Used by server.ts and main.ts for cache-busting
 * resource URIs.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST_DIR = join(import.meta.dirname, "..", "dist");

const WIDGETS_DIR = join(DIST_DIR, "src", "widgets");

const htmlFiles = readdirSync(WIDGETS_DIR, { recursive: true })
  .filter((f): f is string => typeof f === "string" && f.endsWith(".html"))
  .sort();

if (htmlFiles.length === 0) {
  console.error("No HTML files found in dist/src/widgets/");
  process.exit(1);
}

const hash = createHash("sha256");
for (const file of htmlFiles) {
  hash.update(readFileSync(join(WIDGETS_DIR, file)));
}
const version = hash.digest("hex").slice(0, 8);

writeFileSync(join(DIST_DIR, "widget-version.json"), JSON.stringify({ version }) + "\n");
console.error(`Widget version: ${version} (${htmlFiles.length} files)`);
