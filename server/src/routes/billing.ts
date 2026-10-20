import { Hono } from 'hono';
import crypto from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { orgs, projects, analyses } from '../db/schema.js';
import { env } from '../env.js';
import { AuthContextVariables, requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org.js';
import { getBillingProvider } from '../billing/provider.js';
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

  const defaultSuccess = success_url || `http://localhost:5173/#projects?billing=success`;
  const defaultCancel = cancel_url || `http://localhost:5173/#projects?billing=canceled`;

  const provider = getBillingProvider();
  const session = await provider.createCheckoutSession({
    orgId,
    plan,
    successUrl: defaultSuccess,
    cancelUrl: defaultCancel,
  });

  return c.json({
    checkoutUrl: session.url,
    sessionId: session.sessionId,
  });
});

// ---------------------------------------------------------------------------
// 3. Customer Portal Session (Owner role only)
// ---------------------------------------------------------------------------
billingRouter.post('/orgs/:orgId/billing/portal', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;
  const body = await c.req.json().catch(() => ({}));
  const { return_url } = body;

  const defaultReturn = return_url || `http://localhost:5173/#projects`;

  const provider = getBillingProvider();
  const portal = await provider.createCustomerPortalSession({
    orgId,
    returnUrl: defaultReturn,
  });

  return c.json({
    portalUrl: portal.url,
  });
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

billingRouter.post('/billing/webhook', async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header('stripe-signature') || '';

  if (env.STRIPE_WEBHOOK_SECRET) {
    try {
      verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  } else {
    console.warn('[Billing Webhook] STRIPE_WEBHOOK_SECRET is not set; skipping signature verification');
  }

  const provider = getBillingProvider();
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
  if (env.CRON_SECRET) {
    const authHeader = c.req.header('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized: missing or invalid Authorization header' }, 401);
    }
    const token = authHeader.substring(7).trim();
    const tokenBuf = Buffer.from(token, 'utf8');
    const secretBuf = Buffer.from(env.CRON_SECRET, 'utf8');

    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return c.json({ error: 'Unauthorized: invalid cron secret' }, 401);
    }
  } else {
    console.warn('[Billing Retention] CRON_SECRET is not set; running without authentication');
  }

  const report = await runRetentionCleanup();
  return c.json({ status: 'completed', report });
});
