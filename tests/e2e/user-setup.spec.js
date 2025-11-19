const { test, expect } = require('@playwright/test');
const testConfig = require('./utils/testConfig');

test.describe('User Setup Verification', () => {
  test('user should be authenticated', async ({ page }) => {
    await page.goto(testConfig.confluenceBaseUrl);
    
    const userMenu = page.locator('[data-testid="confluence-account-menu--trigger"]');
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    
    console.log('✓ User is successfully authenticated');
  });
});
