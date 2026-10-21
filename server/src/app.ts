import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import { authenticate } from './middleware/auth.js';
import { validateUuidMiddleware } from './middleware/validateUuid.js';
import { authRouter } from './routes/auth.js';
import { projectsRouter, orgRouter } from './routes/projects.js';
import { analysesRouter } from './routes/analyses.js';
import { sharesRouter } from './routes/shares.js';
import { billingRouter } from './routes/billing.js';

import { env } from './env.js';

export const app = new Hono();

// Global error handler (returning generic 500 JSON without stack trace leaks)
app.onError((err, c) => {
  // If JSON parsing error in request body
  if (err instanceof SyntaxError || (err as any).name === 'SyntaxError' || err.message?.includes('JSON')) {
    return c.json({ error: 'Malformed JSON in request body' }, 400);
  }

  // If Postgres UUID error
  if ((err as any).code === '22P02' || err.message?.includes('invalid input syntax for type uuid')) {
    return c.json({ error: 'Invalid UUID format' }, 400);
  }

  console.error('[Internal Server Error]', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Enforce 5 MB body limit on all incoming requests
app.use(
  '*',
  bodyLimit({
    maxSize: 5 * 1024 * 1024, // 5 MB
    onError: (c) => {
      return c.json({ error: 'Payload too large: Max allowed size is 5 MB' }, 413);
    },
  })
);

export function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(env.APP_URL).origin);
  } catch {
    allowed.add(env.APP_URL);
  }
  if (env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:5173');
    allowed.add('http://localhost:3000');
    allowed.add('http://127.0.0.1:5173');
    allowed.add('http://127.0.0.1:3000');
  }
  return allowed;
}

app.use('*', logger());

// Secure CORS middleware with allowlist enforcement
app.use('*', async (c, next) => {
  const origin = c.req.header('origin');
  const allowedOrigins = getAllowedOrigins();

  if (origin && allowedOrigins.has(origin)) {
    c.res.headers.set('Access-Control-Allow-Origin', origin);
    c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    c.res.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, PUT, POST, DELETE, PATCH, OPTIONS');
    const reqHeaders = c.req.header('access-control-request-headers');
    c.res.headers.set(
      'Access-Control-Allow-Headers',
      reqHeaders || 'Content-Type, Authorization, Stripe-Signature'
    );
    c.res.headers.set('Vary', 'Origin');

    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: c.res.headers });
    }
  } else if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 403 });
  }

  await next();
});

// Apply authentication and UUID parameter validation middleware to API routes
app.use('/api/*', validateUuidMiddleware);
app.use('/api/*', authenticate);

// Test error route for 500 error handler verification
if (env.NODE_ENV !== 'production') {
  app.get('/api/v1/throw-error-test', () => {
    throw new Error('Test internal error');
  });
}

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// Root endpoint: redirect browsers to GitHub Pages frontend, or return API status
app.get('/', (c) => {
  const accept = c.req.header('accept') || '';
  if (accept.includes('text/html')) {
    return c.redirect('https://shubham-core.github.io/dwarflens/');
  }
  return c.json({
    service: 'DwarfLens API',
    status: 'ok',
    version: '0.1.0',
    web: 'https://shubham-core.github.io/dwarflens/',
    health: '/health',
  });
});

// Mount routes
app.route('/api/v1/auth', authRouter);
app.route('/api/v1', projectsRouter);
app.route('/api/v1', orgRouter);
app.route('/api/v1', analysesRouter);
app.route('/api/v1', sharesRouter);
app.route('/api/v1', billingRouter);

export default app;
