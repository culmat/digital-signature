import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetWebhookUrls = vi.fn();

vi.mock('../../src/services/webhookConfigStore.js', () => ({
  getWebhookUrls: mockGetWebhookUrls,
}));

const { publishEvent, sendTestEvent } = await import(
  '../../src/services/eventPublisher.js'
);

describe('eventPublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('publishEvent', () => {
    it('does nothing when no webhooks configured', async () => {
      mockGetWebhookUrls.mockResolvedValue([]);
      await publishEvent('signature.added', { pageId: '123' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('posts to all configured webhooks', async () => {
      mockGetWebhookUrls.mockResolvedValue([
        { url: 'https://a.com/hook' },
        { url: 'https://b.com/hook' },
      ]);
      global.fetch.mockResolvedValue({ ok: true });

      await publishEvent('signature.added', { pageId: '123' });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch.mock.calls[0][0]).toBe('https://a.com/hook');
      expect(global.fetch.mock.calls[1][0]).toBe('https://b.com/hook');
    });

    it('includes event type and timestamp in payload', async () => {
      mockGetWebhookUrls.mockResolvedValue([{ url: 'https://a.com/hook' }]);
      global.fetch.mockResolvedValue({ ok: true });

      await publishEvent('signature.added', { pageId: '123' });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.eventType).toBe('signature.added');
      expect(body.timestamp).toBeDefined();
      expect(body.pageId).toBe('123');
    });

    it('includes secret header when webhook has secret', async () => {
      mockGetWebhookUrls.mockResolvedValue([
        { url: 'https://a.com/hook', secret: 'my-token' },
      ]);
      global.fetch.mockResolvedValue({ ok: true });

      await publishEvent('test', {});

      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers['X-Automation-Webhook-Token']).toBe('my-token');
    });

    it('omits secret header when no secret', async () => {
      mockGetWebhookUrls.mockResolvedValue([{ url: 'https://a.com/hook' }]);
      global.fetch.mockResolvedValue({ ok: true });

      await publishEvent('test', {});

      const headers = global.fetch.mock.calls[0][1].headers;
      expect(headers['X-Automation-Webhook-Token']).toBeUndefined();
    });

    it('logs but does not throw when a webhook fails', async () => {
      mockGetWebhookUrls.mockResolvedValue([
        { url: 'https://a.com/hook' },
        { url: 'https://b.com/hook' },
      ]);
      global.fetch
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ ok: true });

      // Should not throw
      await publishEvent('test', {});
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('logs but does not throw when webhook config read fails', async () => {
      mockGetWebhookUrls.mockRejectedValue(new Error('storage error'));
      // Should not throw
      await publishEvent('test', {});
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('sendTestEvent', () => {
    it('returns success when webhook responds ok', async () => {
      global.fetch.mockResolvedValue({ ok: true });
      const result = await sendTestEvent({ url: 'https://a.com/hook' });
      expect(result.success).toBe(true);
    });

    it('returns error when webhook fails', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Error' });
      const result = await sendTestEvent({ url: 'https://a.com/hook' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
