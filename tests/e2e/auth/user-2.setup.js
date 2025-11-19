const { test: setup, expect } = require('@playwright/test');
const path = require('path');
const SessionValidator = require('../utils/sessionValidator');
const EmailOtpHelper = require('./emailOtpHelper');
const testConfig = require('../utils/testConfig');

const USER_INDEX = 2;

setup('authenticate user', async ({ page }) => {
  const user = testConfig.getUser(USER_INDEX);
  const authFile = path.join(__dirname, `../.auth/user-${USER_INDEX}.json`);
  
  const validator = new SessionValidator(testConfig.confluenceBaseUrl);
  validator.ensureAuthDirExists(path.dirname(authFile));

  if (validator.storageStateExists(authFile)) {
    console.log(`[User ${USER_INDEX}] Existing session file found, validating...`);

    const context = await page.context().browser().newContext({
      storageState: authFile
    });
    const testPage = await context.newPage();

    const validation = await validator.validateSession(testPage);
    await testPage.close();
    await context.close();

    if (validation.valid) {
      console.log(`[User ${USER_INDEX}] ✓ Session still valid for: ${validation.userEmail}`);
      return;
    }

    console.log(`[User ${USER_INDEX}] Session invalid or expired, re-authenticating...`);
  } else {
    console.log(`[User ${USER_INDEX}] No session file found, authenticating for the first time...`);
  }

  await page.goto(testConfig.confluenceBaseUrl);
  await page.fill('input[name="username"]', user.email);

  const continueButton = page.locator('button:has-text("Continue"), button:has-text("Next"), button[type="submit"]').first();
  await continueButton.click();
  await page.waitForTimeout(1000);

  const passwordField = page.locator('input[name="password"]');
  const passwordVisible = await passwordField.isVisible({ timeout: 10000 }).catch(() => false);

  if (passwordVisible) {
    await passwordField.waitFor({ state: 'visible', timeout: 5000 });
    await passwordField.click();
    await page.fill('input[name="password"]', user.password);

    const loginButton = page.locator('button:has-text("Log in"), button:has-text("Continue"), button[type="submit"]').first();
    await loginButton.waitFor({ state: 'visible', timeout: 5000 });
    await loginButton.click();
  }

  console.log(`[User ${USER_INDEX}] Waiting for post-login navigation...`);
  await page.waitForTimeout(2000);

  const mfaPageVisible = await page.locator('text="We\'ve emailed you a code"')
    .isVisible({ timeout: 10000 })
    .catch(() => false);

  console.log(`[User ${USER_INDEX}] MFA page detected: ${mfaPageVisible}`);

  if (mfaPageVisible) {
    console.log(`[User ${USER_INDEX}] Email verification code required (MFA page detected)...`);

    if (!user.imap) {
      throw new Error(
        `[User ${USER_INDEX}] Email OTP required but IMAP not configured.\n` +
        `Set TEST_USER_${USER_INDEX}_IMAP_PASSWORD in .env`
      );
    }

    console.log(`[User ${USER_INDEX}] Attempting to retrieve OTP via IMAP...`);
    console.log(`[User ${USER_INDEX}] IMAP config: ${user.imap.host}:${user.imap.port} for ${user.imap.user}`);

    const emailHelper = new EmailOtpHelper(user.imap);

    try {
      const code = await emailHelper.getVerificationCode(60000);
      console.log(`[User ${USER_INDEX}] Successfully retrieved OTP: ${code}`);

      const firstInput = page.locator('input[type="text"]').first();
      await firstInput.waitFor({ state: 'visible', timeout: 5000 });

      await firstInput.click();
      await page.keyboard.type(code, { delay: 100 });

      const verifyButton = page.locator('button:has-text("Verify")');
      await verifyButton.waitFor({ state: 'visible', timeout: 5000 });
      
      await page.waitForTimeout(2000);
      
      await expect(verifyButton).toBeEnabled({ timeout: 10000 });
      await verifyButton.click();
    } catch (error) {
      console.error(`[User ${USER_INDEX}] IMAP error:`, error);
      throw new Error(`[User ${USER_INDEX}] Failed to retrieve verification code: ${error.message}`);
    }
  }

  await page.waitForURL(`${testConfig.confluenceBaseUrl}/**`, {
    timeout: 15000,
    waitUntil: 'domcontentloaded'
  });

  await page.waitForTimeout(3000);

  const currentUrl = await page.url();
  
  if (currentUrl.includes('/welcome')) {
    console.log(`[User ${USER_INDEX}] Welcome wizard detected. Please complete the onboarding manually.`);
    console.log(`[User ${USER_INDEX}] The test will pause for 120 seconds. Click through the welcome screens and wait on any Confluence page.`);
    await page.pause();
    await page.waitForTimeout(5000);
  }

  const pageContent = await page.content();
  const usernameFound = pageContent.includes(user.email);

  if (!usernameFound) {
    console.error(`[User ${USER_INDEX}] Login failed - username not found in page source`);
    console.error(`[User ${USER_INDEX}] Current URL: ${currentUrl}`);
    console.error(`[User ${USER_INDEX}] Page content snippet:`, pageContent.slice(0, 500));
    throw new Error(`[User ${USER_INDEX}] Login failed - username not found in page source`);
  }

  console.log(`[User ${USER_INDEX}] ✓ Authentication successful`);

  await page.context().storageState({ path: authFile });
  console.log(`[User ${USER_INDEX}] ✓ Session saved to: ${authFile}`);
});
