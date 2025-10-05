/**
 * Persistence layer for digital signatures using Forge Custom Entities.
 * 
 * This module provides CRUD operations for signature entities with lifecycle management.
 * Signatures are stored with content integrity hashes and deletion timestamps for cleanup.
 */

import { kvs, WhereConditions } from '@forge/kvs';

// Entity name as defined in manifest.yml
const ENTITY_NAME = 'signature';

// Index names as defined in manifest.yml
// Note: 'hash' index exists in manifest but is not used in queries since
// hash is used as the entity key, allowing direct .get(hash) lookups
const INDEX_PAGE_ID = 'pageId';
const INDEX_BY_DELETION_TIME = 'by-deletion-time';

/**
 * Signature entity structure
 * @typedef {Object} SignatureEntity
 * @property {string} hash - SHA-256 of pageId:title:body
 * @property {string} pageId - Confluence page ID (stable across moves)
 * @property {Array<{accountId: string, signedAt: number}>} signatures - Array of signatures
 * @property {number} createdAt - Unix timestamp (seconds) when first signature was added
 * @property {number} lastModified - Unix timestamp (seconds) when last signature was added
 * @property {number} deletedAt - Unix timestamp (seconds) when page was deleted (0 if not deleted)
 */

/**
 * Individual signature within a signature entity
 * @typedef {Object} Signature
 * @property {string} accountId - Atlassian account ID (stable, unique identifier)
 * @property {number} signedAt - Unix timestamp (seconds) when user signed
 */

/**
 * Creates or updates a signature entity.
 * 
 * If the entity already exists (same hash), it updates the signatures array.
 * If it's a new entity, it initializes all fields.
 * 
 * @param {string} hash - Content hash (SHA-256 of pageId:title:body)
 * @param {string} pageId - Confluence page ID
 * @param {string} accountId - Atlassian account ID of the signer
 * @returns {Promise<SignatureEntity>} The created or updated signature entity
 */
export async function putSignature(hash, pageId, accountId) {
    if (!hash || !pageId || !accountId) {
        throw new Error('hash, pageId, and accountId are required');
    }

    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

    // Try to get existing signature entity
    const existing = await kvs.entity(ENTITY_NAME).get(hash);

    if (existing) {
        // Update existing entity
        // Check if user already signed
        const alreadySigned = existing.signatures.some(sig => sig.accountId === accountId);

        if (alreadySigned) {
            // User already signed, return existing entity unchanged
            return existing;
        }

        // Add new signature
        const updated = {
            ...existing,
            signatures: [
                ...existing.signatures,
                {
                    accountId,
                    signedAt: now
                }
            ],
            lastModified: now
        };

        await kvs.entity(ENTITY_NAME).set(hash, updated);
        return updated;
    } else {
        // Create new entity
        const newEntity = {
            hash,
            pageId,
            signatures: [
                {
                    accountId,
                    signedAt: now
                }
            ],
            createdAt: now,
            lastModified: now,
            deletedAt: 0 // Not deleted
        };

        await kvs.entity(ENTITY_NAME).set(hash, newEntity);
        return newEntity;
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

    return await kvs.entity(ENTITY_NAME).get(hash);
}

/**
 * Marks all signatures for a given page as deleted.
 * 
 * This is called when a Confluence page is deleted. It updates the deletedAt
 * timestamp for all signature entities associated with the page.
 * 
 * @param {string} pageId - Confluence page ID
 * @returns {Promise<number>} Number of signature entities marked as deleted
 */
export async function setDeleted(pageId) {
    if (!pageId) {
        throw new Error('pageId is required');
    }

    const deletionTime = Math.floor(Date.now() / 1000);
    let count = 0;
    let cursor;

    // Query all signatures for this page
    do {
        const query = kvs
            .entity(ENTITY_NAME)
            .query()
            .index(INDEX_PAGE_ID)
            .where(WhereConditions.equalTo(pageId))
            .limit(100);

        if (cursor) {
            query.cursor(cursor);
        }

        const results = await query.getMany();

        // Mark each signature as deleted
        for (const result of results.results) {
            const signature = result.value;

            // Only update if not already deleted
            if (signature.deletedAt === 0) {
                await kvs.entity(ENTITY_NAME).set(result.key, {
                    ...signature,
                    deletedAt: deletionTime
                });
                count++;
            }
        }

        cursor = results.nextCursor;
    } while (cursor);

    return count;
}

/**
 * Deletes signature entities that were deleted before the cutoff time.
 * 
 * This implements the retention policy by permanently removing signatures
 * for pages that have been deleted for longer than the retention period.
 * 
 * @param {number} retentionDays - Number of days to retain deleted signatures
 * @returns {Promise<number>} Number of signature entities permanently deleted
 */
export async function cleanup(retentionDays) {
    if (typeof retentionDays !== 'number' || retentionDays < 0) {
        throw new Error('retentionDays must be a non-negative number');
    }

    const cutoffTime = Math.floor((Date.now() - retentionDays * 24 * 60 * 60 * 1000) / 1000);
    let count = 0;
    let cursor;

    // Query all signatures deleted before cutoff
    do {
        const query = kvs
            .entity(ENTITY_NAME)
            .query()
            .index(INDEX_BY_DELETION_TIME)
            .where(WhereConditions.between(1, cutoffTime))
            .limit(100);

        if (cursor) {
            query.cursor(cursor);
        }

        const results = await query.getMany();

        // Permanently delete each expired signature
        for (const result of results.results) {
            await kvs.entity(ENTITY_NAME).delete(result.key);
            count++;
        }

        cursor = results.nextCursor;
    } while (cursor);

    return count;
}
