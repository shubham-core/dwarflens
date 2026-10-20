import { serve } from '@hono/node-server';
import { app } from './app.js';
import { env } from './env.js';
import { runMigrations } from './db/migrate.js';

const port = env.PORT;

async function bootstrap() {
  try {
    await runMigrations();
  } catch (err) {
    console.error('Fatal: Failed to run database migrations at startup:', err);
    process.exit(1);
  }

  console.log(`DwarfLens API server running at http://localhost:${port}`);

  serve({
    fetch: app.fetch,
    port,
  });
}

bootstrap();
