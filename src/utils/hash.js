/**
 * Hash utilities for digital signatures.
 *
 * This module provides hash computation and validation functions
 * for the client-side frontend.
 *
 * The hash is computed as: SHA-256(pageId:title:body)
 */

/**
 * Client-side hash computation using Web Crypto API.
 * Use this in React components and frontend code.
 *
 * @param {string} pageId - Confluence page ID
 * @param {string} title - Page title
 * @param {string} body - Macro body content (stringified ADF)
 * @returns {Promise<string>} SHA-256 hash in hexadecimal format
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
 * Content format for hash computation.
 * 
 * Format: pageId:title:body
 * 
 * @example
 * // Input:
 * pageId = "123456789"
 * title = "Contract Agreement"
 * body = '{"type":"doc","content":[]}'
 * 
 * // Content string:
 * "123456789:Contract Agreement:{\"type\":\"doc\",\"content\":[]}"
 * 
 * // SHA-256 hash (hex):
 * "a1b2c3d4e5f6..."
 */

/**
 * Validates hash format.
 * 
 * @param {string} hash - Hash to validate
 * @returns {boolean} True if valid SHA-256 hex string (64 characters)
 */
export function isValidHash(hash) {
    return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash);
}
