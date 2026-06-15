/**
 * Cloud-side reset helpers for the repeatable CMA migration test.
 *
 * Two independent clean-ups:
 *  1. deleteCloudSpace() — remove the migrated Confluence space (pages) on the Cloud site.
 *  2. dangerZoneDeleteAll() — wipe the development installation's contract/signature SQL
 *     via the admin "Danger Zone" tab (only rendered when ENABLE_DELETE_ALL=true).
 *
 * REST calls use the browser's fetch (page.evaluate) to match confluence-client.js
 * and work behind corporate proxies.
 */

const { expect } = require('@playwright/test');
const { getCredentials } = require('./confluence-client');
const { navigateToAdmin } = require('./admin-ui');

/**
 * Delete a Confluence Cloud space (and all its pages). Idempotent — a missing
 * space is treated as success.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} spaceKey
 * @returns {Promise<{status: number, ok: boolean}>}
 */
async function deleteCloudSpace(page, spaceKey) {
  if (!spaceKey) throw new Error('deleteCloudSpace requires a spaceKey');
  const { baseUrl, auth } = getCredentials();

  return page.evaluate(
    async ({ baseUrl, auth, spaceKey }) => {
      const res = await fetch(`${baseUrl}/rest/api/space/${encodeURIComponent(spaceKey)}`, {
        method: 'DELETE',
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      });
      // 202 Accepted → long-running delete task queued; 404 → already gone.
      return { status: res.status, ok: res.ok || res.status === 404 };
    },
    { baseUrl, auth, spaceKey }
  );
}

/**
 * Wipe all contract/signature rows in the current installation via the admin
 * Danger Zone tab. Requires ENABLE_DELETE_ALL=true on the target environment so
 * the tab renders. No-op-safe: returns false if the Danger Zone tab is absent.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>} true if a deletion was performed
 */
async function dangerZoneDeleteAll(page) {
  await navigateToAdmin(page);

  const dangerTab = page.getByRole('tab', { name: 'Danger Zone' });
  if (!(await dangerTab.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false; // ENABLE_DELETE_ALL not set on this environment
  }
  await dangerTab.click();

  await page.getByRole('button', { name: 'Delete All Data' }).click();
  await page.getByRole('button', { name: 'Yes, Delete Everything' }).click();

  await expect(page.getByText('Deletion Complete')).toBeVisible({ timeout: 30000 });
  return true;
}

module.exports = { deleteCloudSpace, dangerZoneDeleteAll };
