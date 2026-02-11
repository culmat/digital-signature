import { storage } from '@forge/api';

const WEBHOOK_CONFIG_KEY = 'webhook-config';

export async function getWebhookConfig() {
  const config = await storage.getSecret(WEBHOOK_CONFIG_KEY);
  return config || { webhooks: [] };
}

export async function setWebhookConfig(config) {
  const validated = {
    webhooks: (config.webhooks || [])
      .filter(w => w.url && typeof w.url === 'string')
      .map(w => ({
        url: w.url.trim(),
        secret: w.secret ? w.secret.trim() : undefined,
      }))
  };
  await storage.setSecret(WEBHOOK_CONFIG_KEY, validated);
  return validated;
}

export async function getWebhookUrls() {
  const config = await getWebhookConfig();
  return config.webhooks || [];
}
