/**
 * sync-wiki.mjs
 *
 * Copies site/ content into the GitHub Wiki repo as a one-way mirror.
 * The wiki repo must already be cloned at the path given by --wiki-dir (or WIKI_DIR env var).
 *
 * Usage:
 *   bun run scripts/sync-wiki.mjs --wiki-dir /path/to/digital-signature.wiki
 *
 * Mapping rules:
 *   site/index.md  → wiki/Home.md
 *   site/foo.md    → wiki/foo.md
 *   site/nav.yml   → (skipped — not a wiki page)
 *
 * Files present in the wiki but absent from site/ are removed so the wiki
 * stays a clean mirror.
 */

import fs from "node:fs";
import path from "node:path";

const SITE_DIR = path.resolve(import.meta.dirname, "..", "site");
const SKIP_FILES = new Set(["nav.yml"]);

function wikiName(siteFile) {
  if (siteFile === "index.md") return "Home.md";
  return siteFile;
}

function siteName(wikiFile) {
  if (wikiFile === "Home.md") return "index.md";
  return wikiFile;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let wikiDir = process.env.WIKI_DIR ?? null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--wiki-dir" && args[i + 1]) {
      wikiDir = args[++i];
    }
  }
  return { wikiDir };
}

const { wikiDir } = parseArgs();

if (!wikiDir) {
  console.error(
    "Error: provide --wiki-dir <path> or set the WIKI_DIR environment variable."
  );
  process.exit(1);
}

const resolvedWikiDir = path.resolve(wikiDir);

if (!fs.existsSync(resolvedWikiDir)) {
  console.error(`Error: wiki directory not found: ${resolvedWikiDir}`);
  process.exit(1);
}

if (!fs.existsSync(SITE_DIR)) {
  console.error(`Error: site directory not found: ${SITE_DIR}`);
  process.exit(1);
}

// --- Copy site/ → wiki ---

const siteFiles = fs
  .readdirSync(SITE_DIR)
  .filter((f) => f.endsWith(".md") && !SKIP_FILES.has(f));

for (const siteFile of siteFiles) {
  const src = path.join(SITE_DIR, siteFile);
  const dst = path.join(resolvedWikiDir, wikiName(siteFile));
  fs.copyFileSync(src, dst);
  console.log(`copied: ${siteFile} → ${path.basename(dst)}`);
}

// --- Remove wiki .md files that are no longer in site/ ---

const expectedWikiFiles = new Set(siteFiles.map(wikiName));

const wikiFiles = fs
  .readdirSync(resolvedWikiDir)
  .filter((f) => f.endsWith(".md"));

for (const wikiFile of wikiFiles) {
  if (!expectedWikiFiles.has(wikiFile)) {
    // Ignore wiki files that have no site/ counterpart (e.g. pages added
    // directly to the wiki) — only remove files that were previously synced.
    // We identify synced files as those whose site-name counterpart would be
    // a plain .md file (i.e. not something exotic like a sidebar).
    const counterpart = siteName(wikiFile);
    if (counterpart.endsWith(".md")) {
      fs.rmSync(path.join(resolvedWikiDir, wikiFile));
      console.log(`removed stale: ${wikiFile}`);
    }
  }
}

console.log("Wiki sync complete.");
