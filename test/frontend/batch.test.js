import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();

vi.mock('@forge/bridge', () => ({
  invoke: mockInvoke,
}));

const { runBatched } = await import('../../src/frontend/utils/batch.js');

describe('runBatched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loops until completed, advancing offset and accumulating batches', async () => {
    mockInvoke
      .mockResolvedValueOnce({ success: true, completed: false, offset: 50, n: 1 })
      .mockResolvedValueOnce({ success: true, completed: false, offset: 100, n: 2 })
      .mockResolvedValueOnce({ success: true, completed: true, offset: 130, n: 3 });

    const seen = [];
    await runBatched('migrationData', { action: 'migrationScan' }, (res) => seen.push(res.n));

    expect(seen).toEqual([1, 2, 3]);
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke.mock.calls[0][1]).toEqual({ action: 'migrationScan', offset: 0 });
    expect(mockInvoke.mock.calls[1][1]).toEqual({ action: 'migrationScan', offset: 50 });
    expect(mockInvoke.mock.calls[2][1]).toEqual({ action: 'migrationScan', offset: 100 });
  });

  it('throws the resolver error value on an unsuccessful batch', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: { key: 'error.invalid_space_key' } });

    await expect(
      runBatched('migrationData', { action: 'migrationScan' }, () => {})
    ).rejects.toEqual({ key: 'error.invalid_space_key' });
  });

  it('honors a custom start offset', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, completed: true, offset: 10 });
    await runBatched('adminData', { action: 'export' }, () => {}, 5);
    expect(mockInvoke.mock.calls[0][1]).toEqual({ action: 'export', offset: 5 });
  });
});
