import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authenticate } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { projectsRouter, orgRouter } from './routes/projects.js';
import { analysesRouter } from './routes/analyses.js';
import { sharesRouter } from './routes/shares.js';
import { billingRouter } from './routes/billing.js';

export const app = new Hono();

app.use('*', logger());
app.use('*', cors({
  origin: (origin) => origin || '*',
  credentials: true,
}));

// Apply authentication middleware to API routes
app.use('/api/*', authenticate);

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
