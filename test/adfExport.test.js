import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mock dependencies before importing the module under test ---

const mockParseAndSanitize = vi.fn();
vi.mock('../src/shared/markdown/parseAndSanitize.js', () => ({
  parseAndSanitize: mockParseAndSanitize,
}));

const mockRenderToADF = vi.fn();
vi.mock('../src/shared/markdown/renderToADF.js', () => ({
  renderToADF: mockRenderToADF,
}));

const mockGetSignature = vi.fn();
vi.mock('../src/storage/signatureStore.js', () => ({
  getSignature: mockGetSignature,
}));

// Dynamic import so mocks are in place before the module loads
const { handler } = await import('../src/adfExport.js');

// Minimal ADF document returned by the render pipeline in normal operation
const MOCK_ADF = { version: 1, type: 'doc', content: [] };

describe('adfExport handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: parse/render succeed and return a usable ADF skeleton
    mockParseAndSanitize.mockReturnValue({});
    mockRenderToADF.mockReturnValue({ ...MOCK_ADF, content: [] });
    mockGetSignature.mockResolvedValue(null);
  });

  // ---------------------------------------------------------------
  // No-content guard (independent of license)
  // ---------------------------------------------------------------

  describe('empty content guard', () => {
    it('returns a no-content message when config has no content', async () => {
      const payload = {
        extensionPayload: { config: { title: '', content: '' } },
        context: { content: { id: 'page-1' } },
      };

      const result = await handler(payload);

      expect(result.content[0].content[0].text).toContain('No content configured');
      expect(mockParseAndSanitize).not.toHaveBeenCalled();
    });
  });

  describe('signature section rendering', () => {
    const withSigs = (signatures) => {
      mockGetSignature.mockResolvedValue({ signatures });
      return handler({
        extensionPayload: { config: { title: 'T', content: 'hello' } },
        context: { content: { id: 'page-1' } },
      });
    };
    const allText = (node, acc = []) => {
      if (!node) return acc;
      if (Array.isArray(node)) { node.forEach((n) => allText(n, acc)); return acc; }
      if (node.type === 'text' && typeof node.text === 'string') acc.push(node.text);
      if (node.content) allText(node.content, acc);
      return acc;
    };

    it('renders a legacy (former-user) signer as a label, not a raw legacy: accountId', async () => {
      const adf = await withSigs([
        { accountId: 'acc-real', signedAt: new Date('2025-03-06T10:00:00Z') },
        { accountId: 'legacy:B022106', signedAt: new Date('2025-03-06T11:00:00Z') },
      ]);
      const text = allText(adf.content).join(' | ');
      expect(text).toContain('B022106 (former user)'); // preserved DC userKey, marked as former user
      expect(text).toContain('acc-real');              // real signer still shown
      expect(text).not.toContain('legacy:B022106');    // sentinel prefix never surfaces in the export
    });
  });
});
