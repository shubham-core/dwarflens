import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { db } from '../src/db/client.js';
import { orgs } from '../src/db/schema.js';

describe('Project Budget Alerts (Email & Slack)', () => {
  let sessionOwner: string;
  let orgId: string;
  let projectId: string;
  let rawApiKey: string;
  const ownerEmail = `alert-owner-${Math.random().toString(36).substring(7)}@example.com`;

  const fetchCalls: { url: string; options?: RequestInit }[] = [];

  beforeAll(async () => {
    const runId = Math.random().toString(36).substring(7);

    // 1. Create Owner User and Org
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, name: 'Alert Owner', orgName: `Alert Org ${runId}` }),
    });
    const ownerData = await ownerRes.json();
    sessionOwner = ownerData.sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${sessionOwner}` },
    });
    const meData = await meRes.json();
    orgId = meData.orgs[0].orgId;

    // Alerts require a paid plan
    await db.update(orgs).set({ plan: 'pro' }).where(eq(orgs.id, orgId));

    // 2. Create Project
    const projRes = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionOwner}`,
      },
      body: JSON.stringify({
        name: 'Alert Monitored Binary',
        slug: `alert-bin-${runId}`,
        repo: `test-org/alert-bin-${runId}`,
      }),
    });
    projectId = (await projRes.json()).project.id;

    // 3. Create API Key
    const keyRes = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionOwner}`,
      },
      body: JSON.stringify({ name: 'CI Ingest Key', projectId }),
    });
    rawApiKey = (await keyRes.json()).rawKey;

    // 4. Set budget on project: max size 100,000 bytes
    await app.request(`/api/v1/projects/${projectId}/budgets`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionOwner}`,
      },
      body: JSON.stringify({
        max_total_size: 100000,
      }),
    });
  });

  beforeEach(() => {
    fetchCalls.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({ url, options: init });
      return new Response(JSON.stringify({ ok: true, id: 'mock_resp_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('configures alerts via PUT /api/v1/projects/:id/alerts', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionOwner}`,
      },
      body: JSON.stringify({
        slack_webhook_url: 'https://hooks.slack.com/services/T00/B00/XXXX',
        email: 'custom-alerts@example.com',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.alerts.slack_webhook_url).toBe('https://hooks.slack.com/services/T00/B00/XXXX');
    expect(data.alerts.email).toBe('custom-alerts@example.com');
  });

  function makeAnalysis(commitSha: string, branch: string, fileSize: number) {
    return {
      schema_version: 1,
      filename: 'firmware.elf',
      file_size: fileSize,
      format: 'ELF',
      metadata: {
        commit_sha: commitSha,
        branch: branch,
        build_name: 'release',
      },
      sections: [{ name: '.text', category: 'code', size: fileSize }],
      symbols: [{ name: 'main', size: 100, type: 'FUNC' }],
      structs: [],
    };
  }

  it('does NOT trigger alerts when analysis budget passes on main branch', async () => {
    // 50,000 bytes is within 100,000 limit
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify(makeAnalysis('commit-pass-alerts-001', 'main', 50000)),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.budget_status.passed).toBe(true);
    expect(fetchCalls.length).toBe(0);
  });

  it('does NOT trigger alerts when analysis budget fails on a feature branch', async () => {
    // 250,000 bytes exceeds 100,000 limit, but branch is feature/new-stuff
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify(makeAnalysis('commit-fail-feature-002', 'feature/new-stuff', 250000)),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.budget_status.passed).toBe(false);
    expect(fetchCalls.length).toBe(0);
  });

  it('triggers Slack and Resend email alerts when budget fails on main branch', async () => {
    // Temporarily mock RESEND_API_KEY
    const origResendKey = env.RESEND_API_KEY;
    (env as any).RESEND_API_KEY = 're_test_mock_key';

    try {
      const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rawApiKey}`,
        },
        body: JSON.stringify(makeAnalysis('commit-fail-main-003', 'main', 350000)),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.budget_status.passed).toBe(false);

      // Verify Slack call
      const slackCall = fetchCalls.find((c) => c.url.includes('hooks.slack.com'));
      expect(slackCall).toBeDefined();
      const slackBody = JSON.parse(slackCall?.options?.body as string);
      expect(slackBody.text).toContain('DwarfLens Budget Violation Detected');
      expect(slackBody.text).toContain('exceeds project max total size budget');

      // Verify Resend email call
      const resendCall = fetchCalls.find((c) => c.url.includes('api.resend.com/emails'));
      expect(resendCall).toBeDefined();
      const resendHeaders = resendCall?.options?.headers as Record<string, string>;
      expect(resendHeaders.Authorization).toBe('Bearer re_test_mock_key');
      const emailPayload = JSON.parse(resendCall?.options?.body as string);
      expect(emailPayload.to).toContain('custom-alerts@example.com');
      expect(emailPayload.subject).toContain('❌ DwarfLens Budget Failed: Alert Monitored Binary (main)');
    } finally {
      (env as any).RESEND_API_KEY = origResendKey;
    }
  });

  it('falls back to org owner email if custom email is not set in project alerts', async () => {
    // Clear custom email in project alerts
    await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionOwner}`,
      },
      body: JSON.stringify({
        slack_webhook_url: '',
        email: '',
      }),
    });

    const origResendKey = env.RESEND_API_KEY;
    (env as any).RESEND_API_KEY = 're_test_mock_key';

    try {
      const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rawApiKey}`,
        },
        body: JSON.stringify(makeAnalysis('commit-fail-main-004', 'main', 400000)),
      });

      expect(res.status).toBe(201);
      const resendCall = fetchCalls.find((c) => c.url.includes('api.resend.com/emails'));
      expect(resendCall).toBeDefined();
      const emailPayload = JSON.parse(resendCall?.options?.body as string);
      expect(emailPayload.to).toContain(ownerEmail);
    } finally {
      (env as any).RESEND_API_KEY = origResendKey;
    }
  });

});
