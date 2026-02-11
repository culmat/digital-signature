import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorage = {
  getSecret: vi.fn(),
  setSecret: vi.fn(),
};

vi.mock('@forge/api', () => ({
  storage: mockStorage,
}));

const { getWebhookConfig, setWebhookConfig, getWebhookUrls } = await import(
  '../../src/services/webhookConfigStore.js'
);

describe('webhookConfigStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWebhookConfig', () => {
    it('returns empty webhooks array when no config stored', async () => {
      mockStorage.getSecret.mockResolvedValue(null);
      const config = await getWebhookConfig();
      expect(config).toEqual({ webhooks: [] });
    });

    it('returns stored config', async () => {
      const stored = { webhooks: [{ url: 'https://example.com', secret: 'abc' }] };
      mockStorage.getSecret.mockResolvedValue(stored);
      const config = await getWebhookConfig();
      expect(config).toEqual(stored);
    });
  });

  describe('setWebhookConfig', () => {
    it('filters out entries without url', async () => {
      mockStorage.setSecret.mockResolvedValue(undefined);
      const result = await setWebhookConfig({
        webhooks: [
          { url: 'https://example.com', secret: 'abc' },
          { url: '', secret: 'orphan' },
          { url: null },
        ],
      });
      expect(result.webhooks).toHaveLength(1);
      expect(result.webhooks[0].url).toBe('https://example.com');
    });

    it('trims whitespace from urls and secrets', async () => {
      mockStorage.setSecret.mockResolvedValue(undefined);
      const result = await setWebhookConfig({
        webhooks: [{ url: '  https://example.com  ', secret: '  token  ' }],
      });
      expect(result.webhooks[0].url).toBe('https://example.com');
      expect(result.webhooks[0].secret).toBe('token');
    });

    it('omits secret when empty', async () => {
      mockStorage.setSecret.mockResolvedValue(undefined);
      const result = await setWebhookConfig({
        webhooks: [{ url: 'https://example.com', secret: '' }],
      });
      expect(result.webhooks[0].secret).toBeUndefined();
    });
  });

  describe('getWebhookUrls', () => {
    it('returns webhooks array from config', async () => {
      const stored = { webhooks: [{ url: 'https://a.com' }, { url: 'https://b.com' }] };
      mockStorage.getSecret.mockResolvedValue(stored);
      const urls = await getWebhookUrls();
      expect(urls).toHaveLength(2);
    });

    it('returns empty array when no config', async () => {
      mockStorage.getSecret.mockResolvedValue(null);
      const urls = await getWebhookUrls();
      expect(urls).toEqual([]);
    });
  });
});
