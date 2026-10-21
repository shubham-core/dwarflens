import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { db } from '../src/db/client.js';
import { orgs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { LemonSqueezyBillingProvider } from '../src/billing/lemonSqueezy.js';
import { setBillingProvider, StripeBillingProvider } from '../src/billing/provider.js';

describe('Lemon Squeezy Checkout & Webhook Integration Suite', () => {
  const testWebhookSecret = 'lemonsqueezy_webhook_test_secret_12345';
  let testOrgId: string;
  let ownerSession: string;

  beforeEach(async () => {
    // 1. Create a test org on free plan
    const runId = Math.random().toString(36).substring(7);
    const loginRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `lemon-owner-${runId}@example.com`,
        name: 'Lemon Owner',
        orgName: `Lemon Org ${runId}`,
      }),
    });
    ownerSession = (await loginRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    testOrgId = (await meRes.json()).orgs[0].orgId;

    // Configure Lemon Squeezy provider
    (env as any).BILLING_PROVIDER = 'lemonsqueezy';
    (env as any).LEMONSQUEEZY_WEBHOOK_SECRET = testWebhookSecret;
    (env as any).LEMONSQUEEZY_VARIANT_PRO = 'var_pro_123';
    (env as any).LEMONSQUEEZY_VARIANT_TEAM = 'var_team_456';
    setBillingProvider(new LemonSqueezyBillingProvider('lemon_test_api_key', 'store_12345'));
  });

  afterEach(() => {
    (env as any).BILLING_PROVIDER = 'stripe';
    setBillingProvider(new StripeBillingProvider());
    vi.restoreAllMocks();
  });

  it('creates Lemon Squeezy checkout session calling Lemon Squeezy checkouts API', async () => {
    const mockCheckoutUrl = 'https://dwarflens.lemonsqueezy.com/buy/var_pro_123';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'checkout_123',
            attributes: { url: mockCheckoutUrl },
          },
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/vnd.api+json' },
        }
      )
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
    expect(body.checkoutUrl).toBe(mockCheckoutUrl);

    // Assert fetch call payload
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.lemonsqueezy.com/v1/checkouts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer lemon_test_api_key',
          'Content-Type': 'application/vnd.api+json',
        }),
      })
    );
  });

  it('verifies HMAC-SHA256 signature and upgrades org on subscription_created webhook', async () => {
    const payload = JSON.stringify({
      meta: {
        event_name: 'subscription_created',
        custom_data: {
          org_id: testOrgId,
          plan: 'pro',
        },
      },
      data: {
        attributes: {
          renews_at: '2027-10-21T00:00:00Z',
        },
      },
    });

    const signature = crypto.createHmac('sha256', testWebhookSecret).update(payload).digest('hex');

    const res = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': signature,
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

  it('rejects forged or missing Lemon Squeezy signatures with 400', async () => {
    const payload = JSON.stringify({
      meta: {
        event_name: 'subscription_created',
        custom_data: { org_id: testOrgId, plan: 'pro' },
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
        'x-signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: payload,
    });
    expect(resForged.status).toBe(400);
  });

  it('downgrades org to Free when subscription_cancelled webhook arrives', async () => {
    // First upgrade to team
    await db.update(orgs).set({ plan: 'team', subscriptionStatus: 'active' }).where(eq(orgs.id, testOrgId));

    const payload = JSON.stringify({
      meta: {
        event_name: 'subscription_cancelled',
        custom_data: {
          org_id: testOrgId,
        },
      },
    });

    const signature = crypto.createHmac('sha256', testWebhookSecret).update(payload).digest('hex');

    const res = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': signature,
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
