import { describe, it, expect } from 'vitest';
import { isSectionVisible, ALWAYS, IF_SIGNATORY, IF_SIGNED } from '../../src/shared/visibilityCheck.js';

describe('isSectionVisible', () => {
  describe('ALWAYS', () => {
    it('returns true regardless of user state', () => {
      expect(isSectionVisible(ALWAYS, { isSignatory: false, hasSigned: false })).toBe(true);
      expect(isSectionVisible(ALWAYS, { isSignatory: true, hasSigned: false })).toBe(true);
      expect(isSectionVisible(ALWAYS, { isSignatory: false, hasSigned: true })).toBe(true);
      expect(isSectionVisible(ALWAYS, { isSignatory: true, hasSigned: true })).toBe(true);
    });
  });

  describe('IF_SIGNATORY', () => {
    it('returns true when user is a signatory', () => {
      expect(isSectionVisible(IF_SIGNATORY, { isSignatory: true, hasSigned: false })).toBe(true);
    });

    it('returns true when user is a signatory who has signed', () => {
      expect(isSectionVisible(IF_SIGNATORY, { isSignatory: true, hasSigned: true })).toBe(true);
    });

    it('returns false when user is not a signatory', () => {
      expect(isSectionVisible(IF_SIGNATORY, { isSignatory: false, hasSigned: false })).toBe(false);
    });

    it('returns false when user has signed but is not flagged as signatory', () => {
      expect(isSectionVisible(IF_SIGNATORY, { isSignatory: false, hasSigned: true })).toBe(false);
    });
  });

  describe('IF_SIGNED', () => {
    it('returns true when user has signed', () => {
      expect(isSectionVisible(IF_SIGNED, { isSignatory: false, hasSigned: true })).toBe(true);
      expect(isSectionVisible(IF_SIGNED, { isSignatory: true, hasSigned: true })).toBe(true);
    });

    it('returns false when user has not signed', () => {
      expect(isSectionVisible(IF_SIGNED, { isSignatory: false, hasSigned: false })).toBe(false);
      expect(isSectionVisible(IF_SIGNED, { isSignatory: true, hasSigned: false })).toBe(false);
    });
  });

  describe('defaults to ALWAYS', () => {
    it('returns true when setting is undefined', () => {
      expect(isSectionVisible(undefined, { isSignatory: false, hasSigned: false })).toBe(true);
    });

    it('returns true when setting is null', () => {
      expect(isSectionVisible(null, { isSignatory: false, hasSigned: false })).toBe(true);
    });

    it('returns true when setting is an unrecognized string', () => {
      expect(isSectionVisible('UNKNOWN', { isSignatory: false, hasSigned: false })).toBe(true);
    });
  });
});
