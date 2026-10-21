import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { db } from '../src/db/client.js';
import { orgs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { RazorpayBillingProvider } from '../src/billing/razorpay.js';
import { setBillingProvider, StripeBillingProvider } from '../src/billing/provider.js';

describe('Razorpay Checkout & Webhook Integration Suite', () => {
  const testWebhookSecret = 'razorpay_webhook_test_secret_12345';
  let testOrgId: string;
  let ownerSession: string;

  beforeEach(async () => {
    // 1. Create a test org on free plan
    const runId = Math.random().toString(36).substring(7);
    const loginRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `rzp-owner-${runId}@example.com`,
        name: 'Razorpay Owner',
        orgName: `Razorpay Org ${runId}`,
      }),
    });
    ownerSession = (await loginRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    testOrgId = (await meRes.json()).orgs[0].orgId;

    // Configure Razorpay provider
    (env as any).BILLING_PROVIDER = 'razorpay';
    (env as any).RAZORPAY_WEBHOOK_SECRET = testWebhookSecret;
    setBillingProvider(new RazorpayBillingProvider('rzp_test_key_123', 'rzp_test_secret_456'));
  });

  afterEach(() => {
    (env as any).BILLING_PROVIDER = 'stripe';
    setBillingProvider(new StripeBillingProvider());
    vi.restoreAllMocks();
  });

  it('creates Razorpay checkout session calling Razorpay payment links API', async () => {
    const mockShortUrl = 'https://rzp.io/i/testLink123';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'plink_123', short_url: mockShortUrl }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await app.request(`/api/v1/orgs/${testOrgId}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({ plan: 'pro' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkoutUrl).toBe(mockShortUrl);

    // Assert fetch call payload
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.razorpay.com/v1/payment_links',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('verifies HMAC-SHA256 signature and upgrades org on payment_link.paid webhook', async () => {
    const payload = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'plink_123',
            notes: {
              org_id: testOrgId,
              plan: 'pro',
            },
          },
        },
      },
    });

    const signature = crypto.createHmac('sha256', testWebhookSecret).update(payload).digest('hex');

    const res = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);

    const [updatedOrg] = await db
      .select({ plan: orgs.plan, subscriptionStatus: orgs.subscriptionStatus })
      .from(orgs)
      .where(eq(orgs.id, testOrgId));

    expect(updatedOrg.plan).toBe('pro');
    expect(updatedOrg.subscriptionStatus).toBe('active');
  });

  it('rejects forged or missing Razorpay signatures with 400', async () => {
    const payload = JSON.stringify({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { notes: { org_id: testOrgId, plan: 'pro' } } },
      },
    });

    // 1. Missing signature
    const resNoSig = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    expect(resNoSig.status).toBe(400);

    // 2. Forged signature
    const resForged = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: payload,
    });
    expect(resForged.status).toBe(400);
  });

  it('downgrades org to Free when subscription.cancelled webhook arrives', async () => {
    // First upgrade to team
    await db.update(orgs).set({ plan: 'team', subscriptionStatus: 'active' }).where(eq(orgs.id, testOrgId));

    const payload = JSON.stringify({
      event: 'subscription.cancelled',
      payload: {
        subscription: {
          entity: {
            notes: {
              org_id: testOrgId,
            },
          },
        },
      },
    });

    const signature = crypto.createHmac('sha256', testWebhookSecret).update(payload).digest('hex');

    const res = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);

    const [downgradedOrg] = await db
      .select({ plan: orgs.plan, subscriptionStatus: orgs.subscriptionStatus })
      .from(orgs)
      .where(eq(orgs.id, testOrgId));

    expect(downgradedOrg.plan).toBe('free');
    expect(downgradedOrg.subscriptionStatus).toBe('canceled');
  });
});
