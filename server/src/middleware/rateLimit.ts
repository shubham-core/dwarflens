import { createMiddleware } from 'hono/factory';
import { AuthContextVariables } from './auth.js';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const windowMs = 60 * 1000; // 1 minute
const maxRequests = 60; // 60 requests per minute
const store = new Map<string, RateLimitRecord>();

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (record.resetAt <= now) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export function rateLimiter(limit: number = maxRequests) {
  return createMiddleware<{
    Variables: AuthContextVariables;
  }>(async (c, next) => {
    const apiKey = c.get('apiKey');
    const user = c.get('user');
    const ip = c.req.header('x-forwarded-for') || 'default-client';

    const identifier = apiKey ? `key:${apiKey.id}` : user ? `user:${user.id}` : `ip:${ip}`;
    const now = Date.now();

    let record = store.get(identifier);
    if (!record || record.resetAt <= now) {
      record = { count: 1, resetAt: now + windowMs };
      store.set(identifier, record);
    } else {
      record.count++;
    }

    c.header('X-RateLimit-Limit', limit.toString());
    c.header('X-RateLimit-Remaining', Math.max(0, limit - record.count).toString());
    c.header('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000).toString());

    if (record.count > limit) {
      return c.json(
        { error: 'Too many requests. Please slow down and try again later.' },
        429
      );
    }

    return next();
  });
}
