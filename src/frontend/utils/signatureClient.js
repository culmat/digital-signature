/**
 * Client-side utilities for digital signature macro.
 * 
 * This module provides hash computation and signature management
 * for the React frontend components.
 */

/**
 * Computes SHA-256 hash of content using Web Crypto API.
 * 
 * The hash is computed as: SHA-256(pageId:title:body)
 * 
 * @param {string} pageId - Confluence page ID
 * @param {string} title - Page title
 * @param {string} body - Macro body content (stringified ADF)
 * @returns {Promise<string>} SHA-256 hash in hexadecimal format (64 chars)
 * 
 * @example
 * const hash = await computeHash('123456789', 'Contract', '{"type":"doc"}');
 * // Returns: "a1b2c3d4e5f6..."
 */
export async function computeHash(pageId, title, body) {
    const content = `${pageId}:${title}:${body}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signs the current document content.
 * 
 * Computes the hash client-side and sends only the hash to the server.
 * The server retrieves the user's accountId from the Forge context.
 * 
 * @param {object} invoke - Forge bridge invoke function
 * @param {string} pageId - Confluence page ID
 * @param {string} title - Page title
 * @param {object} body - ADF document body
 * @returns {Promise<{success: boolean, signature?: object, message?: string, error?: string}>}
 * 
 * @example
 * import { invoke } from '@forge/bridge';
 * import { signDocument } from './utils/signatureClient';
 * 
 * const result = await signDocument(invoke, pageId, title, adfBody);
 * if (result.success) {
 *   console.log(result.message);
 * }
 */
export async function signDocument(invoke, pageId, title, body) {
    try {
        // Compute hash client-side
        const hash = await computeHash(pageId, title, JSON.stringify(body));

        // Send only hash and pageId to server
        const result = await invoke('sign', { hash, pageId });

        return result;
    } catch (error) {
        console.error('Error signing document:', error);
        return {
            success: false,
            error: error.message || 'Failed to sign document'
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
 * @param {string} title - Page title
 * @param {object} body - ADF document body
 * @returns {Promise<{success: boolean, signature?: object, hash?: string, error?: string}>}
 * 
 * @example
 * import { invoke } from '@forge/bridge';
 * import { getSignatures } from './utils/signatureClient';
 * 
 * const result = await getSignatures(invoke, pageId, title, adfBody);
 * if (result.success && result.signature) {
 *   console.log(`Found ${result.signature.signatures.length} signatures`);
 * }
 */
export async function getSignatures(invoke, pageId, title, body) {
    try {
        // Compute hash client-side
        const hash = await computeHash(pageId, title, JSON.stringify(body));

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
 * Validates hash format.
 * 
 * @param {string} hash - Hash to validate
 * @returns {boolean} True if valid SHA-256 hex string (64 characters)
 * 
 * @example
 * isValidHash('a1b2c3d4...') // true (if 64 chars)
 * isValidHash('invalid')      // false
 */
export function isValidHash(hash) {
    return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash);
}
