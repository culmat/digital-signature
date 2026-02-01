/**
 * ADF Export handler for the digital signature macro.
 *
 * This function is called by Confluence when exporting pages to PDF or Word.
 * It generates an ADF (Atlassian Document Format) representation of the
 * markdown content stored in the macro configuration, including signature status.
 */

import { createHash } from 'crypto';
import { parseAndSanitize } from './shared/markdown/parseAndSanitize';
import { renderToADF } from './shared/markdown/renderToADF';
import { getSignature } from './storage/signatureStore';

/**
 * Computes SHA-256 hash for content lookup.
 * Backend version using Node.js crypto module.
 */
function computeHash(pageId, panelTitle, content) {
    const hashInput = `${pageId}:${panelTitle}:${content}`;
    return createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Formats a timestamp for display in exports.
 */
function formatDate(timestamp) {
    if (!timestamp) return '';
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Creates ADF nodes for the signature section.
 */
function createSignatureSection(signatures, configuredSigners) {
    const nodes = [];

    // Horizontal rule separator
    nodes.push({ type: 'rule' });

    // Signatures heading
    nodes.push({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Signatures' }],
    });

    // Signed signatures
    if (signatures && signatures.length > 0) {
        nodes.push({
            type: 'paragraph',
            content: [{ type: 'text', text: 'Signed:', marks: [{ type: 'strong' }] }],
        });

        const signedList = {
            type: 'bulletList',
            content: signatures.map(sig => ({
                type: 'listItem',
                content: [{
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: `${sig.accountId}` },
                        { type: 'text', text: ` — ${formatDate(sig.signedAt)}` },
                    ],
                }],
            })),
        };
        nodes.push(signedList);
    }

    // Pending signatures (only if configuredSigners is specified)
    if (configuredSigners && configuredSigners.length > 0) {
        const signedAccountIds = new Set((signatures || []).map(s => s.accountId));
        const pendingSigners = configuredSigners.filter(id => !signedAccountIds.has(id));

        if (pendingSigners.length > 0) {
            nodes.push({
                type: 'paragraph',
                content: [{ type: 'text', text: 'Pending:', marks: [{ type: 'strong' }] }],
            });

            const pendingList = {
                type: 'bulletList',
                content: pendingSigners.map(accountId => ({
                    type: 'listItem',
                    content: [{
                        type: 'paragraph',
                        content: [{ type: 'text', text: accountId }],
                    }],
                })),
            };
            nodes.push(pendingList);
        }
    }

    // If no signatures and no pending (petition mode with no signers yet)
    if ((!signatures || signatures.length === 0) && (!configuredSigners || configuredSigners.length === 0)) {
        nodes.push({
            type: 'paragraph',
            content: [{ type: 'text', text: 'No signatures yet.', marks: [{ type: 'em' }] }],
        });
    }

    return nodes;
}

/**
 * Generates ADF document for export (PDF/Word).
 *
 * @param {object} payload - Export payload from Confluence
 * @param {object} payload.context - Forge context
 * @param {object} payload.context.extension - Extension context
 * @param {object} payload.context.extension.config - Macro configuration
 * @returns {Promise<object>} ADF document for export
 */
export async function handler(payload) {
    // Config location varies between PDF and Word exports:
    // - PDF: payload.extensionPayload.config
    // - Word: payload.context.config or payload.config
    const config = payload?.extensionPayload?.config
        || payload?.context?.config
        || payload?.config
        || {};

    const content = config?.content || '';
    const panelTitle = config?.panelTitle || '';
    const configuredSigners = config?.signers || [];
    const pageId = payload?.context?.content?.id;

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

        // Prepend the panel title as a heading
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

        // Fetch and append signatures if pageId is available
        if (pageId) {
            try {
                const hash = computeHash(pageId, panelTitle, content);
                const signatureEntity = await getSignature(hash);
                const signatures = signatureEntity?.signatures || [];

                const signatureNodes = createSignatureSection(signatures, configuredSigners);
                adf.content.push(...signatureNodes);
            } catch (signatureError) {
                console.error('Error fetching signatures for export:', signatureError);
                // Continue without signatures rather than failing the entire export
                adf.content.push({
                    type: 'paragraph',
                    content: [{
                        type: 'text',
                        text: '(Signature information unavailable)',
                        marks: [{ type: 'em' }],
                    }],
                });
            }
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
