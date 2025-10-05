/**
 * Utilities for validating ADF (Atlassian Document Format) documents
 * to ensure they contain only static content suitable for digital signatures.
 */

/**
 * Extracts user-friendly details from an ADF node for display in error messages
 * 
 * @param {Object} node - The ADF node to extract details from
 * @returns {string} Human-readable description of the problematic content
 */
const extractContentDetails = (node) => {
    switch (node.type) {
        case 'media':
        case 'mediaInline':
            // Extract media file information
            const mediaId = node.attrs?.id || 'unknown';
            const mediaType = node.attrs?.type || 'file';
            const altText = node.attrs?.alt;
            return altText ? `${mediaType} "${altText}"` : `${mediaType} (ID: ${mediaId})`;

        case 'mediaGroup':
        case 'mediaSingle':
            return 'media file or image';

        case 'inlineCard':
        case 'blockCard':
            // Extract URL or datasource information
            if (node.attrs?.datasource) {
                const datasourceId = node.attrs.datasource.id || 'unknown';
                return `datasource query (${datasourceId})`;
            }
            const url = node.attrs?.url || 'unknown URL';
            // Truncate long URLs for readability
            return url.length > 50 ? `link to ${url.substring(0, 47)}...` : `link to ${url}`;

        case 'embedCard':
            const embedUrl = node.attrs?.url || 'unknown URL';
            return embedUrl.length > 50 ? `embedded content from ${embedUrl.substring(0, 40)}...` : `embedded content from ${embedUrl}`;

        case 'extension':
        case 'bodiedExtension':
            // Extract extension/macro name
            const extensionKey = node.attrs?.extensionKey || 'unknown';
            const extensionText = node.attrs?.text;
            return extensionText ? `macro "${extensionText}"` : `macro (${extensionKey})`;

        case 'inlineExtension':
            const inlineExtKey = node.attrs?.extensionKey || 'unknown';
            const inlineExtText = node.attrs?.text;
            return inlineExtText ? `inline macro "${inlineExtText}"` : `inline macro (${inlineExtKey})`;

        default:
            return `${node.type} element`;
    }
};

/**
 * Recursively checks an ADF document for dynamic content that could change after signature.
 * Dynamic content includes:
 * - Media references (file attachments, images) that could be replaced
 * - Inline/block cards (links that could change content)
 * - Extensions (macros that could have dynamic output)
 * - Bodied extensions (complex macros with dynamic behavior)
 * - Inline extensions (inline macros)
 * - Block cards with datasources (dynamic queries)
 * - Embed cards (external content)
 * 
 * @param {Object} node - The ADF node to check
 * @returns {Object|null} Object with type, message, and content details if dynamic content found, null otherwise
 */
export const checkForDynamicContent = (node) => {
    if (!node || typeof node !== 'object') {
        return null;
    }

    // Check node type for dynamic content
    switch (node.type) {
        case 'media':
        case 'mediaInline':
            // Media files can be replaced or deleted
            return {
                type: 'media',
                message: 'Document contains media files (images/attachments) that could be modified or deleted after signing.',
                contentType: 'Media File',
                contentDetails: extractContentDetails(node),
                node: node
            };

        case 'mediaGroup':
        case 'mediaSingle':
            // Media groups and singles contain media nodes
            return {
                type: 'media',
                message: 'Document contains media files (images/attachments) that could be modified or deleted after signing.',
                contentType: 'Media File',
                contentDetails: extractContentDetails(node),
                node: node
            };

        case 'inlineCard':
        case 'blockCard':
            // Cards can have dynamic content from URLs or datasources
            if (node.attrs?.datasource) {
                return {
                    type: 'datasource',
                    message: 'Document contains dynamic datasource queries that could change after signing.',
                    contentType: 'Datasource Query',
                    contentDetails: extractContentDetails(node),
                    node: node
                };
            }
            return {
                type: 'card',
                message: 'Document contains smart links that could display different content after signing.',
                contentType: 'Smart Link',
                contentDetails: extractContentDetails(node),
                node: node
            };

        case 'embedCard':
            // Embedded content can change
            return {
                type: 'embed',
                message: 'Document contains embedded content that could change after signing.',
                contentType: 'Embedded Content',
                contentDetails: extractContentDetails(node),
                node: node
            };

        case 'extension':
        case 'inlineExtension':
        case 'bodiedExtension':
            // Extensions/macros can have dynamic output
            return {
                type: 'extension',
                message: 'Document contains macros or extensions that could display dynamic content after signing.',
                contentType: 'Macro/Extension',
                contentDetails: extractContentDetails(node),
                node: node
            };

        default:
            // Not a dynamic node type, continue checking
            break;
    }

    // Recursively check content array
    if (Array.isArray(node.content)) {
        for (const childNode of node.content) {
            const result = checkForDynamicContent(childNode);
            if (result) {
                return result;
            }
        }
    }

    // Recursively check marks (though marks typically don't contain dynamic content)
    if (Array.isArray(node.marks)) {
        for (const mark of node.marks) {
            const result = checkForDynamicContent(mark);
            if (result) {
                return result;
            }
        }
    }

    return null;
};
