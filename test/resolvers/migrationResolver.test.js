import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetPage = vi.fn();
const mockUpdatePage = vi.fn();
const mockSearchPagesByCql = vi.fn();

vi.mock('../../src/services/confluenceContentClient.js', () => ({
  getPage: mockGetPage,
  updatePage: mockUpdatePage,
  searchPagesByCql: mockSearchPagesByCql,
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

    it('returns one batch with offset/completed and counts macros', async () => {
      mockSearchPagesByCql.mockResolvedValueOnce({
        pages: [
          { id: '1', title: 'A', spaceKey: 'DIG', storageValue: `<p>${MACRO()}${MACRO('def')}</p>` },
          { id: '2', title: 'B', spaceKey: 'DIG', storageValue: '<p>no macro</p>' },
        ],
        nextStart: 50,
        hasMore: true,
      });

      const res = await migrationResolver(adminReq({ action: 'migrationScan', spaceKey: 'DIG', offset: 0 }));

      expect(res.success).toBe(true);
      expect(res.completed).toBe(false);
      expect(res.offset).toBe(50);
      expect(res.pages).toEqual([{ id: '1', title: 'A', spaceKey: 'DIG', macroCount: 2 }]);
      expect(res.stats.totalMacros).toBe(2);
    });

    it('marks completed when the search has no more results', async () => {
      mockSearchPagesByCql.mockResolvedValueOnce({ pages: [], nextStart: 10, hasMore: false });
      const res = await migrationResolver(adminReq({ action: 'migrationScan', offset: 0 }));
      expect(res.completed).toBe(true);
      expect(res.pages).toEqual([]);
    });

    it('passes start=offset through to the search', async () => {
      mockSearchPagesByCql.mockResolvedValueOnce({ pages: [], nextStart: 100, hasMore: false });
      await migrationResolver(adminReq({ action: 'migrationScan', offset: 50 }));
      expect(mockSearchPagesByCql).toHaveBeenCalledWith(expect.any(String), { start: 50, limit: 50 });
    });

    it('returns a 500 error when the search throws', async () => {
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

    it('converts a page via the content client and bumps version', async () => {
      mockGetPage.mockResolvedValueOnce({
        id: '1', title: 'A', status: 'current', versionNumber: 3, storageValue: `<p>${MACRO()}</p>`,
      });
      mockUpdatePage.mockResolvedValueOnce({});

      const res = await migrationResolver(adminReq({ action: 'migrationConvert', pageIds: ['1'], envId: 'env-1' }));

      expect(res.success).toBe(true);
      expect(res.completed).toBe(true);
      expect(res.stats).toMatchObject({ processed: 1, converted: 1, skipped: 0, errors: 0 });
      expect(mockUpdatePage).toHaveBeenCalledWith('1', expect.objectContaining({
        title: 'A', status: 'current', versionNumber: 3,
      }));
    });

    it('skips a page with no legacy macros', async () => {
      mockGetPage.mockResolvedValueOnce({
        id: '1', title: 'A', status: 'current', versionNumber: 1, storageValue: '<p>nothing</p>',
      });

      const res = await migrationResolver(adminReq({ action: 'migrationConvert', pageIds: ['1'], envId: 'env-1' }));

      expect(res.stats).toMatchObject({ converted: 0, skipped: 1, errors: 0 });
      expect(mockUpdatePage).not.toHaveBeenCalled();
    });

    it('records an error for one page and continues with the rest', async () => {
      mockGetPage
        .mockRejectedValueOnce(new Error('410 gone'))            // page 1 fetch fails
        .mockResolvedValueOnce({ id: '2', title: 'B', status: 'current', versionNumber: 1, storageValue: `<p>${MACRO()}</p>` });
      mockUpdatePage.mockResolvedValueOnce({});

      const res = await migrationResolver(adminReq({ action: 'migrationConvert', pageIds: ['1', '2'], envId: 'env-1' }));

      expect(res.stats).toMatchObject({ processed: 2, converted: 1, errors: 1 });
      const statuses = res.results.map((r) => r.status).sort();
      expect(statuses).toEqual(['converted', 'error']);
    });
  });
});
