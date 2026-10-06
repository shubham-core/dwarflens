import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

const { Pool } = pg;

const isNeon = env.DATABASE_URL.includes('neon.tech') || env.DATABASE_URL.includes('sslmode=require');

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isNeon ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
