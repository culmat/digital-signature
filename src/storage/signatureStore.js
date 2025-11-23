/**
 * Persistence layer for digital signatures using Forge SQL.
 *
 * This module provides CRUD operations for signature entities with lifecycle management.
 * Signatures are stored in a normalized SQL schema with content integrity hashes.
 *
 * See: docs/sql-schema-design.md
 */

import sql, { errorCodes, ForgeSQLAPIError } from '@forge/sql';

/**
 * Signature entity structure (returned by getSignature)
 * @typedef {Object} SignatureEntity
 * @property {string} hash - SHA-256 of pageId:title:body
 * @property {string} pageId - Confluence page ID
 * @property {Array<{accountId: string, signedAt: Date}>} signatures - Array of signatures
 * @property {Date} createdAt - When contract was created
 * @property {Date|null} deletedAt - When page was deleted (null if active)
 * @property {Date} lastModified - Derived from MAX(signedAt) or createdAt
 */

/**
 * Creates or updates a signature entity.
 *
 * If the contract doesn't exist, it creates it. Then adds the signature.
 * If the user already signed, throws an error (UNIQUE constraint violation).
 *
 * @param {string} hash - Content hash (SHA-256 of pageId:title:body)
 * @param {string} pageId - Confluence page ID
 * @param {string} accountId - Atlassian account ID of the signer
 * @returns {Promise<SignatureEntity>} The created or updated signature entity
 * @throws {Error} If user has already signed this contract
 */
export async function putSignature(hash, pageId, accountId) {
  if (!hash || !pageId || !accountId) {
    throw new Error('hash, pageId, and accountId are required');
  }

  try {
    // Step 1: Insert contract if not exists
    await sql.prepare(`
      INSERT IGNORE INTO contract (hash, pageId, createdAt, deletedAt)
      VALUES (?, ?, NOW(6), NULL)
    `).bindParams(hash, pageId).execute();

    // Step 2: Insert signature (will fail if duplicate due to PRIMARY KEY)
    await sql.prepare(`
      INSERT INTO signature (contractHash, accountId, signedAt)
      VALUES (?, ?, NOW(6))
    `).bindParams(hash, accountId).execute();

    // Step 3: Fetch and return updated entity
    return await getSignature(hash);
  } catch (error) {
    console.error(`Error putting signature for hash ${hash}:`, error);

    // Check for duplicate signature error
    if (error instanceof ForgeSQLAPIError && error.code === errorCodes.SQL_EXECUTION_ERROR) {
      if (error.message && error.message.includes('Duplicate entry')) {
        throw new Error(`User ${accountId} has already signed this contract`);
      }
    }

    throw new Error(`Failed to put signature: ${error.message}`);
  }
}

/**
 * Retrieves a signature entity by its content hash.
 *
 * @param {string} hash - Content hash (SHA-256 of pageId:title:body)
 * @returns {Promise<SignatureEntity|undefined>} The signature entity or undefined if not found
 */
export async function getSignature(hash) {
  if (!hash) {
    throw new Error('hash is required');
  }

  try {
    const result = await sql.prepare(`
      SELECT
        c.hash,
        c.pageId,
        c.createdAt,
        c.deletedAt,
        s.accountId,
        s.signedAt
      FROM contract c
      LEFT JOIN signature s ON c.hash = s.contractHash
      WHERE c.hash = ?
      ORDER BY s.signedAt ASC
    `).bindParams(hash).execute();

    // Extract rows from result
    const rows = result?.rows || result;

    // Handle empty result set
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return undefined; // Contract not found
    }

    // Transform SQL rows to SignatureEntity
    return transformRowsToEntity(rows);
  } catch (error) {
    console.error(`Error fetching signature for hash ${hash}:`, error);
    throw new Error(`Failed to fetch signature: ${error.message}`);
  }
}

/**
 * Marks all signatures for a given page as deleted (soft delete).
 *
 * This is called when a Confluence page is deleted. It updates the deletedAt
 * timestamp for all contracts associated with the page.
 *
 * @param {string} pageId - Confluence page ID
 * @returns {Promise<number>} Number of contracts marked as deleted
 */
export async function setDeleted(pageId) {
  if (!pageId) {
    throw new Error('pageId is required');
  }

  try {
    const result = await sql.prepare(`
      UPDATE contract
      SET deletedAt = NOW(6)
      WHERE pageId = ? AND deletedAt IS NULL
    `).bindParams(pageId).execute();

    const affectedRows = result.affectedRows || 0;
    console.log(`Marked ${affectedRows} contracts as deleted for pageId ${pageId}`);

    return affectedRows;
  } catch (error) {
    console.error(`Error setting deleted for pageId ${pageId}:`, error);
    throw new Error(`Failed to mark signatures as deleted: ${error.message}`);
  }
}

/**
 * Deletes contracts and signatures that were deleted before the cutoff time (hard delete).
 *
 * This implements the retention policy by permanently removing signatures
 * for pages that have been deleted for longer than the retention period.
 *
 * @param {number} retentionDays - Number of days to retain deleted signatures
 * @returns {Promise<number>} Number of contracts permanently deleted
 */
export async function cleanup(retentionDays) {
  if (typeof retentionDays !== 'number' || retentionDays < 0) {
    throw new Error('retentionDays must be a non-negative number');
  }

  try {
    // Step 1: Delete signatures first (manual cascade)
    const signatureResult = await sql.prepare(`
      DELETE s FROM signature s
      INNER JOIN contract c ON s.contractHash = c.hash
      WHERE c.deletedAt IS NOT NULL
        AND c.deletedAt < DATE_SUB(NOW(6), INTERVAL ? DAY)
    `).bindParams(retentionDays).execute();

    const signaturesDeleted = signatureResult.affectedRows || 0;
    console.log(`Deleted ${signaturesDeleted} signatures during cleanup`);

    // Step 2: Delete contracts
    const contractResult = await sql.prepare(`
      DELETE FROM contract
      WHERE deletedAt IS NOT NULL
        AND deletedAt < DATE_SUB(NOW(6), INTERVAL ? DAY)
    `).bindParams(retentionDays).execute();

    const contractsDeleted = contractResult.affectedRows || 0;
    console.log(`Deleted ${contractsDeleted} contracts during cleanup`);

    return contractsDeleted;
  } catch (error) {
    console.error(`Error during cleanup with retention ${retentionDays} days:`, error);
    throw new Error(`Failed to cleanup signatures: ${error.message}`);
  }
}

/**
 * Transforms SQL query results into a SignatureEntity
 *
 * @param {Array<Object>} rows - SQL query results from contract LEFT JOIN signature
 * @returns {SignatureEntity} Transformed entity
 * @private
 */
function transformRowsToEntity(rows) {
  if (!rows || rows.length === 0) {
    return undefined;
  }

  // First row contains contract data
  const firstRow = rows[0];

  // Helper to convert SQL timestamp string to Date object
  const parseTimestamp = (timestamp) => {
    if (!timestamp) return null;
    if (timestamp instanceof Date) return timestamp;
    return new Date(timestamp);
  };

  // Build signatures array (filter out null accountIds from LEFT JOIN)
  const signatures = rows
    .filter(row => row.accountId !== null)
    .map(row => ({
      accountId: row.accountId,
      signedAt: parseTimestamp(row.signedAt)
    }));

  // Calculate lastModified: most recent signature or createdAt if no signatures
  const lastModified = signatures.length > 0
    ? signatures[signatures.length - 1].signedAt // Last in array (ordered by signedAt ASC)
    : parseTimestamp(firstRow.createdAt);

  // Return entity in expected format
  return {
    hash: firstRow.hash,
    pageId: String(firstRow.pageId), // Convert BIGINT to string for consistency
    signatures: signatures,
    createdAt: parseTimestamp(firstRow.createdAt),
    deletedAt: parseTimestamp(firstRow.deletedAt),
    lastModified: lastModified // Derived value
  };
}
