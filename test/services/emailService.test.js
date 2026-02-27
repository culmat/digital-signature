import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequestConfluence = vi.fn();

vi.mock('@forge/api', () => ({
  default: {
    asApp: () => ({
      requestConfluence: mockRequestConfluence,
    }),
  },
  route: (strings, ...values) => {
    let result = '';
    strings.forEach((str, i) => {
      result += str;
      if (i < values.length) result += values[i];
    });
    return result;
  },
}));

const { getEmailAddresses, buildMailtoUrl } = await import(
  '../../src/services/emailService.js'
);

describe('emailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEmailAddresses', () => {
    it('returns empty array for empty input', async () => {
      const result = await getEmailAddresses([]);
      expect(result).toEqual([]);
      expect(mockRequestConfluence).not.toHaveBeenCalled();
    });

    it('deduplicates account ids', async () => {
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { accountId: 'user-1', email: 'a@test.com', publicName: 'User A' },
          ],
        }),
      });

      const result = await getEmailAddresses(['user-1', 'user-1', 'user-1']);
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe('a@test.com');
    });

    it('returns null email for users not found in API response', async () => {
      mockRequestConfluence.mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const result = await getEmailAddresses(['unknown-user']);
      expect(result).toHaveLength(1);
      expect(result[0].email).toBeNull();
      expect(result[0].displayName).toBeNull();
    });

    it('handles API failure gracefully', async () => {
      mockRequestConfluence.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await getEmailAddresses(['user-1']);
      expect(result).toHaveLength(1);
      expect(result[0].email).toBeNull();
    });
  });

  describe('buildMailtoUrl', () => {
    it('returns null for empty emails', () => {
      expect(buildMailtoUrl([], 'Subject')).toBeNull();
    });

    it('builds mailto url for single email', () => {
      const url = buildMailtoUrl(['a@test.com'], 'My Subject');
      expect(url).toBe('mailto:a@test.com?subject=My%20Subject');
    });

    it('returns null for multiple emails (Forge limitation)', () => {
      const url = buildMailtoUrl(['a@test.com', 'b@test.com'], 'My Subject');
      expect(url).toBeNull();
    });

    it('filters out falsy emails before checking count', () => {
      const url = buildMailtoUrl(['a@test.com', null, ''], 'Hi');
      expect(url).toBe('mailto:a@test.com?subject=Hi');
    });

    it('returns null when url exceeds 2000 characters', () => {
      const longEmail = 'a'.repeat(2000) + '@example.com';
      const url = buildMailtoUrl([longEmail], 'Subject');
      expect(url).toBeNull();
    });
  });
});
