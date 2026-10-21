import crypto from 'crypto';
import { eq, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

const SESSION_DURATION_DAYS = 7;

/**
 * Computes the SHA-256 hash of a raw session token for storage.
 * Protects users from session hijacking if the database is read or dumped.
 */
export function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

export async function createSession(userId: string): Promise<{
  sessionId: string;
  expiresAt: Date;
}> {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const hashedId = hashSessionId(sessionId);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    id: hashedId,
    userId,
    expiresAt,
  });

  return { sessionId, expiresAt };
}

export async function validateSession(sessionId: string): Promise<{
  user: typeof users.$inferSelect;
  session: typeof sessions.$inferSelect;
} | null> {
  const hashedId = hashSessionId(sessionId);
  const [result] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, hashedId))
    .limit(1);

  if (!result) {
    return null;
  }

  // Check expiration
  if (result.session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, hashedId));
    return null;
  }

  return result;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const hashedId = hashSessionId(sessionId);
  await db.delete(sessions).where(eq(sessions.id, hashedId));
}

/**
 * Deletes all expired sessions from the database.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await db.delete(sessions).where(lte(sessions.expiresAt, new Date()));
  return (result as any).rowCount ?? 0;
}

// Periodic cleanup of expired sessions every hour
setInterval(() => {
  cleanupExpiredSessions().catch((err) => {
    console.error('[Session Cleanup] Periodic cleanup error:', err);
  });
}, 60 * 60 * 1000).unref();
