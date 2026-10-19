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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/dwarflens'),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  SESSION_SECRET: z.string().min(16).default('dwarflens-dev-session-secret-at-least-32-chars-long!'),
  GITHUB_CLIENT_ID: z.string().optional().default(''),
  GITHUB_CLIENT_SECRET: z.string().optional().default(''),
  APP_URL: z.string().url().default(process.env.NODE_ENV === 'production' ? 'https://shubham-core.github.io/dwarflens/' : 'http://localhost:5173'),
  API_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL || (process.env.NODE_ENV === 'production' ? 'https://dwarflens.onrender.com' : 'http://localhost:3000')),
  RESEND_API_KEY: z.string().optional().default(''),
  DEV_LOGIN_ENABLED: z.string().optional().default('false'),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

