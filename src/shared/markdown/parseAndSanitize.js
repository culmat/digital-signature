/**
 * Markdown parser and sanitizer for digital signature macro.
 *
 * This module provides the core parsing and sanitization pipeline that is shared
 * between browser rendering and PDF/Word export.
 *
 * Supported markdown subset (per spec):
 * - Block: paragraphs, headings (#-######), lists (- * 1.), blockquotes (>),
 *          code blocks (```), horizontal rules (---)
 * - Inline: bold (**), italic (*), strikethrough (~~), inline code (`)
 *
 * Unsupported (converted to plain text):
 * - Links [text](url) -> text only
 * - Images ![alt](url) -> alt text only
 * - Raw HTML -> escaped
 * - Tables, footnotes, task lists, etc. -> plain text
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';

/**
 * Set of AST node types that are supported and should be preserved.
 */
const SUPPORTED_BLOCK_NODES = new Set([
    'root',
    'paragraph',
    'heading',
    'blockquote',
    'list',
    'listItem',
    'code',           // fenced code blocks
    'thematicBreak',  // horizontal rules
]);

const SUPPORTED_INLINE_NODES = new Set([
    'text',
    'strong',         // bold
    'emphasis',       // italic
    'delete',         // strikethrough
    'inlineCode',
    'break',          // line breaks
]);

const SUPPORTED_NODES = new Set([
    ...SUPPORTED_BLOCK_NODES,
    ...SUPPORTED_INLINE_NODES,
]);

/**
 * Extracts plain text content from an AST node recursively.
 *
 * @param {object} node - AST node
 * @returns {string} Plain text content
 */
function extractText(node) {
    if (!node) return '';

    if (node.type === 'text' || node.type === 'inlineCode') {
        return node.value || '';
    }

    if (node.children && Array.isArray(node.children)) {
        return node.children.map(extractText).join('');
    }

    return node.value || '';
}

/**
 * Sanitization plugin for remark.
 *
 * Transforms unsupported nodes to plain text:
 * - Links -> text content only (Option A from spec)
 * - Images -> alt text
 * - HTML -> escaped/removed
 * - Unknown nodes -> text content
 */
function sanitizePlugin() {
    return (tree) => {
        visit(tree, (node, index, parent) => {
            if (!parent || index === undefined) return;

            // Handle links: convert to text content only (Option A)
            if (node.type === 'link') {
                const textContent = extractText(node);
                parent.children[index] = {
                    type: 'text',
                    value: textContent,
                };
                return;
            }

            // Handle images: convert to alt text
            if (node.type === 'image') {
                parent.children[index] = {
                    type: 'text',
                    value: node.alt || '',
                };
                return;
            }

            // Handle raw HTML: escape it (remark-parse with default settings
            // doesn't parse HTML, but we handle it defensively)
            if (node.type === 'html') {
                parent.children[index] = {
                    type: 'text',
                    value: node.value || '',
                };
                return;
            }

            // Handle link references and image references
            if (node.type === 'linkReference' || node.type === 'imageReference') {
                const textContent = extractText(node);
                parent.children[index] = {
                    type: 'text',
                    value: textContent || node.label || '',
                };
                return;
            }

            // Handle definition (link/image reference definitions)
            if (node.type === 'definition') {
                // Remove definitions entirely
                parent.children.splice(index, 1);
                return;
            }

            // Handle tables: convert entire table to text
            if (node.type === 'table' || node.type === 'tableRow' || node.type === 'tableCell') {
                const textContent = extractText(node);
                parent.children[index] = {
                    type: 'paragraph',
                    children: [{ type: 'text', value: textContent }],
                };
                return;
            }

            // Handle footnotes
            if (node.type === 'footnoteReference' || node.type === 'footnoteDefinition') {
                parent.children.splice(index, 1);
                return;
            }

            // For any other unsupported node types, convert to text
            if (!SUPPORTED_NODES.has(node.type)) {
                const textContent = extractText(node);
                if (textContent) {
                    parent.children[index] = {
                        type: 'text',
                        value: textContent,
                    };
                } else {
                    // Remove empty unsupported nodes
                    parent.children.splice(index, 1);
                }
            }
        });
    };
}

/**
 * Parses markdown content and returns a sanitized AST.
 *
 * The returned AST contains only supported node types, with unsupported
 * elements converted to plain text.
 *
 * @param {string} content - Raw markdown content
 * @returns {object} Sanitized mdast AST
 *
 * @example
 * const ast = parseAndSanitize('# Hello **world**\n\n[link](http://example.com)');
 * // Returns AST with heading, bold text, and "link" as plain text (URL removed)
 */
export function parseAndSanitize(content) {
    if (!content || typeof content !== 'string') {
        return {
            type: 'root',
            children: [],
        };
    }

    try {
        const processor = unified()
            .use(remarkParse)
            .use(sanitizePlugin);

        const ast = processor.parse(content);
        processor.runSync(ast);

        return ast;
    } catch (error) {
        // On parse error, return content as a single preformatted block
        console.error('Markdown parse error:', error);
        return {
            type: 'root',
            children: [{
                type: 'code',
                value: content,
            }],
        };
    }
}

/**
 * Validates markdown content.
 *
 * @param {string} content - Markdown content to validate
 * @param {number} minCharacters - Minimum character count (default: 10)
 * @returns {object|null} Validation error object or null if valid
 */
export function validateMarkdownContent(content, minCharacters = 10) {
    const trimmedContent = (content || '').trim();

    if (trimmedContent.length < minCharacters) {
        return {
            type: 'insufficient-content',
            contentType: 'Insufficient Content',
            contentDetails: `Only ${trimmedContent.length} characters found.`,
            message: `Content must contain at least ${minCharacters} characters.`,
        };
    }

    return null;
}
