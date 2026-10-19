import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';

describe('Shareable Report Links API', () => {
  let sessionOwner: string;
  let sessionViewer: string;
  let orgId: string;
  let projectId: string;
  let analysisId: string;
  let shareToken: string;

  beforeAll(async () => {
    const runId = Math.random().toString(36).substring(7);

    // 1. Create Owner User and Org
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `owner-${runId}@example.com`, name: 'Owner', orgName: `Share Org ${runId}` }),
    });
    const ownerData = await ownerRes.json();
    sessionOwner = ownerData.sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${sessionOwner}` },
    });
    const meData = await meRes.json();
    orgId = meData.orgs[0].orgId;

    // 2. Create Project
    const projRes = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionOwner}`,
      },
      body: JSON.stringify({
        name: 'Share Target',
        slug: `share-target-${runId}`,
        repo: `test-org/share-target-${runId}`,
      }),
    });
    projectId = (await projRes.json()).project.id;

    // 3. Create API Key and Ingest an Analysis
    const keyRes = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionOwner}`,
      },
      body: JSON.stringify({ name: 'CI Key', projectId }),
    });
    const rawApiKey = (await keyRes.json()).rawKey;

    const ingestRes = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'shared_app',
        file_size: 204800,
        format: 'ELF',
        flash_size: 102400,
        ram_size: 32768,
        metadata: {
          commit_sha: 'commit-share-999',
          branch: 'main',
        },
        sections: [{ name: '.text', category: 'code', size: 100000 }],
        symbols: [{ name: 'main', size: 120, type: 'FUNC' }],
        structs: [
          {
            name: 'SharedStruct',
            byte_size: 32,
            alignment: 8,
            total_padding_bytes: 0,
            cache_lines_spanned: 1,
            has_padding: false,
            has_cache_line_crossing: false,
            members: [],
            padding_holes: [],
            cache_line_crossings: [],
            optimal: null,
          },
        ],
      }),
    });
    analysisId = (await ingestRes.json()).id;

    // 4. Create Viewer User
    const viewerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `viewer-${runId}@example.com`, name: 'Viewer' }),
    });
    sessionViewer = (await viewerRes.json()).sessionId;
  });

  it('allows owner to generate a public share link', async () => {
    const res = await app.request(`/api/v1/analyses/${analysisId}/share`, {
      method: 'POST',
      headers: { Cookie: `dwarflens_session=${sessionOwner}` },
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.token).toBeDefined();
    expect(data.url).toContain(data.token);
    shareToken = data.token;
  });

  it('allows anyone to access public report via GET /api/v1/shared/:token without login', async () => {
    // Completely unauthenticated request — no headers, no cookies
    const res = await app.request(`/api/v1/shared/${shareToken}`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.analysis).toBeDefined();
    expect(data.analysis.id).toBe(analysisId);
    expect(data.analysis.rawData.filename).toBe('shared_app');
    expect(data.project.name).toBe('Share Target');
  });

  it('prevents non-owners from generating or revoking share links', async () => {
    const createRes = await app.request(`/api/v1/analyses/${analysisId}/share`, {
      method: 'POST',
      headers: { Cookie: `dwarflens_session=${sessionViewer}` },
    });
    expect(createRes.status).toBe(403);

    const deleteRes = await app.request(`/api/v1/analyses/${analysisId}/share`, {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${sessionViewer}` },
    });
    expect(deleteRes.status).toBe(403);
  });

  it('allows owner to revoke a public share link', async () => {
    const res = await app.request(`/api/v1/analyses/${analysisId}/share`, {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${sessionOwner}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('revoked');

    // Accessing revoked link now returns 404
    const checkRes = await app.request(`/api/v1/shared/${shareToken}`);
    expect(checkRes.status).toBe(404);
  });
});
