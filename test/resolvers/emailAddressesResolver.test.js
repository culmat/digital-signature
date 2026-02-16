import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetEmailAddresses = vi.fn();
const mockBuildMailtoUrl = vi.fn();

vi.mock('../../src/services/emailService.js', () => ({
  getEmailAddresses: mockGetEmailAddresses,
  buildMailtoUrl: mockBuildMailtoUrl,
}));

const { emailAddressesResolver } = await import(
  '../../src/resolvers/emailAddressesResolver.js'
);

describe('emailAddressesResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when accountIds is missing', async () => {
    const req = { payload: {} };
    const result = await emailAddressesResolver(req);

    expect(result).toEqual({
      success: false,
      error: 'accountIds must be a non-empty array',
      status: 400,
    });
  });

  it('returns error when accountIds is empty array', async () => {
    const req = { payload: { accountIds: [] } };
    const result = await emailAddressesResolver(req);

    expect(result).toEqual({
      success: false,
      error: 'accountIds must be a non-empty array',
      status: 400,
    });
  });

  it('returns error when accountIds is not an array', async () => {
    const req = { payload: { accountIds: 'not-an-array' } };
    const result = await emailAddressesResolver(req);

    expect(result).toEqual({
      success: false,
      error: 'accountIds must be a non-empty array',
      status: 400,
    });
  });

  it('returns users and mailto url on success', async () => {
    const mockUsers = [
      { accountId: 'user-1', email: 'a@test.com', displayName: 'User A' },
      { accountId: 'user-2', email: 'b@test.com', displayName: 'User B' },
    ];
    mockGetEmailAddresses.mockResolvedValue(mockUsers);
    mockBuildMailtoUrl.mockReturnValue('mailto:a@test.com,b@test.com?subject=Test%20Subject');

    const req = { payload: { accountIds: ['user-1', 'user-2'], subject: 'Test Subject' } };
    const result = await emailAddressesResolver(req);

    expect(mockGetEmailAddresses).toHaveBeenCalledWith(['user-1', 'user-2']);
    expect(mockBuildMailtoUrl).toHaveBeenCalledWith(['a@test.com', 'b@test.com'], 'Test Subject');
    expect(result).toEqual({
      success: true,
      users: mockUsers,
      mailto: 'mailto:a@test.com,b@test.com?subject=Test%20Subject',
    });
  });

  it('returns null mailto when url exceeds limit', async () => {
    const mockUsers = [
      { accountId: 'user-1', email: 'a@test.com', displayName: 'User A' },
    ];
    mockGetEmailAddresses.mockResolvedValue(mockUsers);
    mockBuildMailtoUrl.mockReturnValue(null); // URL too long

    const req = { payload: { accountIds: ['user-1'], subject: 'Test' } };
    const result = await emailAddressesResolver(req);

    expect(result).toEqual({
      success: true,
      users: mockUsers,
      mailto: null,
    });
  });

  it('defaults subject to Digital Signature when not provided', async () => {
    const mockUsers = [
      { accountId: 'user-1', email: 'a@test.com', displayName: 'User A' },
    ];
    mockGetEmailAddresses.mockResolvedValue(mockUsers);
    mockBuildMailtoUrl.mockReturnValue('mailto:a@test.com?subject=Digital%20Signature');

    const req = { payload: { accountIds: ['user-1'] } };
    const result = await emailAddressesResolver(req);

    expect(mockBuildMailtoUrl).toHaveBeenCalledWith(['a@test.com'], 'Digital Signature');
    expect(result).toEqual({
      success: true,
      users: mockUsers,
      mailto: 'mailto:a@test.com?subject=Digital%20Signature',
    });
  });

  it('filters null emails before building mailto url', async () => {
    const mockUsers = [
      { accountId: 'user-1', email: 'a@test.com', displayName: 'User A' },
      { accountId: 'user-2', email: null, displayName: 'User B' },
    ];
    mockGetEmailAddresses.mockResolvedValue(mockUsers);
    mockBuildMailtoUrl.mockReturnValue('mailto:a@test.com?subject=Test');

    const req = { payload: { accountIds: ['user-1', 'user-2'], subject: 'Test' } };
    const result = await emailAddressesResolver(req);

    expect(mockBuildMailtoUrl).toHaveBeenCalledWith(['a@test.com'], 'Test');
    expect(result).toEqual({
      success: true,
      users: mockUsers,
      mailto: 'mailto:a@test.com?subject=Test',
    });
  });

  it('returns error 500 when service throws', async () => {
    mockGetEmailAddresses.mockRejectedValue(new Error('Service error'));

    const req = { payload: { accountIds: ['user-1'] } };
    const result = await emailAddressesResolver(req);

    expect(result).toEqual({
      success: false,
      error: 'Service error',
      status: 500,
    });
  });
});