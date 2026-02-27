/**
 * Client-side utilities for digital signature macro.
 *
 * This module provides signature management for the React frontend components.
 *
 * Hash formula: SHA-256(pageId:title:content)
 * - pageId: Confluence page ID
 * - title: Contract title from macro config
 * - content: Raw markdown content from macro config (user's exact input)
 */

import { computeHash } from '../../utils/hash.js';

/**
 * Signs the current document content.
 *
 * Computes the hash client-side and sends only the hash to the server.
 * The server retrieves the user's accountId from the Forge context.
 *
 * @param {object} invoke - Forge bridge invoke function
 * @param {string} pageId - Confluence page ID
 * @param {string} title - Contract title from macro config
 * @param {string} content - Raw markdown content from macro config
 * @returns {Promise<{success: boolean, signature?: object, message?: string, error?: string}>}
 *
 * @example
 * import { invoke } from '@forge/bridge';
 * import { signDocument } from './utils/signatureClient';
 *
 * const result = await signDocument(invoke, pageId, title, content);
 * if (result.success) {
 *   console.log(result.message);
 * }
 */
export async function signDocument(invoke, pageId, title, content) {
    try {
        // Compute hash client-side using raw content (not transformed)
        const hash = await computeHash(pageId, title, content);

        // Send only hash and pageId to server
        const result = await invoke('sign', { hash, pageId });

        // If backend returns success: false, surface the message or error
        if (!result.success) {
            return {
                success: false,
                error: result.error,
                status: result.status
            };
        }
        return result;
    } catch (error) {
        console.error('Error signing:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Retrieves signatures for the current document content.
 *
 * Computes the hash client-side and sends only the hash to the server.
 *
 * @param {object} invoke - Forge bridge invoke function
 * @param {string} pageId - Confluence page ID
 * @param {string} title - Contract title from macro config
 * @param {string} content - Raw markdown content from macro config
 * @returns {Promise<{success: boolean, signature?: object, hash?: string, error?: string}>}
 *
 * @example
 * import { invoke } from '@forge/bridge';
 * import { getSignatures } from './utils/signatureClient';
 *
 * const result = await getSignatures(invoke, pageId, title, content);
 * if (result.success && result.signature) {
 *   console.log(`Found ${result.signature.signatures.length} signatures`);
 * }
 */
export async function getSignatures(invoke, pageId, title, content) {
    try {
        // Compute hash client-side using raw content (not transformed)
        const hash = await computeHash(pageId, title, content);

        // Send only hash to server
        const result = await invoke('getSignatures', { hash });

        return result;
    } catch (error) {
        console.error('Error retrieving signatures:', error);
        return {
            success: false,
            error: error.message || 'Failed to retrieve signatures'
        };
    }
}

/**
 * Checks if the current user is authorized to sign the document.
 *
 * @param {object} invoke - Forge bridge invoke function
 * @param {string} pageId - Confluence page ID
 * @param {string} title - Contract title from macro config
 * @param {string} content - Raw markdown content from macro config
 * @returns {Promise<{success: boolean, allowed?: boolean, reason?: string, error?: string}>}
 *
 * @example
 * import { invoke } from '@forge/bridge';
 * import { checkAuthorization } from './utils/signatureClient';
 *
 * const result = await checkAuthorization(invoke, pageId, title, content);
 * if (result.success && result.allowed) {
 *   console.log('User can sign:', result.reason);
 * }
 */
export async function checkAuthorization(invoke, pageId, title, content) {
    try {
        // Compute hash client-side using raw content (not transformed)
        const hash = await computeHash(pageId, title, content);

        // Send hash and pageId to server
        const result = await invoke('checkAuthorization', { hash, pageId });

        return result;
    } catch (error) {
        console.error('Error checking authorization:', error);
        return {
            success: false,
            error: error.message || 'Failed to check authorization'
        };
    }
}

