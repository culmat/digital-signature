/**
 * Converts Server-format signature macros to Forge ADF format.
 *
 * Server macros use <ac:structured-macro ac:name="signature"> with <ac:parameter> elements.
 * Forge macros use <ac:adf-extension> with <ac:adf-node>/<ac:adf-parameter> elements.
 *
 * This is a pure conversion module — no Forge API calls, just string manipulation.
 * Ported from scripts/rewrite-cma-macros.py.
 */

import { randomUUID } from 'crypto';

// Server macro names to match
const SERVER_MACRO_NAMES = ['signature', 'digital-signature'];

// inheritSigners enum → boolean flags
const INHERIT_MAP = {
  'none': [false, false],
  'readers only': [true, false],
  'writers only': [false, true],
  'readers and writers': [true, true],
};

const VISIBILITY_UPPER = {
  'always': 'ALWAYS',
  'if signatory': 'IF_SIGNATORY',
  'if signed': 'IF_SIGNED',
};

// Regex to match a full <ac:structured-macro> block for our macro
const MACRO_RE = /<ac:structured-macro\s+ac:name="(?:signature|digital-signature)"[^>]*>(.*?)<\/ac:structured-macro>/gs;
const PARAM_RE = /<ac:parameter\s+ac:name="([^"]+)">(.*?)<\/ac:parameter>/gs;
const BODY_RE = /<ac:plain-text-body><!\[CDATA\[(.*?)\]\]><\/ac:plain-text-body>/s;

function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Named HTML entities common in Confluence
    .replace(/&[a-zA-Z]+;/g, (match) => {
      const el = typeof document !== 'undefined'
        ? document.createElement('span')
        : null;
      if (el) { el.innerHTML = match; return el.textContent; }
      return match;
    });
}

/**
 * Extract parameters and body from a Server macro's inner XML.
 */
function parseServerMacro(innerXml) {
  const params = {};
  let match;

  const paramRe = new RegExp(PARAM_RE.source, 'gs');
  while ((match = paramRe.exec(innerXml)) !== null) {
    params[match[1]] = unescapeHtml(match[2]);
  }

  const bodyMatch = BODY_RE.exec(innerXml);
  const body = bodyMatch ? bodyMatch[1] : '';

  return { params, body };
}

/**
 * Build a Forge ADF extension block from extracted Server parameters.
 */
function buildForgeAdf(params, body, appId, envId, macroKey) {
  const localId = randomUUID();
  const extensionKey = `${appId}/${envId}/static/${macroKey}`;
  const extensionId = `ari:cloud:ecosystem::extension/${extensionKey}`;

  const title = escapeXml(params.title || '');
  const content = escapeXml(body);

  // signers
  const signersRaw = params.signers || '';
  const signersVals = signersRaw
    ? signersRaw.split(',').filter(s => s.trim()).map(s =>
      `<ac:adf-parameter-value>${escapeXml(s.trim())}</ac:adf-parameter-value>`
    ).join('')
    : '<ac:adf-parameter-value />';

  // signer groups
  const groupsRaw = params.signerGroups || '';
  const groupsVals = groupsRaw
    ? groupsRaw.split(',').filter(g => g.trim()).map(g =>
      `<ac:adf-parameter-value>${escapeXml(g.trim())}</ac:adf-parameter-value>`
    ).join('')
    : '<ac:adf-parameter-value />';

  // inheritSigners → inherit-viewers + inherit-editors
  const inherit = (params.inheritSigners || 'none').toLowerCase();
  const [inheritViewers, inheritEditors] = INHERIT_MAP[inherit] || [false, false];

  // Optional numeric params
  let optional = '';
  for (const [serverKey, adfKey] of [['maxSignatures', 'max-signatures'], ['visibilityLimit', 'visibility-limit']]) {
    const val = params[serverKey];
    if (val != null && val !== '' && val !== '-1') {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n !== -1) {
        optional += `<ac:adf-parameter key="${adfKey}" type="number">${n}</ac:adf-parameter>`;
      }
    }
  }

  // Detect locked Server macros: no signers, no groups (or groups != "*"), no inheritance
  // On Server, these were NOT signable. On Cloud, empty config = petition mode.
  // Set max-signatures to 0 to preserve the locked behavior.
  const isLocked = !signersRaw
    && (!groupsRaw || groupsRaw.trim() !== '*')
    && !inheritViewers
    && !inheritEditors;
  if (isLocked && !optional.includes('max-signatures')) {
    optional += '<ac:adf-parameter key="max-signatures" type="number">0</ac:adf-parameter>';
  }

  // Optional enum params
  for (const [serverKey, adfKey] of [['signaturesVisible', 'signatures-visible'], ['pendingVisible', 'pending-visible']]) {
    const val = params[serverKey];
    if (val) {
      const upper = VISIBILITY_UPPER[val.toLowerCase()] || val;
      optional += `<ac:adf-parameter key="${adfKey}">${upper}</ac:adf-parameter>`;
    }
  }

  return (
    '<ac:adf-extension>' +
    '<ac:adf-node type="extension">' +
    `<ac:adf-attribute key="extension-key">${extensionKey}</ac:adf-attribute>` +
    '<ac:adf-attribute key="extension-type">com.atlassian.ecosystem</ac:adf-attribute>' +
    '<ac:adf-attribute key="parameters">' +
    `<ac:adf-parameter key="local-id">${localId}</ac:adf-parameter>` +
    `<ac:adf-parameter key="extension-id">${extensionId}</ac:adf-parameter>` +
    `<ac:adf-parameter key="extension-title">${macroKey}</ac:adf-parameter>` +
    '<ac:adf-parameter key="render">native</ac:adf-parameter>' +
    '<ac:adf-parameter key="guest-params">' +
    `<ac:adf-parameter key="title">${title}</ac:adf-parameter>` +
    `<ac:adf-parameter key="content">${content}</ac:adf-parameter>` +
    `<ac:adf-parameter key="signers">${signersVals}</ac:adf-parameter>` +
    `<ac:adf-parameter key="signer-groups">${groupsVals}</ac:adf-parameter>` +
    `<ac:adf-parameter key="inherit-viewers" type="boolean">${inheritViewers}</ac:adf-parameter>` +
    `<ac:adf-parameter key="inherit-editors" type="boolean">${inheritEditors}</ac:adf-parameter>` +
    optional +
    '</ac:adf-parameter>' +
    '</ac:adf-attribute>' +
    `<ac:adf-attribute key="text">${macroKey}</ac:adf-attribute>` +
    '<ac:adf-attribute key="layout">default</ac:adf-attribute>' +
    `<ac:adf-attribute key="local-id">${localId}</ac:adf-attribute>` +
    '</ac:adf-node>' +
    '</ac:adf-extension>'
  );
}

/**
 * Check if a page body contains any unconverted Server-format signature macros.
 */
export function hasLegacyMacros(storageBody) {
  if (!storageBody) return false;
  return new RegExp(MACRO_RE.source, 's').test(storageBody);
}

/**
 * Convert all Server-format signature macros in a page body to Forge ADF format.
 *
 * @param {string} storageBody - The page's storage-format HTML
 * @param {string} appId - Forge app ID (e.g. "bab5617e-dc42-4ca8-ad38-947c826fe58c")
 * @param {string} envId - Forge environment ID
 * @param {string} macroKey - Forge macro key (e.g. "digital-signature")
 * @returns {{converted: boolean, body: string, macroCount: number}}
 */
export function convertPageBody(storageBody, appId, envId, macroKey) {
  if (!storageBody) return { converted: false, body: storageBody, macroCount: 0 };

  let macroCount = 0;
  const re = new RegExp(MACRO_RE.source, 'gs');
  const newBody = storageBody.replace(re, (fullMatch, innerXml) => {
    const { params, body } = parseServerMacro(innerXml);
    macroCount++;
    return buildForgeAdf(params, body, appId, envId, macroKey);
  });

  return {
    converted: macroCount > 0,
    body: newBody,
    macroCount,
  };
}
