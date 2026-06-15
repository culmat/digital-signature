/**
 * Drives the Confluence Server/DC side of a CMA migration via the browser.
 *
 *  - enableDarkFeature / disableDarkFeature: toggle a SITE dark feature
 *    (we use `migration-assistant.app-migration.dev-mode`) via /admin/darkfeatures.action.
 *  - openMigrationAssistant: navigate to the Cloud Migration Assistant.
 *  - runMigration: best-effort drive of the migration wizard to completion.
 *
 * The CMA wizard DOM is Confluence-version-specific and is the most fragile part
 * of the automation. Locators here are intentionally text/role based and generous;
 * if they drift, run the `migrate` phase as a manual checkpoint (the orchestrator
 * prompts) and let this module handle only the dark-feature toggles.
 *
 * The CDP browser session must already be logged into the Server as an admin.
 */

const { expect } = require('@playwright/test');

const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:9090';
const SERVER_PASS = process.env.SERVER_PASS || 'admin';
const DEV_MODE_FEATURE = 'migration-assistant.app-migration.dev-mode';

/** Re-enter the admin password if Confluence shows a websudo (secure admin) prompt. */
async function passWebSudoIfPresent(page) {
  const pwd = page.locator('#authenticatePassword, input[name="password"]').first();
  if (await pwd.isVisible({ timeout: 3000 }).catch(() => false)) {
    await pwd.fill(SERVER_PASS);
    const confirm = page.getByRole('button', { name: /Confirm|Authenticate|Login/i }).first();
    await confirm.click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  }
}

/**
 * Enable a site dark feature via the admin Dark Features page.
 * Idempotent — enabling an already-enabled feature is a no-op.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [feature=DEV_MODE_FEATURE]
 */
async function enableDarkFeature(page, feature = DEV_MODE_FEATURE) {
  await page.goto(`${SERVER_BASE_URL}/admin/darkfeatures.action`);
  await passWebSudoIfPresent(page);

  // Already enabled? The feature key shows in the enabled list.
  if (await page.getByText(feature, { exact: false }).first().isVisible({ timeout: 3000 }).catch(() => false)) {
    return;
  }

  // The page exposes a text input to add a site dark feature key.
  const input = page.locator('input[type="text"]').first();
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(feature);
  await page.getByRole('button', { name: /Add|Enable/i }).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByText(feature, { exact: false }).first()).toBeVisible({ timeout: 10000 });
}

/**
 * Disable a site dark feature via the admin Dark Features page.
 * Idempotent — disabling an absent feature is a no-op.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [feature=DEV_MODE_FEATURE]
 */
async function disableDarkFeature(page, feature = DEV_MODE_FEATURE) {
  await page.goto(`${SERVER_BASE_URL}/admin/darkfeatures.action`);
  await passWebSudoIfPresent(page);

  const row = page.locator('tr, li', { has: page.getByText(feature, { exact: false }) }).first();
  if (!(await row.isVisible({ timeout: 3000 }).catch(() => false))) {
    return; // not enabled
  }
  await row.getByRole('button', { name: /Remove|Disable|Delete/i }).first()
    .or(row.getByRole('link', { name: /Remove|Disable|Delete/i }).first())
    .click();
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Navigate to the Cloud Migration Assistant landing page.
 * @param {import('@playwright/test').Page} page
 */
async function openMigrationAssistant(page) {
  // Confluence exposes CMA under the admin plugins servlet.
  await page.goto(`${SERVER_BASE_URL}/plugins/servlet/ial/migration/home`);
  await passWebSudoIfPresent(page);
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Best-effort drive of the CMA wizard: create a migration that includes the given
 * space and the Digital Signature app, then run it and wait for completion.
 *
 * Throws a descriptive error if the wizard layout can't be navigated, so the
 * caller can fall back to a manual checkpoint.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{spaceKey: string, planName?: string, timeoutMs?: number}} opts
 */
async function runMigration(page, { spaceKey, planName, timeoutMs = 15 * 60 * 1000 }) {
  if (!spaceKey) throw new Error('runMigration requires a spaceKey');
  const name = planName || `ds-e2e-${spaceKey}`;

  await openMigrationAssistant(page);

  // Start a new migration plan.
  const createBtn = page.getByRole('button', { name: /Create.*migration|New migration|Migrate/i }).first();
  if (!(await createBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
    throw new Error(
      'CMA wizard "create migration" control not found — run the `migrate` phase manually ' +
      '(set CMA_MANUAL_MIGRATE=1) and complete the wizard in the browser.'
    );
  }
  await createBtn.click();

  // Name the plan.
  const nameInput = page.getByLabel(/name/i).first();
  if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await nameInput.fill(name);
  }

  // Choose the space + the app. These steps vary by Confluence version; we select
  // by visible text where possible and proceed through "Next"/"Continue".
  await page.getByText(spaceKey, { exact: false }).first().click().catch(() => {});
  await page.getByText(/Digital Signature/i).first().click().catch(() => {});

  // Walk through any Next/Continue steps, then run.
  for (let i = 0; i < 6; i++) {
    const next = page.getByRole('button', { name: /Next|Continue/i }).first();
    if (await next.isVisible({ timeout: 2000 }).catch(() => false)) {
      await next.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    } else {
      break;
    }
  }
  const runBtn = page.getByRole('button', { name: /Run|Start migration|Confirm/i }).first();
  await expect(runBtn).toBeVisible({ timeout: 10000 });
  await runBtn.click();

  // Poll for a terminal status.
  await expect(
    page.getByText(/Complete|Finished|Successful/i).first()
  ).toBeVisible({ timeout: timeoutMs });
}

module.exports = {
  SERVER_BASE_URL,
  DEV_MODE_FEATURE,
  enableDarkFeature,
  disableDarkFeature,
  openMigrationAssistant,
  runMigration,
};
