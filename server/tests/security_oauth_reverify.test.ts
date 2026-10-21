import { describe, it, expect, vi } from 'vitest';
import { app } from '../src/app.js';
import { env } from '../src/env.js';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import * as githubAuth from '../src/auth/github.js';

describe('R8: OAuth Re-verification Suite', () => {
  it('strictly derives redirect_uri from API_URL only, ignoring Host and X-Forwarded-Host headers', async () => {
    const res = await app.request('/api/v1/auth/github', {
      headers: {
        Host: 'evil-phishing-host.com',
        'X-Forwarded-Host': 'evil-spoofed-forwarded-host.com',
        'X-Forwarded-Proto': 'https',
      },
    });

    expect(res.status).toBe(302);
    const location = res.headers.get('location') || '';
    const url = new URL(location);
    const redirectUri = url.searchParams.get('redirect_uri');

    expect(redirectUri).toBeDefined();
    // Must NEVER contain attacker hosts
    expect(redirectUri).not.toContain('evil-phishing-host.com');
    expect(redirectUri).not.toContain('evil-spoofed-forwarded-host.com');
    // Must match API_URL
    const expectedPrefix = `${env.API_URL.replace(/\/$/, '')}/api/v1/auth/github/callback`;
    expect(redirectUri).toBe(expectedPrefix);
  });

  it('ensures oauth_state cookie is single-use and cleared upon callback', async () => {
    const mockExchange = vi.spyOn(githubAuth, 'exchangeGitHubCode').mockResolvedValue('mock_token_123');
    const mockProfile = vi.spyOn(githubAuth, 'getGitHubUserProfile').mockResolvedValue({
      githubId: `gh_single_use_${Date.now()}`,
      email: `single_use_${Date.now()}@example.com`,
      emailVerified: true,
      name: 'Single Use Tester',
      avatarUrl: '',
    });

    const state = 'valid_state_single_use_abc';
    const callbackRes = await app.request(`/api/v1/auth/github/callback?code=mock_code&state=${state}`, {
      headers: {
        Cookie: `oauth_state=${state}`,
      },
    });

    expect(callbackRes.status).toBe(302);
    // The response must clear/expire the oauth_state cookie
    const setCookie = callbackRes.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/oauth_state=(?:;|deleted|;|.*Max-Age=0)/i);

    // Now attempt a replay: without cookie or after cookie expired, it must fail with 403
    const replayRes = await app.request(`/api/v1/auth/github/callback?code=mock_code&state=${state}`);
    expect(replayRes.status).toBe(403);
    const replayData = await replayRes.json();
    expect(replayData.error).toMatch(/state/i);

    mockExchange.mockRestore();
    mockProfile.mockRestore();
  });
});
