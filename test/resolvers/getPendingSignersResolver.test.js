import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequestAsUser = vi.fn();

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence: mockRequestAsUser }),
    asApp: () => ({ requestConfluence: mockRequestAsUser }),
  },
  route: (strings, ...values) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? values[i] : ''), ''),
}));

const { getPendingSignersResolver } = await import('../../src/resolvers/getPendingSignersResolver.js');

// Route the user-status lookup by accountId embedded in the URL.
function userStatusRouter(url) {
  const id = (url.match(/accountId=([^&]+)/) || [])[1] || '';
  if (id === 'gone') return { ok: false, status: 404 };                                  // deleted
  if (id === 'deact') return { ok: true, status: 200, json: async () => ({ accountType: '' }) };      // deactivated
  if (id === 'err') return { ok: false, status: 500 };                                   // transient → fail open
  return { ok: true, status: 200, json: async () => ({ accountType: 'atlassian' }) };    // active
}

const reqWith = (config, signedAccountIds = []) => ({
  context: { extension: { config } },
  payload: { pageId: '123', signedAccountIds },
});

describe('getPendingSignersResolver — deactivated filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestAsUser.mockImplementation((url) => Promise.resolve(userStatusRouter(url)));
  });

  it('drops deactivated (empty accountType) and deleted (404) accounts from pending', async () => {
    const res = await getPendingSignersResolver(reqWith({
      signers: ['active', 'deact', 'gone'], signerGroups: [], inheritViewers: false, inheritEditors: false,
    }));

    expect(res.success).toBe(true);
    expect(res.isPetitionMode).toBe(false);
    expect(res.pending).toEqual(['active']);
  });

  it('fails OPEN — a transient lookup error keeps the user in pending (never hide a real signer)', async () => {
    const res = await getPendingSignersResolver(reqWith({
      signers: ['active', 'err'], signerGroups: [], inheritViewers: false, inheritEditors: false,
    }));

    expect(res.pending.sort()).toEqual(['active', 'err']);
  });

  it('never checks status for already-signed users (they are subtracted first)', async () => {
    const res = await getPendingSignersResolver(reqWith({
      signers: ['active', 'deact'], signerGroups: [], inheritViewers: false, inheritEditors: false,
    }, ['active']));

    // 'active' already signed → not pending; only 'deact' remains and is filtered out → empty.
    expect(res.pending).toEqual([]);
    // status endpoint was hit only for the single unsigned candidate ('deact'), not for 'active'.
    expect(mockRequestAsUser).toHaveBeenCalledTimes(1);
    expect(mockRequestAsUser.mock.calls[0][0]).toContain('accountId=deact');
  });

  it('petition mode (no restrictions) short-circuits without status checks', async () => {
    const res = await getPendingSignersResolver(reqWith({
      signers: [], signerGroups: [], inheritViewers: false, inheritEditors: false,
    }));

    expect(res).toMatchObject({ success: true, isPetitionMode: true, pending: [] });
    expect(mockRequestAsUser).not.toHaveBeenCalled();
  });
});
