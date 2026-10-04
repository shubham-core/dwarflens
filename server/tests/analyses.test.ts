import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';

describe('Analyses Ingest, Read, and Diff API', () => {
  let session: string;
  let orgId: string;
  let projectId: string;
  let rawApiKey: string;
  let baseAnalysisId: string;
  let headAnalysisId: string;

  const sampleBaseJson = {
    schema_version: 1,
    filename: 'dwarflens_app',
    file_size: 1048576,
    format: 'ELF',
    flash_size: 524288,
    ram_size: 131072,
    metadata: {
      repo: 'test-org/dwarflens-target',
      commit_sha: 'commit-base-1111',
      branch: 'main',
      build_name: 'release',
      tool_version: '0.1.0',
    },
    sections: [
      { name: '.text', category: 'code', size: 400000 },
      { name: '.rodata', category: 'rodata', size: 100000 },
      { name: '.data', category: 'data', size: 24288 },
      { name: '.bss', category: 'bss', size: 106784 },
    ],
    symbols: [
      { name: 'main', size: 500, type: 'FUNC' },
      { name: 'parse_dwarf', size: 15000, type: 'FUNC' },
      { name: 'global_cache', size: 8192, type: 'OBJECT' },
    ],
    structs: [
      {
        name: 'HeaderInfo',
        byte_size: 64,
        alignment: 8,
        total_padding_bytes: 4,
        cache_lines_spanned: 1,
        has_padding: true,
        has_cache_line_crossing: false,
        members: [
          { name: 'magic', type_name: 'uint32_t', offset: 0, byte_size: 4 },
          { name: 'flags', type_name: 'uint16_t', offset: 4, byte_size: 2 },
          { name: 'size', type_name: 'uint64_t', offset: 8, byte_size: 8 },
        ],
        padding_holes: [{ offset: 6, size: 2, before: 'flags', after: 'size' }],
        cache_line_crossings: [],
        optimal: null,
      },
    ],
  };

  const sampleHeadJson = {
    schema_version: 1,
    filename: 'dwarflens_app',
    file_size: 1073152, // +24,576 bytes
    format: 'ELF',
    flash_size: 540672,
    ram_size: 131072,
    metadata: {
      repo: 'test-org/dwarflens-target',
      commit_sha: 'commit-head-2222',
      branch: 'main',
      build_name: 'release',
      tool_version: '0.1.0',
    },
    sections: [
      { name: '.text', category: 'code', size: 415000 }, // +15,000
      { name: '.rodata', category: 'rodata', size: 101400 }, // +1,400
      { name: '.data', category: 'data', size: 24288 },
      { name: '.bss', category: 'bss', size: 106784 },
    ],
    symbols: [
      { name: 'main', size: 550, type: 'FUNC' }, // +50
      { name: 'parse_dwarf', size: 18000, type: 'FUNC' }, // +3000
      { name: 'new_feature_fn', size: 8000, type: 'FUNC' }, // Added
      { name: 'global_cache', size: 8192, type: 'OBJECT' },
    ],
    structs: [
      {
        name: 'HeaderInfo',
        byte_size: 72,
        alignment: 8,
        total_padding_bytes: 12, // +8 bytes regression
        cache_lines_spanned: 2,
        has_padding: true,
        has_cache_line_crossing: true,
        members: [
          { name: 'magic', type_name: 'uint32_t', offset: 0, byte_size: 4 },
          { name: 'flags', type_name: 'uint16_t', offset: 4, byte_size: 2 },
          { name: 'pad_regression', type_name: 'uint8_t', offset: 6, byte_size: 1 },
          { name: 'size', type_name: 'uint64_t', offset: 8, byte_size: 8 },
        ],
        padding_holes: [{ offset: 7, size: 1, before: 'pad_regression', after: 'size' }],
        cache_line_crossings: [
          { member_name: 'size', member_offset: 64, member_size: 8, boundary: 64 },
        ],
        optimal: null,
      },
    ],
  };

  beforeAll(async () => {
    const runId = Math.random().toString(36).substring(7);

    // 1. Create User and Org
    const loginRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `ingest-user-${runId}@example.com`, name: 'Ingest Dev', orgName: `Ingest Org ${runId}` }),
    });
    const loginData = await loginRes.json();
    session = loginData.sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${session}` },
    });
    const meData = await meRes.json();
    orgId = meData.orgs[0].orgId;

    // 2. Create Project
    const projRes = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${session}`,
      },
      body: JSON.stringify({
        name: 'Target App',
        slug: `dwarflens-target-${runId}`,
        repo: `test-org/dwarflens-target-${runId}`,
      }),
    });
    const projData = await projRes.json();
    projectId = projData.project.id;

    // 3. Create API Key
    const keyRes = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${session}`,
      },
      body: JSON.stringify({ name: 'CI Ingest Key', projectId }),
    });
    const keyData = await keyRes.json();
    rawApiKey = keyData.rawKey;
  });

  it('rejects payloads exceeding the 5 MB limit with 413', async () => {
    // Fake large payload
    const largePadding = 'x'.repeat(5.2 * 1024 * 1024);
    const res = await app.request('/api/v1/analyses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify({ large: largePadding }),
    });

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toContain('Payload too large');
  });

  it('rejects payloads failing JSON schema validation with 422', async () => {
    const invalidJson = {
      schema_version: 1,
      // missing required fields: filename, file_size, format, sections, symbols, structs
    };

    const res = await app.request('/api/v1/analyses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify(invalidJson),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('does not conform to analysis.v1 schema');
    expect(data.details).toBeDefined();
  });

  it('ingests valid base analysis via API key with 201 Created', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify(sampleBaseJson),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe('created');
    expect(data.id).toBeDefined();
    expect(data.commit_sha).toBe('commit-base-1111');
    baseAnalysisId = data.id;
  });

  it('is idempotent on project + commit_sha + build_name (returns 200 existing)', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify(sampleBaseJson),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('existing');
    expect(data.id).toBe(baseAnalysisId);
  });

  it('ingests head analysis successfully', async () => {
    const res = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rawApiKey}`,
      },
      body: JSON.stringify(sampleHeadJson),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe('created');
    headAnalysisId = data.id;
  });

  it('lists project analyses via GET /api/v1/projects/:id/analyses', async () => {
    const res = await app.request(`/api/v1/projects/${projectId}/analyses`, {
      headers: { Cookie: `dwarflens_session=${session}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.analyses).toBeInstanceOf(Array);
    expect(data.analyses.length).toBe(2);
    // Confirm summary columns are populated
    const latest = data.analyses[0];
    expect(latest.totalSize).toBeGreaterThan(0);
    expect(latest.structCount).toBe(1);
    expect(latest.symbolCount).toBe(4);
  });

  it('reads analysis detail via GET /api/v1/analyses/:id', async () => {
    const res = await app.request(`/api/v1/analyses/${baseAnalysisId}`, {
      headers: { Cookie: `dwarflens_session=${session}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.analysis.id).toBe(baseAnalysisId);
    expect(data.analysis.rawData).toBeDefined();
    expect(data.analysis.rawData.sections).toBeInstanceOf(Array);
  });

  it('computes diff between two stored analyses via GET /api/v1/projects/:id/diff', async () => {
    const res = await app.request(
      `/api/v1/projects/${projectId}/diff?base=${baseAnalysisId}&head=${headAnalysisId}`,
      {
        headers: { Cookie: `dwarflens_session=${session}` },
      }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    const diff = data.diff;

    expect(diff).toBeDefined();
    // Size deltas
    expect(diff.file_size_delta).toBe(24576);
    expect(diff.flash_delta).toBe(16384);
    expect(diff.has_padding_regression).toBe(true);

    // Section deltas
    const textDelta = diff.section_deltas.find((s: any) => s.name === '.text');
    expect(textDelta).toBeDefined();
    expect(textDelta.delta).toBe(15000);

    // Symbol deltas
    const addedSymbol = diff.top_symbol_deltas.find((s: any) => s.name === 'new_feature_fn');
    expect(addedSymbol).toBeDefined();
    expect(addedSymbol.status).toBe('added');
    expect(addedSymbol.delta).toBe(8000);

    // Struct regressions
    const headerStruct = diff.struct_regressions.find((st: any) => st.name === 'HeaderInfo');
    expect(headerStruct).toBeDefined();
    expect(headerStruct.padding_delta).toBe(8);
    expect(headerStruct.has_regression).toBe(true);
  });

  it('computes diff using commit_sha identifiers', async () => {
    const res = await app.request(
      `/api/v1/projects/${projectId}/diff?base=commit-base-1111&head=commit-head-2222`,
      {
        headers: { Authorization: `Bearer ${rawApiKey}` },
      }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.diff.file_size_delta).toBe(24576);
  });
});
