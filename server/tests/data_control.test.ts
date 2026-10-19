import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';

describe('Data Control & Privacy Suite (Delete Project & Delete Account)', () => {
  let ownerSession: string;
  let memberSession: string;
  let orgId: string;
  let projectId: string;
  let analysisId: string;
  let rawApiKey: string;

  beforeAll(async () => {
    const runId = Math.random().toString(36).substring(7);

    // 1. Create Org and Owner
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `datacontrol-owner-${runId}@example.com`,
        name: 'DataControl Owner',
        orgName: `DataControl Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    orgId = (await meRes.json()).orgs[0].orgId;

    // 2. Create Member user
    const memberLogin = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `datacontrol-member-${runId}@example.com`,
        name: 'DataControl Member',
      }),
    });
    memberSession = (await memberLogin.json()).sessionId;

    // Add member to org
    const memberEmail = `datacontrol-member-${runId}@example.com`;
    await app.request(`/api/v1/orgs/${orgId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({ email: memberEmail, role: 'member' }),
    });

    // 3. Create Project
    const projRes = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'Project To Delete',
        slug: `proj-delete-${runId}`,
        repo: `org/proj-delete-${runId}`,
      }),
    });
    projectId = (await projRes.json()).project.id;

    // 4. Create API Key for project
    const keyRes = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({ name: 'Project Key', projectId }),
    });
    rawApiKey = (await keyRes.json()).rawKey;

    // 5. Ingest an analysis
    const ingestRes = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'firmware.elf',
        file_size: 120000,
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-del-001',
          branch: 'main',
        },
        sections: [{ name: '.text', category: 'code', size: 100000 }],
        symbols: [{ name: 'main', size: 64, type: 'FUNC' }],
        structs: [],
      }),
    });
    analysisId = (await ingestRes.json()).id;
  });

  // --- Project Deletion ---

  it('forbids members from deleting a project (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}`, {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${memberSession}` },
    });
    expect(res.status).toBe(403);
  });

  it('allows organization owner to delete a project and cascades data cleanup', async () => {
    // Owner deletes project
    const deleteRes = await app.request(`/api/v1/projects/${projectId}`, {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    expect(deleteRes.status).toBe(200);
    const body = await deleteRes.json();
    expect(body.status).toBe('deleted');
    expect(body.id).toBe(projectId);

    // Verify project is gone (404)
    const getProj = await app.request(`/api/v1/projects/${projectId}`, {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    expect(getProj.status).toBe(404);

    // Verify cascaded analysis is gone (404)
    const getAnalysis = await app.request(`/api/v1/analyses/${analysisId}`, {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    expect(getAnalysis.status).toBe(404);
  });

  // --- Account Deletion ---

  it('requires authentication to delete account', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('allows user to permanently delete account and clears sessions', async () => {
    // Create dedicated user to delete
    const tempEmail = `delete-me-${Math.random().toString(36).substring(7)}@example.com`;
    const loginRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: tempEmail, name: 'To Be Deleted' }),
    });
    const tempSession = (await loginRes.json()).sessionId;

    // Verify authenticated before deletion
    const meBefore = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${tempSession}` },
    });
    expect(meBefore.status).toBe(200);

    // Delete account
    const deleteAccountRes = await app.request('/api/v1/auth/me', {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${tempSession}` },
    });
    expect(deleteAccountRes.status).toBe(200);
    expect((await deleteAccountRes.json()).status).toBe('deleted');

    // Verify cookie was cleared
    const setCookie = deleteAccountRes.headers.get('set-cookie');
    expect(setCookie).toContain('dwarflens_session=');

    // Verify session is invalidated (401 Unauthorized)
    const meAfter = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${tempSession}` },
    });
    expect(meAfter.status).toBe(401);
  });
});
