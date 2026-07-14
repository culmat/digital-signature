import { describe, it, expect } from 'vitest';
import { convertStorageResolver } from '../../src/resolvers/convertStorageResolver.js';
import { FORGE_APP_ID } from '../../src/shared/appIdentifiers.js';

// The resolver is a pure transform (no @forge/api, no Confluence) — exercise it against the REAL
// macroConversionService rather than a mock, which also proves the purity/no-consent property.

const ENV = 'env-abc-123';

// A post-CMA legacy macro (Server format) still carrying its contract text in <ac:plain-text-body>.
const LEGACY = [
  '<p>Intro</p>',
  '<ac:structured-macro ac:name="digital-signature" ac:macro-id="m1">',
  '<ac:parameter ac:name="title">My Contract</ac:parameter>',
  '<ac:plain-text-body><![CDATA[# My Contract\n\nThe body text.]]></ac:plain-text-body>',
  '</ac:structured-macro>',
].join('');

const req = (payload) => ({ payload });

describe('convertStorageResolver', () => {
  it('converts a legacy macro and moves the body into the Forge content guest-param', () => {
    const res = convertStorageResolver(req({ storage: LEGACY, envId: ENV }));

    expect(res.success).toBe(true);
    expect(res.converted).toBe(true);
    expect(res.macroCount).toBe(1);
    // Emits a Forge ADF extension keyed to THIS app + the caller-supplied env.
    expect(res.body).toContain('<ac:adf-extension>');
    expect(res.body).toContain(`${FORGE_APP_ID}/${ENV}/static/digital-signature`);
    // The contract text is carried into the content guest-param (no longer lost).
    expect(res.body).toContain('The body text.');
    expect(res.body).not.toContain('<ac:structured-macro');
  });

  it('is idempotent: re-running on already-converted storage is a no-op', () => {
    const first = convertStorageResolver(req({ storage: LEGACY, envId: ENV }));
    const second = convertStorageResolver(req({ storage: first.body, envId: ENV }));

    expect(second.success).toBe(true);
    expect(second.converted).toBe(false);
    expect(second.macroCount).toBe(0);
    expect(second.body).toBe(first.body);
  });

  it('reports converted:false for storage with no legacy macros', () => {
    const res = convertStorageResolver(req({ storage: '<p>just a page</p>', envId: ENV }));
    expect(res.success).toBe(true);
    expect(res.converted).toBe(false);
    expect(res.macroCount).toBe(0);
  });

  it('400s when storage is missing', () => {
    expect(convertStorageResolver(req({ envId: ENV }))).toMatchObject({ success: false, status: 400 });
  });

  it('400s when envId is missing', () => {
    expect(convertStorageResolver(req({ storage: LEGACY }))).toMatchObject({ success: false, status: 400 });
  });

  it('tolerates a missing payload object', () => {
    expect(convertStorageResolver({})).toMatchObject({ success: false, status: 400 });
  });
});
