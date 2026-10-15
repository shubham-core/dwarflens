import { describe, it, expect } from 'vitest';
import { app, getAllowedOrigins } from '../src/app.js';
import { env } from '../src/env.js';

describe('R5: CORS with a Path in APP_URL', () => {
  it('allows origin from APP_URL with path and rejects subdomain injection & malicious origins', async () => {
    const origAppUrl = env.APP_URL;
    try {
      (env as any).APP_URL = 'https://shubham-core.github.io/dwarflens/';

      const allowed = getAllowedOrigins();
      expect(allowed.has('https://shubham-core.github.io')).toBe(true);
      expect(allowed.has('https://shubham-core.github.io/dwarflens/')).toBe(false); // must not include trailing path
      expect(allowed.has('https://evil.example')).toBe(false);
      expect(allowed.has('https://shubham-core.github.io.evil.example')).toBe(false);

      // 1. Origin https://shubham-core.github.io is allowed with credentials
      const resAllowed = await app.request('/health', {
        method: 'GET',
        headers: {
          Origin: 'https://shubham-core.github.io',
        },
      });
      expect(resAllowed.headers.get('access-control-allow-origin')).toBe('https://shubham-core.github.io');
      expect(resAllowed.headers.get('access-control-allow-credentials')).toBe('true');

      // 2. Origin https://evil.example is NOT allowed
      const resEvil = await app.request('/health', {
        method: 'GET',
        headers: {
          Origin: 'https://evil.example',
        },
      });
      expect(resEvil.headers.get('access-control-allow-origin')).toBeNull();
      expect(resEvil.headers.get('access-control-allow-credentials')).toBeNull();

      // 3. Origin https://shubham-core.github.io.evil.example is NOT allowed
      const resSubdomainEvil = await app.request('/health', {
        method: 'GET',
        headers: {
          Origin: 'https://shubham-core.github.io.evil.example',
        },
      });
      expect(resSubdomainEvil.headers.get('access-control-allow-origin')).toBeNull();
      expect(resSubdomainEvil.headers.get('access-control-allow-credentials')).toBeNull();

      // 4. Preflight OPTIONS from attacker origin
      const resPreflightEvil = await app.request('/api/v1/projects', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://shubham-core.github.io.evil.example',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(resPreflightEvil.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      (env as any).APP_URL = origAppUrl;
    }
  });
});
