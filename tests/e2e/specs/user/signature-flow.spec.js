const { test, expect } = require('../../fixtures/confluenceFixture');

/**
 * Regular user signature flow tests.
 * Uses pre-authenticated session from .auth/user.json (loaded via playwright.config.js).
 */
test.describe('Signature Flow - Regular User', () => {
  test('should display signature macro on page', async ({ confluenceApi, testPage, authenticatedPage }) => {
    const contractText = `
      <h2>Service Agreement</h2>
      <p>This Service Agreement is entered into between the parties on the date of signature.</p>
      <p><strong>Terms:</strong></p>
      <ul>
        <li>Service provider agrees to deliver services as outlined</li>
        <li>Client agrees to pay the agreed upon fees</li>
        <li>Both parties agree to maintain confidentiality</li>
      </ul>
      <p>By signing below, both parties acknowledge their agreement to these terms.</p>
    `;
    
    const macroXml = confluenceApi.createMacroXml('digital-signature', {
      panelTitle: 'Test Signature Request'
    }, contractText);

    const currentPage = await confluenceApi.getPage(testPage.id);
    const updatedContent = currentPage.body.storage.value + macroXml;
    await confluenceApi.updatePage(testPage.id, testPage.title, updatedContent);

    await authenticatedPage.goto(`${testPage._links.base}${testPage._links.webui}`);
    await authenticatedPage.waitForLoadState('networkidle');

    const allowAccessButton = authenticatedPage.locator('button:has-text("Allow access")');
    try {
      await allowAccessButton.waitFor({ state: 'visible', timeout: 3000 });
      
      const [popup] = await Promise.all([
        authenticatedPage.context().waitForEvent('page'),
        allowAccessButton.click()
      ]);
      
      await popup.waitForLoadState('networkidle');
      await popup.locator('button:has-text("Allow"), button:has-text("Accept"), button:has-text("Authorize")').first().click();
      await popup.waitForEvent('close', { timeout: 5000 }).catch(() => {});
      
      await authenticatedPage.waitForLoadState('networkidle');
    } catch (e) {
      // Button not present or authorization already granted
      console.log(`Authorization handling: ${e.message}`);
    }

    const macroFrame = authenticatedPage.frameLocator('iframe[data-testid="digital-signature-macro"]');
    await expect(macroFrame.locator('text=Test Signature Request')).toBeVisible({ timeout: 10000 });
  });

  test('should allow user to sign document', async ({ confluenceApi, testPage, authenticatedPage }) => {
    const contractText = `
      <h2>Confidentiality Agreement</h2>
      <p>This agreement establishes the terms under which confidential information will be shared.</p>
      <p>The receiving party agrees to maintain the confidentiality of all proprietary information disclosed during the course of this agreement.</p>
      <p>By signing below, you acknowledge your understanding and acceptance of these confidentiality obligations.</p>
    `;
    
    const macroXml = confluenceApi.createMacroXml('digital-signature', {
      panelTitle: 'Sign Here'
    }, contractText);

    const currentPage = await confluenceApi.getPage(testPage.id);
    const updatedContent = currentPage.body.storage.value + macroXml;
    await confluenceApi.updatePage(testPage.id, testPage.title, updatedContent);
    await authenticatedPage.goto(`${testPage._links.base}${testPage._links.webui}`);
    await authenticatedPage.waitForLoadState('networkidle');

    const allowAccessButton = authenticatedPage.locator('button:has-text("Allow access")');
    try {
      await allowAccessButton.waitFor({ state: 'visible', timeout: 3000 });
      await allowAccessButton.click();
      await authenticatedPage.waitForLoadState('networkidle');
      await authenticatedPage.reload();
      await authenticatedPage.waitForLoadState('networkidle');
    } catch (e) {
      // Button not present, authorization already granted
    }

    const macroFrame = authenticatedPage.frameLocator('iframe[data-testid="digital-signature-macro"]');
    const signButton = macroFrame.locator('button:has-text("Sign")');

    await expect(signButton).toBeEnabled();
    await signButton.click();

    await expect(macroFrame.locator('text=Signature submitted')).toBeVisible({ timeout: 5000 });
  });
});
