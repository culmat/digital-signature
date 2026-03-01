import { describe, it, expect } from 'vitest';
import { normalizeLegacyConfig } from '../../src/shared/normalizeLegacyConfig.js';

describe('normalizeLegacyConfig', () => {
  it('returns null/undefined unchanged', () => {
    expect(normalizeLegacyConfig(null)).toBeNull();
    expect(normalizeLegacyConfig(undefined)).toBeUndefined();
  });

  it('passes through a Forge-format config unchanged', () => {
    const config = {
      title: 'My doc',
      content: 'Sign here',
      inheritViewers: false,
      inheritEditors: true,
      signaturesVisible: 'ALWAYS',
      pendingVisible: 'IF_SIGNATORY',
    };
    expect(normalizeLegacyConfig(config)).toEqual(config);
  });

  describe('inheritSigners → inheritViewers + inheritEditors', () => {
    it('"none" → both false', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none' });
      expect(out.inheritViewers).toBe(false);
      expect(out.inheritEditors).toBe(false);
      expect(out).not.toHaveProperty('inheritSigners');
    });

    it('"readers only" → inheritViewers true, inheritEditors false', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'readers only' });
      expect(out.inheritViewers).toBe(true);
      expect(out.inheritEditors).toBe(false);
    });

    it('"writers only" → inheritViewers false, inheritEditors true', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'writers only' });
      expect(out.inheritViewers).toBe(false);
      expect(out.inheritEditors).toBe(true);
    });

    it('"readers and writers" → both true', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'readers and writers' });
      expect(out.inheritViewers).toBe(true);
      expect(out.inheritEditors).toBe(true);
    });

    it('unknown value → both false (safe default)', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'something unexpected' });
      expect(out.inheritViewers).toBe(false);
      expect(out.inheritEditors).toBe(false);
    });
  });

  describe('body → content', () => {
    it('renames body to content when content is absent', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', body: 'hello' });
      expect(out.content).toBe('hello');
      expect(out).not.toHaveProperty('body');
    });

    it('does not overwrite an existing content field', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', body: 'b', content: 'c' });
      expect(out.content).toBe('c');
      expect(out).not.toHaveProperty('body');
    });
  });

  describe('maxSignatures and visibilityLimit', () => {
    it('converts string "-1" to undefined', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', maxSignatures: '-1', visibilityLimit: '-1' });
      expect(out.maxSignatures).toBeUndefined();
      expect(out.visibilityLimit).toBeUndefined();
    });

    it('converts numeric -1 to undefined', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', maxSignatures: -1, visibilityLimit: -1 });
      expect(out.maxSignatures).toBeUndefined();
      expect(out.visibilityLimit).toBeUndefined();
    });

    it('converts positive string values to numbers', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', maxSignatures: '5', visibilityLimit: '10' });
      expect(out.maxSignatures).toBe(5);
      expect(out.visibilityLimit).toBe(10);
    });

    it('leaves undefined/null/empty values alone', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none' });
      expect(out.maxSignatures).toBeUndefined();
      expect(out.visibilityLimit).toBeUndefined();
    });
  });

  describe('visibility enum uppercasing', () => {
    it('"always" → "ALWAYS"', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', signaturesVisible: 'always', pendingVisible: 'always' });
      expect(out.signaturesVisible).toBe('ALWAYS');
      expect(out.pendingVisible).toBe('ALWAYS');
    });

    it('"if signatory" → "IF_SIGNATORY"', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', signaturesVisible: 'if signatory' });
      expect(out.signaturesVisible).toBe('IF_SIGNATORY');
    });

    it('"if signed" → "IF_SIGNED"', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', pendingVisible: 'if signed' });
      expect(out.pendingVisible).toBe('IF_SIGNED');
    });

    it('already-uppercase values are kept as-is', () => {
      const out = normalizeLegacyConfig({ inheritSigners: 'none', signaturesVisible: 'ALWAYS' });
      expect(out.signaturesVisible).toBe('ALWAYS');
    });
  });

  describe('dropped server-only fields', () => {
    it('removes notified, panel, and protectedContent', () => {
      const out = normalizeLegacyConfig({
        inheritSigners: 'none',
        notified: ['user1'],
        panel: true,
        protectedContent: false,
      });
      expect(out).not.toHaveProperty('notified');
      expect(out).not.toHaveProperty('panel');
      expect(out).not.toHaveProperty('protectedContent');
    });
  });

  it('preserves unrelated Forge fields unchanged', () => {
    const out = normalizeLegacyConfig({
      inheritSigners: 'none',
      title: 'Contract',
      signers: ['accountId1'],
      signerGroups: ['groupId1'],
    });
    expect(out.title).toBe('Contract');
    expect(out.signers).toEqual(['accountId1']);
    expect(out.signerGroups).toEqual(['groupId1']);
  });
});
