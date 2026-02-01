// @ts-check
const { defineConfig } = require('@playwright/test');
require('dotenv').config({ path: __dirname + '/.env' });

/**
 * Playwright config for connecting to existing browser via CDP.
 *
 * Start browser with: chromium --remote-debugging-port=9222 --user-data-dir=/tmp/pw-test
 * Then log into Confluence manually before running tests.
 *
 * Environment variables:
 * - CONFLUENCE_HOST: Confluence host (e.g., your-instance.atlassian.net)
 * - TEST_SPACE: Space key for test pages (default: TEST)
 * - CDP_ENDPOINT: Chrome DevTools Protocol endpoint (default: http://localhost:9222)
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,           // 60s per test - Forge apps can be slow
  retries: 0,               // No retries - dev machine only
  workers: 1,               // Sequential - we reuse single browser

  // Use both the default list reporter and our custom AUI flag reporter
  reporter: [
    ['list'],
    ['./reporters/aui-flag-reporter.js'],
  ],

  use: {
    // Base URL for Confluence instance (constructed from host)
    baseURL: process.env.CONFLUENCE_HOST ? `https://${process.env.CONFLUENCE_HOST}/wiki` : undefined,

    // Ignore SSL certificate errors (for corporate proxies like Zscaler)
    ignoreHTTPSErrors: true,

    // Trace and screenshot on failure for debugging
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  expect: {
    timeout: 15000,  // 15s for assertions (Forge apps load slowly)
  },
});
