/**
 * Test fixture generators.
 *
 * These functions generate SQL that can be restored via the admin UI.
 * The SQL format matches the backup format from backupManager.js.
 */

const { randomUUID } = require('crypto');
const { computeConfigHash } = require('../helpers/hash');
const { getAppId, getMacroKey } = require('../helpers/manifest');

// Load env for FORGE_ENV_ID
require('dotenv').config({ path: __dirname + '/../.env' });

// App and macro identifiers parsed from manifest.yml
const APP_ID = getAppId();
const MACRO_KEY = getMacroKey();
const FORGE_ENV_ID = process.env.FORGE_ENV_ID || 'fd9d205a-7091-4573-9f6f-2cbd40db6961';

/**
 * Sample contract text (markdown content for config).
 */
const SAMPLE_CONTRACT_TEXT = 'I hereby agree to the terms and conditions of this test contract.';

/**
 * Generate a random Atlassian account ID.
 * Real format: 557058:xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *
 * @returns {string}
 */
function generateRandomAccountId() {
  return `557058:${randomUUID()}`;
}

/**
 * Format a Date as MySQL TIMESTAMP string.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Generate fixture SQL for a contract with one existing signature.
 *
 * @param {string} pageId - The Confluence page ID
 * @param {string} signerAccountId - Account ID of the existing signer
 * @param {object} [config] - Macro configuration
 * @param {string} [config.title] - Contract title
 * @param {string} [config.content] - Raw markdown content
 * @returns {string} SQL INSERT statements
 */
function generateFixtureWithOneSignature(pageId, signerAccountId, config = {}) {
  const { title = 'Test Contract', content = SAMPLE_CONTRACT_TEXT } = config;
  const hash = computeConfigHash(pageId, { title, content });

  // Timestamps
  const createdAt = formatTimestamp(new Date(Date.now() - 7200000)); // 2 hours ago
  const signedAt = formatTimestamp(new Date(Date.now() - 3600000));  // 1 hour ago

  return `-- Test fixture: Contract with one signature
-- Hash: ${hash}
-- Page: ${pageId} - ${title}

INSERT INTO contract (hash, pageId, createdAt, deletedAt) VALUES
('${hash}', ${pageId}, '${createdAt}', NULL)
ON DUPLICATE KEY UPDATE
  pageId = VALUES(pageId),
  createdAt = LEAST(createdAt, VALUES(createdAt)),
  deletedAt = COALESCE(VALUES(deletedAt), deletedAt);

INSERT INTO signature (contractHash, accountId, signedAt) VALUES
('${hash}', '${signerAccountId}', '${signedAt}')
ON DUPLICATE KEY UPDATE
  signedAt = LEAST(signedAt, VALUES(signedAt));
`;
}

/**
 * Generate fixture SQL for a contract with multiple signatures.
 * Useful for testing scenarios with multiple signers (e.g., offboarded users).
 *
 * @param {string} pageId - The Confluence page ID
 * @param {string[]} signerAccountIds - Array of account IDs
 * @param {object} [config] - Macro configuration
 * @param {string} [config.title] - Contract title
 * @param {string} [config.content] - Raw markdown content
 * @returns {string} SQL INSERT statements
 */
function generateFixtureWithMultipleSignatures(pageId, signerAccountIds, config = {}) {
  const { title = 'Test Contract', content = SAMPLE_CONTRACT_TEXT } = config;
  const hash = computeConfigHash(pageId, { title, content });

  const createdAt = formatTimestamp(new Date(Date.now() - 7200000)); // 2 hours ago

  // Contract INSERT
  let sql = `-- Test fixture: Contract with ${signerAccountIds.length} signatures
-- Hash: ${hash}
-- Page: ${pageId} - ${title}

INSERT INTO contract (hash, pageId, createdAt, deletedAt) VALUES
('${hash}', ${pageId}, '${createdAt}', NULL)
ON DUPLICATE KEY UPDATE
  pageId = VALUES(pageId),
  createdAt = LEAST(createdAt, VALUES(createdAt)),
  deletedAt = COALESCE(VALUES(deletedAt), deletedAt);

`;

  // Signature INSERTs (staggered timestamps, 1 minute apart)
  signerAccountIds.forEach((accountId, index) => {
    const signedAt = formatTimestamp(new Date(Date.now() - 3600000 + (index * 60000)));
    sql += `INSERT INTO signature (contractHash, accountId, signedAt) VALUES
('${hash}', '${accountId}', '${signedAt}')
ON DUPLICATE KEY UPDATE signedAt = LEAST(signedAt, VALUES(signedAt));

`;
  });

  return sql;
}

/**
 * Generate Confluence storage format for a page with the Digital Signature macro.
 *
 * This generates the <ac:adf-extension> format used by Forge macros in Confluence.
 * The macro is now config-based (not bodied), so content is stored in guest-params.
 *
 * @param {object} [config] - Macro configuration
 * @param {string} [config.title='Test Contract'] - Panel title
 * @param {string} [config.content=''] - Markdown content
 * @param {string[]} [config.signers=[]] - Array of account IDs
 * @param {string[]} [config.signerGroups=[]] - Array of group IDs
 * @param {number} [config.maxSignatures] - Maximum number of signatures allowed
 * @param {boolean} [config.inheritViewers=false] - Allow page viewers to sign
 * @param {boolean} [config.inheritEditors=false] - Allow page editors to sign
 * @param {string} [config.signaturesVisible] - ALWAYS, IF_SIGNATORY, or IF_SIGNED
 * @param {string} [config.pendingVisible] - ALWAYS, IF_SIGNATORY, or IF_SIGNED
 * @returns {string} Storage format XML
 */
function generateMacroStorageFormat(config = {}) {
  const { title = 'Test Contract', content = '', signers = [], signerGroups = [], maxSignatures, inheritViewers = false, inheritEditors = false, signaturesVisible, pendingVisible, visibilityLimit } = config;
  const localId = randomUUID();
  const extensionKey = `${APP_ID}/${FORGE_ENV_ID}/static/${MACRO_KEY}`;
  const extensionId = `ari:cloud:ecosystem::extension/${extensionKey}`;

  // Build signers parameter values
  const signersParams = signers.length > 0
    ? signers.map(s => `<ac:adf-parameter-value>${s}</ac:adf-parameter-value>`).join('')
    : '<ac:adf-parameter-value />';

  // Build signer groups parameter values
  const signerGroupsParams = signerGroups.length > 0
    ? signerGroups.map(g => `<ac:adf-parameter-value>${g}</ac:adf-parameter-value>`).join('')
    : '<ac:adf-parameter-value />';

  // Build optional max signatures parameter
  const maxSignaturesParam = maxSignatures !== undefined
    ? `<ac:adf-parameter key="max-signatures" type="number">${maxSignatures}</ac:adf-parameter>`
    : '';

  const signaturesVisibleParam = signaturesVisible
    ? `<ac:adf-parameter key="signatures-visible">${signaturesVisible}</ac:adf-parameter>`
    : '';

  const pendingVisibleParam = pendingVisible
    ? `<ac:adf-parameter key="pending-visible">${pendingVisible}</ac:adf-parameter>`
    : '';

  const visibilityLimitParam = visibilityLimit !== undefined
    ? `<ac:adf-parameter key="visibility-limit" type="number">${visibilityLimit}</ac:adf-parameter>`
    : '';

  // Escape content for XML
  const escapedContent = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<ac:adf-extension><ac:adf-node type="extension"><ac:adf-attribute key="extension-key">${extensionKey}</ac:adf-attribute><ac:adf-attribute key="extension-type">com.atlassian.ecosystem</ac:adf-attribute><ac:adf-attribute key="parameters"><ac:adf-parameter key="local-id">${localId}</ac:adf-parameter><ac:adf-parameter key="extension-id">${extensionId}</ac:adf-parameter><ac:adf-parameter key="extension-title">digital-signature (Development)</ac:adf-parameter><ac:adf-parameter key="forge-environment">DEVELOPMENT</ac:adf-parameter><ac:adf-parameter key="render">native</ac:adf-parameter><ac:adf-parameter key="guest-params"><ac:adf-parameter key="title">${title}</ac:adf-parameter><ac:adf-parameter key="content">${escapedContent}</ac:adf-parameter><ac:adf-parameter key="signers">${signersParams}</ac:adf-parameter><ac:adf-parameter key="signer-groups">${signerGroupsParams}</ac:adf-parameter><ac:adf-parameter key="inherit-viewers" type="boolean">${inheritViewers}</ac:adf-parameter><ac:adf-parameter key="inherit-editors" type="boolean">${inheritEditors}</ac:adf-parameter>${maxSignaturesParam}${signaturesVisibleParam}${pendingVisibleParam}${visibilityLimitParam}</ac:adf-parameter></ac:adf-attribute><ac:adf-attribute key="text">digital-signature (Development)</ac:adf-attribute><ac:adf-attribute key="layout">default</ac:adf-attribute><ac:adf-attribute key="local-id">${localId}</ac:adf-attribute></ac:adf-node></ac:adf-extension>`;
}

module.exports = {
  SAMPLE_CONTRACT_TEXT,
  generateRandomAccountId,
  generateFixtureWithOneSignature,
  generateFixtureWithMultipleSignatures,
  formatTimestamp,
  generateMacroStorageFormat,
};
