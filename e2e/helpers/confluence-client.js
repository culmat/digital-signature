/**
 * Confluence API client for e2e tests.
 * Uses browser's fetch (via page.evaluate) to avoid proxy issues.
 */

// Load env vars (playwright.config.js also loads these)
require('dotenv').config({ path: __dirname + '/../.env' });

// Confluence credentials - fall back to FORGE_* if not set
const CONFLUENCE_HOST = process.env.CONFLUENCE_HOST;
const CONFLUENCE_EMAIL = process.env.CONFLUENCE_EMAIL || process.env.FORGE_EMAIL;
const CONFLUENCE_API_TOKEN = process.env.CONFLUENCE_API_TOKEN || process.env.FORGE_API_TOKEN;

/**
 * Get credentials for API calls.
 * @returns {{baseUrl: string, auth: string}}
 */
function getCredentials() {
  if (!CONFLUENCE_HOST) {
    throw new Error('Missing required env var: CONFLUENCE_HOST');
  }
  if (!CONFLUENCE_EMAIL || !CONFLUENCE_API_TOKEN) {
    throw new Error(
      'Missing credentials. Set CONFLUENCE_EMAIL/CONFLUENCE_API_TOKEN or FORGE_EMAIL/FORGE_API_TOKEN'
    );
  }

  const auth = Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}`).toString('base64');
  return {
    baseUrl: `https://${CONFLUENCE_HOST}/wiki`,
    auth,
  };
}

/**
 * Create a test page with the digital signature macro.
 * Uses browser's fetch to work with corporate proxy.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} spaceKey - Space key (e.g., 'DS')
 * @param {string} title - Page title
 * @param {string} storageBody - Storage format XML for page body
 * @returns {Promise<{id: string, title: string, webUrl: string}>}
 */
async function createTestPage(page, spaceKey, title, storageBody) {
  const { baseUrl, auth } = getCredentials();

  const result = await page.evaluate(
    async ({ baseUrl, auth, spaceKey, title, storageBody }) => {
      const response = await fetch(`${baseUrl}/rest/api/content`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
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

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create page: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      return {
        id: data.id,
        title: data.title,
        webUrl: data._links?.webui || `/wiki/spaces/${spaceKey}/pages/${data.id}`,
      };
    },
    { baseUrl, auth, spaceKey, title, storageBody }
  );

  return result;
}

/**
 * Delete a test page (cleanup).
 * Uses browser's fetch to work with corporate proxy.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} pageId - Page ID to delete
 */
async function deleteTestPage(page, pageId) {
  const { baseUrl, auth } = getCredentials();

  try {
    await page.evaluate(
      async ({ baseUrl, auth, pageId }) => {
        const response = await fetch(`${baseUrl}/rest/api/content/${pageId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Basic ${auth}`,
          },
        });

        if (!response.ok && response.status !== 404) {
          console.warn(`Failed to delete page ${pageId}: ${response.status}`);
        }
      },
      { baseUrl, auth, pageId }
    );
  } catch (error) {
    console.warn(`Failed to delete page ${pageId}:`, error.message);
  }
}

/**
 * Permanently delete (purge) a page from trash.
 * Uses v2 API with purge=true parameter.
 *
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} pageId - Page ID to purge
 */
async function purgeTestPage(page, pageId) {
  const { baseUrl, auth } = getCredentials();

  try {
    await page.evaluate(
      async ({ baseUrl, auth, pageId }) => {
        const response = await fetch(`${baseUrl}/api/v2/pages/${pageId}?purge=true`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Basic ${auth}`,
          },
        });

        if (!response.ok && response.status !== 404) {
          console.warn(`Failed to purge page ${pageId}: ${response.status}`);
        }
      },
      { baseUrl, auth, pageId }
    );
  } catch (error) {
    console.warn(`Failed to purge page ${pageId}:`, error.message);
  }
}

module.exports = {
  getCredentials,
  createTestPage,
  deleteTestPage,
  purgeTestPage,
};
