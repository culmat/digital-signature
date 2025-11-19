const { test: setup } = require('@playwright/test');
const path = require('path');
const SessionValidator = require('../utils/sessionValidator');
const EmailOtpHelper = require('./emailOtpHelper');
const testConfig = require('../utils/testConfig');

async function authenticateUser(page, userIndex) {
  const user = testConfig.getUser(userIndex);
  const authFile = path.join(__dirname, `../.auth/user-${userIndex}.json`);
  
  const validator = new SessionValidator(testConfig.confluenceBaseUrl);
  validator.ensureAuthDirExists(path.dirname(authFile));

  if (validator.storageStateExists(authFile)) {
    console.log(`[User ${userIndex}] Existing session file found, validating...`);

    const context = await page.context().browser().newContext({
      storageState: authFile
    });
    const testPage = await context.newPage();

    const validation = await validator.validateSession(testPage);
    await testPage.close();
    await context.close();

    if (validation.valid) {
      console.log(`[User ${userIndex}] ✓ Session still valid for: ${validation.userEmail}`);
      return;
    }

    console.log(`[User ${userIndex}] Session invalid: ${validation.error}`);
    validator.removeInvalidSession(authFile);
  }

  console.log(`[User ${userIndex}] No valid session found, authenticating...`);
  console.log(`[User ${userIndex}] Email: ${user.email}, Name: ${user.name}`);

  await page.goto(testConfig.confluenceBaseUrl);

  await page.fill('input[name="username"]', user.email);

  const continueButton = page.locator('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]').first();
  await continueButton.click();

  await page.waitForTimeout(1000);

  const passwordField = page.locator('input[name="password"]');
  const passwordVisible = await passwordField
    .isVisible({ timeout: 10000 })
    .catch(() => false);

  if (passwordVisible) {
    await passwordField.waitFor({ state: 'visible', timeout: 5000 });
    await passwordField.click();
    await page.fill('input[name="password"]', user.password);

    const loginButton = page.locator('button:has-text("Log in"), button:has-text("Continue"), button[type="submit"]').first();
    await loginButton.waitFor({ state: 'visible', timeout: 5000 });
    await loginButton.click();
  }

  const otpInputVisible = await page.locator('input[name="verificationCode"], input[name="otp"], input[type="text"][placeholder*="code" i]')
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (otpInputVisible) {
    console.log(`[User ${userIndex}] Email verification code required...`);

    if (!user.imap) {
      throw new Error(
        `[User ${userIndex}] Email OTP required but IMAP not configured.\n` +
        `Set TEST_USER_${userIndex}_IMAP_PASSWORD in .env`
      );
    }

    const emailHelper = new EmailOtpHelper(user.imap);

    try {
      const code = await emailHelper.getVerificationCode(30000);

      await page.locator('input[name="verificationCode"], input[name="otp"], input[type="text"][placeholder*="code" i]')
        .first()
        .fill(code);

      await page.click('button[type="submit"]');
    } catch (error) {
      throw new Error(`[User ${userIndex}] Failed to retrieve verification code: ${error.message}`);
    }
  }

  await page.waitForURL(`${testConfig.confluenceBaseUrl}/**`, {
    timeout: 15000,
    waitUntil: 'domcontentloaded'
  });

  const userMenuVisible = await page.locator('[data-testid="confluence-account-menu--trigger"]')
    .isVisible({ timeout: 10000 })
    .catch(() => false);

  if (!userMenuVisible) {
    throw new Error(`[User ${userIndex}] Login failed - user menu not found after authentication`);
  }

  console.log(`[User ${userIndex}] ✓ Authentication successful`);

  await page.context().storageState({ path: authFile });
  console.log(`[User ${userIndex}] ✓ Session saved to ${authFile}`);
}

try {
  const allUsers = testConfig.getAllUsers();
  
  if (allUsers.length === 0) {
    console.warn('No test users configured. Please add TEST_USER_1_* to your .env file.');
  } else {
    allUsers.forEach((_, index) => {
      const userIndex = index + 1;
      setup(`authenticate user ${userIndex}`, async ({ page }) => {
        await authenticateUser(page, userIndex);
      });
    });
  }
} catch (error) {
  console.error('Failed to setup test users:', error.message);
}

module.exports = {};
