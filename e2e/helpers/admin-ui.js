/**
 * Admin UI automation helpers.
 * Interacts with the Digital Signature admin settings page to restore fixtures.
 */

const { expect } = require('@playwright/test');

// App ID from manifest.yml
const APP_UUID = 'bab5617e-dc42-4ca8-ad38-947c826fe58c';
const ADMIN_PATH = `/wiki/plugins/servlet/ac/${APP_UUID}/digital-signature-admin-settings`;

/**
 * Navigate to the Digital Signature admin page.
 *
 * @param {import('@playwright/test').Page} page
 */
async function navigateToAdmin(page) {
  await page.goto(ADMIN_PATH);

  // Wait for the Forge app iframe to load
  const iframe = page.frameLocator('iframe[id*="digital-signature"]');

  // Wait for admin UI to be ready (look for Administration heading or stats section)
  await expect(iframe.locator('text=Database Statistics')).toBeVisible({
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
  const iframe = page.frameLocator('iframe[id*="digital-signature"]');

  // Find the restore TextArea
  const textarea = iframe.getByPlaceholder('Paste backup data here');
  await expect(textarea).toBeVisible();

  // Clear and fill with SQL data
  await textarea.fill(sqlData);

  // Click "Restore from Backup" button
  await iframe.getByRole('button', { name: 'Restore from Backup' }).click();

  // Wait for restore to complete (success message)
  await expect(iframe.getByText('Restore completed successfully!')).toBeVisible({
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
