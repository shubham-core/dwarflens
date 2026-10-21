import { config } from 'dotenv';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

// Load .env and .env.local from cwd and root
const envFiles = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '../.env.local'),
];

for (const f of envFiles) {
  if (fs.existsSync(f)) {
    config({ path: f, override: true });
  }
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/dwarflens'),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  SESSION_SECRET: z.string().min(16).default('dwarflens-dev-session-secret-at-least-32-chars-long!'),
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  APP_URL: z.string().url()
    .default(process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : 'https://shubham-core.github.io/dwarflens')
    .transform((val) => val.replace(/\/+$/, '')),
  API_URL: z.string().url()
    .default(process.env.RENDER_EXTERNAL_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'https://dwarflens.onrender.com'))
    .transform((val) => val.replace(/\/+$/, '')),
  RESEND_API_KEY: z.string().optional().default(''),
  DEV_LOGIN_ENABLED: z.string().optional().default('false'),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_PRICE_PRO: z.string().optional().default(''),
  STRIPE_PRICE_TEAM: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  LEMONSQUEEZY_WEBHOOK_SECRET: z.string().optional().default(''),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  RAZORPAY_CURRENCY: z.string().optional().default('USD'),
  BILLING_PROVIDER: z.string().optional().default('stripe'),
  CRON_SECRET: z.string().optional().default(''),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

export function validateProductionEnv(e: Env): void {
  if (e.NODE_ENV === 'production') {
    if (e.SESSION_SECRET === 'dwarflens-dev-session-secret-at-least-32-chars-long!' || e.SESSION_SECRET.length < 32) {
      throw new Error('Refusing to start: SESSION_SECRET is using the insecure default value or is shorter than 32 characters');
    }
    if (e.DATABASE_URL === 'postgresql://postgres:postgres@localhost:5432/dwarflens' || e.DATABASE_URL.includes('localhost') || e.DATABASE_URL.includes('127.0.0.1')) {
      throw new Error('Refusing to start: DATABASE_URL is using the localhost default or contains localhost/127.0.0.1');
    }
    if (e.APP_URL.includes('localhost') || e.APP_URL.includes('127.0.0.1')) {
      throw new Error('Refusing to start: APP_URL cannot point to localhost/127.0.0.1 in production');
    }
    if (e.API_URL.includes('localhost') || e.API_URL.includes('127.0.0.1')) {
      throw new Error('Refusing to start: API_URL cannot point to localhost/127.0.0.1 in production');
    }
    if (!e.GITHUB_CLIENT_ID || !e.GITHUB_CLIENT_SECRET) {
      throw new Error('Refusing to start: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required in production');
    }
    const provider = (e.BILLING_PROVIDER || process.env.BILLING_PROVIDER || 'stripe').toLowerCase();
    if (provider === 'none' || provider === 'disabled') {
      // Billing is disabled; no webhook secret required
    } else if (provider === 'lemonsqueezy' || provider === 'lemon_squeezy') {
      if (!e.LEMONSQUEEZY_WEBHOOK_SECRET) {
        throw new Error('Refusing to start: LEMONSQUEEZY_WEBHOOK_SECRET is required when Lemon Squeezy billing provider is enabled');
      }
    } else if (provider === 'razorpay') {
      if (!e.RAZORPAY_WEBHOOK_SECRET) {
        throw new Error('Refusing to start: RAZORPAY_WEBHOOK_SECRET is required when Razorpay billing provider is enabled');
      }
    } else if (provider === 'stripe') {
      if (!e.STRIPE_WEBHOOK_SECRET) {
        throw new Error('Refusing to start: STRIPE_WEBHOOK_SECRET is required when Stripe billing provider is enabled');
      }
    }
    if (!e.CRON_SECRET || e.CRON_SECRET.length < 32) {
      throw new Error('Refusing to start: CRON_SECRET is required and must be at least 32 characters long in production');
    }
  }
}

validateProductionEnv(env);

