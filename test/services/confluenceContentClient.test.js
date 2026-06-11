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

const {
  getPage,
  updatePage,
  searchPagesByCql,
  __resetContentApiVersion,
} = await import('../../src/services/confluenceContentClient.js');

const v2Page = {
  id: '123',
  title: 'My Page',
  status: 'current',
  version: { number: 7 },
  body: { storage: { value: '<p>v2 body</p>' } },
  spaceId: '999',
};

const v1Page = {
  id: '123',
  title: 'My Page',
  version: { number: 7 },
  body: { storage: { value: '<p>v1 body</p>' } },
  space: { key: 'DIG' },
};

const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const fail = (status) => ({ ok: false, status, text: async () => `error ${status}` });

describe('confluenceContentClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetContentApiVersion();
  });

  describe('getPage', () => {
    it('uses v2 first and normalizes the response', async () => {
      mockRequestConfluence.mockResolvedValueOnce(ok(v2Page));

      const page = await getPage('123');

      expect(mockRequestConfluence).toHaveBeenCalledTimes(1);
      expect(mockRequestConfluence.mock.calls[0][0]).toContain('/wiki/api/v2/pages/123');
      expect(page).toMatchObject({
        id: '123',
        title: 'My Page',
        status: 'current',
        versionNumber: 7,
        storageValue: '<p>v2 body</p>',
      });
    });

    it('falls back to v1 on 410 Gone and normalizes spaceKey', async () => {
      mockRequestConfluence
        .mockResolvedValueOnce(fail(410)) // v2 gone
        .mockResolvedValueOnce(ok(v1Page)); // v1 works

      const page = await getPage('123');

      expect(mockRequestConfluence).toHaveBeenCalledTimes(2);
      expect(mockRequestConfluence.mock.calls[1][0]).toContain('/wiki/rest/api/content/123');
      expect(page.storageValue).toBe('<p>v1 body</p>');
      expect(page.spaceKey).toBe('DIG');
    });

    it('falls back to v1 on 404', async () => {
      mockRequestConfluence
        .mockResolvedValueOnce(fail(404))
        .mockResolvedValueOnce(ok(v1Page));

      await expect(getPage('123')).resolves.toMatchObject({ versionNumber: 7 });
      expect(mockRequestConfluence).toHaveBeenCalledTimes(2);
    });

    it('does NOT fall back on 403 (auth) — throws and tries only one version', async () => {
      mockRequestConfluence.mockResolvedValueOnce(fail(403));

      await expect(getPage('123')).rejects.toThrow(/403/);
      expect(mockRequestConfluence).toHaveBeenCalledTimes(1);
    });

    it('does NOT fall back on 429 or 500', async () => {
      mockRequestConfluence.mockResolvedValueOnce(fail(429));
      await expect(getPage('123')).rejects.toThrow(/429/);

      __resetContentApiVersion();
      mockRequestConfluence.mockResolvedValueOnce(fail(500));
      await expect(getPage('123')).rejects.toThrow(/500/);
    });

    it('memoizes the detected version (v1) so the next call probes v1 first', async () => {
      // First call: v2 gone → fall back to v1
      mockRequestConfluence
        .mockResolvedValueOnce(fail(410))
        .mockResolvedValueOnce(ok(v1Page));
      await getPage('123');

      // Second call: should go straight to v1 (one request, v1 URL)
      mockRequestConfluence.mockResolvedValueOnce(ok(v1Page));
      await getPage('456');

      const lastCallUrl = mockRequestConfluence.mock.calls.at(-1)[0];
      expect(lastCallUrl).toContain('/wiki/rest/api/content/456');
      // 2 (first call) + 1 (second call) = 3 total
      expect(mockRequestConfluence).toHaveBeenCalledTimes(3);
    });
  });

  describe('updatePage', () => {
    it('sends version n+1 and status current on v2', async () => {
      mockRequestConfluence.mockResolvedValueOnce(ok({ id: '123' }));

      await updatePage('123', {
        title: 'My Page',
        status: 'current',
        storageValue: '<p>new</p>',
        versionNumber: 7,
      });

      const [url, opts] = mockRequestConfluence.mock.calls[0];
      expect(url).toContain('/wiki/api/v2/pages/123');
      expect(opts.method).toBe('PUT');
      const body = JSON.parse(opts.body);
      expect(body.version.number).toBe(8);
      expect(body.status).toBe('current');
      expect(body.body).toEqual({ representation: 'storage', value: '<p>new</p>' });
    });
  });

  describe('searchPagesByCql', () => {
    it('normalizes results and reports hasMore when a full page is returned', async () => {
      const results = Array.from({ length: 2 }, (_, i) => ({
        id: i,
        title: `P${i}`,
        space: { key: 'DIG' },
        body: { storage: { value: `body ${i}` } },
      }));
      mockRequestConfluence.mockResolvedValueOnce(ok({ results }));

      const out = await searchPagesByCql('type=page', { start: 0, limit: 2 });

      expect(out.pages).toHaveLength(2);
      expect(out.pages[0]).toEqual({ id: '0', title: 'P0', spaceKey: 'DIG', storageValue: 'body 0' });
      expect(out.nextStart).toBe(2);
      expect(out.hasMore).toBe(true); // results.length === limit
    });

    it('reports completion when fewer than limit are returned', async () => {
      mockRequestConfluence.mockResolvedValueOnce(ok({ results: [{ id: 1, title: 'x' }] }));
      const out = await searchPagesByCql('type=page', { start: 0, limit: 50 });
      expect(out.hasMore).toBe(false);
    });

    it('throws on a non-OK search response', async () => {
      mockRequestConfluence.mockResolvedValueOnce(fail(500));
      await expect(searchPagesByCql('type=page', {})).rejects.toThrow(/CQL search failed/);
    });
  });
});
