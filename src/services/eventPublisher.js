/* global fetch */
import { getWebhookUrls } from './webhookConfigStore';

function buildPayload(eventType, eventData) {
  return {
    eventType,
    timestamp: new Date().toISOString(),
    ...eventData,
  };
}

async function postToWebhook(webhook, payload) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (webhook.secret) {
    headers['X-Automation-Webhook-Token'] = webhook.secret;
  }

  const response = await fetch(webhook.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook POST to ${webhook.url} failed: ${response.status} ${response.statusText}`);
  }

  return response;
}

// Fire-and-forget: publishes to all configured webhooks, logs failures, never throws.
export async function publishEvent(eventType, eventData) {
  let webhooks;
  try {
    webhooks = await getWebhookUrls();
  } catch (error) {
    console.error('Failed to read webhook config:', error);
    return;
  }

  if (webhooks.length === 0) return;

  const payload = buildPayload(eventType, eventData);
  console.log(`Publishing event ${eventType} to ${webhooks.length} webhook(s)`);

  const results = await Promise.allSettled(
    webhooks.map(webhook => postToWebhook(webhook, payload))
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Webhook ${webhooks[index].url} failed:`, result.reason?.message || result.reason);
    }
  });
}

// Sends a test event to a single webhook. Returns { success, error? }.
export async function sendTestEvent(webhook) {
  const payload = buildPayload('test', {
    message: 'Test event from Digital Signature app',
  });

  try {
    await postToWebhook(webhook, payload);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
