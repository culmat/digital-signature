const playwright = require('@playwright/test');
const ConfluenceApiClient = require('../utils/confluenceApi');
const testConfig = require('../utils/testConfig');

const test = playwright.test.extend({
  confluenceApi: async ({}, use) => {
    testConfig.validate();

    const client = new ConfluenceApiClient(testConfig.getConfluenceConfig());

    try {
      const user = await client.getCurrentUser();
      console.log(`✓ Connected to Confluence as: ${user.displayName} (${user.email})`);
    } catch (error) {
      throw new Error(`Failed to connect to Confluence: ${error.message}`);
    }

    await use(client);
  },

  /**
   * Prevents test interference by isolating each test in its own space
   */
  testSpace: async ({ confluenceApi }, use, testInfo) => {
    const spaceKey = testConfig.generateTestSpaceKey();
    const spaceName = testConfig.generateTestSpaceName(testInfo.title);

    console.log(`\n[Setup] Creating test space for: ${testInfo.title}`);

    let space = null;

    try {
      space = await confluenceApi.createSpace(spaceKey, spaceName);
      await use(space);
    } finally {
      if (space && testConfig.cleanupAfterTests) {
        console.log(`[Teardown] Cleaning up test space: ${spaceKey}`);
        try {
          await confluenceApi.deleteSpace(spaceKey);
        } catch (error) {
          console.error(`Failed to cleanup space ${spaceKey}:`, error.message);
        }
      } else if (space) {
        console.log(`[Teardown] Skipping cleanup for space: ${spaceKey} (CLEANUP_AFTER_TESTS=false)`);
      }
    }
  },

  testPage: async ({ confluenceApi, testSpace }, use) => {
    const title = `Test Page - ${Date.now()}`;
    const body = '<p>This is a test page for the digital signature macro.</p>';

    console.log(`[Setup] Creating test page: ${title}`);

    const page = await confluenceApi.createPage(testSpace.key, title, body);

    await use(page);
  },

  authenticatedPage: async ({ page }, use) => {
    const SessionValidator = require('../utils/sessionValidator');
    const validator = new SessionValidator(testConfig.confluenceBaseUrl);

    console.log('[Setup] Validating authenticated session...');

    await page.goto(testConfig.confluenceBaseUrl);

    const validation = await validator.validateSession(page);

    if (!validation.valid) {
      throw new Error(
        `Session validation failed: ${validation.error}\n` +
        `This usually means your authentication session has expired.\n` +
        `Please run the setup again to re-authenticate:\n` +
        `  npx playwright test --project=setup-user\n` +
        `Or delete the session file and run tests again:\n` +
        `  rm tests/e2e/.auth/user.json`
      );
    }

    console.log(`✓ Session valid for user: ${validation.userEmail}`);

    await use(page);
  }
});

/**
 * Use when you need to share spaces across multiple tests or control cleanup timing
 */
class TestSpaceManager {
  constructor(confluenceApi) {
    this.confluenceApi = confluenceApi;
    this.spaces = [];
    this.pages = [];
  }

  async createSpace(namePrefix = 'Manual Test') {
    const spaceKey = testConfig.generateTestSpaceKey();
    const spaceName = testConfig.generateTestSpaceName(namePrefix);

    const space = await this.confluenceApi.createSpace(spaceKey, spaceName);
    this.spaces.push(space);

    return space;
  }

  async createPage(spaceKey, title, body) {
    const page = await this.confluenceApi.createPage(spaceKey, title, body);
    this.pages.push(page);

    return page;
  }

  async cleanup() {
    console.log(`[Cleanup] Cleaning up ${this.spaces.length} spaces and ${this.pages.length} pages`);

    for (const page of this.pages) {
      try {
        await this.confluenceApi.deletePage(page.id);
      } catch (error) {
        console.error(`Failed to delete page ${page.id}:`, error.message);
      }
    }

    // Delete spaces
    for (const space of this.spaces) {
      try {
        await this.confluenceApi.deleteSpace(space.key);
      } catch (error) {
        console.error(`Failed to delete space ${space.key}:`, error.message);
      }
    }

    this.spaces = [];
    this.pages = [];
  }
}

module.exports = {
  test,
  expect: playwright.expect,
  TestSpaceManager
};
