import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';

describe('Project Budgets and Evaluation API', () => {
  let sessionOwner: string;
  let orgId: string;
  let projectId: string;
  let rawApiKey: string;

  beforeAll(async () => {
    const runId = Math.random().toString(36).substring(7);

    // 1. Create Owner User and Org
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `budget-owner-${runId}@example.com`, name: 'Budget Owner', orgName: `Budget Org ${runId}` }),
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
        name: 'Budget Monitored Binary',
        slug: `budget-bin-${runId}`,
        repo: `test-org/budget-bin-${runId}`,
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
  });

  it('configures project budgets via PUT /api/v1/projects/:id/budgets', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/budgets`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${sessionOwner}`,
      },
      body: JSON.stringify({
        max_total_size: 500000, // 500 KB limit
        max_growth_bytes: 5000, // 5 KB growth limit
        fail_on_padding_regression: true,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.budgets.max_total_size).toBe(500000);
    expect(data.budgets.max_growth_bytes).toBe(5000);
    expect(data.budgets.fail_on_padding_regression).toBe(true);
  });

  it('ingests baseline analysis on main branch and passes budgets', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'app_main',
        file_size: 400000, // Under 500 KB limit
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-main-base',
          branch: 'main',
        },
        sections: [{ name: '.text', category: 'code', size: 300000 }],
        symbols: [{ name: 'main', size: 100, type: 'FUNC' }],
        structs: [
          {
            name: 'State',
            byte_size: 64,
            alignment: 8,
            total_padding_bytes: 8,
            cache_lines_spanned: 1,
            has_padding: true,
            has_cache_line_crossing: false,
            members: [],
            padding_holes: [],
            cache_line_crossings: [],
            optimal: null,
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.budget_status).toBeDefined();
    expect(data.budget_status.passed).toBe(true);
    expect(data.budget_status.reasons).toHaveLength(0);
  });

  it('fails budget when total binary size exceeds max_total_size', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'app_huge',
        file_size: 550000, // Exceeds 500,000 B
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-huge',
          branch: 'feat/large-asset',
        },
        sections: [{ name: '.text', category: 'code', size: 450000 }],
        symbols: [{ name: 'main', size: 100, type: 'FUNC' }],
        structs: [],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.budget_status.passed).toBe(false);
    expect(data.budget_status.reasons.some((r: string) => r.includes('exceeds project max total size budget'))).toBe(true);
  });

  it('fails budget when growth exceeds max_growth_bytes', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'app_bloat',
        file_size: 420000, // +20,000 B growth from 400,000 B base (limit is 5,000 B)
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-bloat',
          branch: 'feat/bloat',
        },
        sections: [{ name: '.text', category: 'code', size: 320000 }],
        symbols: [{ name: 'main', size: 100, type: 'FUNC' }],
        structs: [
          {
            name: 'State',
            byte_size: 64,
            alignment: 8,
            total_padding_bytes: 8, // No padding regression
            cache_lines_spanned: 1,
            has_padding: true,
            has_cache_line_crossing: false,
            members: [],
            padding_holes: [],
            cache_line_crossings: [],
            optimal: null,
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.budget_status.passed).toBe(false);
    expect(data.budget_status.reasons.some((r: string) => r.includes('exceeds max growth budget'))).toBe(true);
  });

  it('fails budget when struct padding regresses', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'app_pad_regress',
        file_size: 401000, // +1,000 B (within 5,000 B growth budget)
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-pad-regress',
          branch: 'feat/unaligned-structs',
        },
        sections: [{ name: '.text', category: 'code', size: 301000 }],
        symbols: [{ name: 'main', size: 100, type: 'FUNC' }],
        structs: [
          {
            name: 'State',
            byte_size: 80,
            alignment: 8,
            total_padding_bytes: 24, // Was 8 in base -> +16 B padding regression
            cache_lines_spanned: 2,
            has_padding: true,
            has_cache_line_crossing: false,
            members: [],
            padding_holes: [],
            cache_line_crossings: [],
            optimal: null,
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.budget_status.passed).toBe(false);
    expect(data.budget_status.reasons.some((r: string) => r.includes('Struct padding regression detected'))).toBe(true);
  });

  it('passes all budgets when within size, growth, and padding limits', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'app_good',
        file_size: 402000, // +2,000 B (under 5,000 B growth, total 402 KB < 500 KB)
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-good',
          branch: 'feat/clean-code',
        },
        sections: [{ name: '.text', category: 'code', size: 302000 }],
        symbols: [{ name: 'main', size: 100, type: 'FUNC' }],
        structs: [
          {
            name: 'State',
            byte_size: 64,
            alignment: 8,
            total_padding_bytes: 8, // No padding regression
            cache_lines_spanned: 1,
            has_padding: true,
            has_cache_line_crossing: false,
            members: [],
            padding_holes: [],
            cache_line_crossings: [],
            optimal: null,
          },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.budget_status.passed).toBe(true);
    expect(data.budget_status.reasons).toHaveLength(0);
  });
});
