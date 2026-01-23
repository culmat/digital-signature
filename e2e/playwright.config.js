// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Playwright config for connecting to existing browser via CDP.
 *
 * Start browser with: chromium --remote-debugging-port=9222 --user-data-dir=/tmp/pw-test
 * Then log into Confluence manually before running tests.
 *
 * Environment variables:
 * - CONFLUENCE_URL: Base URL (e.g., https://your-instance.atlassian.net/wiki)
 * - TEST_SPACE: Space key for test pages (default: TEST)
 * - CDP_ENDPOINT: Chrome DevTools Protocol endpoint (default: http://localhost:9222)
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,           // 60s per test - Forge apps can be slow
  retries: 0,               // No retries - dev machine only
  workers: 1,               // Sequential - we reuse single browser

  use: {
    // Connect to existing browser via CDP
    connectOverCDP: process.env.CDP_ENDPOINT || 'http://localhost:9222',

    // Base URL for Confluence instance
    baseURL: process.env.CONFLUENCE_URL,

    // Trace and screenshot on failure for debugging
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  expect: {
    timeout: 15000,  // 15s for assertions (Forge apps load slowly)
  },
});
