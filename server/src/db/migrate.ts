import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('Running database migrations...');
  const migrationsFolder = fs.existsSync(path.resolve(__dirname, '../../drizzle'))
    ? path.resolve(__dirname, '../../drizzle')
    : path.resolve(process.cwd(), 'drizzle');

  // Neon best practice: Use direct (unpooled) connection for schema migrations
  const connectionString = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  const isNeon = connectionString.includes('neon.tech') || connectionString.includes('sslmode=require');

  const migrationPool = new Pool({
    connectionString,
    ssl: isNeon ? { rejectUnauthorized: false } : undefined,
  });
  const migrationDb = drizzle(migrationPool, { schema });

  try {
    await migrate(migrationDb, { migrationsFolder });
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await migrationPool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}
