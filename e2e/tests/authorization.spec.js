const { expect } = require('@playwright/test');
const { test } = require('../fixtures/browser');
const { getCredentials, createTestPage, deleteTestPage } = require('../helpers/confluence-client');
const { generateMacroStorageFormat, generateFixtureWithMultipleSignatures, generateRandomAccountId } = require('../fixtures');
const { setupFixtures } = require('../helpers/admin-ui');

// Test configuration from environment
const TEST_SPACE = process.env.TEST_SPACE;
const TEST_EMPTY_GROUP_ID = process.env.TEST_EMPTY_GROUP_ID;
const BASE_URL = process.env.CONFLUENCE_HOST
  ? `https://${process.env.CONFLUENCE_HOST}`
  : '';

// Store created page IDs for cleanup
const createdPageIds = [];

test.describe('Authorization - Negative Cases', () => {
  test.beforeAll(async () => {
    if (!TEST_SPACE) {
      throw new Error('TEST_SPACE environment variable is required.');
    }
    if (!TEST_EMPTY_GROUP_ID) {
      throw new Error('TEST_EMPTY_GROUP_ID environment variable is required for authorization tests.');
    }
    getCredentials(); // Validates credentials are available
  });

  test.afterAll(async ({ browser }) => {
    if (createdPageIds.length === 0) return;

    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();

    if (!page.url().includes('/wiki')) {
      await page.goto(`${BASE_URL}/wiki`);
    }

    for (const pageId of createdPageIds) {
      await deleteTestPage(page, pageId);
      console.log(`Deleted test page: ${pageId}`);
    }
  });

  test('hides Sign button when user is not a member of the configured signer group', async ({ page }) => {
    // Navigate to Confluence
    await page.goto(`${BASE_URL}/wiki`);

    // Create test page with macro configured to only allow the empty group to sign
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Group-Restricted Contract',
      content: 'Only members of the configured group can sign.',
      signerGroups: [TEST_EMPTY_GROUP_ID],
    });
    const title = `E2E-Auth-Group-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    createdPageIds.push(testPage.id);
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Navigate to the page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for macro to load by checking for panel title
    await expect(page.getByText('Group-Restricted Contract')).toBeVisible({ timeout: 15000 });

    // Wait for content to ensure macro is fully rendered
    await expect(page.getByText('Only members of the configured group can sign.')).toBeVisible();

    // Assert Sign button is NOT visible
    const signButton = page.getByRole('button', { name: 'Sign' });
    await expect(signButton).not.toBeVisible();
  });

  test('hides Sign button when user is not a named signer', async ({ page }) => {
    // Navigate to Confluence
    await page.goto(`${BASE_URL}/wiki`);

    // Create test page with macro configured with a fake account ID as the only signer
    const fakeAccountId = '557058:00000000-0000-0000-0000-000000000000';
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Named-Signer Contract',
      content: 'Only the specified signer can sign.',
      signers: [fakeAccountId],
    });
    const title = `E2E-Auth-NamedSigner-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    createdPageIds.push(testPage.id);
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Navigate to the page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for macro to load by checking for panel title
    await expect(page.getByText('Named-Signer Contract')).toBeVisible({ timeout: 15000 });

    // Wait for "Pending (1)" to appear, proving the config was processed
    await expect(page.getByText('Pending (1)')).toBeVisible();

    // Assert Sign button is NOT visible
    const signButton = page.getByRole('button', { name: 'Sign' });
    await expect(signButton).not.toBeVisible();
  });

  test('hides Sign button after user has already signed', async ({ page }) => {
    // Navigate to Confluence
    await page.goto(`${BASE_URL}/wiki`);

    // Create test page with unrestricted petition-mode macro
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Petition Contract',
      content: 'Open for all to sign once.',
    });
    const title = `E2E-Auth-AlreadySigned-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    createdPageIds.push(testPage.id);
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Navigate to the page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for Sign button to be visible and click it
    const signButton = page.getByRole('button', { name: 'Sign' });
    await expect(signButton).toBeVisible({ timeout: 15000 });
    await signButton.click();

    // Wait for signature to complete - "Signed (1)" indicates signature exists
    await expect(page.getByText('Signed (1)')).toBeVisible({ timeout: 15000 });

    // Assert Sign button is now NOT visible (user already signed)
    await expect(signButton).not.toBeVisible();
  });

  test('hides Sign button when maximum signatures have been reached', async ({ page }) => {
    // Navigate to Confluence
    await page.goto(`${BASE_URL}/wiki`);

    // Create test page with max signatures set to 2
    const maxSigs = 2;
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Max Signatures Contract',
      content: 'Maximum 2 signatures allowed.',
      maxSignatures: maxSigs,
    });
    const title = `E2E-Auth-MaxReached-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    createdPageIds.push(testPage.id);
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Pre-populate with 2 fake signatures to reach the limit
    const fakeSigners = [generateRandomAccountId(), generateRandomAccountId()];
    const fixtureSQL = generateFixtureWithMultipleSignatures(
      testPage.id,
      fakeSigners,
      {
        panelTitle: 'Max Signatures Contract',
        content: 'Maximum 2 signatures allowed.',
      }
    );
    await setupFixtures(page, fixtureSQL);

    // Navigate to the page
    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for "Signed (2)" to appear, confirming the limit is reached
    await expect(page.getByText('Signed (2)')).toBeVisible({ timeout: 15000 });

    // Assert Sign button is NOT visible (max signatures reached)
    const signButton = page.getByRole('button', { name: 'Sign' });
    await expect(signButton).not.toBeVisible();
  });
});
