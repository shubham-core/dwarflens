import crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiKeys } from '../db/schema.js';

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function generateRawKey(): { rawKey: string; prefix: string } {
  const secret = crypto.randomBytes(24).toString('hex');
  const rawKey = `dl_live_${secret}`;
  const prefix = `dl_live_${secret.slice(0, 6)}...`;
  return { rawKey, prefix };
}

export async function createApiKey(params: {
  orgId: string;
  projectId?: string;
  name: string;
  scopes?: string[];
}): Promise<{ apiKey: typeof apiKeys.$inferSelect; rawKey: string }> {
  const { rawKey, prefix } = generateRawKey();
  const keyHash = hashApiKey(rawKey);

  const [inserted] = await db
    .insert(apiKeys)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      name: params.name,
      scopes: params.scopes || ['ingest:write'],
      keyHash,
      prefix,
    })
    .returning();

  return { apiKey: inserted, rawKey };
}

export async function verifyApiKey(rawKey: string): Promise<{
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  scopes: string[];
} | null> {
  if (!rawKey.startsWith('dl_live_')) {
    return null;
  }

  const keyHash = hashApiKey(rawKey);
  const [found] = await db
    .select({
      id: apiKeys.id,
      orgId: apiKeys.orgId,
      projectId: apiKeys.projectId,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!found) {
    return null;
  }

  // Update lastUsedAt asynchronously
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, found.id))
    .catch((err) => console.error('Failed to update lastUsedAt:', err));

  return found;
}
