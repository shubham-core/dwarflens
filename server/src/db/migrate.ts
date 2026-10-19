import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('Running database migrations...');
  const migrationsFolder = fs.existsSync(path.resolve(__dirname, '../../drizzle'))
    ? path.resolve(__dirname, '../../drizzle')
    : path.resolve(process.cwd(), 'drizzle');

  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}
