/**
 * Custom Playwright fixtures for connecting to an existing browser via CDP.
 * This reuses the browser's default context which has the logged-in session cookies.
 */

const { test: base, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://localhost:9222';
const INITIAL_URL_FILE = path.join('/tmp', 'pw-test-initial-url');
const DOWNLOAD_DIR = path.join(__dirname, '..', 'test-downloads');

/**
 * Custom test fixture that connects to existing browser and reuses its context.
 */
const test = base.extend({
  browser: async ({}, use) => {
    let browser;
    try {
      browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    } catch (error) {
      if (error.message.includes('ECONNREFUSED') || error.message.includes('connect')) {
        console.error('\n' + '='.repeat(70));
        console.error('ERROR: Could not connect to browser on ' + CDP_ENDPOINT);
        console.error('='.repeat(70));
        console.error('\nThe e2e tests require a running browser with remote debugging enabled.');
        console.error('\nTo start the browser, run:\n');
        console.error('  npm run test:e2e:browser\n');
        console.error('Then log into Confluence and run the tests again:\n');
        console.error('  npm run test:e2e\n');
        console.error('='.repeat(70) + '\n');
      }
      throw error;
    }
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

    // Configure downloads via CDP for this page
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }
    const client = await page.context().newCDPSession(page);
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR,
    });

    await use(page);
  },

  // Expose download directory to tests
  downloadDir: async ({}, use) => {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }
    await use(DOWNLOAD_DIR);
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

module.exports = { test, getAndClearInitialUrl, INITIAL_URL_FILE, DOWNLOAD_DIR };
