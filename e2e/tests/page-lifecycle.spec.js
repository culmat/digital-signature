const { expect } = require('@playwright/test');
const { test } = require('../fixtures/browser');
const { getCredentials, createTestPage, deleteTestPage, purgeTestPage } = require('../helpers/confluence-client');
const { getStatistics } = require('../helpers/admin-ui');
const { generateMacroStorageFormat } = require('../fixtures');

const TEST_SPACE = process.env.TEST_SPACE;
const BASE_URL = process.env.CONFLUENCE_HOST
  ? `https://${process.env.CONFLUENCE_HOST}`
  : '';

// Time to wait for Forge event handlers to process (triggers are async)
const EVENT_PROCESSING_DELAY_MS = 5000;

let createdPageId = null;

test.describe('Page Lifecycle Events', () => {
  // This test involves multiple page navigations and waits for async event processing
  test.setTimeout(90000);

  test.beforeAll(async () => {
    if (!TEST_SPACE) {
      throw new Error('TEST_SPACE environment variable is required.');
    }
    getCredentials();
  });

  test.afterAll(async ({ browser }) => {
    // Cleanup: purge page if test failed before purging
    if (createdPageId) {
      try {
        const context = browser.contexts()[0] || await browser.newContext();
        const page = context.pages()[0] || await context.newPage();

        if (!page.url().includes('/wiki')) {
          await page.goto(`${BASE_URL}/wiki`);
        }

        await purgeTestPage(page, createdPageId);
        console.log(`Cleanup: purged test page ${createdPageId}`);
      } catch (error) {
        console.warn(`Cleanup failed for page ${createdPageId}:`, error.message);
      }
    }
  });

  test('soft deletes contracts on page trash, hard deletes on purge', async ({ page }) => {
    // Navigate to Confluence (needed for API calls)
    await page.goto(`${BASE_URL}/wiki`);

    // Create test page with digital signature macro
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Lifecycle Test Contract',
      content: 'Test contract for page lifecycle event verification.',
    });
    const title = `Lifecycle-Test-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    createdPageId = testPage.id;
    console.log(`Created test page: ${testPage.id}`);

    // Navigate to page and sign the document
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    const signButton = page.getByRole('button', { name: 'Sign' });
    await expect(signButton).toBeVisible({ timeout: 15000 });
    await signButton.click();

    // Wait for signing to complete
    await expect(page.getByText(/Signed \(\d+\)/)).toBeVisible({ timeout: 15000 });
    console.log('Document signed');

    // Read statistics before deletion
    const statsBefore = await getStatistics(page);
    console.log('Stats before trash:', statsBefore);

    // Delete page (moves to trash) - this triggers avi:confluence:trashed:page
    await deleteTestPage(page, testPage.id);
    console.log('Page moved to trash');

    // Wait for Forge event handler to process
    await page.waitForTimeout(EVENT_PROCESSING_DELAY_MS);

    // Read statistics after trashing
    const statsAfterTrash = await getStatistics(page);
    console.log('Stats after trash:', statsAfterTrash);

    // Assert: Active Contracts decreased, Deleted Contracts increased
    expect(statsAfterTrash.activeContracts).toBe(statsBefore.activeContracts - 1);
    expect(statsAfterTrash.deletedContracts).toBe(statsBefore.deletedContracts + 1);
    // Total Signatures should remain unchanged (soft delete)
    expect(statsAfterTrash.totalSignatures).toBe(statsBefore.totalSignatures);

    const totalSignaturesBeforePurge = statsAfterTrash.totalSignatures;

    // Purge page (permanently delete) - this triggers avi:confluence:deleted:page
    await purgeTestPage(page, testPage.id);
    console.log('Page purged from trash');
    createdPageId = null; // Clear so afterAll doesn't try to purge again

    // Wait for Forge event handler to process
    await page.waitForTimeout(EVENT_PROCESSING_DELAY_MS);
    console.log('Reading stats after purge...');

    // Read statistics after purging
    const statsAfterPurge = await getStatistics(page);
    console.log('Stats after purge:', statsAfterPurge);

    // Assert: Deleted Contracts decreased, Total Signatures decreased
    expect(statsAfterPurge.deletedContracts).toBe(statsAfterTrash.deletedContracts - 1);
    expect(statsAfterPurge.totalSignatures).toBeLessThan(totalSignaturesBeforePurge);
  });
});
