import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { db } from '../src/db/client.js';
import { orgs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('P1-8: Stripe Checkout & Subscription Lifecycle', () => {
  let orgId: string;
  let ownerSession: string;
  const runId = Math.random().toString(36).substring(7);
  const customerId = `cus_sec_${runId}`;
  const testSecret = 'whsec_test_secret_for_stripe_checkout';
  let origSecret: string;

  const signPayload = (payload: string) => {
    const t = Math.floor(Date.now() / 1000);
    const hmac = crypto.createHmac('sha256', testSecret).update(`${t}.${payload}`, 'utf8').digest('hex');
    return `t=${t},v1=${hmac}`;
  };

  beforeAll(async () => {
    origSecret = env.STRIPE_WEBHOOK_SECRET;
    (env as any).STRIPE_WEBHOOK_SECRET = testSecret;
    // 1. Create Owner & Org
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `stripe-owner-${runId}@example.com`,
        name: 'Stripe Owner',
        orgName: `Stripe Lifecycle Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    orgId = (await meRes.json()).orgs[0].orgId;

    // Attach stripe customer id for tests
    await db.update(orgs).set({ stripeCustomerId: customerId }).where(eq(orgs.id, orgId));
  });

  it('rejects external success_url / cancel_url in checkout session (400 Bad Request)', async () => {
    const evilRes = await app.request(`/api/v1/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        plan: 'pro',
        success_url: 'https://evil-phishing.com/steal-creds',
      }),
    });

    expect(evilRes.status).toBe(400);
    const evilData = await evilRes.json();
    expect(evilData.error).toMatch(/url/i);
  });

  it('rejects external return_url in portal session (400 Bad Request)', async () => {
    const evilRes = await app.request(`/api/v1/orgs/${orgId}/billing/portal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        return_url: 'https://evil-phishing.com/portal-steal',
      }),
    });

    expect(evilRes.status).toBe(400);
    const evilData = await evilRes.json();
    expect(evilData.error).toMatch(/url/i);
  });

  afterAll(() => {
    (env as any).STRIPE_WEBHOOK_SECRET = origSecret;
  });

  it('updates subscription to past_due on invoice.payment_failed webhook', async () => {
    const payload = JSON.stringify({
      type: 'invoice.payment_failed',
      data: {
        object: {
          customer: customerId,
        },
      },
    });

    const webhookRes = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signPayload(payload),
      },
      body: payload,
    });

    expect(webhookRes.status).toBe(200);

    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
    expect((org as any).subscriptionStatus).toBe('past_due');
  });

  it('updates subscription to active with period end on customer.subscription.updated', async () => {
    const periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 86400;
    const payload = JSON.stringify({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_live_12345',
          customer: customerId,
          status: 'active',
          current_period_end: periodEndUnix,
          metadata: {
            plan: 'pro',
          },
        },
      },
    });

    const webhookRes = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signPayload(payload),
      },
      body: payload,
    });

    expect(webhookRes.status).toBe(200);

    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
    expect((org as any).stripeSubscriptionId).toBe('sub_live_12345');
    expect((org as any).subscriptionStatus).toBe('active');
    expect(org.plan).toBe('pro');

    // Also verify getSubscription returns real state
    const billingRes = await app.request(`/api/v1/orgs/${orgId}/billing`, {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    expect(billingRes.status).toBe(200);
    const billingData = await billingRes.json();
    expect(billingData.subscription.status).toBe('active');
    expect(billingData.subscription.plan).toBe('pro');
    expect(billingData.subscription.currentPeriodEnd).toBeDefined();
  });

  it('downgrades to free and canceled on customer.subscription.deleted', async () => {
    const payload = JSON.stringify({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          customer: customerId,
        },
      },
    });

    const webhookRes = await app.request('/api/v1/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signPayload(payload),
      },
      body: payload,
    });

    expect(webhookRes.status).toBe(200);

    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
    expect(org.plan).toBe('free');
    expect((org as any).subscriptionStatus).toBe('canceled');
  });
});
