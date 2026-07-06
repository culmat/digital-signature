#!/usr/bin/env node
/**
 * Local deploy wrapper — parity with the CI `maintain-latest-version` step.
 *
 * Does what `npm run deploy` used to do (write build info, then `forge deploy`),
 * PLUS maintains the per-environment `LATEST_VERSION` Forge variable that the
 * About tab reads (src/resolvers/versionInfoResolver.js) to render the
 * "upgrade available" hint. CI used to keep this variable current; since the
 * GitHub pipeline can't reach Atlassian's CDN (see the CI CDN issue), local
 * deploys are now the source of truth and must maintain it themselves.
 *
 * Usage:
 *   npm run deploy                       # -> development (forge deploy default)
 *   npm run deploy -- -e production      # -> production, maintains prod LATEST_VERSION
 *   npm run deploy -- -e staging --verbose
 *
 * All argv is passed straight through to `forge deploy`; we only *read* -e/-environment
 * to know which environment's LATEST_VERSION to update.
 *
 * The version pointer is derived from the `forge deploy` output ([X.Y.Z ...]), the same
 * regex CI uses. Backport guard: only overwrite when the new version is strictly greater.
 * Note: a changed Forge variable only takes effect on the *next* deploy (Forge injects
 * variables at deploy time) — same eventual-consistency behavior as CI.
 */

import { execSync, spawnSync } from 'node:child_process';

const FORGE = process.env.FORGE_CLI_BIN || 'forge';
const forgeArgs = process.argv.slice(2);

/** Read the target environment from the passed-through args (default: development). */
function resolveEnv(args) {
  for (let i = 0; i < args.length; i += 1) {
    if ((args[i] === '-e' || args[i] === '--environment') && args[i + 1]) {
      return args[i + 1];
    }
    const inline = args[i].match(/^(?:-e|--environment)=(.+)$/);
    if (inline) return inline[1];
  }
  return 'development';
}

const envName = resolveEnv(forgeArgs);

// 1) Stamp buildInfo.json (unchanged behavior).
execSync('node scripts/write-build-info.mjs', { stdio: 'inherit' });

// 2) forge deploy — stream live (interactive prompts still work) while capturing stdout.
console.log(`\n==> forge deploy (env=${envName})  args: ${forgeArgs.join(' ') || '(none)'}`);
let captured = '';
const child = spawnSync(FORGE, ['deploy', ...forgeArgs], {
  stdio: ['inherit', 'pipe', 'inherit'],
  encoding: 'utf8',
});
if (child.stdout) {
  captured = child.stdout;
  process.stdout.write(child.stdout);
}
if (child.status !== 0) {
  console.error(`\nforge deploy exited with code ${child.status}; not touching LATEST_VERSION.`);
  process.exit(child.status ?? 1);
}

// 3) Maintain LATEST_VERSION for the deployed environment (backport-safe).
const versionMatch = captured.match(/\[(\d+\.\d+\.\d+)/);
const version = versionMatch ? versionMatch[1] : '';
if (!version) {
  console.warn('\nCould not parse the deployed version from forge output; skipping LATEST_VERSION.');
  process.exit(0);
}
maintainLatestVersionVar(envName, version);

// ── helpers (mirror forge-ci/.github/actions/forge-deploy/deploy-forge.mjs) ──

function parseSemver(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Current LATEST_VERSION: value string, `null` if absent, `undefined` on CLI/parse error. */
function readStoredLatestVersion(env) {
  let raw;
  try {
    raw = execSync(`${FORGE} variables list -e "${env}" --json`, { encoding: 'utf8' });
  } catch (error) {
    console.warn(`Failed to read current LATEST_VERSION: ${error.message}. Will skip update.`);
    return undefined;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`Could not parse 'variables list --json': ${error.message}. Will skip update.`);
    return undefined;
  }
  if (Array.isArray(parsed)) {
    const entry = parsed.find((e) => e && (e.key ?? e.name) === 'LATEST_VERSION');
    return entry?.value ?? null;
  }
  if (parsed && typeof parsed === 'object') return parsed.LATEST_VERSION ?? null;
  return null;
}

function maintainLatestVersionVar(env, newVersion) {
  const stored = readStoredLatestVersion(env);
  const before = stored ?? '';
  let action;

  if (stored === undefined) {
    action = 'skipped-read-error';
  } else if (!parseSemver(newVersion)) {
    action = 'skipped-unparseable-new';
  } else if (stored === null) {
    action = 'initialized';
  } else {
    const cmp = compareSemver(newVersion, stored);
    if (cmp === null) action = 'initialized-overwrite-corrupt';
    else if (cmp <= 0) action = 'skipped-downgrade';
    else action = 'updated';
  }

  if (action === 'initialized' || action === 'updated' || action === 'initialized-overwrite-corrupt') {
    try {
      execSync(`${FORGE} variables set -e "${env}" LATEST_VERSION "${newVersion}"`, { stdio: 'inherit' });
      console.log(`\nLATEST_VERSION ${action}: "${before}" -> "${newVersion}" (activates on next deploy).`);
    } catch (error) {
      console.error(`Failed to set LATEST_VERSION: ${error.message}. Continuing.`);
    }
  } else {
    console.log(`\nLATEST_VERSION ${action}: stored "${before}", deployed "${newVersion}".`);
  }
}
