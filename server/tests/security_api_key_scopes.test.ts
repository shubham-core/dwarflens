import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { orgs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('P2-12: API Key Scopes & Project-Scoped Key Enforcement', () => {
  let orgId: string;
  let ownerSession: string;
  let projectAId: string;
  let projectBId: string;
  let apiKeyA: string;
  const runId = Math.random().toString(36).substring(7);

  beforeAll(async () => {
    // 1. Create owner and org
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `apikey-owner-${runId}@example.com`,
        name: 'API Key Owner',
        orgName: `Scope Test Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    orgId = (await meRes.json()).orgs[0].orgId;

    // Upgrade to pro for multiple projects
    await db.update(orgs).set({ plan: 'pro' }).where(eq(orgs.id, orgId));

    // 2. Create Project A
    const pARes = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'Project Alpha',
        slug: `proj-alpha-${runId}`,
        repo: `shubham-core/alpha-${runId}`,
      }),
    });
    projectAId = (await pARes.json()).project.id;

    // 3. Create Project B
    const pBRes = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'Project Beta',
        slug: `proj-beta-${runId}`,
        repo: `shubham-core/beta-${runId}`,
      }),
    });
    projectBId = (await pBRes.json()).project.id;

    // 4. Create CI API Key scoped to Project A
    const keyRes = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'CI Scoped Key Alpha',
        projectId: projectAId,
      }),
    });
    const keyData = await keyRes.json();
    apiKeyA = keyData.rawKey;
    expect(keyData.apiKey.scopes).toBeDefined();
    expect(keyData.apiKey.scopes).toContain('ingest:write');
  });

  it('allows CI key to ingest analysis into its scoped Project A', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectAId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'firmware.elf',
        file_size: 1024,
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-alpha-1',
          branch: 'main',
          build_name: 'release',
        },
        sections: [],
        symbols: [],
        structs: [],
      }),
    });

    expect(res.status).toBe(201);
  });

  it('rejects CI key from ingesting analysis into a different Project B (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectBId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'firmware.elf',
        file_size: 1024,
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-beta-1',
          branch: 'main',
          build_name: 'release',
        },
        sections: [],
        symbols: [],
        structs: [],
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/scoped to a different project|not authorized/i);
  });

  it('rejects CI key from deleting project (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/projects/${projectAId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKeyA}`,
      },
    });

    expect(res.status).toBe(403);
  });

  it('rejects CI key from modifying budgets (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/projects/${projectAId}/budgets`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        max_total_size: 200000,
      }),
    });

    expect(res.status).toBe(403);
  });

  it('rejects CI key from managing members (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        email: 'hacker@example.com',
        role: 'owner',
      }),
    });

    expect(res.status).toBe(403);
  });

  it('rejects CI key from managing keys (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        name: 'Escalated Key',
      }),
    });

    expect(res.status).toBe(403);
  });

  it('rejects CI key from managing billing (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgId}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKeyA}`,
      },
      body: JSON.stringify({
        plan: 'team',
      }),
    });

    expect(res.status).toBe(403);
  });
});
