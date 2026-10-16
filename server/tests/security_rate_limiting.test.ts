import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { resetRateLimitStore } from '../src/middleware/rateLimit.js';

describe('P2-16: Platform Trusted IP & Comprehensive Rate Limiting', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('uses platform trusted IP (cf-connecting-ip) and prevents spoofed X-Forwarded-For bypass', async () => {
    // Repeatedly hit /api/v1/auth/github with same CF-Connecting-IP but changing X-Forwarded-For
    const trustedIp = '198.51.100.42';

    let lastStatus = 200;
    for (let i = 0; i < 25; i++) {
      const spoofedClientIp = `10.0.0.${i}`;
      const res = await app.request('/api/v1/auth/github', {
        headers: {
          'CF-Connecting-IP': trustedIp,
          'X-Forwarded-For': `${spoofedClientIp}, ${trustedIp}`,
        },
      });
      lastStatus = res.status;
      if (res.status === 429) {
        const body = await res.json();
        expect(body.error).toMatch(/too many requests|rate limit/i);
        expect(res.headers.get('Retry-After')).toBeDefined();
        break;
      }
    }

    // Should have hit 429 because all requests came from the same trusted IP
    expect(lastStatus).toBe(429);
  });

  it('enforces rate limiting on login route (POST /api/v1/auth/dev-login)', async () => {
    const testIp = '198.51.100.50';
    let hitRateLimit = false;

    for (let i = 0; i < 15; i++) {
      const res = await app.request('/api/v1/auth/dev-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': testIp,
          Host: 'localhost:3000',
        },
        body: JSON.stringify({ email: `rate-limit-test-${i}@example.com` }),
      });

      if (res.status === 429) {
        hitRateLimit = true;
        expect(res.headers.get('X-RateLimit-Limit')).toBeDefined();
        expect(res.headers.get('Retry-After')).toBeDefined();
        break;
      }
    }

    expect(hitRateLimit).toBe(true);
  });

  it('enforces rate limiting on public share link reads (GET /api/v1/shared/:token)', async () => {
    const testIp = '198.51.100.60';
    let hitRateLimit = false;

    for (let i = 0; i < 65; i++) {
      const res = await app.request('/api/v1/shared/test-share-token-1234', {
        headers: {
          'CF-Connecting-IP': testIp,
        },
      });

      if (res.status === 429) {
        hitRateLimit = true;
        expect(res.headers.get('X-RateLimit-Limit')).toBeDefined();
        break;
      }
    }

    expect(hitRateLimit).toBe(true);
  });
});
