import { createMiddleware } from 'hono/factory';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const validateUuidMiddleware = createMiddleware(async (c, next) => {
  const path = c.req.path;
  const segments = path.split('/').filter(Boolean);

  // Prefixes after which the next path segment MUST be a UUID
  const uuidPrefixes = ['projects', 'orgs', 'keys', 'members', 'invites'];

  for (let i = 0; i < segments.length - 1; i++) {
    if (uuidPrefixes.includes(segments[i])) {
      const candidate = segments[i + 1];
      if (candidate && !UUID_REGEX.test(candidate)) {
        return c.json({ error: `Invalid UUID format for parameter after '${segments[i]}': '${candidate}'` }, 400);
      }
    }
  }

  // Analyses: /api/v1/analyses/:id (and /api/v1/analyses/:id/share)
  const analysesIdx = segments.indexOf('analyses');
  if (analysesIdx !== -1 && segments.length > analysesIdx + 1) {
    const candidate = segments[analysesIdx + 1];
    if (candidate && !UUID_REGEX.test(candidate)) {
      return c.json({ error: `Invalid UUID format for analysis ID: '${candidate}'` }, 400);
    }
  }

  // Check query parameters
  const queryProjectId = c.req.query('projectId');
  if (queryProjectId && !UUID_REGEX.test(queryProjectId)) {
    return c.json({ error: `Invalid UUID format for query parameter 'projectId': '${queryProjectId}'` }, 400);
  }

  const queryOrgId = c.req.query('orgId');
  if (queryOrgId && !UUID_REGEX.test(queryOrgId)) {
    return c.json({ error: `Invalid UUID format for query parameter 'orgId': '${queryOrgId}'` }, 400);
  }

  // Check header X-Org-Id
  const headerXOrgId = c.req.header('X-Org-Id');
  if (headerXOrgId && !UUID_REGEX.test(headerXOrgId)) {
    return c.json({ error: `Invalid UUID format for header 'X-Org-Id': '${headerXOrgId}'` }, 400);
  }

  await next();
});
