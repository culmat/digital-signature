/**
 * Admin UI automation helpers.
 * Interacts with the Digital Signature admin settings page to restore fixtures.
 */

const { expect } = require('@playwright/test');

// App ID from manifest.yml
const APP_UUID = 'bab5617e-dc42-4ca8-ad38-947c826fe58c';
// Environment ID is installation-specific - must be configured
const ENV_ID = process.env.FORGE_ENV_ID;
const ADMIN_PATH = `/wiki/admin/forge/apps/${APP_UUID}/${ENV_ID}/digital-signature-admin-settings`;

// Construct full URL from env var
const BASE_URL = process.env.CONFLUENCE_HOST
  ? `https://${process.env.CONFLUENCE_HOST}`
  : '';
const ADMIN_URL = `${BASE_URL}${ADMIN_PATH}`;

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

module.exports = { navigateToAdmin, restoreFixtures, setupFixtures, ADMIN_PATH };
