import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { orgs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('P1-10: Server-side Plan Limits Enforcement', () => {
  let freeOrgId: string;
  let ownerSession: string;
  let freeProjectId: string;

  beforeAll(async () => {
    const runId = Math.random().toString(36).substring(7);

    // 1. Create Free Org & Owner
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `plan-owner-${runId}@example.com`,
        name: 'Plan Owner',
        orgName: `Free Limits Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    freeOrgId = (await meRes.json()).orgs[0].orgId;

    // Create 1 project on free plan
    const projRes = await app.request(`/api/v1/orgs/${freeOrgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'Free Alert Test Project',
        slug: `free-alert-proj-${runId}`,
        repo: 'shubham-core/alert-test',
      }),
    });
    const projData = await projRes.json();
    freeProjectId = projData.project.id;
  });

  it('rejects configuring alerts on Free plan (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/projects/${freeProjectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        slack_webhook_url: 'https://hooks.slack.com/services/T00/B00/XXXX',
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/plan limit|paid plan|pro/i);
  });

  it('returns "unlimited" as string instead of null/Infinity in billing overview for Pro plan', async () => {
    // Upgrade org to Pro
    await db.update(orgs).set({ plan: 'pro' }).where(eq(orgs.id, freeOrgId));

    const res = await app.request(`/api/v1/orgs/${freeOrgId}/billing`, {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.plan).toBe('pro');
    expect(data.limits.maxProjects).toBe('unlimited');
    expect(data.limits.maxProjects).not.toBeNull();
    expect(data.limits.allowAlerts).toBe(true);

    // Verify alerts can now be configured on Pro plan
    const alertRes = await app.request(`/api/v1/projects/${freeProjectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        slack_webhook_url: 'https://hooks.slack.com/services/T00/B00/XXXX',
      }),
    });
    expect(alertRes.status).toBe(200);
  });
});
