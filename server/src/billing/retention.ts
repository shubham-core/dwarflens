import { db } from '../db/client.js';
import { analyses, projects, orgs } from '../db/schema.js';
import { eq, and, lt, inArray } from 'drizzle-orm';
import { PLAN_LIMITS } from './types.js';

export interface RetentionCleanupReport {
  freeAnalysesDeleted: number;
  proAnalysesDeleted: number;
  totalDeleted: number;
}

export async function runRetentionCleanup(overrideDate?: Date): Promise<RetentionCleanupReport> {
  const now = overrideDate || new Date();
  let freeDeleted = 0;
  let proDeleted = 0;

  // 1. Free plan cleanup: older than 30 days
  const freeCutoff = new Date(now.getTime() - PLAN_LIMITS.free.retentionDays * 24 * 60 * 60 * 1000);
  const freeProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(orgs, eq(projects.orgId, orgs.id))
    .where(eq(orgs.plan, 'free'));

  if (freeProjects.length > 0) {
    const projectIds = freeProjects.map((p) => p.id);
    const deleted = await db
      .delete(analyses)
      .where(
        and(
          inArray(analyses.projectId, projectIds),
          lt(analyses.createdAt, freeCutoff)
        )
      )
      .returning({ id: analyses.id });
    freeDeleted = deleted.length;
  }

  // 2. Pro plan cleanup: older than 365 days
  const proCutoff = new Date(now.getTime() - PLAN_LIMITS.pro.retentionDays * 24 * 60 * 60 * 1000);
  const proProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(orgs, eq(projects.orgId, orgs.id))
    .where(eq(orgs.plan, 'pro'));

  if (proProjects.length > 0) {
    const projectIds = proProjects.map((p) => p.id);
    const deleted = await db
      .delete(analyses)
      .where(
        and(
          inArray(analyses.projectId, projectIds),
          lt(analyses.createdAt, proCutoff)
        )
      )
      .returning({ id: analyses.id });
    proDeleted = deleted.length;
  }

  return {
    freeAnalysesDeleted: freeDeleted,
    proAnalysesDeleted: proDeleted,
    totalDeleted: freeDeleted + proDeleted,
  };
}
