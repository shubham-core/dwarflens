import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

const { Pool } = pg;

const isSsl = env.DATABASE_URL.includes('neon.tech') || env.DATABASE_URL.includes('sslmode=require');
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isSsl ? { rejectUnauthorized } : undefined,
});

pool.on('error', (err) => {
  console.error('[DB Pool] Unexpected error on idle database client:', err);
});

export const db = drizzle(pool, { schema });
