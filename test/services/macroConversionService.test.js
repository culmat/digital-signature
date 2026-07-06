import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { convertPageBody } from '../../src/services/macroConversionService.js';

const APP_ID = 'bab5617e-dc42-4ca8-ad38-947c826fe58c';
const ENV_ID = '3db24628-d68b-465a-8bfd-ffb0aae164b4';
const MACRO_KEY = 'digital-signature';

/**
 * Build a Server-format signature macro from a map of parameters.
 */
function serverMacro(params) {
  const paramXml = Object.entries(params)
    .map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`)
    .join('');
  return `<ac:structured-macro ac:name="signature">${paramXml}</ac:structured-macro>`;
}

function convert(params) {
  const { body } = convertPageBody(serverMacro(params), APP_ID, ENV_ID, MACRO_KEY);
  return body;
}

/** Extract the inner XML of the signer-groups adf-parameter. */
function signerGroups(body) {
  const m = /<ac:adf-parameter key="signer-groups">(.*?)<\/ac:adf-parameter>/s.exec(body);
  return m ? m[1] : null;
}

function hasMaxSignatures(body) {
  return /key="max-signatures"/.test(body);
}

/** Extract the inner value of a named adf-parameter guest-param. */
function guestParam(body, key) {
  const m = new RegExp(`<ac:adf-parameter key="${key}">(.*?)</ac:adf-parameter>`, 's').exec(body);
  return m ? m[1] : null;
}

describe('macroConversionService — signerGroups "*" wildcard', () => {
  it('strips a lone "*" to empty signer-groups and keeps the macro signable (petition mode)', () => {
    const body = convert({ signerGroups: '*' });
    expect(signerGroups(body)).toBe('<ac:adf-parameter-value />');
    // "*" means petition mode, not locked → no max-signatures override
    expect(hasMaxSignatures(body)).toBe(false);
  });

  it('treats truly-empty groups (no signers/inherit) as a locked Server macro (max-signatures 0)', () => {
    const body = convert({ signerGroups: '' });
    expect(signerGroups(body)).toBe('<ac:adf-parameter-value />');
    expect(body).toContain('<ac:adf-parameter key="max-signatures" type="number">0</ac:adf-parameter>');
  });

  it('drops "*" but keeps real groups when mixed', () => {
    // include a named signer so the unrelated locked-macro detection stays out of the way
    const body = convert({ signers: 'user-1', signerGroups: 'abc-123,*,def-456' });
    expect(signerGroups(body)).toBe(
      '<ac:adf-parameter-value>abc-123</ac:adf-parameter-value>' +
      '<ac:adf-parameter-value>def-456</ac:adf-parameter-value>'
    );
    expect(hasMaxSignatures(body)).toBe(false);
  });

  it('passes real groups through unchanged when no wildcard is present', () => {
    const body = convert({ signers: 'user-1', signerGroups: 'abc-123' });
    expect(signerGroups(body)).toBe('<ac:adf-parameter-value>abc-123</ac:adf-parameter-value>');
    expect(hasMaxSignatures(body)).toBe(false);
  });
});

describe('macroConversionService — CMA-renamed Forge-key macro', () => {
  // After CMA migration the macro is renamed to the full Forge extension key but keeps the
  // params + <ac:plain-text-body>; the Forge macro reads its text from the `content` guest-param,
  // so an unconverted CMA macro renders "Only 0 Characters found". The convert must recognize this
  // form and move the body into `content`. (ac:name + body taken from the real CMAMIG4 page.)
  const FORGE_NAME = `${APP_ID}/${ENV_ID}/static/digital-signature`;

  function cmaMacro({ title, body, params = {} }) {
    const paramXml = Object.entries({ title, ...params })
      .map(([k, v]) => `<ac:parameter ac:name="${k}">${v}</ac:parameter>`)
      .join('');
    const bodyXml = `<ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body>`;
    return `<ac:structured-macro ac:name="${FORGE_NAME}" ac:schema-version="1" ac:macro-id="abc">${paramXml}${bodyXml}</ac:structured-macro>`;
  }

  it('recognizes the CMA-renamed macro and moves the body into the content guest-param', () => {
    const storage = cmaMacro({ title: 'Full Config', body: 'Complete test', params: { signerGroups: '*' } });
    const { converted, macroCount, body } = convertPageBody(storage, APP_ID, ENV_ID, MACRO_KEY);
    expect(converted).toBe(true);
    expect(macroCount).toBe(1);
    expect(body).toContain('<ac:adf-extension>');
    expect(body).toContain('<ac:adf-parameter key="content">Complete test</ac:adf-parameter>');
    expect(body).toContain('<ac:adf-parameter key="title">Full Config</ac:adf-parameter>');
    // the legacy plain-text-body is gone (rewritten into the ADF extension)
    expect(body).not.toContain('<ac:plain-text-body>');
  });

  it('still converts the legacy ac:name="signature" form', () => {
    const legacy = '<ac:structured-macro ac:name="signature"><ac:parameter ac:name="title">T</ac:parameter><ac:plain-text-body><![CDATA[Hello there]]></ac:plain-text-body></ac:structured-macro>';
    const { converted, body } = convertPageBody(legacy, APP_ID, ENV_ID, MACRO_KEY);
    expect(converted).toBe(true);
    expect(body).toContain('<ac:adf-parameter key="content">Hello there</ac:adf-parameter>');
  });

  it('does not touch an already-converted ac:adf-extension (no double conversion)', () => {
    const already = convertPageBody(cmaMacro({ title: 'X', body: 'Some agreement body', params: {} }), APP_ID, ENV_ID, MACRO_KEY).body;
    const second = convertPageBody(already, APP_ID, ENV_ID, MACRO_KEY);
    expect(second.converted).toBe(false);
    expect(second.macroCount).toBe(0);
  });
});

describe('macroConversionService — unicode titles (HTML entity decoding)', () => {
  // CMA HTML-entity-encodes non-ASCII text inside <ac:parameter> values (the title) during
  // migration but keeps <ac:plain-text-body><![CDATA[…]]> bodies literal. The signature key is
  // SHA-256(pageId:title:content); a title left entity-encoded yields a hash that no longer matches
  // the migrated `contract` row, so the signature can't be found and appears lost. The title must be
  // decoded back to raw Unicode. (Real CMAMIG3/4 "Unicode Contract" — page 168460297.)
  const PAGE_ID = '168460297';
  const RAW_TITLE = 'Ünïcödé Tëst';
  const ENC_TITLE = '&Uuml;n&iuml;c&ouml;d&eacute; T&euml;st';   // as CMA stores the param
  const BODY = 'Ägréément: äöü ñ 你好';                          // CDATA — stays raw

  function macro({ title, body }) {
    const bodyXml = `<ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body>`;
    return `<ac:structured-macro ac:name="signature"><ac:parameter ac:name="title">${title}</ac:parameter>${bodyXml}</ac:structured-macro>`;
  }

  it('decodes an entity-encoded title back to raw Unicode in the title guest-param', () => {
    const { body } = convertPageBody(macro({ title: ENC_TITLE, body: BODY }), APP_ID, ENV_ID, MACRO_KEY);
    expect(guestParam(body, 'title')).toBe(RAW_TITLE);
    expect(guestParam(body, 'content')).toBe(BODY);
  });

  it('yields a signature hash equal to the migration-side hash (raw strings)', () => {
    const { body } = convertPageBody(macro({ title: ENC_TITLE, body: BODY }), APP_ID, ENV_ID, MACRO_KEY);
    const renderHash = createHash('sha256')
      .update(`${PAGE_ID}:${guestParam(body, 'title')}:${guestParam(body, 'content')}`).digest('hex');
    const migrationHash = createHash('sha256')
      .update(`${PAGE_ID}:${RAW_TITLE}:${BODY}`).digest('hex');
    expect(renderHash).toBe(migrationHash);
    // Regression guard against the pre-fix (entity-title) hash.
    expect(renderHash).toBe('74679a1681dc7f2ce7843100d39db38511d71e52f7019e489bdd3d0980c15ba7');
  });

  it('decodes numeric entities — decimal and hex', () => {
    const { body } = convertPageBody(macro({ title: '&#252;ber &#x4f60;&#x597d;', body: 'x' }), APP_ID, ENV_ID, MACRO_KEY);
    expect(guestParam(body, 'title')).toBe('über 你好');
  });

  it('round-trips a literal ampersand (stored escaped, renders as "&")', () => {
    const { body } = convertPageBody(macro({ title: 'A &amp; B', body: 'x' }), APP_ID, ENV_ID, MACRO_KEY);
    expect(guestParam(body, 'title')).toBe('A &amp; B');
  });
});
