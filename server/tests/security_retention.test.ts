import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../src/app.js';
import { env } from '../src/env.js';

describe('P0-3: Retention Cron Guard & Secret Verification', () => {
  const cronSecret = 'test_cron_secret_super_secure_key_12345';
  let origSecret: string;

  beforeEach(() => {
    origSecret = env.CRON_SECRET;
    (env as any).CRON_SECRET = cronSecret;
  });

  afterEach(() => {
    (env as any).CRON_SECRET = origSecret;
  });

  it('rejects retention request with 503 when CRON_SECRET is unset/empty (fail-closed)', async () => {
    (env as any).CRON_SECRET = '';

    const res = await app.request('/api/v1/billing/retention', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toMatch(/secret not configured/i);
  });

  it('rejects retention request without Authorization header when CRON_SECRET is set (401)', async () => {
    const res = await app.request('/api/v1/billing/retention', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/unauthorized|missing/i);
  });

  it('rejects retention request with wrong Authorization Bearer token (401)', async () => {
    const res = await app.request('/api/v1/billing/retention', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong_token_value_abc',
      },
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/unauthorized|invalid/i);
  });

  it('accepts retention request with correct Bearer token (200)', async () => {
    const res = await app.request('/api/v1/billing/retention', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cronSecret}`,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
  });
});
