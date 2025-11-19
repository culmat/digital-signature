const { test, expect } = require('../../fixtures/multiUserFixture');
const ConfluenceApiClient = require('../../utils/confluenceApi');
const testConfig = require('../../utils/testConfig');

/**
 * Multi-user collaborative signing tests.
 * Uses both user.json and admin.json sessions via multiUserFixture.
 */
test.describe('Collaborative Signing - Multiple Users', () => {
  let confluenceApi;
  let testSpace;
  let testPage;

  test.beforeEach(async () => {
    confluenceApi = new ConfluenceApiClient(testConfig.getConfluenceConfig());

    const spaceKey = testConfig.generateTestSpaceKey();
    const spaceName = testConfig.generateTestSpaceName('Multi-user test');
    testSpace = await confluenceApi.createSpace(spaceKey, spaceName);

    const contractText = `
      <h2>Partnership Agreement</h2>
      <p>This partnership agreement outlines the terms between the collaborating parties.</p>
      <p><strong>Key Terms:</strong></p>
      <ul>
        <li>Both parties agree to share resources and responsibilities equally</li>
        <li>Decisions require mutual consent from all parties</li>
        <li>Profits and losses will be distributed according to the agreed ratios</li>
      </ul>
      <p>All parties must sign to indicate their acceptance of these terms.</p>
    `;

    const macroXml = confluenceApi.createMacroXml('digital-signature', {
      panelTitle: 'Multi-User Signature'
    }, contractText);

    testPage = await confluenceApi.createPage(testSpace.key, 'Collaborative Test', '<p>Test page content</p>' + macroXml);
  });

  test.afterEach(async () => {
    if (testSpace && testConfig.cleanupAfterTests) {
      await confluenceApi.deleteSpace(testSpace.key);
    }
  });

  test('admin creates request, regular user signs', async ({ userPage, adminPage }) => {
    const pageUrl = `${testPage._links.base}${testPage._links.webui}`;

    await adminPage.goto(pageUrl);
    await adminPage.waitForLoadState('networkidle');
    
    const adminAllowButton = adminPage.locator('button:has-text("Allow access")');
    try {
      await adminAllowButton.waitFor({ state: 'visible', timeout: 3000 });
      await adminAllowButton.click();
      await adminPage.waitForLoadState('networkidle');
      await adminPage.reload();
      await adminPage.waitForLoadState('networkidle');
    } catch (e) {
      // Button not present, authorization already granted
    }

    const adminFrame = adminPage.frameLocator('iframe[data-testid="digital-signature-macro"]');
    await expect(adminFrame.locator('text=Multi-User Signature')).toBeVisible();

    const createButton = adminFrame.locator('button:has-text("Create Request")');
    await createButton.click();

    await expect(adminFrame.locator('text=Request created')).toBeVisible({ timeout: 5000 });

    await userPage.goto(pageUrl);
    await userPage.waitForLoadState('networkidle');
    
    const userAllowButton = userPage.locator('button:has-text("Allow access")');
    try {
      await userAllowButton.waitFor({ state: 'visible', timeout: 3000 });
      await userAllowButton.click();
      await userPage.waitForLoadState('networkidle');
      await userPage.reload();
      await userPage.waitForLoadState('networkidle');
    } catch (e) {
      // Button not present, authorization already granted
    }

    const userFrame = userPage.frameLocator('iframe[data-testid="digital-signature-macro"]');

    const signButton = userFrame.locator('button:has-text("Sign")');
    await expect(signButton).toBeEnabled();
    await signButton.click();

    await expect(userFrame.locator('text=Signature submitted')).toBeVisible({ timeout: 5000 });

    await adminPage.reload();
    await expect(adminFrame.locator('text=Signed by')).toBeVisible({ timeout: 5000 });
  });

  test('both users can view signature status concurrently', async ({ userPage, adminPage }) => {
    const pageUrl = `${testPage._links.base}${testPage._links.webui}`;

    await Promise.all([
      userPage.goto(pageUrl),
      adminPage.goto(pageUrl)
    ]);

    await Promise.all([
      userPage.waitForLoadState('networkidle'),
      adminPage.waitForLoadState('networkidle')
    ]);

    const userAllowButton = userPage.locator('button:has-text("Allow access")');
    try {
      await userAllowButton.waitFor({ state: 'visible', timeout: 3000 });
      await userAllowButton.click();
      await userPage.waitForLoadState('networkidle');
      await userPage.reload();
      await userPage.waitForLoadState('networkidle');
    } catch (e) {
      // Button not present
    }

    const adminAllowButton = adminPage.locator('button:has-text("Allow access")');
    try {
      await adminAllowButton.waitFor({ state: 'visible', timeout: 3000 });
      await adminAllowButton.click();
      await adminPage.waitForLoadState('networkidle');
      await adminPage.reload();
      await adminPage.waitForLoadState('networkidle');
    } catch (e) {
      // Button not present
    }

    const userFrame = userPage.frameLocator('iframe[data-testid="digital-signature-macro"]');
    const adminFrame = adminPage.frameLocator('iframe[data-testid="digital-signature-macro"]');

    await Promise.all([
      expect(userFrame.locator('text=Multi-User Signature')).toBeVisible(),
      expect(adminFrame.locator('text=Multi-User Signature')).toBeVisible()
    ]);

    const userStatusCount = await userFrame.locator('[data-testid="signature-count"]').textContent();
    const adminStatusCount = await adminFrame.locator('[data-testid="signature-count"]').textContent();

    expect(userStatusCount).toBe(adminStatusCount);
  });
});
