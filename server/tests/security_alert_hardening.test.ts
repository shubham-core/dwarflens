import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { orgs, users, orgMembers } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { sendBudgetAlerts } from '../alerts/notifier.js';

describe('P2-13: Alert Hardening', () => {
  let orgId: string;
  let ownerSession: string;
  let viewerSession: string;
  let viewerEmail: string;
  let unverifiedMemberEmail: string;
  let projectId: string;
  const runId = Math.random().toString(36).substring(7);

  beforeAll(async () => {
    // 1. Create owner
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `alert-owner-${runId}@example.com`,
        name: 'Alert Owner',
        orgName: `Alert Hardening Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    orgId = (await meRes.json()).orgs[0].orgId;

    // Upgrade org to pro so alerts feature is allowed
    await db.update(orgs).set({ plan: 'pro' }).where(eq(orgs.id, orgId));

    // 2. Create Project
    const projRes = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'Alerts Test Project',
        slug: `proj-alert-${runId}`,
        repo: `shubham-core/alert-${runId}`,
      }),
    });
    projectId = (await projRes.json()).project.id;

    // 3. Create a viewer user
    viewerEmail = `alert-viewer-${runId}@example.com`;
    const viewerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: viewerEmail,
        name: 'Alert Viewer',
      }),
    });
    viewerSession = (await viewerRes.json()).sessionId;

    // Get viewer user id
    const viewerMe = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${viewerSession}` },
    });
    const viewerUserId = (await viewerMe.json()).user.id;

    // Add viewer to org
    await db.insert(orgMembers).values({
      orgId,
      userId: viewerUserId,
      role: 'viewer',
    });

    // 4. Create an unverified member user
    unverifiedMemberEmail = `unverified-${runId}@example.com`;
    const [unverifiedUser] = await db
      .insert(users)
      .values({
        email: unverifiedMemberEmail,
        name: 'Unverified Member',
        emailVerified: false,
      })
      .returning();

    await db.insert(orgMembers).values({
      orgId,
      userId: unverifiedUser.id,
      role: 'member',
    });
  });

  it('rejects invalid Slack webhook URLs that do not match https://hooks.slack.com/services/*', async () => {
    const evilRes = await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        slack_webhook_url: 'https://attacker.evil.com/services/hook',
      }),
    });
    expect(evilRes.status).toBe(400);

    const httpRes = await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        slack_webhook_url: 'http://hooks.slack.com/services/T00/B00/X00',
      }),
    });
    expect(httpRes.status).toBe(400);
  });

  it('allows valid Slack webhook URLs matching https://hooks.slack.com/services/*', async () => {
    const validRes = await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        slack_webhook_url: 'https://hooks.slack.com/services/T00/B00/test_mock_hook_123',
      }),
    });
    expect(validRes.status).toBe(200);
    const data = await validRes.json();
    expect(data.alerts.has_slack_webhook).toBe(true);
  });

  it('rejects alert email if address does not belong to an org member', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: 'outsider@randomdomain.com',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects alert email if org member email is unverified', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: unverifiedMemberEmail,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('allows alert email if org member is verified', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: viewerEmail,
      }),
    });
    expect(res.status).toBe(200);
  });

  it('hides slack_webhook_url from viewers on GET /projects/:id and returns has_slack_webhook', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}`, {
      headers: {
        Cookie: `dwarflens_session=${viewerSession}`,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.settings?.alerts?.slack_webhook_url).toBeUndefined();
    expect(data.project.settings?.alerts?.has_slack_webhook).toBe(true);
  });

  it('hides slack_webhook_url from viewers on GET /orgs/:orgId/projects', async () => {
    const res = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      headers: {
        Cookie: `dwarflens_session=${viewerSession}`,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const proj = data.projects.find((p: any) => p.id === projectId);
    expect(proj.settings?.alerts?.slack_webhook_url).toBeUndefined();
    expect(proj.settings?.alerts?.has_slack_webhook).toBe(true);
  });

  it('reveals slack_webhook_url to owners on GET /projects/:id', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}`, {
      headers: {
        Cookie: `dwarflens_session=${ownerSession}`,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project.settings?.alerts?.slack_webhook_url).toBe(
      'https://hooks.slack.com/services/T00/B00/test_mock_hook_123'
    );
    expect(data.project.settings?.alerts?.has_slack_webhook).toBe(true);
  });
});
