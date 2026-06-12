import { describe, it, expect } from 'vitest';
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
