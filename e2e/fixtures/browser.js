/**
 * Custom Playwright fixtures for connecting to an existing browser via CDP.
 * This reuses the browser's default context which has the logged-in session cookies.
 */

const { test: base, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';
const INITIAL_URL_FILE = path.join('/tmp', 'pw-test-initial-url');

/**
 * Custom test fixture that connects to existing browser and reuses its context.
 */
const test = base.extend({
  browser: async ({}, use) => {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    await use(browser);
  },

  context: async ({ browser }, use) => {
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    await use(context);
  },

  page: async ({ context }, use) => {
    const pages = context.pages();
    const page = pages[0] || await context.newPage();

    // Save the initial URL before any test navigation (only once per test run)
    if (!fs.existsSync(INITIAL_URL_FILE)) {
      const currentUrl = page.url();
      if (currentUrl && currentUrl !== 'about:blank') {
        fs.writeFileSync(INITIAL_URL_FILE, currentUrl);
      }
    }

    await use(page);
  },
});

/**
 * Read and clear the saved initial URL.
 * @returns {string|null} The initial URL or null if not saved
 */
function getAndClearInitialUrl() {
  if (fs.existsSync(INITIAL_URL_FILE)) {
    const url = fs.readFileSync(INITIAL_URL_FILE, 'utf-8').trim();
    fs.unlinkSync(INITIAL_URL_FILE);
    return url;
  }
  return null;
}

module.exports = { test, getAndClearInitialUrl, INITIAL_URL_FILE };
