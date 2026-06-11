#!/usr/bin/env node
/**
 * Generates src/shared/buildInfo.json with the commit SHA that was built.
 * The full SHA links the About tab to the matching GitHub commit.
 *
 * Runs in two contexts:
 *   - CI: reads $GITHUB_SHA from the GitHub Actions runner.
 *   - Local (tunnel / manual build): falls back to `git rev-parse HEAD`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';

const commitSha =
  process.env.GITHUB_SHA ||
  execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

const outPath = 'src/shared/buildInfo.json';
mkdirSync(dirname(outPath), { recursive: true });

const payload = {
  commitSha,
  commitShaShort: commitSha.slice(0, 7),
};

writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`wrote ${outPath} @ ${payload.commitShaShort}`);
