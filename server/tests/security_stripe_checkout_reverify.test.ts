import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { db } from '../src/db/client.js';
import { orgs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { StripeBillingProvider } from '../src/billing/provider.js';

describe('R9: Stripe Checkout Payload & Mock Verification', () => {
  let orgId: string;
  let ownerSession: string;
  const runId = Math.random().toString(36).substring(7);

  const origSecretKey = env.STRIPE_SECRET_KEY;
  const origPricePro = env.STRIPE_PRICE_PRO;
  const origPriceTeam = env.STRIPE_PRICE_TEAM;
  const origAppUrl = env.APP_URL;
  const origNodeEnv = env.NODE_ENV;
  const origFetch = globalThis.fetch;

  type CapturedCall = {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    bodyParams?: Record<string, string>;
  };
  const capturedCalls: CapturedCall[] = [];

  beforeAll(async () => {
    // 1. Create Owner & Org
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({
        email: `stripe-audit-${runId}@example.com`,
        name: 'Stripe Auditor',
        orgName: `Stripe Reverify Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    orgId = (await meRes.json()).orgs[0].orgId;

    // Configure test price IDs
    (env as any).STRIPE_PRICE_PRO = 'price_pro_test_123';
    (env as any).STRIPE_PRICE_TEAM = 'price_team_test_456';
    (env as any).STRIPE_SECRET_KEY = 'sk_test_mock_secret_key';

    // Mock global fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = String(input);
      const method = init?.method || 'GET';
      const body = init?.body ? String(init.body) : '';
      const bodyParams: Record<string, string> = {};
      if (body) {
        const parsed = new URLSearchParams(body);
        for (const [k, v] of parsed.entries()) {
          bodyParams[k] = v;
        }
      }
      const headers = (init?.headers as Record<string, string>) || {};

      capturedCalls.push({ url: urlStr, method, headers, bodyParams });

      if (urlStr === 'https://api.stripe.com/v1/customers') {
        return new Response(JSON.stringify({
          id: `cus_created_${runId}`,
          object: 'customer',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (urlStr === 'https://api.stripe.com/v1/checkout/sessions') {
        return new Response(JSON.stringify({
          id: `cs_test_${runId}`,
          url: `https://checkout.stripe.com/c/pay/cs_test_${runId}`,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response('Not Found', { status: 404 });
    }) as any;
  });

  afterAll(() => {
    (env as any).STRIPE_SECRET_KEY = origSecretKey;
    (env as any).STRIPE_PRICE_PRO = origPricePro;
    (env as any).STRIPE_PRICE_TEAM = origPriceTeam;
    (env as any).APP_URL = origAppUrl;
    (env as any).NODE_ENV = origNodeEnv;
    globalThis.fetch = origFetch;
  });

  it('creates/stores customer and asserts exact Stripe checkout request body', async () => {
    capturedCalls.length = 0;

    const res = await app.request(`/api/v1/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        plan: 'pro',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checkoutUrl).toBe(`https://checkout.stripe.com/c/pay/cs_test_${runId}`);
    expect(data.sessionId).toBe(`cs_test_${runId}`);

    // Check that customer was created via API and stored in DB
    const custCall = capturedCalls.find(c => c.url === 'https://api.stripe.com/v1/customers');
    expect(custCall).toBeDefined();
    expect(custCall?.method).toBe('POST');
    expect(custCall?.headers?.Authorization).toBe('Bearer sk_test_mock_secret_key');
    expect(custCall?.bodyParams?.['metadata[org_id]']).toBe(orgId);

    // Verify customer ID was saved to DB
    const [org] = await db.select({ stripeCustomerId: orgs.stripeCustomerId }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
    expect(org?.stripeCustomerId).toBe(`cus_created_${runId}`);

    // Verify exact request body sent to Stripe checkout
    const sessionCall = capturedCalls.find(c => c.url === 'https://api.stripe.com/v1/checkout/sessions');
    expect(sessionCall).toBeDefined();
    expect(sessionCall?.method).toBe('POST');
    expect(sessionCall?.headers?.Authorization).toBe('Bearer sk_test_mock_secret_key');
    expect(sessionCall?.bodyParams).toEqual({
      client_reference_id: orgId,
      'metadata[org_id]': orgId,
      'metadata[plan]': 'pro',
      'subscription_data[metadata][org_id]': orgId,
      'subscription_data[metadata][plan]': 'pro',
      mode: 'subscription',
      'line_items[0][price]': 'price_pro_test_123',
      'line_items[0][quantity]': '1',
      customer: `cus_created_${runId}`,
      success_url: `${env.APP_URL.endsWith('/') ? env.APP_URL : env.APP_URL + '/'}#projects?billing=success`,
      cancel_url: `${env.APP_URL.endsWith('/') ? env.APP_URL : env.APP_URL + '/'}#projects?billing=canceled`,
    });
  });

  it('reuses existing stored customer for subsequent checkout calls', async () => {
    capturedCalls.length = 0;

    const res = await app.request(`/api/v1/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        plan: 'team',
      }),
    });

    expect(res.status).toBe(200);

    // Customer creation endpoint should NOT be called again
    const custCall = capturedCalls.find(c => c.url === 'https://api.stripe.com/v1/customers');
    expect(custCall).toBeUndefined();

    // Checkout should reuse the stored customer
    const sessionCall = capturedCalls.find(c => c.url === 'https://api.stripe.com/v1/checkout/sessions');
    expect(sessionCall).toBeDefined();
    expect(sessionCall?.bodyParams?.customer).toBe(`cus_created_${runId}`);
    expect(sessionCall?.bodyParams?.['line_items[0][price]']).toBe('price_team_test_456');
    expect(sessionCall?.bodyParams?.['metadata[plan]']).toBe('team');
    expect(sessionCall?.bodyParams?.['subscription_data[metadata][plan]']).toBe('team');
  });

  it('fails cleanly with 400 when configured Stripe price ID is missing', async () => {
    (env as any).STRIPE_PRICE_PRO = '';

    const res = await app.request(`/api/v1/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        plan: 'pro',
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Missing Stripe price ID');

    (env as any).STRIPE_PRICE_PRO = 'price_pro_test_123';
  });

  it('rejects localhost redirect URLs in production mode', async () => {
    const priorEnv = env.NODE_ENV;
    const priorAppUrl = env.APP_URL;
    try {
      (env as any).NODE_ENV = 'production';
      (env as any).APP_URL = 'https://dwarflens.com';

      const res = await app.request(`/api/v1/orgs/${orgId}/billing/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `dwarflens_session=${ownerSession}`,
        },
        body: JSON.stringify({
          plan: 'pro',
          success_url: 'http://localhost:5173/dashboard',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('Forbidden redirect URL');
    } finally {
      (env as any).NODE_ENV = priorEnv;
      (env as any).APP_URL = priorAppUrl;
    }
  });
});
