import { Hono } from 'hono';
import crypto from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { orgs, projects, analyses } from '../db/schema.js';
import { env } from '../env.js';
import { AuthContextVariables, requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org.js';
import { getBillingProvider } from '../billing/provider.js';
import { LemonSqueezyBillingProvider } from '../billing/lemonSqueezy.js';
import { RazorpayBillingProvider } from '../billing/razorpay.js';
import { PLAN_LIMITS, PlanType } from '../billing/types.js';
import { runRetentionCleanup } from '../billing/retention.js';

export const billingRouter = new Hono<{ Variables: AuthContextVariables }>();

// ---------------------------------------------------------------------------
// 1. Get Org Billing Overview (Viewer role or above)
// ---------------------------------------------------------------------------
billingRouter.get('/orgs/:orgId/billing', requireAuth, resolveOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;

  const [org] = await db
    .select()
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);

  if (!org) {
    return c.json({ error: 'Organization not found' }, 404);
  }

  const plan = (org.plan || 'free') as PlanType;
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const orgProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.orgId, orgId));

  let analysisCount = 0;
  if (orgProjects.length > 0) {
    const projectIds = orgProjects.map((p) => p.id);
    const analysisList = await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(inArray(analyses.projectId, projectIds));
    analysisCount = analysisList.length;
  }

  const provider = getBillingProvider();
  const subscription = await provider.getSubscription(orgId);

  return c.json({
    plan,
    limits,
    usage: {
      projectCount: orgProjects.length,
      analysisCount,
    },
    subscription,
  });
});

function validateRedirectUrl(urlStr: string | undefined, defaultHash: string): string {
  if (!urlStr) {
    const base = env.APP_URL.endsWith('/') ? env.APP_URL : `${env.APP_URL}/`;
    return `${base}${defaultHash}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL format for redirect');
  }

  const appUrl = new URL(env.APP_URL);
  const isAllowedAppOrigin = parsed.origin === appUrl.origin;
  const isDevLocalhost = env.NODE_ENV !== 'production' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

  if (!isAllowedAppOrigin && !isDevLocalhost) {
    throw new Error(`Forbidden redirect URL: origin ${parsed.origin} is not allowed by APP_URL allowlist`);
  }

  return urlStr;
}

// ---------------------------------------------------------------------------
// 2. Checkout Session (Owner role only)
// ---------------------------------------------------------------------------
billingRouter.post('/orgs/:orgId/billing/checkout', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await c.req.json().catch(() => ({}));
  const { plan = 'pro', success_url, cancel_url } = body;

  if (plan !== 'pro' && plan !== 'team') {
    return c.json({ error: 'Invalid plan. Allowed plans are pro or team' }, 400);
  }

  let validSuccess: string;
  let validCancel: string;
  try {
    validSuccess = validateRedirectUrl(success_url, '#projects?billing=success');
    validCancel = validateRedirectUrl(cancel_url, '#projects?billing=canceled');
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  const provider = getBillingProvider();
  try {
    const session = await provider.createCheckoutSession({
      orgId,
      plan,
      successUrl: validSuccess,
      cancelUrl: validCancel,
    });

    return c.json({
      checkoutUrl: session.url,
      sessionId: session.sessionId,
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create checkout session' }, 400);
  }
});

// ---------------------------------------------------------------------------
// 3. Customer Portal Session (Owner role only)
// ---------------------------------------------------------------------------
billingRouter.post('/orgs/:orgId/billing/portal', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await c.req.json().catch(() => ({}));
  const { return_url } = body;

  let validReturn: string;
  try {
    validReturn = validateRedirectUrl(return_url, '#projects');
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  const provider = getBillingProvider();
  try {
    const portal = await provider.createCustomerPortalSession({
      orgId,
      returnUrl: validReturn,
    });

    return c.json({
      portalUrl: portal.url,
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create customer portal session' }, 400);
  }
});

// ---------------------------------------------------------------------------
// 4. Webhook Handler
// ---------------------------------------------------------------------------
export function verifyStripeSignature(rawPayload: string, signatureHeader: string, secret: string): void {
  if (!signatureHeader) {
    throw new Error('Missing stripe-signature header');
  }

  const parts = signatureHeader.split(',').reduce((acc, part) => {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      const k = part.substring(0, eqIdx).trim();
      const v = part.substring(eqIdx + 1).trim();
      if (k === 't') acc.t = v;
      if (k === 'v1') acc.v1.push(v);
    }
    return acc;
  }, { t: '', v1: [] as string[] });

  if (!parts.t || parts.v1.length === 0) {
    throw new Error('Invalid stripe-signature format');
  }

  const timestamp = parseInt(parts.t, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
    throw new Error('Webhook timestamp outside tolerance zone (300s)');
  }

  const signedPayload = `${parts.t}.${rawPayload}`;
  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHmac, 'utf8');
  let matched = false;
  for (const sig of parts.v1) {
    const sigBuf = Buffer.from(sig, 'utf8');
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    throw new Error('Invalid webhook signature');
  }
}

export function verifyLemonSqueezySignature(rawPayload: string, signatureHeader: string, secret: string): void {
  if (!signatureHeader) {
    throw new Error('Missing x-signature header');
  }
  const expectedHmac = crypto.createHmac('sha256', secret).update(rawPayload, 'utf8').digest('hex');
  const sigBuf = Buffer.from(signatureHeader, 'utf8');
  const expectedBuf = Buffer.from(expectedHmac, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid webhook signature');
  }
}

export function verifyRazorpaySignature(rawPayload: string, signatureHeader: string, secret: string): void {
  if (!signatureHeader) {
    throw new Error('Missing x-razorpay-signature header');
  }
  const expectedHmac = crypto.createHmac('sha256', secret).update(rawPayload, 'utf8').digest('hex');
  const sigBuf = Buffer.from(signatureHeader, 'utf8');
  const expectedBuf = Buffer.from(expectedHmac, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid webhook signature');
  }
}

billingRouter.post('/billing/webhook', async (c) => {
  const payload = await c.req.text();
  const provider = getBillingProvider();

  // Determine provider type
  let providerType = (process.env.BILLING_PROVIDER || env.BILLING_PROVIDER || 'stripe').toLowerCase();
  if (provider instanceof LemonSqueezyBillingProvider) providerType = 'lemonsqueezy';
  else if (provider instanceof RazorpayBillingProvider) providerType = 'razorpay';
  else if (c.req.header('x-signature') && !c.req.header('stripe-signature')) providerType = 'lemonsqueezy';
  else if (c.req.header('x-razorpay-signature') && !c.req.header('stripe-signature')) providerType = 'razorpay';

  let signature = '';
  if (providerType === 'lemonsqueezy' || providerType === 'lemon_squeezy') {
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || env.LEMONSQUEEZY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[Billing Webhook] LEMONSQUEEZY_WEBHOOK_SECRET is not configured; rejecting webhook (fail-closed)');
      return c.json({ error: 'Webhook secret not configured' }, 503);
    }
    signature = c.req.header('x-signature') || '';
    try {
      verifyLemonSqueezySignature(payload, signature, secret);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  } else if (providerType === 'razorpay') {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[Billing Webhook] RAZORPAY_WEBHOOK_SECRET is not configured; rejecting webhook (fail-closed)');
      return c.json({ error: 'Webhook secret not configured' }, 503);
    }
    signature = c.req.header('x-razorpay-signature') || '';
    try {
      verifyRazorpaySignature(payload, signature, secret);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  } else {
    // Stripe
    const secret = env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[Billing Webhook] STRIPE_WEBHOOK_SECRET is not configured; rejecting webhook (fail-closed)');
      return c.json({ error: 'Webhook secret not configured' }, 503);
    }
    signature = c.req.header('stripe-signature') || '';
    try {
      verifyStripeSignature(payload, signature, secret);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  }

  try {
    const result = await provider.handleWebhook(payload, signature);
    return c.json({ received: true, result });
  } catch (err: any) {
    return c.json({ error: err.message || 'Webhook processing failed' }, 400);
  }
});

// ---------------------------------------------------------------------------
// 5. Retention Cleanup Endpoint (Internal / Cron trigger)
// ---------------------------------------------------------------------------
billingRouter.post('/billing/retention', async (c) => {
  const cronSecret = env.CRON_SECRET || process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[Billing Retention] CRON_SECRET is not configured; refusing to run retention cleanup (fail-closed)');
    return c.json({ error: 'Cron secret not configured' }, 503);
  }

  const authHeader = c.req.header('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: missing or invalid Authorization header' }, 401);
  }
  const token = authHeader.substring(7).trim();
  const tokenBuf = Buffer.from(token, 'utf8');
  const secretBuf = Buffer.from(cronSecret, 'utf8');

  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return c.json({ error: 'Unauthorized: invalid cron secret' }, 401);
  }

  const report = await runRetentionCleanup();
  return c.json({ status: 'completed', report });
});
