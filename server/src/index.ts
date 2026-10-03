import { serve } from '@hono/node-server';
import { app } from './app.js';
import { env } from './env.js';

const port = env.PORT;

console.log(`DwarfLens API server running at http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
