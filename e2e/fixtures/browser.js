/**
 * Custom Playwright fixtures for connecting to an existing browser via CDP.
 * This reuses the browser's default context which has the logged-in session cookies.
 */

const { test: base, chromium } = require('@playwright/test');

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';

/**
 * Custom test fixture that connects to existing browser and reuses its context.
 */
const test = base.extend({
  // Override the default browser fixture
  browser: async ({}, use) => {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    await use(browser);
    // Don't disconnect - we want to keep the browser running
  },

  // Override context to use the browser's default context (has cookies)
  context: async ({ browser }, use) => {
    // Get the default context which has the user's session
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    await use(context);
    // Don't close - keep the context
  },

  // Override page to use existing page or create one in default context
  page: async ({ context }, use) => {
    // Reuse existing page or create a new one in the default context
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    await use(page);
    // Don't close - keep the page
  },
});

module.exports = { test };
