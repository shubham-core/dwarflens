import { createMiddleware } from 'hono/factory';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { orgMembers, projects, OrgRole } from '../db/schema.js';
import { AuthContextVariables } from './auth.js';

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  member: 2,
  owner: 3,
};

export function hasRequiredRole(actualRole: OrgRole, requiredRole: OrgRole): boolean {
  return ROLE_RANK[actualRole] >= ROLE_RANK[requiredRole];
}

export function resolveOrg(minRole: OrgRole = 'viewer') {
  return createMiddleware<{
    Variables: AuthContextVariables;
  }>(async (c, next) => {
    const user = c.get('user');
    const apiKey = c.get('apiKey');

    let targetOrgId = c.req.param('orgId') || c.req.header('X-Org-Id') || c.req.query('orgId');

    // If projectId is provided in route params or query, we can resolve targetOrgId from it
    const projectId = c.req.param('projectId') || (c.req.param('id') && c.req.path.includes('/projects/') ? c.req.param('id') : undefined);
    if (!targetOrgId && projectId) {
      const [proj] = await db
        .select({ orgId: projects.orgId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (proj) {
        targetOrgId = proj.orgId;
      } else {
        return c.json({ error: 'Project not found' }, 404);
      }
    }

    // 1. API Key Auth
    if (apiKey) {
      if (minRole === 'owner') {
        return c.json({ error: 'Forbidden: API keys cannot perform owner actions' }, 403);
      }

      // If a specific org was requested, verify it matches the API key's org
      if (targetOrgId && targetOrgId !== apiKey.orgId) {
        return c.json({ error: 'Forbidden: API key is not valid for this organization' }, 403);
      }

      // If projectId is targeted and the key is scoped to a specific project, verify it matches
      if (apiKey.projectId && projectId && apiKey.projectId !== projectId) {
        return c.json({ error: 'Forbidden: API key is not scoped to this project' }, 403);
      }

      c.set('orgId', apiKey.orgId);
      c.set('orgRole', 'member');
      return next();
    }

    // 2. User Session Auth
    if (user) {
      if (!targetOrgId) {
        return c.json({ error: 'Organization context required (via param, header, or project)' }, 400);
      }

      const [membership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, targetOrgId), eq(orgMembers.userId, user.id)))
        .limit(1);

      if (!membership) {
        return c.json({ error: 'Forbidden: User is not a member of this organization' }, 403);
      }

      const actualRole = membership.role as OrgRole;
      if (!hasRequiredRole(actualRole, minRole)) {
        return c.json({ error: `Forbidden: Requires ${minRole} role or higher` }, 403);
      }

      c.set('orgId', targetOrgId);
      c.set('orgRole', actualRole);
      return next();
    }

    return c.json({ error: 'Unauthorized: Authentication required' }, 401);
  });
}
