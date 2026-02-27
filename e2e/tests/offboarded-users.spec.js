const { expect } = require('@playwright/test');
const { test } = require('../fixtures/browser');
const { getCredentials, createTestPage, deleteTestPage } = require('../helpers/confluence-client');
const { generateMacroStorageFormat, generateRandomAccountId, generateFixtureWithMultipleSignatures } = require('../fixtures');
const { setupFixtures } = require('../helpers/admin-ui');

// Test configuration from environment
const TEST_SPACE = process.env.TEST_SPACE;
const BASE_URL = process.env.CONFLUENCE_HOST
  ? `https://${process.env.CONFLUENCE_HOST}`
  : '';

// Store created page info for cleanup
let createdPageId = null;

// Contract configuration for the test
const CONTRACT_CONFIG = {
  title: 'Offboarded Users Contract',
  content: 'This contract was signed by team members who have since left the organization.',
};

test.describe('Offboarded Users', () => {
  test.beforeAll(async () => {
    if (!TEST_SPACE) {
      throw new Error('TEST_SPACE environment variable is required.');
    }
    getCredentials(); // Validates credentials are available
  });

  test.afterAll(async ({ browser }) => {
    if (createdPageId) {
      const context = browser.contexts()[0] || await browser.newContext();
      const page = context.pages()[0] || await context.newPage();

      if (!page.url().includes('/wiki')) {
        await page.goto(`${BASE_URL}/wiki`);
      }

      await deleteTestPage(page, createdPageId);
      console.log(`Deleted test page: ${createdPageId}`);
    }
  });

  test('displays signatures from 3 offboarded users', async ({ page }) => {
    // Navigate to Confluence
    await page.goto(`${BASE_URL}/wiki`);

    // Create test page with the macro
    const storageBody = generateMacroStorageFormat(CONTRACT_CONFIG);
    const title = `E2E-Offboarded-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    createdPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Generate 3 random account IDs (simulating offboarded users)
    const offboardedUsers = [
      generateRandomAccountId(),
      generateRandomAccountId(),
      generateRandomAccountId(),
    ];
    console.log(`Offboarded user IDs: ${offboardedUsers.join(', ')}`);

    // Generate and restore SQL fixtures
    const sql = generateFixtureWithMultipleSignatures(testPage.id, offboardedUsers, CONTRACT_CONFIG);
    await setupFixtures(page, sql);
    console.log('Restored fixtures via admin UI');

    // Navigate to test page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for macro to load
    await expect(page.getByRole('button', { name: 'Sign' })).toBeVisible({ timeout: 15000 });

    // Verify "Signed (3)" counter
    await expect(page.getByText('Signed (3)')).toBeVisible();

    // Verify 3 signature entries are rendered (disabled checkboxes indicate signed)
    // The User component should render placeholders for unknown users
    const signatureCheckboxes = page.locator('input[type="checkbox"][disabled]');
    await expect(signatureCheckboxes).toHaveCount(3);

    // Verify contract content is still visible
    await expect(page.getByText('team members who have since left')).toBeVisible();
  });
});
