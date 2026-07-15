#!/usr/bin/env node
/**
 * Local deploy wrapper — a faithful local mirror of the culmat/forge-ci deploy pipeline
 * (.github/actions/forge-deploy/action.yml), so `npm run deploy` produces the SAME deploy-time
 * side effects as CI and never silently drifts from it.
 *
 * Per deploy it:
 *   1. stamps buildInfo.json (scripts/write-build-info.mjs)
 *   2. runs `forge deploy` (streamed live; stdout captured to read the assigned version)
 *   3. maintains the per-env `LATEST_VERSION` Forge variable (backport-safe semver guard) — the
 *      About tab's getVersionInfo resolver reads it to flag older-major installs
 *   4. NON-PRODUCTION only: `forge install --upgrade` (fresh-install fallback) on the env's site
 *   5. NON-DEVELOPMENT only: creates + force-pushes the `forge-<env>-v<version>` annotated tag
 *
 * CI-only aspects intentionally NOT replicated (they concern build *creation* — which `forge
 * deploy` does inline locally — not the deploy *result*): build-artifact reuse across parallel
 * env jobs, the forge lint/build CDN-retry wrappers, the `npm run lint && vitest --coverage`
 * gate, and the GitHub step summary. Run `npm test && npm run lint` before deploying (as CI's
 * pre-build-command does), or trigger the fully-gated pipeline directly instead of deploying local:
 *     gh workflow run forge-deploy.yml -f environment=<development|staging|production>
 *
 * Usage:
 *   npm run deploy                    # -> development
 *   npm run deploy -- -e staging      # -> staging     (+ install --upgrade, + tag)
 *   npm run deploy -- -e production   # -> production   (+ tag; install --upgrade skipped, as in CI)
 *
 * Env args pass straight through to `forge deploy`; we read -e/-environment to know the target.
 * The version is parsed from the forge output ([X.Y.Z …]) exactly as CI does.
 */

import { execSync, spawnSync } from 'node:child_process';

const FORGE = process.env.FORGE_CLI_BIN || 'forge';
const forgeArgs = process.argv.slice(2);

// Confluence sites per env — mirrors the site-* inputs in .github/workflows/forge-deploy.yml.
// Used only for the non-production `forge install --upgrade` step.
const SITES = {
  development: 'dev-cul.atlassian.net',
  staging: 'sta-cul.atlassian.net',
  production: 'cul.atlassian.net',
};

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
  console.warn('\nCould not parse the deployed version from forge output; skipping LATEST_VERSION, install --upgrade and tag.');
  process.exit(0);
}
maintainLatestVersionVar(envName, version);

// 4) Non-production: forge install --upgrade so the env's install picks up new scopes/egress.
if (envName !== 'production') {
  installUpgrade(envName, SITES[envName]);
}

// 5) Non-development: create + push the release tag (forge-<env>-v<version>).
if (envName !== 'development') {
  createReleaseTag(envName, version);
}

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

/**
 * Non-production only: `forge install --upgrade`, falling back to a fresh install when the site has
 * no existing installation. Mirrors forge-ci action.yml (run-install-non-production). Best-effort:
 * a failure is logged but does not abort — the deploy itself already succeeded.
 */
function installUpgrade(env, site) {
  if (!site) {
    console.warn(`\nNo site configured for env "${env}"; skipping install --upgrade.`);
    return;
  }
  const tail = ['--site', site, '--product', 'confluence', '-e', env];
  console.log(`\n==> forge install --upgrade (env=${env}, site=${site})`);
  const res = spawnSync(FORGE, ['install', '--non-interactive', '--upgrade', ...tail],
    { stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8' });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  process.stdout.write(out);
  if (res.status === 0) return;
  if (/Could not find an installation/i.test(out)) {
    console.log(`No existing installation on ${site} for env ${env} — performing a fresh install.`);
    const fresh = spawnSync(FORGE, ['install', '--non-interactive', ...tail], { stdio: 'inherit', encoding: 'utf8' });
    if (fresh.status !== 0) console.error(`Fresh install failed (rc=${fresh.status}); continuing.`);
  } else {
    console.error(`install --upgrade failed (rc=${res.status}); continuing.`);
  }
}

/**
 * Non-development only: create + force-push the `forge-<env>-v<version>` annotated tag, matching
 * forge-ci action.yml byte-for-byte (`git tag -af "$TAG" -m "Deployed to $ENV"` + `git push
 * --force`). Uses the local git identity (no bot override). Best-effort: a failure is logged, not fatal.
 */
function createReleaseTag(env, version) {
  const tag = `forge-${env}-v${version}`;
  try {
    execSync(`git tag -af "${tag}" -m "Deployed to ${env}"`, { stdio: 'inherit' });
    execSync(`git push origin "${tag}" --force`, { stdio: 'inherit' });
    console.log(`\nRelease tag ${tag} created and pushed.`);
  } catch (error) {
    console.error(`\nRelease tag ${tag} failed: ${error.message}. Continuing.`);
  }
}
