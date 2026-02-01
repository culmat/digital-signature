/**
 * ADF Export handler for the digital signature macro.
 *
 * This function is called by Confluence when exporting pages to PDF or Word.
 * It generates an ADF (Atlassian Document Format) representation of the
 * markdown content stored in the macro configuration.
 */

import { parseAndSanitize } from './shared/markdown/parseAndSanitize';
import { renderToADF } from './shared/markdown/renderToADF';

/**
 * Generates ADF document for export (PDF/Word).
 *
 * @param {object} payload - Export payload from Confluence
 * @param {object} payload.context - Forge context
 * @param {object} payload.context.extension - Extension context
 * @param {object} payload.context.extension.config - Macro configuration
 * @returns {object} ADF document for export
 */
export function handler(payload) {
    const config = payload?.context?.extension?.config;
    const content = config?.content || '';
    const panelTitle = config?.panelTitle || '';

    // If no content, return a simple message
    if (!content) {
        return {
            version: 1,
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: 'No content configured for this digital signature macro.',
                }],
            }],
        };
    }

    try {
        // Parse and sanitize the markdown content
        const ast = parseAndSanitize(content);

        // Convert to ADF
        const adf = renderToADF(ast);

        // Optionally prepend the panel title as a heading
        if (panelTitle) {
            const titleHeading = {
                type: 'heading',
                attrs: { level: 2 },
                content: [{
                    type: 'text',
                    text: panelTitle,
                }],
            };
            adf.content.unshift(titleHeading);
        }

        return adf;
    } catch (error) {
        console.error('Error generating ADF for export:', error);

        // Fallback: return content as a code block
        return {
            version: 1,
            type: 'doc',
            content: [{
                type: 'codeBlock',
                content: [{
                    type: 'text',
                    text: content,
                }],
            }],
        };
    }
}
