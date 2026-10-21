import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { createOneTimeCode, exchangeOneTimeCode } from '../src/auth/handoff.js';
import { createSession } from '../src/auth/sessions.js';

describe('P3-19: Cross-Origin Login & One-Time-Code Handoff', () => {
  let testUser: any;
  let testSessionId: string;

  beforeEach(async () => {
    const email = `cross-origin-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
    const [u] = await db
      .insert(users)
      .values({
        email,
        emailVerified: true,
        name: 'Cross Origin User',
      })
      .returning();
    testUser = u;

    const sessionRes = await createSession(testUser.id);
    testSessionId = sessionRes.sessionId;
  });

  it('generates a one-time handoff code, exchanges it for session token, and enforces single use', async () => {
    // 1. Generate code for session
    const code = createOneTimeCode(testSessionId);
    expect(code).toBeDefined();
    expect(code.length).toBeGreaterThanOrEqual(32);

    // 2. Exchange code via POST /api/v1/auth/exchange-code
    const exchangeRes = await app.request('/api/v1/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    expect(exchangeRes.status).toBe(200);
    const body = await exchangeRes.json();
    expect(body.sessionId).toBe(testSessionId);
    expect(body.user.id).toBe(testUser.id);
    expect(exchangeRes.headers.get('set-cookie')).toContain('dwarflens_session=');

    // 3. Replay attack: Re-using the same code MUST fail (400 Bad Request)
    const replayRes = await app.request('/api/v1/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    expect(replayRes.status).toBe(400);
    const replayBody = await replayRes.json();
    expect(replayBody.error).toMatch(/invalid or expired/i);
  });

  it('rejects expired one-time codes', async () => {
    // Generate code with negative TTL (already expired)
    const expiredCode = createOneTimeCode(testSessionId, -1000);

    const res = await app.request('/api/v1/auth/exchange-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: expiredCode }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid or expired/i);
  });

  it('allows authenticated API requests using Authorization Bearer without cookies (for Safari/Brave cross-origin)', async () => {
    // Call GET /api/v1/auth/me with NO cookies, only Authorization: Bearer <sessionId>
    const res = await app.request('/api/v1/auth/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${testSessionId}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(testUser.id);
    expect(body.user.email).toBe(testUser.email);
  });
});
