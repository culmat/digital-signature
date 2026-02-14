const { expect } = require('@playwright/test');
const { test } = require('../fixtures/browser');
const {
  getCredentials,
  createTestPage,
  deleteTestPage,
  getCurrentUser,
} = require('../helpers/confluence-client');
const {
  generateMacroStorageFormat,
  generateFixtureWithOneSignature,
  generateFixtureWithMultipleSignatures,
  generateRandomAccountId,
} = require('../fixtures');
const { setupFixtures } = require('../helpers/admin-ui');

const TEST_SPACE = process.env.TEST_SPACE;
const CONFLUENCE_HOST = process.env.CONFLUENCE_HOST;
const BASE_URL = CONFLUENCE_HOST ? `https://${CONFLUENCE_HOST}` : '';

const MACRO_CONTAINER = '[data-testid="ForgeExtensionContainer"]';

test.describe('Visibility Controls', () => {
  let testPageId = null;

  test.beforeEach(async () => {
    if (!TEST_SPACE) {
      throw new Error('TEST_SPACE environment variable is required.');
    }
    getCredentials();
    testPageId = null;
  });

  test.afterEach(async ({ page }) => {
    if (testPageId) {
      await deleteTestPage(page, testPageId);
      console.log(`Deleted test page: ${testPageId}`);
      testPageId = null;
    }
  });

  test('signaturesVisible=IF_SIGNATORY hides signed list from non-signatories', async ({ page }) => {
    await page.goto(`${BASE_URL}/wiki`);

    const signedAccountId = generateRandomAccountId();
    const unsignedAccountId = generateRandomAccountId();
    const macroConfig = {
      panelTitle: 'Visibility Test - Signed IF_SIGNATORY',
      content: 'Only signatories can see who signed.',
      signers: [signedAccountId, unsignedAccountId],
      signaturesVisible: 'IF_SIGNATORY',
    };
    const storageBody = generateMacroStorageFormat(macroConfig);
    const title = `E2E-Vis-SignedSignatory-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    testPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Only one signer has signed, the other remains pending
    const fixtureSQL = generateFixtureWithOneSignature(
      testPage.id,
      signedAccountId,
      macroConfig,
    );
    await setupFixtures(page, fixtureSQL);

    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Current user is NOT a named signer, so "Signed" section should be hidden
    await expect(page.getByText('Only signatories can see who signed.')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(MACRO_CONTAINER).getByText('Signed (1)')).not.toBeVisible({ timeout: 5000 });

    // Pending should still be visible (defaults to ALWAYS)
    await expect(page.getByText('Pending (1)')).toBeVisible();
  });

  test('signaturesVisible=IF_SIGNED hides signed list from users who have not signed', async ({ page }) => {
    await page.goto(`${BASE_URL}/wiki`);

    const fakeSignerAccountId = generateRandomAccountId();
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Visibility Test - Signed IF_SIGNED',
      content: 'Only users who signed can see the list.',
      signaturesVisible: 'IF_SIGNED',
    });
    const title = `E2E-Vis-SignedIfSigned-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    testPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Create a pre-existing signature from a fake user
    const fixtureSQL = generateFixtureWithOneSignature(
      testPage.id,
      fakeSignerAccountId,
      { panelTitle: 'Visibility Test - Signed IF_SIGNED', content: 'Only users who signed can see the list.' }
    );
    await setupFixtures(page, fixtureSQL);

    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Current user has NOT signed, so "Signed" section should be hidden
    await expect(page.getByText('Only users who signed can see the list.')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(MACRO_CONTAINER).getByText('Signed (1)')).not.toBeVisible({ timeout: 5000 });

    // Sign button should still be visible (petition mode, user is authorized)
    const signButton = page.locator(MACRO_CONTAINER).getByRole('button', { name: 'Sign' });
    await expect(signButton).toBeVisible();
  });

  test('pendingVisible=IF_SIGNATORY hides pending list from non-signatories', async ({ page }) => {
    await page.goto(`${BASE_URL}/wiki`);

    const fakeSignerAccountId = generateRandomAccountId();
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Visibility Test - Pending IF_SIGNATORY',
      content: 'Only signatories can see the pending list.',
      signers: [fakeSignerAccountId],
      pendingVisible: 'IF_SIGNATORY',
    });
    const title = `E2E-Vis-PendingSignatory-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    testPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Current user is NOT a named signer, so "Pending" section should be hidden
    await expect(page.getByText('Only signatories can see the pending list.')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(MACRO_CONTAINER).getByText('Pending (1)')).not.toBeVisible({ timeout: 5000 });
  });

  test('pendingVisible=IF_SIGNED hides pending list from users who have not signed', async ({ page }) => {
    await page.goto(`${BASE_URL}/wiki`);

    const fakeSignerAccountId = generateRandomAccountId();
    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Visibility Test - Pending IF_SIGNED',
      content: 'Only users who signed can see pending.',
      signers: [fakeSignerAccountId],
      pendingVisible: 'IF_SIGNED',
    });
    const title = `E2E-Vis-PendingIfSigned-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    testPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Current user has NOT signed, so "Pending" section should be hidden
    await expect(page.getByText('Only users who signed can see pending.')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(MACRO_CONTAINER).getByText('Pending (1)')).not.toBeVisible({ timeout: 5000 });
  });

  test('default visibility (ALWAYS) shows both sections to all users', async ({ page }) => {
    await page.goto(`${BASE_URL}/wiki`);

    const signedAccountId = generateRandomAccountId();
    const unsignedAccountId = generateRandomAccountId();
    const macroConfig = {
      panelTitle: 'Visibility Test - Default',
      content: 'Both sections should be visible by default.',
      signers: [signedAccountId, unsignedAccountId],
    };
    const storageBody = generateMacroStorageFormat(macroConfig);
    const title = `E2E-Vis-Default-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    testPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    // Only one of the two signers has signed, so one remains pending
    const fixtureSQL = generateFixtureWithOneSignature(
      testPage.id,
      signedAccountId,
      macroConfig
    );
    await setupFixtures(page, fixtureSQL);

    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Both sections should be visible by default.')).toBeVisible({ timeout: 15000 });

    // Both sections visible even though current user is not a signer
    await expect(page.locator(MACRO_CONTAINER).getByText('Signed (1)')).toBeVisible();
    await expect(page.getByText('Pending (1)')).toBeVisible();
  });

  test('signaturesVisible=IF_SIGNED reveals signed list after user signs', async ({ page }) => {
    await page.goto(`${BASE_URL}/wiki`);

    const storageBody = generateMacroStorageFormat({
      panelTitle: 'Visibility Test - Reveal After Sign',
      content: 'Signed list appears after signing.',
      signaturesVisible: 'IF_SIGNED',
    });
    const title = `E2E-Vis-RevealAfterSign-${Date.now()}`;
    const testPage = await createTestPage(page, TEST_SPACE, title, storageBody);
    testPageId = testPage.id;
    console.log(`Created test page: ${testPage.id} - ${testPage.title}`);

    await page.goto(`${BASE_URL}/wiki/spaces/${TEST_SPACE}/pages/${testPage.id}`);
    await page.waitForLoadState('networkidle');

    // Before signing: Sign button visible, Signed section not visible (no signatures yet anyway)
    const signButton = page.locator(MACRO_CONTAINER).getByRole('button', { name: 'Sign' });
    await expect(signButton).toBeVisible({ timeout: 15000 });

    // Sign the document
    await signButton.click();

    // After signing: Signed section should become visible
    await expect(page.locator(MACRO_CONTAINER).getByText('Signed (1)')).toBeVisible({ timeout: 15000 });
  });
});
