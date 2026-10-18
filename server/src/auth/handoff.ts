import crypto from 'crypto';

interface OneTimeCodeEntry {
  sessionId: string;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 60 * 1000; // 60 seconds
const codeStore = new Map<string, OneTimeCodeEntry>();

// Periodic garbage collection for expired codes
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of codeStore.entries()) {
    if (entry.expiresAt <= now) {
      codeStore.delete(code);
    }
  }
}, 60 * 1000).unref();

/**
 * Creates a short-lived single-use authorization code bound to an active session.
 */
export function createOneTimeCode(sessionId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const code = crypto.randomBytes(32).toString('hex');
  codeStore.set(code, {
    sessionId,
    expiresAt: Date.now() + ttlMs,
  });
  return code;
}

/**
 * Atomically exchanges a single-use code for its bound session ID.
 * The code is immediately purged to prevent replay attacks.
 */
export function exchangeOneTimeCode(code: string): string | null {
  if (!code) return null;
  const entry = codeStore.get(code);
  if (!entry) return null;

  // Single-use: purge immediately
  codeStore.delete(code);

  if (entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry.sessionId;
}
