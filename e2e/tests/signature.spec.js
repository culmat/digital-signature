const { expect } = require('@playwright/test');
const { test } = require('../fixtures/browser');
const { getCredentials, createTestPage, deleteTestPage } = require('../helpers/confluence-client');
const { generateMacroStorageFormat } = require('../fixtures');

// Test configuration from environment
const TEST_SPACE = process.env.TEST_SPACE;
const BASE_URL = process.env.CONFLUENCE_HOST
  ? `https://${process.env.CONFLUENCE_HOST}`
  : '';

// Store created page info for cleanup
let testPageId = null;

test.describe('Digital Signature Macro', () => {
  test.beforeEach(async () => {
    if (!TEST_SPACE) {
      throw new Error('TEST_SPACE environment variable is required.');
    }
    getCredentials(); // Validates credentials are available
    testPageId = null;
  });

  test.afterEach(async ({ page }) => {
    if (testPageId) {
      await deleteTestPage(page, testPageId);
      console.log(`Deleted test page: ${testPageId}`);
      testPageId = null;
    }
  });

  test('displays macro and allows signing', async ({ page }) => {
    // Navigate to Confluence (needed for API calls)
    await page.goto(`${BASE_URL}/wiki`);

    // Generate and create test page with digital signature macro
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'E2E Test Contract',
      content: 'I hereby agree to the **terms and conditions** of this E2E test contract.',
    });
    const title = `E2E-Test-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    testPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Navigate to the created test page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for Sign button to be visible
    const signButton = page.getByRole('button', { name: 'Sign' });
    await expect(signButton).toBeVisible({ timeout: 15000 });

    // Click Sign button
    await signButton.click();

    // Wait for signing to complete - "Signed (N)" indicates signature exists
    await expect(page.getByText(/Signed \(\d+\)/)).toBeVisible({
      timeout: 15000,
    });
  });

  test('displays macro with a 200-character title', async ({ page }) => {
    await page.goto(`${BASE_URL}/wiki`);

    // Title at the max allowed length (200 characters)
    const longTitle = 'A'.repeat(200);
    const storageBody = generateMacroStorageFormat({
      panelTitle: longTitle,
      content: 'Contract with a long title for validation boundary testing.',
    });
    const title = `E2E-LongTitle-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    testPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Verify the long title renders in the macro heading
    await expect(page.getByText(longTitle)).toBeVisible({ timeout: 15000 });

    // Verify the Sign button is still functional
    const signButton = page.getByRole('button', { name: 'Sign' });
    await expect(signButton).toBeVisible({ timeout: 15000 });
  });
});
