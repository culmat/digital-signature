/**
 * ADF (Atlassian Document Format) renderer for sanitized markdown AST.
 *
 * Converts a sanitized mdast AST to ADF for Confluence PDF/Word export.
 *
 * ADF Node Mapping:
 * - paragraph -> paragraph
 * - heading -> heading (with level attribute)
 * - list (unordered) -> bulletList
 * - list (ordered) -> orderedList
 * - listItem -> listItem
 * - blockquote -> blockquote
 * - code -> codeBlock
 * - thematicBreak -> rule
 * - text -> text
 * - strong -> text with mark { type: 'strong' }
 * - emphasis -> text with mark { type: 'em' }
 * - delete -> text with mark { type: 'strike' }
 * - inlineCode -> text with mark { type: 'code' }
 * - break -> hardBreak
 */

/**
 * Renders inline nodes to ADF text nodes with marks.
 *
 * @param {object} node - mdast inline node
 * @param {Array} marks - Accumulated marks from parent nodes
 * @returns {Array} Array of ADF inline nodes
 */
function renderInlineToADF(node, marks = []) {
    if (!node) return [];

    switch (node.type) {
        case 'text':
            if (!node.value) return [];
            return [{
                type: 'text',
                text: node.value,
                ...(marks.length > 0 ? { marks } : {}),
            }];

        case 'strong': {
            const newMarks = [...marks, { type: 'strong' }];
            return (node.children || []).flatMap(child => renderInlineToADF(child, newMarks));
        }

        case 'emphasis': {
            const newMarks = [...marks, { type: 'em' }];
            return (node.children || []).flatMap(child => renderInlineToADF(child, newMarks));
        }

        case 'delete': {
            const newMarks = [...marks, { type: 'strike' }];
            return (node.children || []).flatMap(child => renderInlineToADF(child, newMarks));
        }

        case 'inlineCode':
            if (!node.value) return [];
            return [{
                type: 'text',
                text: node.value,
                marks: [...marks, { type: 'code' }],
            }];

        case 'break':
            return [{ type: 'hardBreak' }];

        default:
            // Fallback: extract text value or recurse into children
            if (node.value) {
                return [{
                    type: 'text',
                    text: node.value,
                    ...(marks.length > 0 ? { marks } : {}),
                }];
            }
            if (node.children) {
                return node.children.flatMap(child => renderInlineToADF(child, marks));
            }
            return [];
    }
}

/**
 * Renders block-level nodes to ADF.
 *
 * @param {object} node - mdast block node
 * @returns {object|null} ADF node or null
 */
function renderBlockToADF(node) {
    if (!node) return null;

    switch (node.type) {
        case 'paragraph': {
            const content = (node.children || []).flatMap(child => renderInlineToADF(child));
            // ADF requires at least empty content array for paragraphs
            return {
                type: 'paragraph',
                content: content.length > 0 ? content : [],
            };
        }

        case 'heading': {
            const level = Math.min(Math.max(node.depth || 1, 1), 6);
            const content = (node.children || []).flatMap(child => renderInlineToADF(child));
            return {
                type: 'heading',
                attrs: { level },
                content: content.length > 0 ? content : [],
            };
        }

        case 'blockquote': {
            const content = (node.children || [])
                .map(child => renderBlockToADF(child))
                .filter(Boolean);
            return {
                type: 'blockquote',
                content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
            };
        }

        case 'code': {
            const attrs = {};
            if (node.lang) {
                attrs.language = node.lang;
            }
            return {
                type: 'codeBlock',
                ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
                content: node.value ? [{
                    type: 'text',
                    text: node.value,
                }] : [],
            };
        }

        case 'list': {
            const listType = node.ordered ? 'orderedList' : 'bulletList';
            const content = (node.children || [])
                .map(child => renderBlockToADF(child))
                .filter(Boolean);

            const result = {
                type: listType,
                content: content.length > 0 ? content : [],
            };

            // Add order attribute for ordered lists if starting number is not 1
            if (node.ordered && node.start && node.start !== 1) {
                result.attrs = { order: node.start };
            }

            return result;
        }

        case 'listItem': {
            // List items in ADF must contain block content (paragraphs)
            const content = (node.children || []).map(child => {
                if (child.type === 'paragraph') {
                    return renderBlockToADF(child);
                }
                // Wrap non-paragraph content in paragraph
                if (child.type === 'list') {
                    // Nested lists are allowed directly
                    return renderBlockToADF(child);
                }
                // For inline content, wrap in paragraph
                const inlineContent = renderInlineToADF(child);
                if (inlineContent.length > 0) {
                    return {
                        type: 'paragraph',
                        content: inlineContent,
                    };
                }
                return renderBlockToADF(child);
            }).filter(Boolean);

            return {
                type: 'listItem',
                content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
            };
        }

        case 'thematicBreak':
            return { type: 'rule' };

        default:
            // Fallback: try to render as paragraph
            if (node.children) {
                const content = node.children.flatMap(child => renderInlineToADF(child));
                if (content.length > 0) {
                    return {
                        type: 'paragraph',
                        content,
                    };
                }
            }
            if (node.value) {
                return {
                    type: 'paragraph',
                    content: [{
                        type: 'text',
                        text: node.value,
                    }],
                };
            }
            return null;
    }
}

/**
 * Renders a sanitized markdown AST to an ADF document.
 *
 * @param {object} ast - Sanitized mdast AST from parseAndSanitize()
 * @returns {object} ADF document
 *
 * @example
 * import { parseAndSanitize } from './parseAndSanitize';
 *
 * const ast = parseAndSanitize('# Hello **world**');
 * const adf = renderToADF(ast);
 * // Returns: { version: 1, type: 'doc', content: [...] }
 */
export function renderToADF(ast) {
    if (!ast || ast.type !== 'root') {
        return {
            version: 1,
            type: 'doc',
            content: [],
        };
    }

    const content = (ast.children || [])
        .map(node => renderBlockToADF(node))
        .filter(Boolean);

    return {
        version: 1,
        type: 'doc',
        content: content.length > 0 ? content : [],
    };
}
