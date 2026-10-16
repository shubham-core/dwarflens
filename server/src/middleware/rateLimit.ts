import { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { AuthContextVariables } from './auth.js';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  keyPrefix?: string;
  skipSuccessfulRequests?: boolean;
}

const defaultWindowMs = 60 * 1000; // 1 minute
const defaultMaxRequests = 60; // 60 requests per minute
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

/**
 * Resets the in-memory rate limit store (for test suites).
 */
export function resetRateLimitStore(): void {
  store.clear();
}

/**
 * Extracts the trusted client IP address from request headers.
 * Protects against X-Forwarded-For spoofing by client injection:
 * 1. Cloudflare / CDN headers (cf-connecting-ip, true-client-ip)
 * 2. In reverse-proxy chains (e.g. Render / AWS ALB), the rightmost IP in X-Forwarded-For
 *    is appended by the nearest trusted reverse proxy, ignoring attacker-controlled prefixes.
 * 3. Fallback to 127.0.0.1.
 */
export function getTrustedClientIp(c: Context): string {
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  const trueClientIp = c.req.header('true-client-ip');
  if (trueClientIp) return trueClientIp.trim();

  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  return '127.0.0.1';
}

export function rateLimiter(options: number | RateLimiterOptions = defaultMaxRequests) {
  const opts: RateLimiterOptions = typeof options === 'number' ? { limit: options } : options;
  const limit = opts.limit ?? defaultMaxRequests;
  const windowMs = opts.windowMs ?? defaultWindowMs;
  const keyPrefix = opts.keyPrefix ?? '';

  return createMiddleware<{
    Variables: AuthContextVariables;
  }>(async (c, next) => {
    const apiKey = c.get('apiKey');
    const user = c.get('user');
    const ip = getTrustedClientIp(c);

    const prefix = keyPrefix ? `${keyPrefix}:` : '';
    const identifier = apiKey
      ? `key:${prefix}${apiKey.id}`
      : user
      ? `user:${prefix}${user.id}`
      : `ip:${prefix}${ip}`;

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
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      c.header('Retry-After', retryAfter.toString());
      return c.json(
        { error: 'Too many requests. Please slow down and try again later.' },
        429
      );
    }

    return next();
  });
}
