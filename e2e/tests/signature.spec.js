const { test, expect } = require('@playwright/test');
const { createTestPage, deletePage } = require('../helpers/confluence-api');
const { setupFixtures } = require('../helpers/admin-ui');
const {
  SAMPLE_CONTRACT_ADF,
  generateRandomAccountId,
  generateFixtureWithOneSignature,
} = require('../fixtures');

// Test configuration from environment
const TEST_SPACE = process.env.TEST_SPACE || 'TEST';

test.describe('Digital Signature Macro', () => {
  let testPageId = null;

  test.afterEach(async ({ page }) => {
    // Clean up: delete test page if it was created
    if (testPageId) {
      await deletePage(page, testPageId);
      testPageId = null;
    }
  });

  test('displays existing signature and allows signing', async ({ page }) => {
    // Step 1: Create a test page with the macro
    const pageTitle = `E2E Test - Signature - ${Date.now()}`;

    const created = await createTestPage(
      page,
      TEST_SPACE,
      pageTitle,
      SAMPLE_CONTRACT_ADF
    );
    testPageId = created.pageId;

    // Step 2: Generate fixture with one existing signature
    const existingSignerAccountId = generateRandomAccountId();
    const fixtureSQL = generateFixtureWithOneSignature(
      testPageId,
      pageTitle,
      existingSignerAccountId,
      SAMPLE_CONTRACT_ADF
    );

    // Step 3: Restore fixture via admin UI
    await setupFixtures(page, fixtureSQL);

    // Step 4: Navigate to the test page
    await page.goto(created.pageUrl);

    // Step 5: Wait for macro to load (inside Forge iframe)
    const macroFrame = page.frameLocator('iframe[id*="digital-signature"]');

    // Step 6: Assert existing signature is displayed
    // The macro shows "Signed (N)" section
    await expect(macroFrame.getByText('Signed (1)')).toBeVisible({
      timeout: 30000,
    });

    // Step 7: Assert Sign button is visible (current user can sign in petition mode)
    const signButton = macroFrame.getByRole('button', { name: 'Sign' });
    await expect(signButton).toBeVisible();

    // Step 8: Click Sign button
    await signButton.click();

    // Step 9: Wait for signing to complete
    // The button text changes during signing, then back to Sign
    // After signing, user should see their signature in the list
    await expect(macroFrame.getByText('Signed (2)')).toBeVisible({
      timeout: 30000,
    });
  });
});
