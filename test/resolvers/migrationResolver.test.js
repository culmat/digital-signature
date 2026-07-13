import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPage = vi.fn();
const mockUpdatePage = vi.fn();
const mockSearchPagesByCql = vi.fn();
const mockUnionSpacePageIds = vi.fn();
const mockSqlExecute = vi.fn();

vi.mock('../../src/services/confluenceContentClient.js', () => ({
  getPage: mockGetPage,
  updatePage: mockUpdatePage,
  searchPagesByCql: mockSearchPagesByCql,
  unionSpacePageIds: mockUnionSpacePageIds,
}));

vi.mock('@forge/sql', () => ({
  default: { prepare: () => ({ execute: mockSqlExecute }) },
}));

const { migrationResolver } = await import('../../src/resolvers/migrationResolver.js');

// One legacy macro in storage format
const MACRO = (hash = 'abc') =>
  `<ac:structured-macro ac:name="signature" ac:macro-id="m"><ac:parameter ac:name="hash">${hash}</ac:parameter></ac:structured-macro>`;

const adminReq = (payload) => ({ context: { accountId: 'admin-1' }, payload });

describe('migrationResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('migrationScan', () => {
    it('rejects an invalid space key', async () => {
      const res = await migrationResolver(adminReq({ action: 'migrationScan', spaceKey: 'bad key!' }));
      expect(res).toMatchObject({ success: false, status: 400, error: { key: 'error.invalid_space_key' } });
      expect(mockSearchPagesByCql).not.toHaveBeenCalled();
    });

    it('space scan: intersects the union of (app ∪ user) page IDs with contract pageIds', async () => {
      // contract table: pages 1 (2 contracts) and 3 (1) carry migrated signatures
      mockSqlExecute.mockResolvedValueOnce({ rows: [{ pageId: 1, cnt: 2 }, { pageId: 3, cnt: 1 }] });
      // union across principals lists pages 1 and 2 — page 2 has no contract → excluded
      mockUnionSpacePageIds.mockResolvedValueOnce(new Map([['1', 'A'], ['2', 'B']]));

      const res = await migrationResolver(adminReq({ action: 'migrationScan', spaceKey: 'CMAMIG4' }));

      expect(res.success).toBe(true);
      expect(res.completed).toBe(true);
      expect(res.offset).toBe(0);
      expect(res.pages).toEqual([{ id: '1', title: 'A', spaceKey: 'CMAMIG4', macroCount: 2 }]);
      expect(res.stats.totalMacros).toBe(2);
      expect(mockUnionSpacePageIds).toHaveBeenCalledWith('CMAMIG4');
      expect(mockSearchPagesByCql).not.toHaveBeenCalled();
    });

    it('Space Settings: locks the scan to the space from context, ignoring the payload spaceKey', async () => {
      mockSqlExecute.mockResolvedValueOnce({ rows: [] });
      mockUnionSpacePageIds.mockResolvedValueOnce(new Map());
      const req = {
        context: { accountId: 'admin-1', extension: { space: { key: 'CCRuS' } } },
        payload: { action: 'migrationScan', spaceKey: 'SOMEWHEREELSE' },
      };

      await migrationResolver(req);

      expect(mockUnionSpacePageIds).toHaveBeenCalledWith('CCRuS');
    });

    it('whole-instance scan (no spaceKey): uses CQL macro search and counts macros', async () => {
      mockSearchPagesByCql.mockResolvedValueOnce({
        pages: [
          { id: '1', title: 'A', spaceKey: 'DIG', storageValue: `<p>${MACRO()}${MACRO('def')}</p>` },
          { id: '2', title: 'B', spaceKey: 'DIG', storageValue: '<p>no macro</p>' },
        ],
        nextStart: 50,
        hasMore: true,
      });

      const res = await migrationResolver(adminReq({ action: 'migrationScan', offset: 0 }));

      expect(res.offset).toBe(50);
      expect(res.pages).toEqual([{ id: '1', title: 'A', spaceKey: 'DIG', macroCount: 2 }]);
      expect(res.stats.totalMacros).toBe(2);
      expect(mockUnionSpacePageIds).not.toHaveBeenCalled();
    });

    it('whole-instance scan: passes start=offset through to CQL search', async () => {
      mockSearchPagesByCql.mockResolvedValueOnce({ pages: [], nextStart: 100, hasMore: false });
      await migrationResolver(adminReq({ action: 'migrationScan', offset: 50 }));
      expect(mockSearchPagesByCql).toHaveBeenCalledWith(expect.any(String), { start: 50, limit: 50 });
    });

    it('returns a 500 error when the whole-instance search throws', async () => {
      mockSearchPagesByCql.mockRejectedValueOnce(new Error('boom'));
      const res = await migrationResolver(adminReq({ action: 'migrationScan' }));
      expect(res).toMatchObject({ success: false, status: 500 });
    });
  });

  describe('migrationConvert', () => {
    it('requires envId', async () => {
      const res = await migrationResolver(adminReq({ action: 'migrationConvert', pageIds: ['1'] }));
      expect(res).toMatchObject({ success: false, status: 400 });
    });

    it('converts a page (as the app) via the content client and bumps version', async () => {
      mockGetPage.mockResolvedValueOnce({
        id: '1', title: 'A', status: 'current', versionNumber: 3, storageValue: `<p>${MACRO()}</p>`,
      });
      mockUpdatePage.mockResolvedValueOnce({});

      const res = await migrationResolver(adminReq({ action: 'migrationConvert', pageIds: ['1'], envId: 'env-1' }));

      expect(res.success).toBe(true);
      expect(res.completed).toBe(true);
      expect(res.stats).toMatchObject({ processed: 1, converted: 1, skipped: 0, errors: 0 });
      expect(mockGetPage).toHaveBeenCalledWith('1', { asUser: false });
      expect(mockUpdatePage).toHaveBeenCalledWith('1', expect.objectContaining({
        title: 'A', status: 'current', versionNumber: 3,
      }), { asUser: false });
    });

    it('falls back to asUser when the app cannot read a (restricted) page, and writes as that principal', async () => {
      mockGetPage
        .mockRejectedValueOnce(new Error('404 not visible to app'))  // asApp read fails
        .mockResolvedValueOnce({ id: '9', title: 'R', status: 'current', versionNumber: 2, storageValue: `<p>${MACRO()}</p>` }); // asUser read succeeds
      mockUpdatePage.mockResolvedValueOnce({});

      const res = await migrationResolver(adminReq({ action: 'migrationConvert', pageIds: ['9'], envId: 'env-1' }));

      expect(res.stats).toMatchObject({ converted: 1, errors: 0 });
      expect(mockGetPage).toHaveBeenNthCalledWith(1, '9', { asUser: false });
      expect(mockGetPage).toHaveBeenNthCalledWith(2, '9', { asUser: true });
      expect(mockUpdatePage).toHaveBeenCalledWith('9', expect.any(Object), { asUser: true });
    });

    it('skips a page with no legacy macros', async () => {
      mockGetPage.mockResolvedValueOnce({
        id: '1', title: 'A', status: 'current', versionNumber: 1, storageValue: '<p>nothing</p>',
      });

      const res = await migrationResolver(adminReq({ action: 'migrationConvert', pageIds: ['1'], envId: 'env-1' }));

      expect(res.stats).toMatchObject({ converted: 0, skipped: 1, errors: 0 });
      expect(mockUpdatePage).not.toHaveBeenCalled();
    });

    it('records an error only when BOTH principals fail to read a page, and continues with the rest', async () => {
      mockGetPage
        .mockRejectedValueOnce(new Error('app 410'))   // page 1 asApp
        .mockRejectedValueOnce(new Error('user 403'))  // page 1 asUser → both fail → error
        .mockResolvedValueOnce({ id: '2', title: 'B', status: 'current', versionNumber: 1, storageValue: `<p>${MACRO()}</p>` });
      mockUpdatePage.mockResolvedValueOnce({});

      const res = await migrationResolver(adminReq({ action: 'migrationConvert', pageIds: ['1', '2'], envId: 'env-1' }));

      expect(res.stats).toMatchObject({ processed: 2, converted: 1, errors: 1 });
      const statuses = res.results.map((r) => r.status).sort();
      expect(statuses).toEqual(['converted', 'error']);
    });
  });
});
