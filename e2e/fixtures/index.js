/**
 * Test fixture generators.
 *
 * These functions generate SQL that can be restored via the admin UI.
 * The SQL format matches the backup format from backupManager.js.
 */

const { computeMacroHash } = require('../helpers/hash');

/**
 * Sample ADF for a simple contract text.
 * This is the content INSIDE the macro body.
 */
const SAMPLE_CONTRACT_ADF = {
  type: 'paragraph',
  content: [
    {
      type: 'text',
      text: 'I hereby agree to the terms and conditions of this test contract. This document is for testing purposes only.',
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
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return `557058:${uuid}`;
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

module.exports = {
  SAMPLE_CONTRACT_ADF,
  generateRandomAccountId,
  generateFixtureWithOneSignature,
  formatTimestamp,
};
