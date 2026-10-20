import { describe, it, expect } from 'vitest';
import { envSchema } from '../src/env.js';
import { app, getAllowedOrigins } from '../src/app.js';
import { env } from '../src/env.js';

describe('R3: Safe Default NODE_ENV=production & Localhost Dev-Login Enforcement', () => {
  it('defaults NODE_ENV to production when unset, and sets production APP_URL/API_URL', () => {
    const parsed = envSchema.parse({});
    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.APP_URL).toBe('https://shubham-core.github.io/dwarflens');
    expect(parsed.API_URL).toBe('https://dwarflens.onrender.com');
  });

  it('rejects dev-login with 404 when request is not from localhost even in dev/test env', async () => {
    const resExternalHost = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'dwarflens.onrender.com',
      },
      body: JSON.stringify({ email: 'attacker@evil.com' }),
    });
    expect(resExternalHost.status).toBe(404);

    const resForwardedIp = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'localhost',
        'X-Forwarded-For': '203.0.113.195',
      },
      body: JSON.stringify({ email: 'attacker@evil.com' }),
    });
    expect(resForwardedIp.status).toBe(404);
  });

  it('allows dev-login when request comes from localhost in development/test env', async () => {
    const res = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'localhost:3000',
      },
      body: JSON.stringify({ email: 'dev-user@localhost.test' }),
    });
    expect(res.status).toBe(200);
  });

  it('verifies that in production mode dev-login returns 404 and CORS allows real APP_URL with credentials', async () => {
    const origNodeEnv = env.NODE_ENV;
    try {
      (env as any).NODE_ENV = 'production';
      // In production, dev-login must return 404 even from localhost
      const devRes = await app.request('/api/v1/auth/dev-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: 'localhost',
        },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
      expect(devRes.status).toBe(404);

      // CORS in production allows real APP_URL origin
      const origins = getAllowedOrigins();
      expect(origins.has('https://shubham-core.github.io')).toBe(true);
      expect(origins.has('http://localhost:5173')).toBe(false);

      const corsRes = await app.request('/health', {
        headers: {
          Origin: 'https://shubham-core.github.io',
        },
      });
      expect(corsRes.headers.get('Access-Control-Allow-Origin')).toBe('https://shubham-core.github.io');
      expect(corsRes.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    } finally {
      (env as any).NODE_ENV = origNodeEnv;
    }
  });
});
