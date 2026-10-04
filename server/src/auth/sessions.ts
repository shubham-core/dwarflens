import crypto from 'crypto';
import { eq, gt } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';

const SESSION_DURATION_DAYS = 7;

export async function createSession(userId: string): Promise<{
  sessionId: string;
  expiresAt: Date;
}> {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    expiresAt,
  });

  return { sessionId, expiresAt };
}

export async function validateSession(sessionId: string): Promise<{
  user: typeof users.$inferSelect;
  session: typeof sessions.$inferSelect;
} | null> {
  const [result] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!result) {
    return null;
  }

  // Check expiration
  if (result.session.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  return result;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
