import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { setBillingProvider, StripeBillingProvider } from '../src/billing/provider.js';
import { LemonSqueezyBillingProvider } from '../src/billing/lemonSqueezy.js';
import { RazorpayBillingProvider } from '../src/billing/razorpay.js';

describe('R1: Fail-Closed Webhook Verification', () => {
  const stripeSecret = 'whsec_test_stripe_secret_1234567890';
  const lemonSecret = 'lemsec_test_lemon_secret_1234567890';
  const razorpaySecret = 'rzpsec_test_razorpay_secret_1234567890';

  let origStripeSecret: string;
  let origLemonSecret: string | undefined;
  let origRazorpaySecret: string | undefined;
  let origBillingProvider: any;

  beforeEach(() => {
    origStripeSecret = env.STRIPE_WEBHOOK_SECRET;
    origLemonSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    origRazorpaySecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    origBillingProvider = (env as any).BILLING_PROVIDER;
  });

  afterEach(() => {
    (env as any).STRIPE_WEBHOOK_SECRET = origStripeSecret;
    if (origLemonSecret !== undefined) process.env.LEMONSQUEEZY_WEBHOOK_SECRET = origLemonSecret;
    else delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
    if (origRazorpaySecret !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = origRazorpaySecret;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
    (env as any).BILLING_PROVIDER = origBillingProvider;
    setBillingProvider(new StripeBillingProvider());
  });

  describe('Stripe Provider (Fail-Closed)', () => {
    it('rejects webhooks with 503 when STRIPE_WEBHOOK_SECRET is unset/empty', async () => {
      (env as any).STRIPE_WEBHOOK_SECRET = '';
      setBillingProvider(new StripeBillingProvider());

      const payload = JSON.stringify({ type: 'checkout.session.completed', data: {} });
      const res = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toMatch(/secret not configured/i);
    });

    it('rejects unsigned webhooks with 400 when STRIPE_WEBHOOK_SECRET is set', async () => {
      (env as any).STRIPE_WEBHOOK_SECRET = stripeSecret;
      setBillingProvider(new StripeBillingProvider());

      const payload = JSON.stringify({ type: 'checkout.session.completed', data: {} });
      const res = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/signature/i);
    });

    it('rejects forged/invalid signature webhooks with 400 when secret is set', async () => {
      (env as any).STRIPE_WEBHOOK_SECRET = stripeSecret;
      setBillingProvider(new StripeBillingProvider());

      const payload = JSON.stringify({ type: 'checkout.session.completed', data: {} });
      const timestamp = Math.floor(Date.now() / 1000);
      const invalidSignature = `t=${timestamp},v1=0000000000000000000000000000000000000000000000000000000000000000`;

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

    it('rejects replayed webhooks with expired timestamp (> 300s)', async () => {
      (env as any).STRIPE_WEBHOOK_SECRET = stripeSecret;
      setBillingProvider(new StripeBillingProvider());

      const payload = JSON.stringify({ type: 'checkout.session.completed', data: {} });
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s ago
      const signedPayload = `${expiredTimestamp}.${payload}`;
      const hmac = crypto.createHmac('sha256', stripeSecret).update(signedPayload, 'utf8').digest('hex');
      const signature = `t=${expiredTimestamp},v1=${hmac}`;

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

    it('rejects webhooks signed with the wrong secret with 400', async () => {
      (env as any).STRIPE_WEBHOOK_SECRET = stripeSecret;
      setBillingProvider(new StripeBillingProvider());

      const payload = JSON.stringify({ type: 'checkout.session.completed', data: {} });
      const timestamp = Math.floor(Date.now() / 1000);
      const wrongSecret = 'whsec_attacker_controlled_secret_123';
      const signedPayload = `${timestamp}.${payload}`;
      const hmac = crypto.createHmac('sha256', wrongSecret).update(signedPayload, 'utf8').digest('hex');
      const signature = `t=${timestamp},v1=${hmac}`;

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
      expect(data.error).toMatch(/signature/i);
    });
  });

  describe('Lemon Squeezy Provider (Fail-Closed)', () => {
    it('rejects Lemon Squeezy webhooks with 503 when secret is unset', async () => {
      delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
      delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
      setBillingProvider(new LemonSqueezyBillingProvider());

      const payload = JSON.stringify({ meta: { event_name: 'order_created' } });
      const res = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toMatch(/secret not configured/i);
    });

    it('rejects unsigned or forged Lemon Squeezy webhooks with 400 when secret is set', async () => {
      process.env.LEMONSQUEEZY_WEBHOOK_SECRET = lemonSecret;
      setBillingProvider(new LemonSqueezyBillingProvider());

      const payload = JSON.stringify({ meta: { event_name: 'order_created' } });
      const unsignedRes = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      expect(unsignedRes.status).toBe(400);

      const forgedRes = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature': 'bad_signature_hash',
        },
        body: payload,
      });
      expect(forgedRes.status).toBe(400);
    });
  });

  describe('Razorpay Provider (Fail-Closed)', () => {
    it('rejects Razorpay webhooks with 503 when secret is unset', async () => {
      delete process.env.RAZORPAY_WEBHOOK_SECRET;
      setBillingProvider(new RazorpayBillingProvider());

      const payload = JSON.stringify({ event: 'subscription.activated' });
      const res = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.error).toMatch(/secret not configured/i);
    });

    it('rejects unsigned or forged Razorpay webhooks with 400 when secret is set', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = razorpaySecret;
      setBillingProvider(new RazorpayBillingProvider());

      const payload = JSON.stringify({ event: 'subscription.activated' });
      const unsignedRes = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      expect(unsignedRes.status).toBe(400);

      const forgedRes = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'bad_signature_hash',
        },
        body: payload,
      });
      expect(forgedRes.status).toBe(400);
    });
  });
});
