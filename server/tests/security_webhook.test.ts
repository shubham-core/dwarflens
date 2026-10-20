import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { env } from '../src/env.js';

describe('P0-2: Billing Webhook Signature & Security', () => {
  const webhookSecret = 'whsec_test_secret_xyz_9876543210';
  let origSecret: string;

  beforeEach(() => {
    origSecret = env.STRIPE_WEBHOOK_SECRET;
    // Set secret for test
    (env as any).STRIPE_WEBHOOK_SECRET = webhookSecret;
  });

  afterEach(() => {
    (env as any).STRIPE_WEBHOOK_SECRET = origSecret;
  });

  it('rejects webhook request without stripe-signature header (400 Bad Request)', async () => {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123' } },
    });

    const res = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/signature/i);
  });

  it('rejects webhook request with invalid HMAC signature (400 Bad Request)', async () => {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123' } },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const invalidSignature = `t=${timestamp},v1=bad_invalid_hmac_hash_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`;

    const res = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': invalidSignature,
      },
      body: payload,
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/signature/i);
  });

  it('rejects webhook request with expired timestamp (> 300s old)', async () => {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_123' } },
    });
    // 10 minutes ago
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const signedPayload = `${oldTimestamp}.${payload}`;
    const hmac = crypto.createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
    const signature = `t=${oldTimestamp},v1=${hmac}`;

    const res = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/timestamp|tolerance/i);
  });

  it('accepts webhook request with valid HMAC signature and valid timestamp', async () => {
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'test-org-id',
          customer: 'cus_test_123',
          metadata: { org_id: 'test-org-id', plan: 'pro' },
        },
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;
    const hmac = crypto.createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
    const signature = `t=${timestamp},v1=${hmac}`;

    const res = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received).toBe(true);
  });
});
