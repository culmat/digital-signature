/**
 * preview-site.mjs
 *
 * Live-preview the culm.at website with THIS repo's `site/` content, before pushing.
 *
 * The website is a separate Astro repo (culm-at/culm-at.github.io) that reads content from
 * sibling repos at build/dev time (it resolves `../digital-signature`). Its dev server watches
 * the sibling `site/*.md` and hot-reloads, so editing files here shows up live at
 * http://localhost:4321/digital-signature/<slug>/.
 *
 * This script makes that one command from the content repo:
 *   - clones ../culm-at.github.io if it isn't already a sibling,
 *   - installs its deps (first run only) and its sibling sources (`setup:sources --clone`),
 *   - starts `bun run dev` (blocks; Ctrl-C to stop).
 *
 * Usage:  bun run site   (or: node scripts/preview-site.mjs)
 *
 * Note: this previews against the site theme in ../culm-at.github.io. To preview unpushed THEME
 * (CSS/layout) changes too, edit them in that sibling checkout before running.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SITE_REPO = "culm-at.github.io";
const SITE_REPO_URL = "https://github.com/culm-at/culm-at.github.io.git";

const contentRepo = path.resolve(import.meta.dirname, "..");
const parent = path.resolve(contentRepo, "..");
const siteDir = path.join(parent, SITE_REPO);

function run(cmd, args, cwd) {
  console.log(`\n\x1b[1;34m==>\x1b[0m ${cmd} ${args.join(" ")}  (in ${path.basename(cwd)})`);
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.error) {
    if (res.error.code === "ENOENT") {
      console.error(`\n[preview-site] '${cmd}' not found. Install it and retry (the site uses bun).`);
    } else {
      console.error(`\n[preview-site] ${cmd} failed: ${res.error.message}`);
    }
    process.exit(1);
  }
  if (typeof res.status === "number" && res.status !== 0) process.exit(res.status);
}

// 1. Ensure the sibling website repo exists.
if (!fs.existsSync(siteDir)) {
  console.log(`[preview-site] ${SITE_REPO} not found next to this repo — cloning into ${siteDir}`);
  run("git", ["clone", SITE_REPO_URL, siteDir], parent);
} else {
  console.log(`[preview-site] using existing ${siteDir}`);
}

// 2. Install deps on first run.
if (!fs.existsSync(path.join(siteDir, "node_modules"))) {
  run("bun", ["install"], siteDir);
}

// 3. Ensure the website's sibling content sources are present (auto-clones any that are missing,
//    e.g. information-classification; this repo is already present as the sibling it reads).
run("bun", ["run", "setup:sources", "--clone"], siteDir);

// 4. Start the dev server (blocks). Content edits under this repo's site/ hot-reload.
console.log(
  `\n[preview-site] starting dev server — open http://localhost:4321/digital-signature/  (Ctrl-C to stop)`,
);
run("bun", ["run", "dev"], siteDir);
