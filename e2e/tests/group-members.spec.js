const { expect } = require('@playwright/test');
const { test } = require('../fixtures/browser');
const { getCredentials, createTestPage, deleteTestPage, getGroupMembers } = require('../helpers/confluence-client');
const { generateMacroStorageFormat, generateFixtureWithMultipleSignatures } = require('../fixtures');
const { setupFixtures } = require('../helpers/admin-ui');

const TEST_SPACE = process.env.TEST_SPACE;
const CONFLUENCE_HOST = process.env.CONFLUENCE_HOST;
const BASE_URL = CONFLUENCE_HOST ? `https://${CONFLUENCE_HOST}` : '';
const MAX_MEMBERS = 5;

// Derive group name from host (e.g., "devds.atlassian.net" → "confluence-users-devds")
function deriveGroupName(host) {
  const subdomain = host.split('.')[0];
  return `confluence-users-${subdomain}`;
}

// Format date matching the UI's Intl.DateTimeFormat output (en-GB: "3 Feb 2026, 14:30")
function formatExpectedTimestamp(date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

let createdPageId = null;

const CONTRACT_CONFIG = {
  panelTitle: 'Group Members Contract',
  content: 'This contract tests signatures from real group members.',
};

test.describe('Group Member Signatures', () => {
  test.beforeAll(async () => {
    if (!TEST_SPACE) {
      throw new Error('TEST_SPACE environment variable is required.');
    }
    if (!CONFLUENCE_HOST) {
      throw new Error('CONFLUENCE_HOST environment variable is required.');
    }
    getCredentials();
  });

  test.afterAll(async ({ browser }) => {
    if (createdPageId) {
      const context = browser.contexts()[0] || await browser.newContext();
      const page = context.pages()[0] || await context.newPage();

      if (!page.url().includes('/wiki')) {
        await page.goto(`${BASE_URL}/wiki`);
      }

      await deleteTestPage(page, createdPageId);
      console.log(`Deleted test page: ${createdPageId}`);
    }
  });

  test('displays signatures from group members with names and timestamps', async ({ page }) => {
    await page.goto(`${BASE_URL}/wiki`);

    // Get group members with limit parameter
    const groupName = deriveGroupName(CONFLUENCE_HOST);
    const members = await getGroupMembers(page, groupName, MAX_MEMBERS);
    console.log(`Using ${members.length} members from ${groupName}`);

    // Create test page
    const storageBody = generateMacroStorageFormat(CONTRACT_CONFIG);
    const title = `E2E-GroupMembers-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    createdPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Capture timestamp baseline before generating fixtures
    const fixtureBaseTime = Date.now();

    // Generate fixtures with member accountIds
    const accountIds = members.map(m => m.accountId);
    const sql = generateFixtureWithMultipleSignatures(testPage.id, accountIds, CONTRACT_CONFIG);
    await setupFixtures(page, sql);
    console.log('Restored fixtures via admin UI');

    // Navigate to test page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for macro to load
    await expect(page.getByRole('button', { name: 'Sign' })).toBeVisible({ timeout: 15000 });

    // Verify "Signed (N)" counter
    await expect(page.getByText(`Signed (${members.length})`)).toBeVisible();

    // Verify each member's signature appears with name and expected timestamp
    for (let i = 0; i < members.length; i++) {
      const member = members[i];

      // Verify displayName is visible
      await expect(page.getByText(member.displayName)).toBeVisible();

      // Compute expected timestamp (matches generateFixtureWithMultipleSignatures logic)
      const expectedDate = new Date(fixtureBaseTime - 3600000 + (i * 60000));
      const expectedTimestamp = formatExpectedTimestamp(expectedDate);

      // Verify timestamp appears on page
      await expect(page.getByText(expectedTimestamp)).toBeVisible();
    }

    // Verify all signatures have disabled checkboxes
    const signedCheckboxes = page.locator('input[type="checkbox"][disabled]');
    await expect(signedCheckboxes).toHaveCount(members.length);
  });
});
