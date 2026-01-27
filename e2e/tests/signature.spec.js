const { expect } = require('@playwright/test');
const { test } = require('../fixtures/browser');

// Test configuration from environment
const TEST_PAGE_ID = process.env.TEST_PAGE_ID;
const TEST_SPACE = process.env.TEST_SPACE;
const BASE_URL = process.env.CONFLUENCE_HOST
  ? `https://${process.env.CONFLUENCE_HOST}`
  : '';

test.describe('Digital Signature Macro', () => {
  test('displays macro and allows signing', async ({ page }) => {
    if (!TEST_PAGE_ID || !TEST_SPACE) {
      throw new Error('TEST_PAGE_ID and TEST_SPACE environment variables are required.');
    }

    // Navigate to the pre-created test page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${TEST_PAGE_ID}`);

    // Wait for macro to load (Forge renders in iframe)
    const macroFrame = page.frameLocator('iframe[id*="digital-signature"]');

    // Wait for macro content to be visible (look for the Sign button)
    const signButton = macroFrame.getByRole('button', { name: 'Sign' });
    await expect(signButton).toBeVisible({ timeout: 7000 });

    // Click Sign button
    await signButton.click();

    // Wait for signing to complete - button should still be visible after signing
    // (user can sign again if they want to revoke and re-sign, but the signature should appear)
    // Look for "Signed" text which indicates at least one signature exists
    await expect(macroFrame.getByText(/Signed \(\d+\)/)).toBeVisible({
      timeout: 7000,
    });
  });
});
