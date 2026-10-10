import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { analyses, projects, orgMembers, orgs } from '../db/schema.js';
import { AuthContextVariables, requireAuth } from '../middleware/auth.js';
import { PLAN_LIMITS, PlanType } from '../billing/types.js';
import { validateAnalysisJson, getValidationErrors } from '../schema/validator.js';
import { rateLimiter } from '../middleware/rateLimit.js';
import { computeAnalysisDiff } from '../diff/engine.js';
import { evaluateBudgets } from '../budgets/evaluator.js';
import { sendBudgetAlerts } from '../alerts/notifier.js';

export const analysesRouter = new Hono<{ Variables: AuthContextVariables }>();

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// 1. Ingest Analysis (POST /api/v1/analyses)
// ---------------------------------------------------------------------------
analysesRouter.post(
  '/analyses',
  requireAuth,
  rateLimiter(100),
  async (c) => {
    // Check Content-Length header first
    const contentLength = Number(c.req.header('content-length') || 0);
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return c.json({ error: 'Payload too large: Max allowed size is 5 MB' }, 413);
    }

    const rawBody = await c.req.text();
    if (Buffer.byteLength(rawBody, 'utf-8') > MAX_PAYLOAD_BYTES) {
      return c.json({ error: 'Payload too large: Max allowed size is 5 MB' }, 413);
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch (e: any) {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    // JSON Schema validation
    const isValid = validateAnalysisJson(payload);
    if (!isValid) {
      return c.json(
        {
          error: 'Analysis JSON does not conform to analysis.v1 schema',
          details: getValidationErrors(),
        },
        422
      );
    }

    const user = c.get('user');
    const apiKey = c.get('apiKey');

    // Resolve Org ID
    let orgId = apiKey?.orgId;
    if (!orgId && user) {
      // If user session, orgId can be passed via header or query or metadata
      orgId = c.req.header('X-Org-Id') || c.req.query('orgId');
      if (!orgId) {
        // Fallback to first user org
        const [firstMember] = await db
          .select({ orgId: orgMembers.orgId })
          .from(orgMembers)
          .where(eq(orgMembers.userId, user.id))
          .limit(1);
        orgId = firstMember?.orgId;
      }
    }

    if (!orgId) {
      return c.json({ error: 'Organization context required' }, 400);
    }

    // Role enforcement for user sessions: viewers cannot ingest analyses
    if (user) {
      const [membership] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)))
        .limit(1);

      if (!membership) {
        return c.json({ error: 'Forbidden: User is not a member of this organization' }, 403);
      }
      if (membership.role !== 'owner' && membership.role !== 'member') {
        return c.json({ error: 'Forbidden: Viewers have read-only access' }, 403);
      }
    }

    // Resolve target Project
    let projectId = c.req.query('projectId') || payload.project_id || apiKey?.projectId;
    let project: any;

    if (projectId) {
      [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
        .limit(1);
    } else if (payload.metadata?.repo) {
      // Match by repo within caller's org
      [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.repo, payload.metadata.repo), eq(projects.orgId, orgId)))
        .limit(1);

      // Auto-create project if it doesn't exist yet for this repo
      if (!project) {
        // Enforce plan limit before creating project
        const [org] = await db
          .select({ plan: orgs.plan })
          .from(orgs)
          .where(eq(orgs.id, orgId))
          .limit(1);

        const plan = (org?.plan || 'free') as PlanType;
        const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

        const existingProjects = await db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.orgId, orgId));

        if (typeof limits.maxProjects === 'number' && existingProjects.length >= limits.maxProjects) {
          return c.json(
            {
              error: `Plan limit reached: The ${plan} plan allows up to ${limits.maxProjects} project(s). Upgrade to Pro to add more projects.`,
              plan,
            },
            403
          );
        }

        const repoName = payload.metadata.repo.split('/').pop() || 'binary';
        const slug = `${repoName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`;
        [project] = await db
          .insert(projects)
          .values({
            orgId,
            name: repoName,
            slug,
            repo: payload.metadata.repo,
          })
          .returning();
      }
    }

    if (!project) {
      return c.json({ error: 'Project not found or not accessible within this organization' }, 404);
    }

    // If API key is scoped to a specific project, verify match
    if (apiKey?.projectId && apiKey.projectId !== project.id) {
      return c.json({ error: 'Forbidden: API key is not authorized for this project' }, 403);
    }

    const commitSha = payload.metadata?.commit_sha || payload.commit_sha || 'unknown-sha';
    const branch = payload.metadata?.branch || payload.branch || 'main';
    const buildName = payload.metadata?.build_name || payload.build_name || 'default';

    // Idempotency check on (project_id, commit_sha, build_name)
    const [existing] = await db
      .select()
      .from(analyses)
      .where(
        and(
          eq(analyses.projectId, project.id),
          eq(analyses.commitSha, commitSha),
          eq(analyses.buildName, buildName)
        )
      )
      .limit(1);

    // Calculate summary metrics
    const totalSize = Number(payload.file_size || 0);
    const flashSize = Number(payload.flash_size || 0);
    const ramSize = Number(payload.ram_size || 0);
    const structCount = payload.structs?.length || 0;
    const symbolCount = payload.symbols?.length || 0;

    let paddingBytes = 0;
    let cacheLineCrossings = 0;
    for (const st of payload.structs || []) {
      paddingBytes += Number(st.total_padding_bytes || 0);
      cacheLineCrossings += (st.cache_line_crossings?.length || 0);
    }

    // Look up base analysis for growth/padding comparisons
    const baseCommit = c.req.query('base') || payload.metadata?.base_commit_sha;
    let baseAnalysis: any = null;
    if (baseCommit) {
      [baseAnalysis] = await db
        .select()
        .from(analyses)
        .where(and(eq(analyses.projectId, project.id), eq(analyses.commitSha, baseCommit)))
        .orderBy(desc(analyses.createdAt))
        .limit(1);
    } else {
      [baseAnalysis] = await db
        .select()
        .from(analyses)
        .where(and(eq(analyses.projectId, project.id), eq(analyses.branch, 'main')))
        .orderBy(desc(analyses.createdAt))
        .limit(1);
    }

    const budgets = (project.settings as Record<string, any>)?.budgets;
    const budgetStatus = evaluateBudgets({
      budgets,
      currentSize: totalSize,
      currentPadding: paddingBytes,
      baseSize: baseAnalysis?.totalSize,
      basePadding: baseAnalysis?.paddingBytes,
    });

    if (existing) {
      return c.json(
        {
          status: 'existing',
          id: existing.id,
          project_id: existing.projectId,
          commit_sha: existing.commitSha,
          build_name: existing.buildName,
          created_at: existing.createdAt,
          budget_status: budgetStatus,
        },
        200
      );
    }

    // Insert analysis
    const [inserted] = await db
      .insert(analyses)
      .values({
        projectId: project.id,
        commitSha,
        branch,
        buildName,
        totalSize,
        flashSize,
        ramSize,
        structCount,
        symbolCount,
        paddingBytes,
        cacheLineCrossings,
        rawData: payload,
      })
      .returning();

    if (!budgetStatus.passed) {
      await sendBudgetAlerts({
        project,
        analysis: inserted,
        reasons: budgetStatus.reasons,
      }).catch((err) => {
        console.error('[alerts] Failed to send budget alerts:', err);
      });
    }

    return c.json(
      {
        status: 'created',
        id: inserted.id,
        project_id: inserted.projectId,
        commit_sha: inserted.commitSha,
        branch: inserted.branch,
        build_name: inserted.buildName,
        created_at: inserted.createdAt,
        budget_status: budgetStatus,
      },
      201
    );
  }
);

// ---------------------------------------------------------------------------
// 2. List Project Analyses (GET /api/v1/projects/:id/analyses)
// ---------------------------------------------------------------------------
analysesRouter.get('/projects/:id/analyses', requireAuth, async (c) => {
  const projectId = c.req.param('id');
  const user = c.get('user');
  const apiKey = c.get('apiKey');

  // Verify project access
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  if (apiKey && apiKey.orgId !== project.orgId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (user) {
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, project.orgId), eq(orgMembers.userId, user.id)))
      .limit(1);
    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  const branch = c.req.query('branch');
  const limit = Math.min(Number(c.req.query('limit') || 50), 100);
  const offset = Number(c.req.query('offset') || 0);

  const queryConditions = [eq(analyses.projectId, projectId)];
  if (branch) {
    queryConditions.push(eq(analyses.branch, branch));
  }

  const list = await db
    .select({
      id: analyses.id,
      projectId: analyses.projectId,
      commitSha: analyses.commitSha,
      branch: analyses.branch,
      buildName: analyses.buildName,
      createdAt: analyses.createdAt,
      totalSize: analyses.totalSize,
      flashSize: analyses.flashSize,
      ramSize: analyses.ramSize,
      structCount: analyses.structCount,
      symbolCount: analyses.symbolCount,
      paddingBytes: analyses.paddingBytes,
      cacheLineCrossings: analyses.cacheLineCrossings,
    })
    .from(analyses)
    .where(and(...queryConditions))
    .orderBy(desc(analyses.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ analyses: list });
});

// ---------------------------------------------------------------------------
// 3. Get Analysis by ID (GET /api/v1/analyses/:id)
// ---------------------------------------------------------------------------
analysesRouter.get('/analyses/:id', requireAuth, async (c) => {
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

  // Tenant isolation check
  if (apiKey && apiKey.orgId !== item.orgId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (user) {
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, item.orgId), eq(orgMembers.userId, user.id)))
      .limit(1);
    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  return c.json({ analysis: item.analysis });
});

// ---------------------------------------------------------------------------
// 4. Compare Two Analyses (GET /api/v1/projects/:id/diff?base=&head=)
// ---------------------------------------------------------------------------
analysesRouter.get('/projects/:id/diff', requireAuth, async (c) => {
  const projectId = c.req.param('id');
  const baseParam = c.req.query('base');
  const headParam = c.req.query('head');

  if (!baseParam || !headParam) {
    return c.json({ error: 'Query parameters base and head are required' }, 400);
  }

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

  // Tenant verification
  if (apiKey && apiKey.orgId !== project.orgId) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (user) {
    const [membership] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, project.orgId), eq(orgMembers.userId, user.id)))
      .limit(1);
    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }

  // Fetch base analysis by ID or commitSha
  const [baseAnalysis] = await db
    .select()
    .from(analyses)
    .where(
      and(
        eq(analyses.projectId, projectId),
        baseParam.length === 36
          ? eq(analyses.id, baseParam)
          : eq(analyses.commitSha, baseParam)
      )
    )
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  if (!baseAnalysis) {
    return c.json({ error: `Base analysis not found for '${baseParam}'` }, 404);
  }

  // Fetch head analysis by ID or commitSha
  const [headAnalysis] = await db
    .select()
    .from(analyses)
    .where(
      and(
        eq(analyses.projectId, projectId),
        headParam.length === 36
          ? eq(analyses.id, headParam)
          : eq(analyses.commitSha, headParam)
      )
    )
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  if (!headAnalysis) {
    return c.json({ error: `Head analysis not found for '${headParam}'` }, 404);
  }

  const diff = computeAnalysisDiff(baseAnalysis, headAnalysis);
  return c.json({ diff });
});
