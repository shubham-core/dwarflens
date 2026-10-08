import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import * as githubAuth from '../src/auth/github.js';

describe('P0-5: GitHub OAuth State Cookie & Verified Email Account Linking', () => {
  it('GET /api/v1/auth/github sets a short-lived httpOnly oauth_state cookie matching the state query param', async () => {
    const res = await app.request('/api/v1/auth/github');
    expect(res.status).toBe(302);
    const location = res.headers.get('location') || '';
    const url = new URL(location);
    const stateParam = url.searchParams.get('state');
    expect(stateParam).toBeTruthy();

    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('oauth_state=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain(stateParam!);
  });

  it('rejects OAuth callback if oauth_state cookie is missing (403)', async () => {
    const res = await app.request('/api/v1/auth/github/callback?code=some_code&state=some_state');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/state/i);
  });

  it('rejects OAuth callback if state in query does not match oauth_state cookie (403)', async () => {
    const res = await app.request('/api/v1/auth/github/callback?code=some_code&state=attack_state', {
      headers: {
        Cookie: 'oauth_state=legit_state',
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/state/i);
  });

  it('never links accounts by unverified email', async () => {
    // Insert an existing victim user
    const victimEmail = `victim_${Date.now()}@example.com`;
    const [victim] = await db
      .insert(users)
      .values({
        email: victimEmail,
        name: 'Victim User',
      })
      .returning();

    // Mock exchangeGitHubCode and getGitHubUserProfile
    const mockExchange = vi.spyOn(githubAuth, 'exchangeGitHubCode').mockResolvedValue('mock_token');
    const mockProfile = vi.spyOn(githubAuth, 'getGitHubUserProfile').mockResolvedValue({
      githubId: `gh_attacker_${Date.now()}`,
      email: victimEmail,
      emailVerified: false, // UNVERIFIED!
      name: 'Attacker Impersonator',
      avatarUrl: '',
    });

    const state = 'matching_state_123';
    const res = await app.request(`/api/v1/auth/github/callback?code=test_code&state=${state}`, {
      headers: {
        Cookie: `oauth_state=${state}`,
      },
    });

    // Check victim in DB: victim's githubId MUST still be null!
    const [victimAfter] = await db
      .select()
      .from(users)
      .where(eq(users.id, victim.id))
      .limit(1);

    expect(victimAfter.githubId).toBeNull();

    mockExchange.mockRestore();
    mockProfile.mockRestore();
  });
});
