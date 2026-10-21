import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { users, sessions, orgs, orgMembers, projects } from '../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { createSession, validateSession, cleanupExpiredSessions } from '../src/auth/sessions.js';

describe('P2-17: Session Hardening & Safe Destructive Deletions', () => {
  let testUser: any;
  let testOrg: any;
  let testProject: any;
  let testSessionId: string;

  beforeEach(async () => {
    // Create test user and personal org
    const email = `session-test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
    const [u] = await db
      .insert(users)
      .values({
        email,
        emailVerified: true,
        name: 'Session Security User',
      })
      .returning();
    testUser = u;

    const [o] = await db
      .insert(orgs)
      .values({
        name: 'Session Security Org',
        slug: `sess-org-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      })
      .returning();
    testOrg = o;

    await db.insert(orgMembers).values({
      orgId: testOrg.id,
      userId: testUser.id,
      role: 'owner',
    });

    const [p] = await db
      .insert(projects)
      .values({
        orgId: testOrg.id,
        name: 'Mission Critical Project',
        slug: `mission-critical-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        repo: 'org/mission-critical',
        defaultBranch: 'main',
      })
      .returning();
    testProject = p;

    const sessionRes = await createSession(testUser.id);
    testSessionId = sessionRes.sessionId;
  });

  it('hashes session IDs in the database using SHA-256 (never stores raw session tokens in DB)', async () => {
    const expectedHash = crypto.createHash('sha256').update(testSessionId).digest('hex');

    // 1. Raw session token must NOT be present as an ID in the DB
    const [rawMatch] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, testSessionId))
      .limit(1);
    expect(rawMatch).toBeUndefined();

    // 2. The SHA-256 hashed token MUST be present in the DB
    const [hashedMatch] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, expectedHash))
      .limit(1);
    expect(hashedMatch).toBeDefined();
    expect(hashedMatch.userId).toBe(testUser.id);

    // 3. validateSession must successfully look up and validate using the raw session token
    const validated = await validateSession(testSessionId);
    expect(validated).not.toBeNull();
    expect(validated?.user.id).toBe(testUser.id);
  });

  it('cleans up expired sessions periodically via cleanupExpiredSessions', async () => {
    // Insert an expired session directly into DB
    const expiredToken = crypto.randomBytes(32).toString('hex');
    const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
    const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago

    await db.insert(sessions).values({
      id: expiredHash,
      userId: testUser.id,
      expiresAt: pastDate,
    });

    // Verify it exists in DB
    const [beforeCleanup] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, expiredHash))
      .limit(1);
    expect(beforeCleanup).toBeDefined();

    // Run cleanup
    const deletedCount = await cleanupExpiredSessions();
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    // Verify it is gone
    const [afterCleanup] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, expiredHash))
      .limit(1);
    expect(afterCleanup).toBeUndefined();
  });

  it('requires typed confirmation (project name) for project deletion and rejects missing/mismatched name', async () => {
    // 1. Deletion without confirmation body must be rejected (400)
    const resNoConfirm = await app.request(`/api/v1/projects/${testProject.id}`, {
      method: 'DELETE',
      headers: {
        Cookie: `dwarflens_session=${testSessionId}`,
      },
    });
    expect(resNoConfirm.status).toBe(400);
    const errNoConfirm = await resNoConfirm.json();
    expect(errNoConfirm.error).toMatch(/confirm/i);

    // 2. Deletion with wrong project name must be rejected (400)
    const resWrongConfirm = await app.request(`/api/v1/projects/${testProject.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${testSessionId}`,
      },
      body: JSON.stringify({ confirmName: 'Wrong Project Name' }),
    });
    expect(resWrongConfirm.status).toBe(400);

    // Project should still exist in DB
    const [stillExists] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, testProject.id))
      .limit(1);
    expect(stillExists).toBeDefined();

    // 3. Deletion with exact matching project name succeeds (200)
    const resSuccess = await app.request(`/api/v1/projects/${testProject.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${testSessionId}`,
      },
      body: JSON.stringify({ confirmName: 'Mission Critical Project' }),
    });
    expect(resSuccess.status).toBe(200);

    const [deleted] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, testProject.id))
      .limit(1);
    expect(deleted).toBeUndefined();
  });

  it('requires typed confirmation (account name or email) for account deletion and rejects missing/mismatched name', async () => {
    // 1. Deletion without confirmation body must be rejected (400)
    const resNoConfirm = await app.request('/api/v1/auth/me', {
      method: 'DELETE',
      headers: {
        Cookie: `dwarflens_session=${testSessionId}`,
      },
    });
    expect(resNoConfirm.status).toBe(400);
    const errNoConfirm = await resNoConfirm.json();
    expect(errNoConfirm.error).toMatch(/confirm/i);

    // 2. Deletion with wrong name must be rejected (400)
    const resWrongConfirm = await app.request('/api/v1/auth/me', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${testSessionId}`,
      },
      body: JSON.stringify({ confirmName: 'Someone Else' }),
    });
    expect(resWrongConfirm.status).toBe(400);

    // User should still exist in DB
    const [stillExists] = await db
      .select()
      .from(users)
      .where(eq(users.id, testUser.id))
      .limit(1);
    expect(stillExists).toBeDefined();

    // 3. Deletion with matching email succeeds (200)
    const resSuccess = await app.request('/api/v1/auth/me', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${testSessionId}`,
      },
      body: JSON.stringify({ confirmName: testUser.email }),
    });
    expect(resSuccess.status).toBe(200);

    const [deletedUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, testUser.id))
      .limit(1);
    expect(deletedUser).toBeUndefined();
  });

  it('does NOT delete organizations that still have other members when an owner deletes their account', async () => {
    // Create a multi-member organization
    const [sharedOrg] = await db
      .insert(orgs)
      .values({
        name: 'Multi-Member Shared Team',
        slug: `shared-team-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      })
      .returning();

    // Add testUser as owner
    await db.insert(orgMembers).values({
      orgId: sharedOrg.id,
      userId: testUser.id,
      role: 'owner',
    });

    // Add a second user as a member
    const [secondUser] = await db
      .insert(users)
      .values({
        email: `teammate-${Date.now()}@example.com`,
        emailVerified: true,
        name: 'Teammate Bob',
      })
      .returning();

    await db.insert(orgMembers).values({
      orgId: sharedOrg.id,
      userId: secondUser.id,
      role: 'member',
    });

    // Create a project inside this shared org
    const [sharedProject] = await db
      .insert(projects)
      .values({
        orgId: sharedOrg.id,
        name: 'Shared Team Project',
        slug: `shared-team-proj-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        repo: 'org/shared-team-proj',
        defaultBranch: 'main',
      })
      .returning();

    // testUser deletes their account
    const resDeleteAccount = await app.request('/api/v1/auth/me', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${testSessionId}`,
      },
      body: JSON.stringify({ confirmName: testUser.name }),
    });
    expect(resDeleteAccount.status).toBe(200);

    // The shared organization MUST NOT be deleted because it still has other members!
    const [orgStillExists] = await db
      .select()
      .from(orgs)
      .where(eq(orgs.id, sharedOrg.id))
      .limit(1);
    expect(orgStillExists).toBeDefined();

    // The shared project MUST NOT be deleted
    const [projectStillExists] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, sharedProject.id))
      .limit(1);
    expect(projectStillExists).toBeDefined();

    // The remaining teammate must still be in the org, and promoted to owner if no other owner existed
    const [teammateMember] = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, sharedOrg.id), eq(orgMembers.userId, secondUser.id)))
      .limit(1);
    expect(teammateMember).toBeDefined();
    expect(teammateMember.role).toBe('owner');
  });
});
