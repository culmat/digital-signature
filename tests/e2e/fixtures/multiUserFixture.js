const playwright = require('@playwright/test');
const path = require('path');
const SessionValidator = require('../utils/sessionValidator');
const testConfig = require('../utils/testConfig');

const USER_AUTH_FILE = path.join(__dirname, '../.auth/user-1.json');
const ADMIN_AUTH_FILE = path.join(__dirname, '../.auth/user-2.json');

/**
 * Multi-user fixture for testing scenarios requiring multiple authenticated users.
 * Provides separate browser contexts and pages for regular user and admin user.
 */
const multiUserTest = playwright.test.extend({
  userContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: USER_AUTH_FILE
    });
    await use(context);
    await context.close();
  },

  adminContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: ADMIN_AUTH_FILE
    });
    await use(context);
    await context.close();
  },

  userPage: async ({ userContext }, use) => {
    const page = await userContext.newPage();
    const validator = new SessionValidator(testConfig.confluenceBaseUrl);

    await page.goto(testConfig.confluenceBaseUrl);
    const validation = await validator.validateSession(page);

    if (!validation.valid) {
      throw new Error(
        `User session validation failed: ${validation.error}\n` +
        `Please re-authenticate: npx playwright test --project=setup-user`
      );
    }

    console.log(`✓ User session valid: ${validation.userEmail}`);

    await use(page);
    await page.close();
  },

  adminPage: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    const validator = new SessionValidator(testConfig.confluenceBaseUrl);

    await page.goto(testConfig.confluenceBaseUrl);
    const validation = await validator.validateSession(page);

    if (!validation.valid) {
      throw new Error(
        `Admin session validation failed: ${validation.error}\n` +
        `Please re-authenticate: npx playwright test --project=setup-admin`
      );
    }

    console.log(`✓ Admin session valid: ${validation.userEmail}`);

    await use(page);
    await page.close();
  }
});

module.exports = {
  test: multiUserTest,
  expect: playwright.expect
};
