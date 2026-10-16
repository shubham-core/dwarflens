import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { orgs, users, orgMembers, invitations } from '../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

describe('P2-14: Pending Invitations Lifecycle & Security Hardening', () => {
  let orgId: string;
  let ownerSession: string;
  let inviteeVerifiedSession: string;
  let inviteeUnverifiedSession: string;
  let strangerVerifiedSession: string;
  let inviteeEmail: string;
  let strangerEmail: string;
  let inviteToken: string;
  let viewerInviteToken: string;
  const runId = Math.random().toString(36).substring(7);

  beforeAll(async () => {
    // 1. Create owner and org
    const ownerRes = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({
        email: `invite-owner-${runId}@example.com`,
        name: 'Invite Owner',
        orgName: `Invite Org ${runId}`,
      }),
    });
    ownerSession = (await ownerRes.json()).sessionId;

    const meRes = await app.request('/api/v1/auth/me', {
      headers: { Cookie: `dwarflens_session=${ownerSession}` },
    });
    orgId = (await meRes.json()).orgs[0].orgId;

    // 2. Create invitee user (initially unverified)
    inviteeEmail = `invitee-${runId}@example.com`.toLowerCase();
    const [unverifiedUser] = await db
      .insert(users)
      .values({
        email: inviteeEmail,
        name: 'Pending Invitee',
        emailVerified: false,
      })
      .returning();

    // Create session for unverified invitee
    const unverifiedLogin = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({ email: inviteeEmail }),
    });
    inviteeUnverifiedSession = (await unverifiedLogin.json()).sessionId;
    // Set emailVerified back to false (since dev-login sets true)
    await db.update(users).set({ emailVerified: false }).where(eq(users.id, unverifiedUser.id));

    // 3. Create a stranger user with verified email
    strangerEmail = `stranger-${runId}@example.com`.toLowerCase();
    const strangerLogin = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({ email: strangerEmail, name: 'Stranger' }),
    });
    strangerVerifiedSession = (await strangerLogin.json()).sessionId;
  });

  it('allows owner to create a pending invitation with a token stored as SHA-256 hash', async () => {
    const res = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: inviteeEmail,
        role: 'member',
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.invitation).toBeDefined();
    expect(data.invitation.token).toBeDefined();
    expect(data.invitation.email).toBe(inviteeEmail);
    expect(data.invitation.role).toBe('member');
    inviteToken = data.invitation.token;

    // Check expiry is ~7 days from now
    const expiresAt = new Date(data.invitation.expiresAt).getTime();
    const expectedExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(10000);

    // Verify token stored in DB is SHA-256 hash, NOT raw token
    const expectedHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
    const [invitationRow] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, expectedHash))
      .limit(1);
    expect(invitationRow).toBeDefined();
    expect(invitationRow.token).toBe(expectedHash);
    expect(invitationRow.token).not.toBe(inviteToken);

    // Verify user is NOT yet added to orgMembers
    const [existingMember] = await db
      .select()
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.email, inviteeEmail)))
      .limit(1);
    expect(existingMember).toBeUndefined();
  });

  it('rejects invitation creation with invalid or escalated role (400 Bad Request)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: 'attacker-role@example.com',
        role: 'superadmin',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invitation creation from non-owners (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${strangerVerifiedSession}`,
      },
      body: JSON.stringify({
        email: 'another@example.com',
        role: 'member',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects the old direct "add member instantly" path (POST /orgs/:orgId/members) (403 Forbidden)', async () => {
    const res = await app.request(`/api/v1/orgs/${orgId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: 'direct-bypass@example.com',
        role: 'member',
      }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/disabled/i);
  });

  it('rejects accepting invitation without authentication (401 Unauthorized)', async () => {
    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteToken }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects accepting invitation if logged-in user email is unverified (403 Forbidden)', async () => {
    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${inviteeUnverifiedSession}`,
      },
      body: JSON.stringify({ token: inviteToken }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/verified email/i);
  });

  it('rejects accepting invitation if logged-in user has a different email (403 Forbidden)', async () => {
    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${strangerVerifiedSession}`,
      },
      body: JSON.stringify({ token: inviteToken }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/different email/i);
  });

  it('successfully adds user to org when accepted with verified email matching invitation', async () => {
    // Verify invitee's email
    await db.update(users).set({ emailVerified: true }).where(eq(users.email, inviteeEmail));

    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${inviteeUnverifiedSession}`,
      },
      body: JSON.stringify({ token: inviteToken }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('accepted');
    expect(data.orgId).toBe(orgId);

    // Verify user is now an active org member
    const [membership] = await db
      .select()
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.email, inviteeEmail)))
      .limit(1);

    expect(membership).toBeDefined();
    expect(membership.org_members.role).toBe('member');
  });

  it('rejects accepting an already accepted invitation (single use) (400 Bad Request)', async () => {
    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${inviteeUnverifiedSession}`,
      },
      body: JSON.stringify({ token: inviteToken }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/already accepted|already used/i);
  });

  it('rejects accepting an expired invitation (400 Bad Request)', async () => {
    // Create an expired invitation directly
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    const expiredEmail = `expired-${runId}@example.com`.toLowerCase();

    await db.insert(invitations).values({
      orgId,
      email: expiredEmail,
      role: 'member',
      token: expiredHash,
      expiresAt: new Date(Date.now() - 3600000), // 1 hour in the past
    });

    // Create and login verified user with matching email
    const expiredLogin = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({ email: expiredEmail }),
    });
    const expiredSession = (await expiredLogin.json()).sessionId;

    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${expiredSession}`,
      },
      body: JSON.stringify({ token: expiredRawToken }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/expired/i);
  });

  it('prevents role escalation during invitation creation and acceptance', async () => {
    // 1. Create a viewer invite for a new user
    const viewerEmail = `viewer-invitee-${runId}@example.com`.toLowerCase();
    const createRes = await app.request(`/api/v1/orgs/${orgId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${ownerSession}`,
      },
      body: JSON.stringify({
        email: viewerEmail,
        role: 'viewer',
      }),
    });
    expect(createRes.status).toBe(201);
    viewerInviteToken = (await createRes.json()).invitation.token;

    // 2. Login as viewer invitee
    const viewerLogin = await app.request('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost:3000' },
      body: JSON.stringify({ email: viewerEmail }),
    });
    const viewerSession = (await viewerLogin.json()).sessionId;

    // 3. Attempt to accept with an escalated role payload
    const acceptRes = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `dwarflens_session=${viewerSession}`,
      },
      body: JSON.stringify({
        token: viewerInviteToken,
        role: 'owner', // Maliciously requested escalation
      }),
    });
    expect(acceptRes.status).toBe(200);

    // 4. Verify user was assigned ONLY 'viewer' role, not escalated
    const [membership] = await db
      .select()
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(and(eq(orgMembers.orgId, orgId), eq(users.email, viewerEmail)))
      .limit(1);

    expect(membership).toBeDefined();
    expect(membership.org_members.role).toBe('viewer');
    expect(membership.org_members.role).not.toBe('owner');
  });
});
