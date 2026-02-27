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
});
