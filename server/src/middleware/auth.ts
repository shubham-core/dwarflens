import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { validateSession } from '../auth/sessions.js';
import { verifyApiKey } from '../auth/keys.js';
import { users } from '../db/schema.js';

export type UserSelect = typeof users.$inferSelect;

export interface ApiKeyContext {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  scopes: string[];
}

export interface AuthContextVariables {
  user: UserSelect | null;
  apiKey: ApiKeyContext | null;
  authType: 'session' | 'api_key' | null;
  orgId?: string;
  orgRole?: 'owner' | 'member' | 'viewer';
}

export const authenticate = createMiddleware<{
  Variables: AuthContextVariables;
}>(async (c, next) => {
  // 1. Check Authorization header (API key or Bearer session token)
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.startsWith('dl_live_')) {
      const apiKey = await verifyApiKey(token);
      if (apiKey) {
        c.set('apiKey', apiKey);
        c.set('authType', 'api_key');
        c.set('user', null);
        return next();
      }
    } else {
      const sessionData = await validateSession(token);
      if (sessionData) {
        c.set('user', sessionData.user);
        c.set('apiKey', null);
        c.set('authType', 'session');
        return next();
      }
    }
  }

  // 2. Check session cookie
  const sessionId = getCookie(c, 'dwarflens_session');
  if (sessionId) {
    const sessionData = await validateSession(sessionId);
    if (sessionData) {
      c.set('user', sessionData.user);
      c.set('apiKey', null);
      c.set('authType', 'session');
      return next();
    }
  }

  // Not authenticated
  c.set('user', null);
  c.set('apiKey', null);
  c.set('authType', null);
  return next();
});

export const requireAuth = createMiddleware<{
  Variables: AuthContextVariables;
}>(async (c, next) => {
  const user = c.get('user');
  const apiKey = c.get('apiKey');

  if (!user && !apiKey) {
    return c.json({ error: 'Unauthorized: Authentication required' }, 401);
  }

  return next();
});

export const requireUser = createMiddleware<{
  Variables: AuthContextVariables;
}>(async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized: User session required' }, 401);
  }
  return next();
});
