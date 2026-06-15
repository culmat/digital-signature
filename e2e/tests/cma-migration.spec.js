/**
 * End-to-end CMA migration test — the browser-driven phases.
 *
 * This spec is NOT meant to be run on its own. The orchestrator
 * (scripts/cma-e2e-test.sh) runs it one phase at a time by setting CMA_PHASE,
 * interleaving with the Docker / fixture / forge-logs phases it owns. Each test
 * below skips unless it is the selected phase, so `workers: 1` drives a single
 * browser step per invocation.
 *
 * Required env (see e2e/.env.example):
 *   CMA_PHASE          one of: reset | darkon | migrate | darkoff | wizard | verify
 *   CMA_SPACE_KEY      the fresh space key for this run (Server + Cloud)
 *   CMA_PREV_SPACE_KEY (reset only) previous run's Cloud space to delete (optional)
 *   CMA_MANUAL_MIGRATE (migrate only) "1" → just open the assistant; human + the
 *                      orchestrator complete and gate the migration
 *   CONFLUENCE_HOST, FORGE_ENV_ID, SERVER_BASE_URL, FORGE_EMAIL/API_TOKEN …
 */

const { test } = require('../fixtures/browser');
const { expect } = require('@playwright/test');
const { getStatistics } = require('../helpers/admin-ui');
const { scanAndConvert } = require('../helpers/migration-wizard');
const { deleteCloudSpace, dangerZoneDeleteAll } = require('../helpers/cloud-reset');
const {
  enableDarkFeature,
  disableDarkFeature,
  openMigrationAssistant,
  runMigration,
} = require('../helpers/server-cma');
const expected = require('../fixtures/cma-expected');

const PHASE = process.env.CMA_PHASE || '';
const SPACE_KEY = process.env.CMA_SPACE_KEY || '';
const PREV_SPACE_KEY = process.env.CMA_PREV_SPACE_KEY || '';
const MANUAL_MIGRATE = process.env.CMA_MANUAL_MIGRATE === '1';

/** Declare a test that only runs when CMA_PHASE matches. */
function phase(name, timeoutMs, fn) {
  test(`cma:${name}`, async ({ page }, testInfo) => {
    test.skip(PHASE !== name, `CMA_PHASE=${PHASE || '(unset)'} — skipping ${name}`);
    testInfo.setTimeout(timeoutMs);
    await fn(page);
  });
}

test.describe.configure({ mode: 'serial' });

// reset: clean Cloud state so the run is repeatable.
phase('reset', 120_000, async (page) => {
  if (PREV_SPACE_KEY) {
    const r = await deleteCloudSpace(page, PREV_SPACE_KEY);
    console.log(`[reset] deleteCloudSpace(${PREV_SPACE_KEY}) → ${r.status}`);
  }
  const wiped = await dangerZoneDeleteAll(page);
  console.log(`[reset] dangerZoneDeleteAll → ${wiped ? 'wiped' : 'tab not available (ENABLE_DELETE_ALL?)'}`);
});

// darkon: enable CMA dev mode on the Server.
phase('darkon', 60_000, async (page) => {
  await enableDarkFeature(page);
});

// migrate: run the CMA migration (or open the assistant for a manual checkpoint).
phase('migrate', 17 * 60_000, async (page) => {
  if (MANUAL_MIGRATE) {
    await openMigrationAssistant(page);
    console.log('[migrate] Manual mode — complete the migration in the browser; the orchestrator will wait.');
    return;
  }
  await runMigration(page, { spaceKey: SPACE_KEY });
});

// darkoff: disable CMA dev mode on the Server.
phase('darkoff', 60_000, async (page) => {
  await disableDarkFeature(page);
});

// wizard: convert Server-format macros to Forge ADF via the admin Migration tab.
phase('wizard', 180_000, async (page) => {
  const { found, summary } = await scanAndConvert(page, SPACE_KEY);
  console.log(`[wizard] ${found} | ${summary}`);
  expect(summary).not.toMatch(/[1-9]\d* errors/); // no conversion errors
});

// verify: the development installation's stats match the expected fixture counts.
phase('verify', 120_000, async (page) => {
  const stats = await getStatistics(page);
  console.log(`[verify] stats: ${JSON.stringify(stats)} | expected contracts=${expected.contracts} signatures=${expected.signatures}`);
  expect(stats.totalContracts).toBe(expected.contracts);
  expect(stats.totalSignatures).toBe(expected.signatures);
  expect(stats.deletedContracts).toBe(0);
});
