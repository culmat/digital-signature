const fs = require('fs');
const path = require('path');

/**
 * Validates Confluence authentication session state.
 * Checks if saved session cookies are still valid by testing page access.
 */
class SessionValidator {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Checks if storageState file exists and is not expired
   * @param {string} storageStatePath - Path to storageState JSON file
   * @returns {boolean} True if file exists and cookies are not expired
   */
  storageStateExists(storageStatePath) {
    if (!fs.existsSync(storageStatePath)) {
      return false;
    }

    try {
      const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));

      if (!storageState.cookies || storageState.cookies.length === 0) {
        return false;
      }

      const now = Date.now() / 1000;
      const sessionCookie = storageState.cookies.find(
        cookie => cookie.name === 'cloud.session.token' || cookie.name === 'tenant.session.token'
      );

      if (!sessionCookie) {
        return false;
      }

      // Check if cookie has not expired (if expires is set)
      if (sessionCookie.expires && sessionCookie.expires !== -1) {
        if (sessionCookie.expires < now) {
          console.log(`Session cookie expired at ${new Date(sessionCookie.expires * 1000).toISOString()}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(`Error reading storageState file: ${error.message}`);
      return false;
    }
  }

  /**
   * Validates session by attempting to access Confluence and checking for authenticated state
   * @param {import('@playwright/test').Page} page - Playwright page object
   * @returns {Promise<{valid: boolean, userEmail?: string, error?: string}>}
   */
  async validateSession(page) {
    try {
      await page.goto(this.baseUrl, { timeout: 10000, waitUntil: 'domcontentloaded' });

      const currentUrl = page.url();
      if (currentUrl.includes('id.atlassian.com/login') || currentUrl.includes('/login')) {
        return {
          valid: false,
          error: 'Redirected to login page - session expired or invalid'
        };
      }

      const userMenuVisible = await page.locator('[data-testid="confluence-account-menu--trigger"]')
        .isVisible({ timeout: 5000 })
        .catch(() => false);

      if (!userMenuVisible) {
        const alternativeIndicator = await page.locator('[aria-label="Profile"]')
          .isVisible({ timeout: 2000 })
          .catch(() => false);

        if (!alternativeIndicator) {
          return {
            valid: false,
            error: 'User menu not found - session likely invalid'
          };
        }
      }

      let userEmail = 'unknown';
      try {
        await page.click('[data-testid="confluence-account-menu--trigger"]', { timeout: 3000 }).catch(() => {});
        const emailElement = await page.locator('[data-testid="user-email"]').textContent({ timeout: 2000 }).catch(() => null);
        if (emailElement) {
          userEmail = emailElement;
        }
        await page.keyboard.press('Escape');
      } catch (error) {
        // Unable to extract email, but session is valid
      }

      return {
        valid: true,
        userEmail
      };
    } catch (error) {
      return {
        valid: false,
        error: `Validation failed: ${error.message}`
      };
    }
  }

  /**
   * Ensures .auth directory exists
   * @param {string} authDirPath - Path to .auth directory
   */
  ensureAuthDirExists(authDirPath) {
    if (!fs.existsSync(authDirPath)) {
      fs.mkdirSync(authDirPath, { recursive: true });
      console.log(`Created authentication directory: ${authDirPath}`);
    }
  }

  /**
   * Removes invalid or expired session file
   * @param {string} storageStatePath - Path to storageState JSON file
   */
  removeInvalidSession(storageStatePath) {
    if (fs.existsSync(storageStatePath)) {
      fs.unlinkSync(storageStatePath);
      console.log(`Removed invalid session file: ${storageStatePath}`);
    }
  }
}

module.exports = SessionValidator;
