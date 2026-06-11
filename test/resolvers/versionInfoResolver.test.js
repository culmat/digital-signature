import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetAppContext = vi.fn();

vi.mock('@forge/api', () => ({
  getAppContext: () => mockGetAppContext(),
}));

const { getVersionInfoResolver } = await import(
  '../../src/resolvers/versionInfoResolver.js'
);

const ctx = (over = {}) => ({
  appVersion: '4.1.0',
  environmentType: 'STAGING',
  license: { active: true },
  ...over,
});

describe('getVersionInfoResolver', () => {
  const originalLatest = process.env.LATEST_VERSION;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LATEST_VERSION;
    mockGetAppContext.mockReturnValue(ctx());
  });

  afterEach(() => {
    if (originalLatest === undefined) delete process.env.LATEST_VERSION;
    else process.env.LATEST_VERSION = originalLatest;
  });

  it('passes through version, environment, and license', () => {
    const res = getVersionInfoResolver();
    expect(res).toMatchObject({
      success: true,
      myVersion: '4.1.0',
      environmentType: 'STAGING',
      license: { active: true },
    });
  });

  it("reports 'current' when the latest is the same major", () => {
    process.env.LATEST_VERSION = '4.9.0';
    const res = getVersionInfoResolver();
    expect(res.latestVersion).toBe('4.9.0');
    expect(res.status).toBe('current');
  });

  it("reports 'older-major' when a newer major exists", () => {
    process.env.LATEST_VERSION = '5.0.0';
    const res = getVersionInfoResolver();
    expect(res.status).toBe('older-major');
  });

  it('falls back to myVersion when LATEST_VERSION is missing (no false upgrade)', () => {
    const res = getVersionInfoResolver();
    expect(res.latestVersion).toBe('4.1.0');
    expect(res.status).toBe('current');
  });

  it('ignores a malformed LATEST_VERSION', () => {
    process.env.LATEST_VERSION = 'not-a-version';
    const res = getVersionInfoResolver();
    expect(res.latestVersion).toBe('4.1.0');
    expect(res.status).toBe('current');
  });

  it("reports 'unknown' when the app version is unavailable", () => {
    mockGetAppContext.mockReturnValue(ctx({ appVersion: undefined }));
    const res = getVersionInfoResolver();
    expect(res.myVersion).toBeNull();
    expect(res.status).toBe('unknown');
  });

  it('degrades to nulls when getAppContext throws', () => {
    mockGetAppContext.mockImplementation(() => {
      throw new Error('no context');
    });
    const res = getVersionInfoResolver();
    expect(res).toMatchObject({
      success: true,
      myVersion: null,
      latestVersion: null,
      status: 'unknown',
      environmentType: null,
      license: null,
    });
  });
});
