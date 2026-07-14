import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequestConfluence = vi.fn();        // asApp
const mockRequestConfluenceAsUser = vi.fn();  // asUser

vi.mock('@forge/api', () => ({
  default: {
    asApp: () => ({
      requestConfluence: mockRequestConfluence,
    }),
    asUser: () => ({
      requestConfluence: mockRequestConfluenceAsUser,
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
  unionSpacePageIds,
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

    it('retries the v2 write on a transient 404 and never falls back to v1', async () => {
      vi.useFakeTimers();
      try {
        mockRequestConfluence
          .mockResolvedValueOnce(fail(404)) // transient (freshly-migrated page settling)
          .mockResolvedValueOnce(fail(404))
          .mockResolvedValueOnce(ok({ id: '123' })); // recovers
        const p = updatePage('123', { title: 'T', storageValue: '<p>x</p>', versionNumber: 7 });
        await vi.runAllTimersAsync();
        await p;

        expect(mockRequestConfluence).toHaveBeenCalledTimes(3);
        for (const call of mockRequestConfluence.mock.calls) {
          expect(call[0]).toContain('/wiki/api/v2/pages/123');
          expect(call[0]).not.toContain('/wiki/rest/api/content'); // never the dead v1 write endpoint
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws after exhausting v2 retries on a persistent 404 — no v1 write fallback', async () => {
      vi.useFakeTimers();
      try {
        mockRequestConfluence.mockResolvedValue(fail(404)); // v2 never recovers
        const p = updatePage('123', { title: 'T', storageValue: '<p>x</p>', versionNumber: 7 });
        const assertion = expect(p).rejects.toThrow(/updatePage failed on v2: 404/);
        await vi.runAllTimersAsync();
        await assertion;

        // initial attempt + WRITE_404_RETRIES (3) = 4 attempts, all v2, user principal untouched
        expect(mockRequestConfluence).toHaveBeenCalledTimes(4);
        expect(mockRequestConfluenceAsUser).not.toHaveBeenCalled();
        for (const call of mockRequestConfluence.mock.calls) {
          expect(call[0]).toContain('/wiki/api/v2/pages/123');
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('always writes via v2 even when a prior read memoized v1', async () => {
      // A read on a site whose v2 GET is gone memoizes v1 for reads...
      mockRequestConfluence.mockResolvedValueOnce(fail(410)).mockResolvedValueOnce(ok(v1Page));
      await getPage('123');

      // ...but the write must still go straight to v2 (the v1 write endpoint is 410 Gone).
      mockRequestConfluence.mockResolvedValueOnce(ok({ id: '123' }));
      await updatePage('123', { title: 'T', storageValue: '<p>x</p>', versionNumber: 7 });

      const lastUrl = mockRequestConfluence.mock.calls.at(-1)[0];
      expect(lastUrl).toContain('/wiki/api/v2/pages/123');
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

  describe('asUser option', () => {
    it('getPage({asUser:true}) requests as the user, not the app', async () => {
      mockRequestConfluenceAsUser.mockResolvedValueOnce(ok(v2Page));

      const page = await getPage('123', { asUser: true });

      expect(mockRequestConfluenceAsUser).toHaveBeenCalledTimes(1);
      expect(mockRequestConfluence).not.toHaveBeenCalled();
      expect(page.storageValue).toBe('<p>v2 body</p>');
    });

    it('getPage() defaults to the app principal', async () => {
      mockRequestConfluence.mockResolvedValueOnce(ok(v2Page));
      await getPage('123');
      expect(mockRequestConfluence).toHaveBeenCalledTimes(1);
      expect(mockRequestConfluenceAsUser).not.toHaveBeenCalled();
    });
  });

  describe('unionSpacePageIds', () => {
    const spaceLookup = ok({ results: [{ id: 'SID' }] });
    const listOf = (pages) => ok({ results: pages, _links: {} });

    it('unions page IDs across the app and the user, de-duping', async () => {
      // asApp sees page 1; asUser sees pages 2 and 1 (overlap) — union should be {1,2}.
      mockRequestConfluence
        .mockResolvedValueOnce(spaceLookup)
        .mockResolvedValueOnce(listOf([{ id: '1', title: 'A' }]));
      mockRequestConfluenceAsUser
        .mockResolvedValueOnce(spaceLookup)
        .mockResolvedValueOnce(listOf([{ id: '2', title: 'B' }, { id: '1', title: 'A' }]));

      const map = await unionSpacePageIds('SP');

      expect([...map.keys()].sort()).toEqual(['1', '2']);
      expect(map.get('2')).toBe('B');
      expect(mockRequestConfluence).toHaveBeenCalled();
      expect(mockRequestConfluenceAsUser).toHaveBeenCalled();
    });

    it('degrades gracefully when one principal fails (asUser not consented) — keeps the other', async () => {
      mockRequestConfluence
        .mockResolvedValueOnce(spaceLookup)
        .mockResolvedValueOnce(listOf([{ id: '1', title: 'A' }]));
      mockRequestConfluenceAsUser.mockRejectedValueOnce(new Error('no user consent'));

      const map = await unionSpacePageIds('SP');

      expect([...map.keys()]).toEqual(['1']); // asApp result survived
    });
  });
});
