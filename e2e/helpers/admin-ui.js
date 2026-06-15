/**
 * Admin UI automation helpers.
 * Interacts with the Digital Signature admin settings page to restore fixtures.
 */

const { expect } = require('@playwright/test');
const { getAppId } = require('./manifest');

// App ID parsed from manifest.yml
const APP_UUID = getAppId();
// Environment ID is installation-specific - must be configured
const ENV_ID = process.env.FORGE_ENV_ID;
const ADMIN_PATH = `/wiki/admin/forge/apps/${APP_UUID}/${ENV_ID}/digital-signature-admin-settings`;

// Construct full URL from env var
const BASE_URL = process.env.CONFLUENCE_HOST
  ? `https://${process.env.CONFLUENCE_HOST}`
  : '';
const ADMIN_URL = `${BASE_URL}${ADMIN_PATH}`;

/**
 * Dismiss any blocking dialogs (e.g., Confluence promotion dialogs).
 *
 * @param {import('@playwright/test').Page} page
 */
async function dismissDialogs(page) {
  // Check for common Confluence dialogs and dismiss them
  const okButton = page.getByRole('dialog').getByRole('button', { name: 'OK' });
  if (await okButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await okButton.click();
    // Wait for dialog to disappear
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
}

/**
 * Navigate to the Digital Signature admin page.
 *
 * @param {import('@playwright/test').Page} page
 */
async function navigateToAdmin(page) {
  await page.goto(ADMIN_URL);

  // Wait for admin UI to be ready (Forge native render - no iframe)
  await expect(page.getByText('Database Statistics')).toBeVisible({
    timeout: 30000,
  });

  // Dismiss any blocking dialogs
  await dismissDialogs(page);
}

/**
 * Restore fixture data via the admin UI TextArea.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} sqlData - Plain SQL statements (INSERT statements)
 */
async function restoreFixtures(page, sqlData) {
  // Forge native render - no iframe, interact directly with page

  // Find the restore TextArea
  const textarea = page.getByPlaceholder('Paste backup data here (base64 or plain SQL)...');
  await expect(textarea).toBeVisible();

  // Clear and fill with SQL data
  await textarea.fill(sqlData);

  // Click "Restore from Backup" button
  await page.getByRole('button', { name: 'Restore from Backup' }).click();

  // Wait for restore to complete (success message)
  await expect(page.getByText('Restore completed successfully!')).toBeVisible({
    timeout: 30000,
  });
}

/**
 * Navigate to admin and restore fixtures in one step.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} sqlData
 */
async function setupFixtures(page, sqlData) {
  await navigateToAdmin(page);
  await restoreFixtures(page, sqlData);
}

/**
 * Read statistics from the admin page.
 * Navigates to admin and parses the DynamicTable values.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{totalContracts: number, activeContracts: number, deletedContracts: number, totalSignatures: number}>}
 */
async function getStatistics(page) {
  await navigateToAdmin(page);

  // Wait for statistics table to load (table has rows with metric names)
  await expect(page.getByText('Active Contracts')).toBeVisible({ timeout: 10000 });

  // Read the value cell (2nd td) of the row whose metric-name cell matches `label`.
  const readMetric = async (label) => {
    const row = page.locator('tr', { has: page.getByText(label, { exact: true }) });
    return parseInt(await row.locator('td').nth(1).textContent(), 10);
  };

  return {
    totalContracts: await readMetric('Total Contracts'),
    activeContracts: await readMetric('Active Contracts'),
    deletedContracts: await readMetric('Deleted Contracts'),
    totalSignatures: await readMetric('Total Signatures'),
  };
}

/**
 * Navigate to the admin page and switch to the "Migration" tab.
 *
 * @param {import('@playwright/test').Page} page
 */
async function navigateToMigrationTab(page) {
  await navigateToAdmin(page);
  await page.getByRole('tab', { name: 'Migration' }).click();
  // The migration tab shows its tool heading once active.
  await expect(page.getByText('Migration Tools')).toBeVisible({ timeout: 10000 });
}

module.exports = {
  navigateToAdmin,
  navigateToMigrationTab,
  restoreFixtures,
  setupFixtures,
  getStatistics,
  ADMIN_PATH,
};
