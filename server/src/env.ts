import { config } from 'dotenv';
import { z } from 'zod';

// Load .env if present
config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/dwarflens'),
  SESSION_SECRET: z.string().min(16).default('dwarflens-dev-session-secret-at-least-32-chars-long!'),
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  APP_URL: z.string().url().default('http://localhost:5173'),
  API_URL: z.string().url().default('http://localhost:3000'),
  RESEND_API_KEY: z.string().optional().default(''),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
