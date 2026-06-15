/**
 * Drives the Forge admin "Migration" tab (the post-CMA macro-rewrite wizard).
 *
 * This is the in-app wizard that converts Server-format `<ac:structured-macro>`
 * markup to Forge ADF. It does NOT write contract/signature rows — that is the
 * CMA app-data import (src/migration/index.js). See docs/cma-migration-e2e.md.
 *
 * Text labels mirror src/i18n/en.json (admin.migration.*).
 */

const { expect } = require('@playwright/test');
const { navigateToMigrationTab } = require('./admin-ui');

/**
 * Scan a space for legacy macros and convert them all to Forge ADF.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} spaceKey - Space to scan (required; avoids scanning all spaces)
 * @returns {Promise<{found: string, summary: string}>} visible result strings
 */
async function scanAndConvert(page, spaceKey) {
  if (!spaceKey) throw new Error('scanAndConvert requires a spaceKey');

  await navigateToMigrationTab(page);

  // Enter the space key into the scan TextArea.
  const spaceInput = page.getByPlaceholder('Space key (leave empty to scan all spaces)');
  await expect(spaceInput).toBeVisible({ timeout: 10000 });
  await spaceInput.fill(spaceKey);

  // Scan.
  await page.getByRole('button', { name: 'Scan for Legacy Macros' }).click();

  // Either "Found N pages with M legacy macros" or the empty-result message.
  const foundMsg = page.getByText(/Found \d+ pages with \d+ legacy macros/);
  const emptyMsg = page.getByText('No pages with legacy Server macros found.');
  await expect(foundMsg.or(emptyMsg)).toBeVisible({ timeout: 60000 });

  if (await emptyMsg.isVisible().catch(() => false)) {
    return { found: 'none', summary: '0 converted, 0 skipped, 0 errors' };
  }

  const found = (await foundMsg.textContent())?.trim() || '';

  // Convert all scanned pages.
  await page.getByRole('button', { name: 'Convert All' }).click();

  // Wait for the conversion summary ("{n} converted, {n} skipped, {n} errors").
  await expect(page.getByText('Conversion Complete')).toBeVisible({ timeout: 120000 });
  const summaryLine = page.getByText(/\d+ converted, \d+ skipped, \d+ errors/);
  await expect(summaryLine).toBeVisible({ timeout: 10000 });
  const summary = (await summaryLine.textContent())?.trim() || '';

  return { found, summary };
}

module.exports = { scanAndConvert };
