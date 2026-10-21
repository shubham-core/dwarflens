import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { db } from '../src/db/client.js';
import { orgs, projects, analyses } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { runRetentionCleanup } from '../src/billing/retention.js';

describe('Billing, Plan Limits & Data Retention Suite', () => {
  let freeOrgId: string;
  let ownerSession: string;
  let firstProjectId: string;

  beforeAll(async () => {
    const runId = Math.random().toString(36).substring(7);

    // 1. Create Free Org & Owner
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `billing-owner-${runId}@example.com`,
        name: 'Billing Owner',
        orgName: `Free Tier Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    freeOrgId = (await meRes.json()).orgs[0].orgId;
  });

  it('allows Free plan to create 1 project, but blocks the 2nd project (403 Forbidden)', async () => {
    // 1st project creation -> succeeds (201)
    const res1 = await app.request(`/api/v1/orgs/${freeOrgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'Free Project 1',
        slug: `free-proj-1-${Date.now().toString(36)}`,
        repo: 'shubham-core/free-proj-1',
      }),
    });

    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    firstProjectId = body1.project.id;
    expect(firstProjectId).toBeDefined();

    // 2nd project creation -> rejected (403)
    const res2 = await app.request(`/api/v1/orgs/${freeOrgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'Free Project 2',
        slug: `free-proj-2-${Date.now().toString(36)}`,
        repo: 'shubham-core/free-proj-2',
      }),
    });

    expect(res2.status).toBe(403);
    const body2 = await res2.json();
    expect(body2.error).toContain('Plan limit reached');
    expect(body2.plan).toBe('free');
  });

  it('rejects private repository creation on Free plan', async () => {
    const runId = Math.random().toString(36).substring(7);

    // Create a new org on Free plan with 0 projects
    const tempRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `private-test-${runId}@example.com`,
        name: 'Private Tester',
        orgName: `Private Org ${runId}`,
      }),
    });
    const tempSession = (await tempRes.json()).sessionId;
    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${tempSession}` },
    });
    const tempOrgId = (await meRes.json()).orgs[0].orgId;

    // Attempt to create private project on free tier
    const resPrivate = await app.request(`/api/v1/orgs/${tempOrgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${tempSession}`,
      },
      body: JSON.stringify({
        name: 'Private Project',
        slug: `private-proj-${runId}`,
        repo: 'shubham-core/secret-repo',
        is_private: true,
      }),
    });

    expect(resPrivate.status).toBe(403);
    const data = await resPrivate.json();
    expect(data.error).toContain('Private repositories are not allowed');
  });

  it('returns billing overview with plan, limits, and usage via GET /api/v1/orgs/:id/billing', async () => {
    const res = await app.request(`/api/v1/orgs/${freeOrgId}/billing`, {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.plan).toBe('free');
    expect(data.limits.maxProjects).toBe(1);
    expect(data.limits.allowPrivateRepos).toBe(false);
    expect(data.limits.retentionDays).toBe(30);
    expect(data.usage.projectCount).toBe(1);
    expect(data.subscription.status).toBe('active');
  });

  it('creates checkout session and customer portal sessions', async () => {
    // Checkout session
    const checkoutRes = await app.request(`/api/v1/orgs/${freeOrgId}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({ plan: 'pro' }),
    });

    expect(checkoutRes.status).toBe(200);
    const checkoutData = await checkoutRes.json();
    expect(checkoutData.checkoutUrl).toBeDefined();
    expect(checkoutData.sessionId).toBeDefined();

    // Portal session
    const portalRes = await app.request(`/api/v1/orgs/${freeOrgId}/billing/portal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({ return_url: 'http://localhost:5173/#projects' }),
    });

    expect(portalRes.status).toBe(200);
    const portalData = await portalRes.json();
    expect(portalData.portalUrl).toContain('portal_session=');
  });

  it('handles Stripe webhooks to upgrade and downgrade organization plan', async () => {
    const testSecret = 'whsec_test_secret_for_billing_tests';
    const origSecret = env.STRIPE_WEBHOOK_SECRET;
    (env as any).STRIPE_WEBHOOK_SECRET = testSecret;

    const signPayload = (payload: string) => {
      const t = Math.floor(Date.now() / 1000);
      const hmac = crypto.createHmac('sha256', testSecret).update(`${t}.${payload}`, 'utf8').digest('hex');
      return `t=${t},v1=${hmac}`;
    };

    try {
      // 1. Webhook checkout.session.completed upgrades org to Pro
      const upgradeBody = JSON.stringify({
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: freeOrgId,
            metadata: {
              org_id: freeOrgId,
              plan: 'pro',
            },
          },
        },
      });

      const upgradeWebhook = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signPayload(upgradeBody),
        },
        body: upgradeBody,
      });

      expect(upgradeWebhook.status).toBe(200);

      // Verify org is now on 'pro'
      const [updatedOrg] = await db
        .select({ plan: orgs.plan })
        .from(orgs)
        .where(eq(orgs.id, freeOrgId));
      expect(updatedOrg.plan).toBe('pro');

      // Pro plan now allows creating a 2nd project!
      const resProProj = await app.request(`/api/v1/orgs/${freeOrgId}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `dwarflens_session=${ownerSession}`,
        },
        body: JSON.stringify({
          name: 'Pro Second Project',
          slug: `pro-proj-2-${Date.now().toString(36)}`,
          repo: 'shubham-core/pro-proj-2',
          is_private: true, // Pro allows private repos too
        }),
      });
      expect(resProProj.status).toBe(201);

      // 2. Webhook customer.subscription.deleted downgrades org back to Free
      const cancelBody = JSON.stringify({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            metadata: {
              org_id: freeOrgId,
            },
          },
        },
      });

      const cancelWebhook = await app.request('/api/v1/billing/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signPayload(cancelBody),
        },
        body: cancelBody,
      });

      expect(cancelWebhook.status).toBe(200);

      const [downgradedOrg] = await db
        .select({ plan: orgs.plan })
        .from(orgs)
        .where(eq(orgs.id, freeOrgId));
      expect(downgradedOrg.plan).toBe('free');
    } finally {
      (env as any).STRIPE_WEBHOOK_SECRET = origSecret;
    }
  });

  it('runs retention cleanup, pruning Free tier analyses older than 30 days', async () => {
    const now = new Date();
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    // Insert an old analysis (40 days ago) for Free org project
    const [oldAnalysis] = await db
      .insert(analyses)
      .values({
        projectId: firstProjectId,
        commitSha: 'commit-ancient-40d',
        branch: 'main',
        buildName: 'default',
        totalSize: 500000,
        flashSize: 400000,
        ramSize: 100000,
        structCount: 10,
        symbolCount: 50,
        paddingBytes: 128,
        cacheLineCrossings: 2,
        rawData: { schema_version: 1 },
        createdAt: fortyDaysAgo,
      })
      .returning();

    // Insert a recent analysis (10 days ago) for Free org project
    const [recentAnalysis] = await db
      .insert(analyses)
      .values({
        projectId: firstProjectId,
        commitSha: 'commit-recent-10d',
        branch: 'main',
        buildName: 'default',
        totalSize: 510000,
        flashSize: 410000,
        ramSize: 100000,
        structCount: 10,
        symbolCount: 50,
        paddingBytes: 128,
        cacheLineCrossings: 2,
        rawData: { schema_version: 1 },
        createdAt: tenDaysAgo,
      })
      .returning();

    // Execute retention cleanup
    const report = await runRetentionCleanup(now);
    expect(report.freeAnalysesDeleted).toBeGreaterThanOrEqual(1);

    // Verify old analysis is deleted
    const [checkOld] = await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.id, oldAnalysis.id));
    expect(checkOld).toBeUndefined();

    // Verify recent analysis is still present
    const [checkRecent] = await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(eq(analyses.id, recentAnalysis.id));
    expect(checkRecent).toBeDefined();

    // Trigger via HTTP retention endpoint
    const httpRes = await app.request('/api/v1/billing/retention', {
      method: 'POST',
    });
    expect(httpRes.status).toBe(200);
    const httpData = await httpRes.json();
    expect(httpData.status).toBe('completed');
  });
});
