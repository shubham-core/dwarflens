import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projects, apiKeys, orgMembers, orgs } from '../db/schema.js';
import { AuthContextVariables, requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org.js';
import { createApiKey } from '../auth/keys.js';

export const projectsRouter = new Hono<{ Variables: AuthContextVariables }>();

// ---------------------------------------------------------------------------
// Single Project Lookup (Scoped to caller's org)
// ---------------------------------------------------------------------------
projectsRouter.get('/projects/:id', requireAuth, async (c) => {
  const projectId = c.req.param('id');
  const user = c.get('user');
  const apiKey = c.get('apiKey');

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  // Tenant Isolation Check
  if (apiKey) {
    if (apiKey.orgId !== project.orgId) {
      return c.json({ error: 'Forbidden: API key does not belong to this project organization' }, 403);
    }
    if (apiKey.projectId && apiKey.projectId !== project.id) {
      return c.json({ error: 'Forbidden: API key is scoped to a different project' }, 403);
    }
  } else if (user) {
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, project.orgId), eq(orgMembers.userId, user.id)))
      .limit(1);

    if (!membership) {
      return c.json({ error: 'Forbidden: You do not have access to this project' }, 403);
    }
  }

  return c.json({ project });
});

// Configure Project Budgets
projectsRouter.put('/projects/:id/budgets', requireAuth, async (c) => {
  const projectId = c.req.param('id');
  const user = c.get('user');
  const apiKey = c.get('apiKey');

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  // Authorization check (must be member or owner)
  if (apiKey) {
    if (apiKey.orgId !== project.orgId) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  } else if (user) {
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, project.orgId), eq(orgMembers.userId, user.id)))
      .limit(1);

    if (!membership || (membership.role !== 'owner' && membership.role !== 'member')) {
      return c.json({ error: 'Forbidden: Insufficient permissions to modify budgets' }, 403);
    }
  }

  const { max_total_size, max_growth_bytes, fail_on_padding_regression } = await c.req.json();

  const currentSettings = (project.settings as Record<string, any>) || {};
  const updatedSettings = {
    ...currentSettings,
    budgets: {
      max_total_size: max_total_size !== undefined ? Number(max_total_size) : undefined,
      max_growth_bytes: max_growth_bytes !== undefined ? Number(max_growth_bytes) : undefined,
      fail_on_padding_regression: Boolean(fail_on_padding_regression),
    },
  };

  const [updated] = await db
    .update(projects)
    .set({
      settings: updatedSettings,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();

  return c.json({ project: updated, budgets: updatedSettings.budgets });
});

// ---------------------------------------------------------------------------
// Org-Scoped Project Routes
// ---------------------------------------------------------------------------
export const orgRouter = new Hono<{ Variables: AuthContextVariables }>();

// List projects in Org
orgRouter.get('/orgs/:orgId/projects', requireAuth, resolveOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;

  const list = await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId));

  return c.json({ projects: list });
});

// Create project in Org
orgRouter.post('/orgs/:orgId/projects', requireAuth, resolveOrg('member'), async (c) => {
  const orgId = c.get('orgId')!;
  const { name, slug, repo, settings } = await c.req.json();

  if (!name || !slug || !repo) {
    return c.json({ error: 'name, slug, and repo are required' }, 400);
  }

  try {
    const [project] = await db
      .insert(projects)
      .values({
        orgId,
        name,
        slug,
        repo,
        settings: settings || {},
      })
      .returning();

    return c.json({ project }, 201);
  } catch (err: any) {
    if (err.code === '23505') {
      return c.json({ error: 'Project slug already exists in this organization' }, 409);
    }
    throw err;
  }
});

// Create API key in Org
orgRouter.post('/orgs/:orgId/keys', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;
  const { name, projectId } = await c.req.json();

  if (!name) {
    return c.json({ error: 'Key name is required' }, 400);
  }

  // If projectId is provided, verify it belongs to this org
  if (projectId) {
    const [proj] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .limit(1);

    if (!proj) {
      return c.json({ error: 'Project not found in this organization' }, 404);
    }
  }

  const { apiKey, rawKey } = await createApiKey({
    orgId,
    projectId,
    name,
  });

  return c.json({
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      projectId: apiKey.projectId,
      createdAt: apiKey.createdAt,
    },
    // Returned ONLY ONCE upon creation
    rawKey,
  }, 201);
});

// List API keys in Org
orgRouter.get('/orgs/:orgId/keys', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      projectId: apiKeys.projectId,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, orgId));

  return c.json({ keys });
});

// Revoke API key in Org
orgRouter.delete('/orgs/:orgId/keys/:keyId', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;
  const keyId = c.req.param('keyId');

  const [revoked] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId)))
    .returning();

  if (!revoked) {
    return c.json({ error: 'API key not found' }, 404);
  }

  return c.json({ status: 'revoked', id: revoked.id });
});
