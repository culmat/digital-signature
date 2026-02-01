/**
 * Test fixture generators.
 *
 * These functions generate SQL that can be restored via the admin UI.
 * The SQL format matches the backup format from backupManager.js.
 */

const { randomUUID } = require('crypto');
const { computeMacroHash } = require('../helpers/hash');
const { getAppId, getMacroKey } = require('../helpers/manifest');

// Load env for FORGE_ENV_ID
require('dotenv').config({ path: __dirname + '/../.env' });

// App and macro identifiers parsed from manifest.yml
const APP_ID = getAppId();
const MACRO_KEY = getMacroKey();
const FORGE_ENV_ID = process.env.FORGE_ENV_ID || 'fd9d205a-7091-4573-9f6f-2cbd40db6961';

/**
 * Sample contract text (plain text for storage format).
 */
const SAMPLE_CONTRACT_TEXT = 'I hereby agree to the terms and conditions of this test contract.';

/**
 * Sample ADF for a simple contract text.
 * This is the content INSIDE the macro body (what the frontend sees).
 * This must match the ADF that Confluence generates from the storage format.
 */
const SAMPLE_CONTRACT_ADF = {
  type: 'doc',
  version: 1,
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: SAMPLE_CONTRACT_TEXT,
        },
      ],
    },
  ],
};

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
 * @param {string} pageTitle - The page title
 * @param {string} signerAccountId - Account ID of the existing signer
 * @param {object} [macroBody] - ADF content inside the macro (default: SAMPLE_CONTRACT_ADF)
 * @returns {string} SQL INSERT statements
 */
function generateFixtureWithOneSignature(pageId, pageTitle, signerAccountId, macroBody = SAMPLE_CONTRACT_ADF) {
  const bodyJson = JSON.stringify(macroBody);
  const hash = computeMacroHash(pageId, pageTitle, macroBody);

  // Timestamps
  const createdAt = formatTimestamp(new Date(Date.now() - 7200000)); // 2 hours ago
  const signedAt = formatTimestamp(new Date(Date.now() - 3600000));  // 1 hour ago

  return `-- Test fixture: Contract with one signature
-- Hash: ${hash}
-- Page: ${pageId} - ${pageTitle}

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
 * Generate Confluence storage format for a page with the Digital Signature macro.
 *
 * This generates the <ac:adf-extension> format used by Forge macros in Confluence.
 *
 * @param {string} bodyText - Plain text content for inside the macro body
 * @param {object} [config] - Optional macro configuration
 * @param {string} [config.panelTitle='Test Contract'] - Panel title
 * @param {string[]} [config.signers=[]] - Array of account IDs
 * @returns {string} Storage format XML
 */
function generateMacroStorageFormat(bodyText, config = {}) {
  const { panelTitle = 'Test Contract', signers = [] } = config;
  const localId = randomUUID();
  const extensionKey = `${APP_ID}/${FORGE_ENV_ID}/static/${MACRO_KEY}`;
  const extensionId = `ari:cloud:ecosystem::extension/${extensionKey}`;

  // Build signers parameter values
  const signersParams = signers.length > 0
    ? signers.map(s => `<ac:adf-parameter-value>${s}</ac:adf-parameter-value>`).join('')
    : '<ac:adf-parameter-value />';

  return `<ac:adf-extension><ac:adf-node type="bodied-extension"><ac:adf-attribute key="extension-key">${extensionKey}</ac:adf-attribute><ac:adf-attribute key="extension-type">com.atlassian.ecosystem</ac:adf-attribute><ac:adf-attribute key="parameters"><ac:adf-parameter key="local-id">${localId}</ac:adf-parameter><ac:adf-parameter key="extension-id">${extensionId}</ac:adf-parameter><ac:adf-parameter key="extension-title">digital-signature (Development)</ac:adf-parameter><ac:adf-parameter key="layout">bodiedExtension</ac:adf-parameter><ac:adf-parameter key="forge-environment">DEVELOPMENT</ac:adf-parameter><ac:adf-parameter key="render">native</ac:adf-parameter><ac:adf-parameter key="guest-params"><ac:adf-parameter key="panel-title">${panelTitle}</ac:adf-parameter><ac:adf-parameter key="signers">${signersParams}</ac:adf-parameter><ac:adf-parameter key="signer-groups"><ac:adf-parameter-value /></ac:adf-parameter><ac:adf-parameter key="inherit-viewers" type="boolean">false</ac:adf-parameter><ac:adf-parameter key="inherit-editors" type="boolean">false</ac:adf-parameter></ac:adf-parameter></ac:adf-attribute><ac:adf-attribute key="text">digital-signature (Development)</ac:adf-attribute><ac:adf-attribute key="layout">default</ac:adf-attribute><ac:adf-attribute key="local-id">${localId}</ac:adf-attribute><ac:adf-content>
<p local-id="${randomUUID()}">${bodyText}</p></ac:adf-content></ac:adf-node></ac:adf-extension>`;
}

module.exports = {
  SAMPLE_CONTRACT_TEXT,
  SAMPLE_CONTRACT_ADF,
  generateRandomAccountId,
  generateFixtureWithOneSignature,
  formatTimestamp,
  generateMacroStorageFormat,
};
