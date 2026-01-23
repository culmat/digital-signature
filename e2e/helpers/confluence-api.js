/**
 * Confluence REST API helpers for creating test pages with macros.
 * Uses browser session cookies for authentication via page.evaluate().
 */

/**
 * Get space ID from space key.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} spaceKey
 * @returns {Promise<string>}
 */
async function getSpaceId(page, spaceKey) {
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
async function createTestPage(page, spaceKey, title, macroBodyContent, macroConfig = {}) {
  const spaceId = await getSpaceId(page, spaceKey);

  const result = await page.evaluate(
    async ({ spaceId, title, macroContent, config }) => {
      // Build the ADF for the page with macro
      // Extension key from manifest: digital-signature-confluence-cloud-culmat
      const pageBody = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'extension',
            attrs: {
              extensionType: 'com.atlassian.ecosystem',
              extensionKey: 'digital-signature-confluence-cloud-culmat',
              parameters: {
                config: {
                  panelTitle: config.panelTitle || '',
                  signers: config.signers || [],
                  signerGroups: [],
                  inheritViewers: false,
                  inheritEditors: false,
                },
              },
              bodyType: 'rich',
            },
            content: [macroContent],
          },
        ],
      };

      const res = await fetch('/wiki/api/v2/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          spaceId,
          status: 'current',
          title,
          body: {
            representation: 'atlas_doc_format',
            value: JSON.stringify(pageBody),
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
    { spaceId, title, macroContent: macroBodyContent, config: macroConfig }
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
