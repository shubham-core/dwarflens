import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { orgs, projects, analyses } from '../db/schema.js';
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
billingRouter.post('/billing/webhook', async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header('stripe-signature') || '';

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
  const report = await runRetentionCleanup();
  return c.json({ status: 'completed', report });
});
