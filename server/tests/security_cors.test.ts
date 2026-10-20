import { describe, it, expect } from 'vitest';
import { app } from '../src/app.js';
import { env } from '../src/env.js';

describe('P0-1: CORS Allowlist Security Suite', () => {
  const appOrigin = new URL(env.APP_URL).origin;

  it('rejects CORS headers for forbidden origins (does not reflect origin)', async () => {
    const res = await app.request('/health', {
      method: 'GET',
      headers: {
        Origin: 'https://evil-attacker.com',
      },
    });

    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowCreds = res.headers.get('access-control-allow-credentials');

    // Forbidden origin must not be reflected, and credentials must not be granted
    expect(allowOrigin).toBeNull();
    expect(allowCreds).toBeNull();
  });

  it('allows CORS headers for configured APP_URL origin', async () => {
    const res = await app.request('/health', {
      method: 'GET',
      headers: {
        Origin: appOrigin,
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe(appOrigin);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('allows localhost dev origins in non-production environments', async () => {
    const res = await app.request('/health', {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:5173',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('rejects or drops CORS headers on OPTIONS preflight from forbidden origin', async () => {
    const res = await app.request('/api/v1/projects', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil-hacker.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    const allowOrigin = res.headers.get('access-control-allow-origin');
    expect(allowOrigin).toBeNull();
  });
});
