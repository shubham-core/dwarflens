import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';

describe('P2-15: Input Validation, UUID Safety, Error Handling & Body Limits', () => {
  let sessionCookie: string;
  const runId = Math.random().toString(36).substring(7);

  beforeAll(async () => {
    const loginRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({
        email: `input-val-${runId}@example.com`,
        name: 'Input Validation Tester',
      }),
    });
    sessionCookie = `dwarflens_session=${(await loginRes.json()).sessionId}`;
  });

  describe('UUID Parameter Validation (400 Bad Request on invalid format)', () => {
    it('rejects invalid UUID in /projects/:id with 400', async () => {
      const res = await app.request('/api/v1/projects/not-a-valid-uuid', {
        headers: { Cookie: sessionCookie },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/uuid/i);
    });

    it('rejects invalid UUID in /projects/:id/analyses with 400', async () => {
      const res = await app.request('/api/v1/projects/invalid-project/analyses', {
        headers: { Cookie: sessionCookie },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/uuid/i);
    });

    it('rejects invalid UUID in /analyses/:id with 400', async () => {
      const res = await app.request('/api/v1/analyses/bad-analysis-uuid', {
        headers: { Cookie: sessionCookie },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/uuid/i);
    });

    it('rejects invalid UUID in /orgs/:orgId/projects with 400', async () => {
      const res = await app.request('/api/v1/orgs/not-a-valid-org-id/projects', {
        headers: { Cookie: sessionCookie },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/uuid/i);
    });

    it('rejects invalid UUID in /orgs/:orgId/members/:memberId with 400', async () => {
      const res = await app.request('/api/v1/orgs/00000000-0000-0000-0000-000000000000/members/bad-member-id', {
        method: 'DELETE',
        headers: { Cookie: sessionCookie },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/uuid/i);
    });

    it('rejects invalid UUID in query param ?projectId=... with 400', async () => {
      const res = await app.request('/api/v1/analyses?projectId=not-a-valid-uuid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          schema_version: 1,
          filename: 'test.elf',
          file_size: 100,
          format: 'ELF',
          sections: [],
          symbols: [],
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/uuid/i);
    });
  });

  describe('Safe JSON Parsing (400 on malformed JSON body)', () => {
    it('returns 400 Bad Request when receiving malformed JSON', async () => {
      const res = await app.request('/api/v1/auth/dev-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: 'localhost:3000',
        },
        body: '{"unclosed_json: true, invalid',
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toMatch(/json/i);
    });
  });

  describe('Global 5 MB Body Limit (413 Payload Too Large)', () => {
    it('rejects request body exceeding 5 MB with 413 Payload Too Large', async () => {
      // Create a payload larger than 5 MB (5.2 MB)
      const largePadding = 'x'.repeat(5.2 * 1024 * 1024);
      const largeBody = JSON.stringify({ padding: largePadding });

      const res = await app.request('/api/v1/auth/dev-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: 'localhost:3000',
        },
        body: largeBody,
      });

      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.error).toMatch(/too large|payload/i);
    });
  });

  describe('Generic 500 Error Handler', () => {
    it('returns generic JSON { error: "Internal Server Error" } without stack leaks', async () => {
      // Request an intentional test error route or trigger unhandled error
      const res = await app.request('/api/v1/throw-error-test');
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data).toEqual({ error: 'Internal Server Error' });
      expect((data as any).stack).toBeUndefined();
    });
  });
});
