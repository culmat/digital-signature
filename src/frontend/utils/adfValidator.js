function traverseADF(node, visitor, options = {}) {
    const {
        visitMarks = false,
        earlyReturn = false
    } = options;

    const result = visitor(node);
    if (earlyReturn && result) return result;

    if (Array.isArray(node.content)) {
        for (const child of node.content) {
            const childResult = traverseADF(child, visitor, options);
            if (earlyReturn && childResult) return childResult;
        }
    }

    if (visitMarks && Array.isArray(node.marks)) {
        for (const mark of node.marks) {
            const markResult = traverseADF(mark, visitor, options);
            if (earlyReturn && markResult) return markResult;
        }
    }

    return result;
}

const extractTextContent = (node) => {
    if (!node || typeof node !== 'object') {
        return '';
    }

    let textContent = '';

    traverseADF(node, (currentNode) => {
        if (currentNode.type === 'text' && currentNode.text) {
            textContent += currentNode.text;
        }
    });

    return textContent;
};

/**
 * Validates that the ADF document contains sufficient text content
 * 
 * @param {Object} node - The ADF document root node to validate
 * @param {number} minCharacters - Minimum number of characters required (default: 10)
 * @returns {Object|null} Validation error object if content is insufficient, null otherwise
 */
export const validateTextContent = (node, minCharacters = 10) => {
    const textContent = extractTextContent(node);
    const trimmedContent = textContent.trim();

    if (trimmedContent.length < minCharacters) {
        return {
            type: 'insufficient-content',
            message: 'The contract must be self-contained within the macro body and cannot rely on content from the surrounding Confluence page.',
            contentType: 'Insufficient Content',
            contentDetails: trimmedContent.length === 0
                ? 'The macro body is empty or contains no text.'
                : `Only ${trimmedContent.length} character${trimmedContent.length === 1 ? '' : 's'} of text found (minimum ${minCharacters} required).`,
            actualContent: trimmedContent
        };
    }

    return null;
};

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

    return traverseADF(node, (currentNode) => {
        switch (currentNode.type) {
            case 'media':
            case 'mediaInline':
                return {
                    type: 'media',
                    message: 'Document contains media files (images/attachments) that could be modified or deleted after signing.',
                    contentType: 'Media File',
                    contentDetails: extractContentDetails(currentNode),
                    node: currentNode
                };

            case 'mediaGroup':
            case 'mediaSingle':
                return {
                    type: 'media',
                    message: 'Document contains media files (images/attachments) that could be modified or deleted after signing.',
                    contentType: 'Media File',
                    contentDetails: extractContentDetails(currentNode),
                    node: currentNode
                };

            case 'inlineCard':
            case 'blockCard':
                if (currentNode.attrs?.datasource) {
                    return {
                        type: 'datasource',
                        message: 'Document contains dynamic datasource queries that could change after signing.',
                        contentType: 'Datasource Query',
                        contentDetails: extractContentDetails(currentNode),
                        node: currentNode
                    };
                }
                return {
                    type: 'card',
                    message: 'Document contains smart links that could display different content after signing.',
                    contentType: 'Smart Link',
                    contentDetails: extractContentDetails(currentNode),
                    node: currentNode
                };

            case 'embedCard':
                return {
                    type: 'embed',
                    message: 'Document contains embedded content that could change after signing.',
                    contentType: 'Embedded Content',
                    contentDetails: extractContentDetails(currentNode),
                    node: currentNode
                };

            case 'extension':
            case 'inlineExtension':
            case 'bodiedExtension':
                return {
                    type: 'extension',
                    message: 'Document contains macros or extensions that could display dynamic content after signing.',
                    contentType: 'Macro/Extension',
                    contentDetails: extractContentDetails(currentNode),
                    node: currentNode
                };

            default:
                return null;
        }
    }, { visitMarks: true, earlyReturn: true });
};
