import { Hono } from 'hono';
import crypto from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { analyses, projects, shareLinks, orgMembers } from '../db/schema.js';
import { env } from '../env.js';
import { AuthContextVariables, requireAuth } from '../middleware/auth.js';

export const sharesRouter = new Hono<{ Variables: AuthContextVariables }>();

// ---------------------------------------------------------------------------
// 1. Create Share Link (Owner only)
// ---------------------------------------------------------------------------
sharesRouter.post('/analyses/:id/share', requireAuth, async (c) => {
  const analysisId = c.req.param('id');
  const user = c.get('user');
  const apiKey = c.get('apiKey');

  const [item] = await db
    .select({
      analysis: analyses,
      orgId: projects.orgId,
    })
    .from(analyses)
    .innerJoin(projects, eq(analyses.projectId, projects.id))
    .where(eq(analyses.id, analysisId))
    .limit(1);

  if (!item) {
    return c.json({ error: 'Analysis not found' }, 404);
  }

  // Only human owners can create share links
  if (apiKey) {
    return c.json({ error: 'Forbidden: API keys cannot manage public share links' }, 403);
  } else if (user) {
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, item.orgId), eq(orgMembers.userId, user.id)))
      .limit(1);

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Forbidden: Only organization owners can generate public share links' }, 403);
    }
  }

  // Check if active share link already exists
  const [existing] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.analysisId, analysisId), isNull(shareLinks.revokedAt)))
    .limit(1);

  if (existing) {
    return c.json({
      token: existing.token,
      url: `${env.APP_URL}/#shared/${existing.token}`,
      status: 'existing',
    });
  }

  const token = crypto.randomBytes(16).toString('hex');
  const [created] = await db
    .insert(shareLinks)
    .values({
      analysisId,
      token,
    })
    .returning();

  return c.json(
    {
      token: created.token,
      url: `${env.APP_URL}/#shared/${created.token}`,
      status: 'created',
    },
    201
  );
});

// ---------------------------------------------------------------------------
// 2. Revoke Share Link (Owner only)
// ---------------------------------------------------------------------------
sharesRouter.delete('/analyses/:id/share', requireAuth, async (c) => {
  const analysisId = c.req.param('id');
  const user = c.get('user');
  const apiKey = c.get('apiKey');

  const [item] = await db
    .select({
      analysis: analyses,
      orgId: projects.orgId,
    })
    .from(analyses)
    .innerJoin(projects, eq(analyses.projectId, projects.id))
    .where(eq(analyses.id, analysisId))
    .limit(1);

  if (!item) {
    return c.json({ error: 'Analysis not found' }, 404);
  }

  // Only human owners can revoke share links
  if (apiKey) {
    return c.json({ error: 'Forbidden: API keys cannot manage public share links' }, 403);
  } else if (user) {
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, item.orgId), eq(orgMembers.userId, user.id)))
      .limit(1);

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Forbidden: Only organization owners can revoke public share links' }, 403);
    }
  }

  await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.analysisId, analysisId), isNull(shareLinks.revokedAt)));

  return c.json({ status: 'revoked' });
});

// ---------------------------------------------------------------------------
// 3. Public Read-Only Report Access (NO AUTH REQUIRED)
// ---------------------------------------------------------------------------
sharesRouter.get('/shared/:token', async (c) => {
  const token = c.req.param('token');

  const [link] = await db
    .select({
      shareLink: shareLinks,
      analysis: analyses,
      project: {
        name: projects.name,
        repo: projects.repo,
      },
    })
    .from(shareLinks)
    .innerJoin(analyses, eq(shareLinks.analysisId, analyses.id))
    .innerJoin(projects, eq(analyses.projectId, projects.id))
    .where(and(eq(shareLinks.token, token), isNull(shareLinks.revokedAt)))
    .limit(1);

  if (!link) {
    return c.json({ error: 'Shared report link not found, expired, or revoked' }, 404);
  }

  return c.json({
    analysis: link.analysis,
    project: link.project,
    shared_at: link.shareLink.createdAt,
  });
});
