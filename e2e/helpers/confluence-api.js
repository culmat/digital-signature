/**
 * Confluence REST API helpers for creating test pages with macros.
 * Uses browser session cookies for authentication via page.evaluate().
 */

// Construct base URL from env var
const CONFLUENCE_HOST = process.env.CONFLUENCE_HOST;
const BASE_URL = CONFLUENCE_HOST ? `https://${CONFLUENCE_HOST}` : '';

/**
 * Ensure browser is on the Confluence domain (needed for API calls with cookies).
 *
 * @param {import('@playwright/test').Page} page
 */
async function ensureOnConfluence(page) {
  const currentUrl = page.url();
  // If we're not on the Confluence domain, navigate to it
  if (!currentUrl.includes('/wiki') || !currentUrl.includes(CONFLUENCE_HOST)) {
    await page.goto(`${BASE_URL}/wiki`);
  }
}

/**
 * Get space ID from space key.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} spaceKey
 * @returns {Promise<string>}
 */
async function getSpaceId(page, spaceKey) {
  await ensureOnConfluence(page);
  const spaceId = await page.evaluate(async (spaceKey) => {
    const res = await fetch(`/wiki/api/v2/spaces?keys=${spaceKey}`);
    if (!res.ok) {
      throw new Error(`Failed to get space: ${res.status}`);
    }
    const data = await res.json();
    return data.results[0]?.id;
  }, spaceKey);

  if (!spaceId) {
    throw new Error(`Space ${spaceKey} not found`);
  }
  return spaceId;
}

/**
 * Create a Confluence page with the digital signature macro.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} spaceKey - Confluence space key
 * @param {string} title - Page title
 * @param {object} macroBodyContent - ADF content node for inside the macro
 * @param {object} [macroConfig] - Optional macro configuration
 * @param {string} [macroConfig.panelTitle] - Panel title
 * @param {string[]} [macroConfig.signers] - Array of account IDs
 * @returns {Promise<{pageId: string, pageUrl: string, title: string}>}
 */
async function createTestPage(page, spaceKey, title, macroBodyText, macroConfig = {}) {
  await ensureOnConfluence(page);

  // Use v1 API with storage format - more reliable for Forge macros
  // App ID: bab5617e-dc42-4ca8-ad38-947c826fe58c
  // Macro key: digital-signature-confluence-cloud-culmat
  const result = await page.evaluate(
    async ({ spaceKey, title, bodyText, config }) => {
      // Build storage format body with Forge macro
      // Forge macros use: forge-{app-id}-{macro-key}
      const macroName = 'forge-bab5617e-dc42-4ca8-ad38-947c826fe58c-digital-signature-confluence-cloud-culmat';

      // Build config parameters as macro parameters
      const configJson = JSON.stringify({
        panelTitle: config.panelTitle || '',
        signers: config.signers || [],
        signerGroups: [],
        inheritViewers: false,
        inheritEditors: false,
      });

      const storageBody = `
        <ac:structured-macro ac:name="${macroName}" ac:schema-version="1" ac:macro-id="${crypto.randomUUID()}">
          <ac:parameter ac:name="config">${configJson}</ac:parameter>
          <ac:rich-text-body>
            <p>${bodyText}</p>
          </ac:rich-text-body>
        </ac:structured-macro>
      `;

      const res = await fetch('/wiki/rest/api/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          type: 'page',
          title,
          space: { key: spaceKey },
          body: {
            storage: {
              value: storageBody,
              representation: 'storage',
            },
          },
        }),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Failed to create page: ${res.status} ${error}`);
      }

      const data = await res.json();
      return {
        pageId: data.id,
        pageUrl: data._links.webui,
        title: data.title,
      };
    },
    { spaceKey, title, bodyText: macroBodyText, config: macroConfig }
  );

  return result;
}

/**
 * Delete a test page (cleanup).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} pageId
 */
async function deletePage(page, pageId) {
  await ensureOnConfluence(page);
  await page.evaluate(async (pageId) => {
    const res = await fetch(`/wiki/api/v2/pages/${pageId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`Failed to delete page ${pageId}: ${res.status}`);
    }
  }, pageId);
}

module.exports = { createTestPage, deletePage, getSpaceId };
