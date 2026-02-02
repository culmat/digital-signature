import { setDeleted, hardDeleteByPageId as hardDelete } from './storage/signatureStore';

/**
 * Handles Confluence page lifecycle events (trashed, deleted).
 *
 * - avi:confluence:trashed:page → Soft delete: marks contracts with deletedAt timestamp
 * - avi:confluence:deleted:page → Hard delete: permanently removes contracts and signatures
 *
 * @param {Object} event - Confluence event payload
 * @param {string} event.eventType - Event type identifier
 * @param {Object} event.content - Page content details
 * @param {string} event.content.id - Page ID
 */
export async function handler(event) {
  const pageId = event.content?.id;

  if (!pageId) {
    console.warn('Page lifecycle event received without page ID:', event.eventType);
    return;
  }

  console.log(`Processing ${event.eventType} for pageId ${pageId}`);

  if (event.eventType === 'avi:confluence:trashed:page') {
    const affected = await setDeleted(pageId);
    console.log(`Soft deleted ${affected} contracts for trashed page ${pageId}`);
  } else if (event.eventType === 'avi:confluence:deleted:page') {
    const affected = await hardDelete(pageId);
    console.log(`Hard deleted ${affected} contracts for purged page ${pageId}`);
  }
}
