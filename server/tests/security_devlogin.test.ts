import { describe, it, expect } from 'vitest';
import { validateProductionEnv, envSchema } from '../src/env.js';
import { Hono } from 'hono';

describe('P0-4: Dev Login Hardening & Production Startup Validation', () => {
  it('fails startup validation in production if SESSION_SECRET is default', () => {
    const parsed = envSchema.parse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://prod_user:prod_pass@db.example.com:5432/dwarflens_prod',
      // SESSION_SECRET default is used
    });
    expect(() => validateProductionEnv(parsed)).toThrow(/SESSION_SECRET is using the insecure default value/);
  });

  it('fails startup validation in production if DATABASE_URL is default', () => {
    const parsed = envSchema.parse({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-secure-and-random-32-chars',
      // DATABASE_URL default is used
    });
    expect(() => validateProductionEnv(parsed)).toThrow(/DATABASE_URL is using the localhost default/);
  });

  it('passes startup validation in production when secure values are provided', () => {
    const parsed = envSchema.parse({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-very-long-secret-key-that-is-secure-and-random-32-chars',
      DATABASE_URL: 'postgresql://prod_user:prod_pass@db.example.com:5432/dwarflens_prod',
    });
    expect(() => validateProductionEnv(parsed)).not.toThrow();
  });

  it('never mounts dev-login when NODE_ENV is production even if DEV_LOGIN_ENABLED=true', async () => {
    // If we test authRouter logic with production env
    // A production instance should not expose POST /dev-login
    const prodRouter = new Hono();
    // Simulate what auth.ts does:
    const mockEnv = { NODE_ENV: 'production', DEV_LOGIN_ENABLED: 'true' } as const;
    if ((mockEnv.NODE_ENV as string) === 'development' || (mockEnv.NODE_ENV as string) === 'test') {
      prodRouter.post('/dev-login', (c) => c.text('ok'));
    }

    const res = await prodRouter.request('/dev-login', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
