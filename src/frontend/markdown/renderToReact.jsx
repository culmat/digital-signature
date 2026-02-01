/**
 * React renderer for sanitized markdown AST.
 *
 * Converts a sanitized mdast AST to React elements using Atlassian Design System
 * components from @forge/react where appropriate.
 */

import React from 'react';
import { Box, Heading, Text, Strong, Em, Strike, Code, CodeBlock, List, ListItem, Stack, xcss } from '@forge/react';

/**
 * Styles for blockquotes.
 */
const blockquoteStyles = xcss({
    borderLeftWidth: 'border.width.outline',
    borderLeftStyle: 'solid',
    borderLeftColor: 'color.border',
    paddingLeft: 'space.200',
    marginLeft: 'space.0',
    color: 'color.text.subtlest',
});

const hrStyles = xcss({
    borderTopWidth: 'border.width',
    borderTopStyle: 'solid',
    borderTopColor: 'color.border',
    marginTop: 'space.200',
    marginBottom: 'space.200',
});

/**
 * Maps heading depth to Atlassian Heading size.
 */
const HEADING_SIZE_MAP = {
    1: 'large',
    2: 'medium',
    3: 'small',
    4: 'xsmall',
    5: 'xsmall',
    6: 'xsmall',
};

/**
 * Renders inline nodes (text, strong, emphasis, etc.)
 *
 * @param {object} node - AST node
 * @param {number} index - Node index for React key
 * @returns {React.ReactNode}
 */
function renderInline(node, index) {
    if (!node) return null;

    switch (node.type) {
        case 'text':
            return node.value;

        case 'strong':
            return (
                <Strong key={index}>
                    {node.children?.map((child, i) => renderInline(child, i))}
                </Strong>
            );

        case 'emphasis':
            return (
                <Em key={index}>
                    {node.children?.map((child, i) => renderInline(child, i))}
                </Em>
            );

        case 'delete':
            return (
                <Strike key={index}>
                    {node.children?.map((child, i) => renderInline(child, i))}
                </Strike>
            );

        case 'inlineCode':
            return <Code key={index}>{node.value}</Code>;

        case 'break':
            return <Text key={index}>{'\n'}</Text>;

        default:
            // Fallback: render as text if has value, or render children
            if (node.value) return node.value;
            if (node.children) {
                return node.children.map((child, i) => renderInline(child, i));
            }
            return null;
    }
}

/**
 * Renders block-level nodes.
 *
 * @param {object} node - AST node
 * @param {number} index - Node index for React key
 * @returns {React.ReactNode}
 */
function renderBlock(node, index) {
    if (!node) return null;

    switch (node.type) {
        case 'paragraph':
            return (
                <Text key={index}>
                    {node.children?.map((child, i) => renderInline(child, i))}
                </Text>
            );

        case 'heading': {
            const size = HEADING_SIZE_MAP[node.depth] || 'small';
            return (
                <Heading key={index} size={size}>
                    {node.children?.map((child, i) => renderInline(child, i))}
                </Heading>
            );
        }

        case 'blockquote':
            return (
                <Box key={index} xcss={blockquoteStyles}>
                    {node.children?.map((child, i) => renderBlock(child, i))}
                </Box>
            );

        case 'code':
            return (
                <CodeBlock
                    key={index}
                    text={node.value}
                    language={node.lang || 'text'}
                    showLineNumbers={false}
                />
            );

        case 'list':
            return (
                <List key={index} type={node.ordered ? 'ordered' : 'unordered'}>
                    {node.children?.map((child, i) => renderBlock(child, i))}
                </List>
            );

        case 'listItem':
            return (
                <ListItem key={index}>
                    {node.children?.map((child, i) => {
                        if (child.type === 'paragraph') {
                            return child.children?.map((c, j) => renderInline(c, j));
                        }
                        return renderBlock(child, i);
                    })}
                </ListItem>
            );

        case 'thematicBreak':
            return <Box key={index} xcss={hrStyles} />;

        default:
            // Fallback: try to render as paragraph with text content
            if (node.children) {
                return (
                    <Text key={index}>
                        {node.children.map((child, i) => renderInline(child, i))}
                    </Text>
                );
            }
            if (node.value) {
                return <Text key={index}>{node.value}</Text>;
            }
            return null;
    }
}

/**
 * Renders a sanitized markdown AST to React elements.
 *
 * @param {object} ast - Sanitized mdast AST from parseAndSanitize()
 * @returns {React.ReactNode}
 *
 * @example
 * import { parseAndSanitize } from '../../shared/markdown/parseAndSanitize';
 *
 * const ast = parseAndSanitize('# Hello **world**');
 * const rendered = renderToReact(ast);
 */
export function renderToReact(ast) {
    if (!ast || ast.type !== 'root' || !ast.children) {
        return null;
    }

    return (
        <Stack space="space.100">
            {ast.children.map((node, index) => renderBlock(node, index))}
        </Stack>
    );
}

/**
 * React component wrapper for markdown rendering.
 *
 * @param {object} props
 * @param {object} props.ast - Sanitized mdast AST
 * @returns {React.ReactNode}
 */
export function MarkdownContent({ ast }) {
    return renderToReact(ast);
}
