const { createHash } = require('crypto');

/**
 * Compute contract hash: SHA-256(pageId:panelTitle:content)
 * Must match the client-side implementation in src/utils/hash.js
 *
 * @param {string} pageId - Confluence page ID
 * @param {string} panelTitle - Contract title from macro config
 * @param {string} content - Raw markdown content from macro config
 * @returns {string} SHA-256 hash in hexadecimal format
 */
function computeHash(pageId, panelTitle, content) {
  const hashInput = `${pageId}:${panelTitle}:${content}`;
  return createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Compute hash for macro config.
 *
 * @param {string} pageId
 * @param {object} config - Macro configuration object
 * @param {string} config.panelTitle - Contract title
 * @param {string} config.content - Raw markdown content
 * @returns {string}
 */
function computeConfigHash(pageId, config) {
  return computeHash(pageId, config.panelTitle || '', config.content || '');
}

module.exports = { computeHash, computeConfigHash };
