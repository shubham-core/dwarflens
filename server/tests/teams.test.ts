import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { orgs, users, orgMembers } from '../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('Teams and Role Enforcement Suite (owner / member / viewer)', () => {
  const runId = Math.random().toString(36).substring(7);
  let orgId: string;
  let ownerSession: string;
  let memberSession: string;
  let viewerSession: string;
  let memberId: string;
  let viewerId: string;
  let projectId: string;
  let analysisId: string;

  beforeAll(async () => {
    // 1. Create Org and Owner
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({
        email: `team-owner-${runId}@example.com`,
        name: 'Team Owner',
        orgName: `Team Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    orgId = (await meRes.json()).orgs[0].orgId;

    // Set plan to 'team' so multi-project creation is permitted
    await db.update(orgs).set({ plan: 'team' }).where(eq(orgs.id, orgId));

    // 2. Create Member user
    const memberLogin = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({
        email: `team-member-${runId}@example.com`,
        name: 'Team Member',
      }),
    });
    memberSession = (await memberLogin.json()).sessionId;

    // 3. Create Viewer user
    const viewerLogin = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({
        email: `team-viewer-${runId}@example.com`,
        name: 'Team Viewer',
      }),
    });
    viewerSession = (await viewerLogin.json()).sessionId;

    // 4. Owner creates initial Project
    const projRes = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        name: 'Team Project',
        slug: `team-proj-${runId}`,
        repo: `team-org/team-proj-${runId}`,
      }),
    });
    projectId = (await projRes.json()).project.id;

    // 5. Ingest an initial analysis
    const ingestRes = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'team-binary.elf',
        file_size: 150000,
        format: 'ELF',
        metadata: {
          commit_sha: 'team-commit-001',
          branch: 'main',
        },
        sections: [{ name: '.text', category: 'code', size: 100000 }],
        symbols: [{ name: 'main', size: 100, type: 'FUNC' }],
        structs: [],
      }),
    });
    analysisId = (await ingestRes.json()).id;
  });

  // --- Member Invitation & Role Assignment ---

  it('allows owner to invite a member with "member" role via pending invitations', async () => {
    const inviteEmail = `team-member-invited-${runId}@example.com`;
    const inviteRes = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: inviteEmail,
        role: 'member',
      }),
    });

    expect(inviteRes.status).toBe(201);
    const inviteBody = await inviteRes.json();
    expect(inviteBody.invitation.role).toBe('member');
    expect(inviteBody.invitation.email).toBe(inviteEmail);
    const token = inviteBody.invitation.token;

    // Login as invitee and accept
    const loginRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const session = (await loginRes.json()).sessionId;

    const acceptRes = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${session}`,
      },
      body: JSON.stringify({ token }),
    });
    expect(acceptRes.status).toBe(200);

    const [m] = await db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.email, inviteEmail)))
      .limit(1);
    memberId = m.id;
  });

  it('allows owner to invite a member with "viewer" role via pending invitations', async () => {
    const inviteEmail = `team-viewer-invited-${runId}@example.com`;
    const inviteRes = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: inviteEmail,
        role: 'viewer',
      }),
    });

    expect(inviteRes.status).toBe(201);
    const inviteBody = await inviteRes.json();
    expect(inviteBody.invitation.role).toBe('viewer');
    const token = inviteBody.invitation.token;

    // Login as invitee and accept
    const loginRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const session = (await loginRes.json()).sessionId;

    const acceptRes = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${session}`,
      },
      body: JSON.stringify({ token }),
    });
    expect(acceptRes.status).toBe(200);

    const [v] = await db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.email, inviteEmail)))
      .limit(1);
    viewerId = v.id;
  });

  it('rejects duplicate invitations for existing members (409 Conflict)', async () => {
    const inviteEmail = `team-member-invited-${runId}@example.com`;
    const res = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: inviteEmail,
        role: 'member',
      }),
    });

    expect(res.status).toBe(409);
  });

  it('allows all roles to list organization members', async () => {
    // Add the active member and viewer sessions to org
    const mRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${memberSession}` },
    });
    const memberEmail = (await mRes.json()).user.email;
    const [mUser] = await db.select().from(users).where(eq(users.email, memberEmail)).limit(1);
    await db.insert(orgMembers).values({ orgId, userId: mUser.id, role: 'member' });

    const vRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${viewerSession}` },
    });
    const viewerEmail = (await vRes.json()).user.email;
    const [vUser] = await db.select().from(users).where(eq(users.email, viewerEmail)).limit(1);
    await db.insert(orgMembers).values({ orgId, userId: vUser.id, role: 'viewer' });

    // Check list as viewer
    const listAsViewer = await app.request(`/api/v1/orgs/${orgId}/members`, {
      headers: { Cookie: `dwarflens_session=${viewerSession}` },
    });
    expect(listAsViewer.status).toBe(200);
    const body = await listAsViewer.json();
    expect(body.members.length).toBeGreaterThanOrEqual(3);
  });

  // --- Role Enforcements on Endpoints ---

  it('enforces roles on member invitations (viewers and members get 403 Forbidden)', async () => {
    const resAsViewer = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${viewerSession}`,
      },
      body: JSON.stringify({ email: 'newbie@example.com', role: 'viewer' }),
    });
    expect(resAsViewer.status).toBe(403);

    const resAsMember = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${memberSession}`,
      },
      body: JSON.stringify({ email: 'newbie2@example.com', role: 'viewer' }),
    });
    expect(resAsMember.status).toBe(403);
  });

  it('enforces roles on project creation (members allowed, viewers forbidden)', async () => {
    // Member creates project -> 201
    const resMember = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${memberSession}`,
      },
      body: JSON.stringify({
        name: 'Member Project',
        slug: `member-proj-${Date.now().toString(36)}`,
        repo: 'org/member-proj',
      }),
    });
    expect(resMember.status).toBe(201);

    // Viewer creates project -> 403
    const resViewer = await app.request(`/api/v1/orgs/${orgId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${viewerSession}`,
      },
      body: JSON.stringify({
        name: 'Viewer Project',
        slug: `viewer-proj-${Date.now().toString(36)}`,
        repo: 'org/viewer-proj',
      }),
    });
    expect(resViewer.status).toBe(403);
  });

  it('enforces roles on API key creation (owner allowed, member/viewer forbidden)', async () => {
    // Member creates key -> 403
    const resMember = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${memberSession}`,
      },
      body: JSON.stringify({ name: 'Member Key', projectId }),
    });
    expect(resMember.status).toBe(403);

    // Viewer creates key -> 403
    const resViewer = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${viewerSession}`,
      },
      body: JSON.stringify({ name: 'Viewer Key', projectId }),
    });
    expect(resViewer.status).toBe(403);

    // Owner creates key -> 201
    const resOwner = await app.request(`/api/v1/orgs/${orgId}/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({ name: 'Owner Key', projectId }),
    });
    expect(resOwner.status).toBe(201);
  });

  it('enforces roles on share link creation (owner allowed, member/viewer forbidden)', async () => {
    // Member creates share link -> 403
    const resMember = await app.request(`/api/v1/analyses/${analysisId}/share`, {
      method: 'POST',
      headers: { Cookie: `dwarflens_session=${memberSession}` },
    });
    expect(resMember.status).toBe(403);

    // Viewer creates share link -> 403
    const resViewer = await app.request(`/api/v1/analyses/${analysisId}/share`, {
      method: 'POST',
      headers: { Cookie: `dwarflens_session=${viewerSession}` },
    });
    expect(resViewer.status).toBe(403);

    // Owner creates share link -> 201
    const resOwner = await app.request(`/api/v1/analyses/${analysisId}/share`, {
      method: 'POST',
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    expect(resOwner.status).toBe(201);
  });

  it('enforces roles on budgets and alerts modification (viewers forbidden)', async () => {
    // Viewer sets budgets -> 403
    const budgetRes = await app.request(`/api/v1/projects/${projectId}/budgets`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${viewerSession}`,
      },
      body: JSON.stringify({ max_total_size: 200000 }),
    });
    expect(budgetRes.status).toBe(403);

    // Viewer sets alerts -> 403
    const alertRes = await app.request(`/api/v1/projects/${projectId}/alerts`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${viewerSession}`,
      },
      body: JSON.stringify({ slack_webhook_url: 'https://hooks.slack.com/xxx' }),
    });
    expect(alertRes.status).toBe(403);

    // Member sets budgets -> 200
    const memberBudgetRes = await app.request(`/api/v1/projects/${projectId}/budgets`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${memberSession}`,
      },
      body: JSON.stringify({ max_total_size: 200000 }),
    });
    expect(memberBudgetRes.status).toBe(200);
  });

  it('enforces roles on analysis ingestion (viewers forbidden from writing)', async () => {
    // Viewer ingests analysis -> 403
    const resViewer = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${viewerSession}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'viewer-test.elf',
        file_size: 100000,
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-viewer-test',
          branch: 'main',
        },
        sections: [{ name: '.text', category: 'code', size: 50000 }],
        symbols: [],
        structs: [],
      }),
    });
    expect(resViewer.status).toBe(403);

    // Member ingests analysis -> 201
    const resMember = await app.request(`/api/v1/analyses?projectId=${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${memberSession}`,
        'X-Org-Id': orgId,
      },
      body: JSON.stringify({
        schema_version: 1,
        filename: 'member-test.elf',
        file_size: 100000,
        format: 'ELF',
        metadata: {
          commit_sha: 'commit-member-test',
          branch: 'main',
        },
        sections: [{ name: '.text', category: 'code', size: 50000 }],
        symbols: [],
        structs: [],
      }),
    });
    expect(resMember.status).toBe(201);
  });

  // --- Member Updates & Removals ---

  it('allows owner to update member role, but prevents demoting the last owner', async () => {
    // Update invited member role to viewer
    const updateRes = await app.request(`/api/v1/orgs/${orgId}/members/${memberId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({ role: 'viewer' }),
    });
    expect(updateRes.status).toBe(200);
    const body = await updateRes.json();
    expect(body.member.role).toBe('viewer');

    // Find the owner's member record id
    const membersRes = await app.request(`/api/v1/orgs/${orgId}/members`, {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    const allMembers = (await membersRes.json()).members;
    const ownerMember = allMembers.find((m: any) => m.role === 'owner');

    // Attempt to demote last owner -> 400 Bad Request
    const demoteOwnerRes = await app.request(`/api/v1/orgs/${orgId}/members/${ownerMember.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(demoteOwnerRes.status).toBe(400);
  });

  it('allows owner to remove a member, but prevents removing the last owner', async () => {
    // Find the owner's member record id
    const membersRes = await app.request(`/api/v1/orgs/${orgId}/members`, {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    const allMembers = (await membersRes.json()).members;
    const ownerMember = allMembers.find((m: any) => m.role === 'owner');

    // Attempt to delete last owner -> 400 Bad Request
    const deleteOwnerRes = await app.request(`/api/v1/orgs/${orgId}/members/${ownerMember.id}`, {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    expect(deleteOwnerRes.status).toBe(400);

    // Delete viewer member -> 200 OK
    const deleteViewerRes = await app.request(`/api/v1/orgs/${orgId}/members/${viewerId}`, {
      method: 'DELETE',
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    expect(deleteViewerRes.status).toBe(200);
    expect((await deleteViewerRes.json()).status).toBe('removed');
  });
});
