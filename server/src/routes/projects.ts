import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projects, apiKeys, orgMembers, orgs, users, OrgRole } from '../db/schema.js';
import { AuthContextVariables, requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org.js';
import { createApiKey } from '../auth/keys.js';
import { PLAN_LIMITS, PlanType } from '../billing/types.js';

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

// Delete Project (Owner only)
projectsRouter.delete('/projects/:id', requireAuth, async (c) => {
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

  // Authorization check (Only owner can delete project)
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

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Forbidden: Only organization owners can delete projects' }, 403);
    }
  }

  // Delete project (Postgres foreign keys cascade delete analyses, share links, and keys)
  await db.delete(projects).where(eq(projects.id, projectId));

  return c.json({ status: 'deleted', id: projectId });
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

// Configure Project Alerts
projectsRouter.put('/projects/:id/alerts', requireAuth, async (c) => {
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
      return c.json({ error: 'Forbidden: Insufficient permissions to modify alert settings' }, 403);
    }
  }

  const { slack_webhook_url, email } = await c.req.json();

  const currentSettings = (project.settings as Record<string, any>) || {};
  const updatedSettings = {
    ...currentSettings,
    alerts: {
      slack_webhook_url: slack_webhook_url ? String(slack_webhook_url) : undefined,
      email: email ? String(email) : undefined,
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

  return c.json({ project: updated, alerts: updatedSettings.alerts });
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
  const body = await c.req.json();
  const { name, slug, repo, is_private, settings } = body;

  if (!name || !slug || !repo) {
    return c.json({ error: 'name, slug, and repo are required' }, 400);
  }

  // Check plan limits
  const [org] = await db
    .select({ plan: orgs.plan })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);

  const plan = (org?.plan || 'free') as PlanType;
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  // 1. Max projects check
  const existingProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.orgId, orgId));

  if (existingProjects.length >= limits.maxProjects) {
    return c.json(
      {
        error: `Plan limit reached: The ${plan} plan allows up to ${limits.maxProjects} project(s). Upgrade to Pro for unlimited projects.`,
        plan,
        limit: limits.maxProjects,
      },
      403
    );
  }

  // 2. Private repo check
  const isPrivate = Boolean(is_private ?? settings?.is_private);
  if (isPrivate && !limits.allowPrivateRepos) {
    return c.json(
      {
        error: `Private repositories are not allowed on the ${plan} plan. Upgrade to Pro for private repository support.`,
        plan,
      },
      403
    );
  }

  const projectSettings = {
    ...(settings || {}),
    ...(isPrivate ? { is_private: true } : {}),
  };

  try {
    const [project] = await db
      .insert(projects)
      .values({
        orgId,
        name,
        slug,
        repo,
        settings: projectSettings,
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

// ---------------------------------------------------------------------------
// Org Members Management Routes
// ---------------------------------------------------------------------------

// List Org Members (Viewers, members, owners can list)
orgRouter.get('/orgs/:orgId/members', requireAuth, resolveOrg('viewer'), async (c) => {
  const orgId = c.get('orgId')!;

  const membersList = await db
    .select({
      id: orgMembers.id,
      orgId: orgMembers.orgId,
      userId: orgMembers.userId,
      role: orgMembers.role,
      createdAt: orgMembers.createdAt,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(eq(orgMembers.orgId, orgId));

  return c.json({ members: membersList });
});

// Invite / Add Org Member (Owner only)
orgRouter.post('/orgs/:orgId/members', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;
  const { email, role = 'member' } = await c.req.json();

  if (!email || typeof email !== 'string') {
    return c.json({ error: 'Valid email is required' }, 400);
  }

  const validRoles: OrgRole[] = ['owner', 'member', 'viewer'];
  if (!validRoles.includes(role)) {
    return c.json({ error: 'Invalid role. Must be owner, member, or viewer' }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Find or create user
  let [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (!targetUser) {
    [targetUser] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0],
      })
      .returning();
  }

  // Check if member already in org
  const [existingMember] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUser.id)))
    .limit(1);

  if (existingMember) {
    return c.json({ error: 'User is already a member of this organization' }, 409);
  }

  const [membership] = await db
    .insert(orgMembers)
    .values({
      orgId,
      userId: targetUser.id,
      role,
    })
    .returning();

  return c.json(
    {
      member: {
        id: membership.id,
        orgId: membership.orgId,
        userId: membership.userId,
        role: membership.role,
        createdAt: membership.createdAt,
        user: {
          id: targetUser.id,
          email: targetUser.email,
          name: targetUser.name,
        },
      },
    },
    201
  );
});

// Update Member Role (Owner only)
orgRouter.patch('/orgs/:orgId/members/:memberId', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;
  const memberId = c.req.param('memberId');
  const { role } = await c.req.json();

  const validRoles: OrgRole[] = ['owner', 'member', 'viewer'];
  if (!validRoles.includes(role)) {
    return c.json({ error: 'Invalid role. Must be owner, member, or viewer' }, 400);
  }

  const [target] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId)))
    .limit(1);

  if (!target) {
    return c.json({ error: 'Member not found' }, 404);
  }

  // Prevent demoting the last owner
  if (target.role === 'owner' && role !== 'owner') {
    const owners = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));

    if (owners.length <= 1) {
      return c.json({ error: 'Cannot demote the last organization owner' }, 400);
    }
  }

  const [updated] = await db
    .update(orgMembers)
    .set({ role })
    .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId)))
    .returning();

  return c.json({ member: updated });
});

// Remove Member (Owner only)
orgRouter.delete('/orgs/:orgId/members/:memberId', requireAuth, resolveOrg('owner'), async (c) => {
  const orgId = c.get('orgId')!;
  const memberId = c.req.param('memberId');

  const [target] = await db
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId)))
    .limit(1);

  if (!target) {
    return c.json({ error: 'Member not found' }, 404);
  }

  // Prevent removing the last owner
  if (target.role === 'owner') {
    const owners = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));

    if (owners.length <= 1) {
      return c.json({ error: 'Cannot remove the last organization owner' }, 400);
    }
  }

  await db
    .delete(orgMembers)
    .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId)));

  return c.json({ status: 'removed', id: memberId });
});

