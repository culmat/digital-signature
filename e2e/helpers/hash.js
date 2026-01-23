const { createHash } = require('crypto');

/**
 * Compute contract hash: SHA-256(pageId:title:body)
 * Must match the client-side implementation in src/utils/hash.js
 *
 * @param {string} pageId - Confluence page ID
 * @param {string} title - Page title
 * @param {string} body - Macro body content (stringified ADF)
 * @returns {string} SHA-256 hash in hexadecimal format
 */
function computeHash(pageId, title, body) {
  const content = `${pageId}:${title}:${body}`;
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute hash for a macro body (ADF object).
 *
 * @param {string} pageId
 * @param {string} title
 * @param {object} macroBody - ADF content object
 * @returns {string}
 */
function computeMacroHash(pageId, title, macroBody) {
  return computeHash(pageId, title, JSON.stringify(macroBody));
}

module.exports = { computeHash, computeMacroHash };
