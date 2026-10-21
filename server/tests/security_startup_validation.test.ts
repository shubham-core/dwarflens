import { describe, it, expect } from 'vitest';
import { envSchema, validateProductionEnv } from '../src/env.js';

describe('R4: Startup Production Environment Validation', () => {
  const baseValidProduction = {
    NODE_ENV: 'production' as const,
    SESSION_SECRET: 'super-secret-session-key-minimum-32-characters-long!',
    DATABASE_URL: 'postgresql://prod_user:prod_pass@neon-db.example.com:5432/dwarflens_prod',
    APP_URL: 'https://shubham-core.github.io/dwarflens/',
    API_URL: 'https://dwarflens.onrender.com',
    GITHUB_CLIENT_ID: 'gh_client_id_123456789',
    GITHUB_CLIENT_SECRET: 'gh_client_secret_abcdef123456789',
    STRIPE_WEBHOOK_SECRET: 'whsec_stripe_test_secret_123456789',
    CRON_SECRET: 'cron-super-secret-key-at-least-32-characters-long!',
    BILLING_PROVIDER: 'stripe',
  };

  it('passes validation when all required production variables are set correctly', () => {
    const parsed = envSchema.parse(baseValidProduction);
    expect(() => validateProductionEnv(parsed)).not.toThrow();
  });

  it('refuses to start in production if APP_URL is localhost or 127.0.0.1', () => {
    const parsedLocalhost = envSchema.parse({
      ...baseValidProduction,
      APP_URL: 'http://localhost:5173',
    });
    expect(() => validateProductionEnv(parsedLocalhost)).toThrow(/APP_URL cannot point to localhost/i);

    const parsedIp = envSchema.parse({
      ...baseValidProduction,
      APP_URL: 'http://127.0.0.1:5173',
    });
    expect(() => validateProductionEnv(parsedIp)).toThrow(/APP_URL cannot point to localhost/i);
  });

  it('refuses to start in production if API_URL is localhost or 127.0.0.1', () => {
    const parsedLocalhost = envSchema.parse({
      ...baseValidProduction,
      API_URL: 'http://localhost:3000',
    });
    expect(() => validateProductionEnv(parsedLocalhost)).toThrow(/API_URL cannot point to localhost/i);

    const parsedIp = envSchema.parse({
      ...baseValidProduction,
      API_URL: 'http://127.0.0.1:3000',
    });
    expect(() => validateProductionEnv(parsedIp)).toThrow(/API_URL cannot point to localhost/i);
  });

  it('refuses to start in production if GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET are empty', () => {
    const parsedNoId = envSchema.parse({
      ...baseValidProduction,
      GITHUB_CLIENT_ID: '',
    });
    expect(() => validateProductionEnv(parsedNoId)).toThrow(/GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required/i);

    const parsedNoSecret = envSchema.parse({
      ...baseValidProduction,
      GITHUB_CLIENT_SECRET: '',
    });
    expect(() => validateProductionEnv(parsedNoSecret)).toThrow(/GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required/i);
  });

  it('refuses to start in production if active billing provider webhook secret is missing', () => {
    // 1. Stripe active without STRIPE_WEBHOOK_SECRET
    const parsedStripeNoSecret = envSchema.parse({
      ...baseValidProduction,
      BILLING_PROVIDER: 'stripe',
      STRIPE_WEBHOOK_SECRET: '',
    });
    expect(() => validateProductionEnv(parsedStripeNoSecret)).toThrow(/STRIPE_WEBHOOK_SECRET is required/i);

    // 2. Lemon Squeezy active without LEMONSQUEEZY_WEBHOOK_SECRET
    const parsedLemonNoSecret = envSchema.parse({
      ...baseValidProduction,
      BILLING_PROVIDER: 'lemonsqueezy',
      LEMONSQUEEZY_WEBHOOK_SECRET: '',
    });
    expect(() => validateProductionEnv(parsedLemonNoSecret)).toThrow(/LEMONSQUEEZY_WEBHOOK_SECRET is required/i);

    // 3. Razorpay active without RAZORPAY_WEBHOOK_SECRET
    const parsedRazorpayNoSecret = envSchema.parse({
      ...baseValidProduction,
      BILLING_PROVIDER: 'razorpay',
      RAZORPAY_WEBHOOK_SECRET: '',
    });
    expect(() => validateProductionEnv(parsedRazorpayNoSecret)).toThrow(/RAZORPAY_WEBHOOK_SECRET is required/i);
  });

  it('allows starting in production without billing webhook secret if BILLING_PROVIDER is "none" or "disabled"', () => {
    const parsedNone = envSchema.parse({
      ...baseValidProduction,
      BILLING_PROVIDER: 'none',
      STRIPE_WEBHOOK_SECRET: '',
    });
    expect(() => validateProductionEnv(parsedNone)).not.toThrow();

    const parsedDisabled = envSchema.parse({
      ...baseValidProduction,
      BILLING_PROVIDER: 'disabled',
      STRIPE_WEBHOOK_SECRET: '',
    });
    expect(() => validateProductionEnv(parsedDisabled)).not.toThrow();
  });

  it('refuses to start in production if CRON_SECRET is missing or shorter than 32 characters', () => {
    const parsedNoCron = envSchema.parse({
      ...baseValidProduction,
      CRON_SECRET: '',
    });
    expect(() => validateProductionEnv(parsedNoCron)).toThrow(/CRON_SECRET is required and must be at least 32 characters/i);

    const parsedShortCron = envSchema.parse({
      ...baseValidProduction,
      CRON_SECRET: 'short-secret-under-32-chars',
    });
    expect(() => validateProductionEnv(parsedShortCron)).toThrow(/CRON_SECRET is required and must be at least 32 characters/i);
  });
});
