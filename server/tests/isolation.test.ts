import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { apiKeys } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('Tenant Isolation and Security Suite', () => {
  let sessionA: string;
  let userA: any;
  let orgA: any;
  let projectA: any;
  let rawKeyA: string;
  let apiKeyIdA: string;

  let sessionB: string;
  let userB: any;
  let orgB: any;
  let projectB: any;
  let rawKeyB: string;
  let apiKeyIdB: string;

  beforeAll(async () => {
    // 1. Create User A, Org A, Project A, API Key A
    const loginARes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user-a@example.com', name: 'User A', orgName: 'Org A' }),
    });
    expect(loginARes.status).toBe(200);
    const loginAData = await loginARes.json();
    userA = loginAData.user;
    sessionA = loginAData.sessionId;

    const meARes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${sessionA}` },
    });
    const meAData = await meARes.json();
    orgA = { id: meAData.orgs[0].orgId, name: meAData.orgs[0].orgName };

    const projARes = await app.request(`/api/v1/orgs/${orgA.id}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionA}`,
      },
      body: JSON.stringify({
        name: 'Project Alpha',
        slug: 'alpha',
        repo: 'shubham-core/alpha',
      }),
    });
    expect(projARes.status).toBe(201);
    projectA = (await projARes.json()).project;

    const keyARes = await app.request(`/api/v1/orgs/${orgA.id}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionA}`,
      },
      body: JSON.stringify({ name: 'CI Key A', projectId: projectA.id }),
    });
    expect(keyARes.status).toBe(201);
    const keyAData = await keyARes.json();
    rawKeyA = keyAData.rawKey;
    apiKeyIdA = keyAData.apiKey.id;

    // 2. Create User B, Org B, Project B, API Key B
    const loginBRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user-b@example.com', name: 'User B', orgName: 'Org B' }),
    });
    expect(loginBRes.status).toBe(200);
    const loginBData = await loginBRes.json();
    userB = loginBData.user;
    sessionB = loginBData.sessionId;

    const meBRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${sessionB}` },
    });
    const meBData = await meBRes.json();
    orgB = { id: meBData.orgs[0].orgId, name: meBData.orgs[0].orgName };

    const projBRes = await app.request(`/api/v1/orgs/${orgB.id}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionB}`,
      },
      body: JSON.stringify({
        name: 'Project Beta',
        slug: 'beta',
        repo: 'shubham-core/beta',
      }),
    });
    expect(projBRes.status).toBe(201);
    projectB = (await projBRes.json()).project;

    const keyBRes = await app.request(`/api/v1/orgs/${orgB.id}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionB}`,
      },
      body: JSON.stringify({ name: 'CI Key B', projectId: projectB.id }),
    });
    expect(keyBRes.status).toBe(201);
    const keyBData = await keyBRes.json();
    rawKeyB = keyBData.rawKey;
    apiKeyIdB = keyBData.apiKey.id;
  });

  it('allows User A to access their own Org A projects', async () => {
    const res = await app.request(`/api/v1/orgs/${orgA.id}/projects`, {
      headers: { Cookie: `dwarflens_session=${sessionA}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.projects).toBeInstanceOf(Array);
    expect(data.projects.some((p: any) => p.id === projectA.id)).toBe(true);
  });

  it('prevents User A from reading Org B projects (returns 403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgB.id}/projects`, {
      headers: { Cookie: `dwarflens_session=${sessionA}` },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Forbidden');
  });

  it('prevents User B from reading Org A projects (returns 403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgA.id}/projects`, {
      headers: { Cookie: `dwarflens_session=${sessionB}` },
    });
    expect(res.status).toBe(403);
  });

  it('prevents User A from reading Project B directly by ID (returns 403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: { Cookie: `dwarflens_session=${sessionA}` },
    });
    expect(res.status).toBe(403);
  });

  it('prevents User B from reading Project A directly by ID (returns 403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: { Cookie: `dwarflens_session=${sessionB}` },
    });
    expect(res.status).toBe(403);
  });

  it('prevents User A from creating a project in Org B (returns 403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgB.id}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionA}`,
      },
      body: JSON.stringify({
        name: 'Malicious Project',
        slug: 'malicious',
        repo: 'attacker/repo',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('prevents User A from accessing or creating API keys in Org B (returns 403 Forbidden)', async () => {
    const listRes = await app.request(`/api/v1/orgs/${orgB.id}/keys`, {
      headers: { Cookie: `dwarflens_session=${sessionA}` },
    });
    expect(listRes.status).toBe(403);

    const createRes = await app.request(`/api/v1/orgs/${orgB.id}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionA}`,
      },
      body: JSON.stringify({ name: 'Malicious Key' }),
    });
    expect(createRes.status).toBe(403);
  });

  it('prevents User A from revoking Org B API keys (returns 403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgB.id}/keys/${apiKeyIdB}`, {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${sessionA}` },
    });
    expect(res.status).toBe(403);
  });

  it('verifies API keys are stored only as SHA-256 hashes in database', async () => {
    const [storedKey] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, apiKeyIdA))
      .limit(1);

    expect(storedKey).toBeDefined();
    // Raw key should NOT match stored value
    expect(storedKey.keyHash).not.toBe(rawKeyA);
    // Hash length should be 64 characters (SHA-256 hex string)
    expect(storedKey.keyHash).toHaveLength(64);
    // Prefix should be visible short snippet
    expect(storedKey.prefix).toBeDefined();
    expect(rawKeyA.startsWith(storedKey.prefix.replace('...', ''))).toBe(true);
  });

  it('allows API Key A to access Project A but prevents access to Project B', async () => {
    // Valid access to Project A
    const resA = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: { Authorization: `Bearer ${rawKeyA}` },
    });
    expect(resA.status).toBe(200);

    // Cross-tenant access to Project B
    const resB = await app.request(`/api/v1/projects/${projectB.id}`, {
      headers: { Authorization: `Bearer ${rawKeyA}` },
    });
    expect(resB.status).toBe(403);
  });

  it('rejects revoked API keys', async () => {
    // Revoke key A
    const revokeRes = await app.request(`/api/v1/orgs/${orgA.id}/keys/${apiKeyIdA}`, {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${sessionA}` },
    });
    expect(revokeRes.status).toBe(200);

    // Try using key A now
    const tryRes = await app.request(`/api/v1/projects/${projectA.id}`, {
      headers: { Authorization: `Bearer ${rawKeyA}` },
    });
    expect(tryRes.status).toBe(401);
  });
});
