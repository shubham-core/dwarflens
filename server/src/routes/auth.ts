import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, orgs, orgMembers } from '../db/schema.js';
import { env } from '../env.js';
import {
  getGitHubAuthUrl,
  exchangeGitHubCode,
  getGitHubUserProfile,
} from '../auth/github.js';
import { createSession, deleteSession } from '../auth/sessions.js';
import { AuthContextVariables, requireAuth, requireUser } from '../middleware/auth.js';

export const authRouter = new Hono<{ Variables: AuthContextVariables }>();

// 1. Initiate GitHub OAuth
authRouter.get('/github', (c) => {
  const state = crypto.randomBytes(16).toString('hex');
  const reqHost = c.req.header('x-forwarded-host') || c.req.header('host');
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const dynamicRedirectUri = reqHost && !reqHost.includes('localhost')
    ? `${proto}://${reqHost}/api/v1/auth/github/callback`
    : undefined;

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  return c.redirect(getGitHubAuthUrl(state, dynamicRedirectUri));
});

// 2. GitHub OAuth Callback
authRouter.get('/github/callback', async (c) => {
  const code = c.req.query('code');
  const queryState = c.req.query('state');
  const cookieState = getCookie(c, 'oauth_state');

  // Verify OAuth state cookie
  if (!queryState || !cookieState) {
    return c.json({ error: 'Missing OAuth state parameter or state cookie' }, 403);
  }

  const queryBuf = Buffer.from(queryState, 'utf8');
  const cookieBuf = Buffer.from(cookieState, 'utf8');
  if (queryBuf.length !== cookieBuf.length || !crypto.timingSafeEqual(queryBuf, cookieBuf)) {
    return c.json({ error: 'Invalid OAuth state parameter' }, 403);
  }

  deleteCookie(c, 'oauth_state');

  if (!code) {
    return c.json({ error: 'Missing OAuth authorization code' }, 400);
  }

  try {
    const accessToken = await exchangeGitHubCode(code);
    const profile = await getGitHubUserProfile(accessToken);

    // Upsert user
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.githubId, profile.githubId))
      .limit(1);

    if (!user) {
      // Link account ONLY if email is verified
      let existingEmailUser: typeof users.$inferSelect | undefined;
      if (profile.emailVerified && profile.email) {
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, profile.email))
          .limit(1);
        existingEmailUser = existing;
      }

      if (existingEmailUser) {
        user = (
          await db
            .update(users)
            .set({
              githubId: profile.githubId,
              avatarUrl: profile.avatarUrl,
              emailVerified: profile.emailVerified,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existingEmailUser.id))
            .returning()
        )[0];
      } else {
        // If email is unverified and clashes with an existing user, use a safe noreply address
        let insertEmail = profile.email;
        if (!profile.emailVerified) {
          const [taken] = await db.select().from(users).where(eq(users.email, insertEmail)).limit(1);
          if (taken) {
            insertEmail = `gh_${profile.githubId}_${Date.now()}@users.noreply.dwarflens.com`;
          }
        }

        user = (
          await db
            .insert(users)
            .values({
              githubId: profile.githubId,
              email: insertEmail,
              emailVerified: profile.emailVerified,
              name: profile.name,
              avatarUrl: profile.avatarUrl,
            })
            .returning()
        )[0];

        // Create default personal organization for new user
        const orgSlug = `${profile.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
        const [org] = await db
          .insert(orgs)
          .values({
            name: `${profile.name}'s Org`,
            slug: orgSlug,
          })
          .returning();

        await db.insert(orgMembers).values({
          orgId: org.id,
          userId: user.id,
          role: 'owner',
        });
      }
    }

    const { sessionId, expiresAt } = await createSession(user.id);

    setCookie(c, 'dwarflens_session', sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
      path: '/',
      expires: expiresAt,
    });

    const targetUrl = new URL(env.APP_URL);
    targetUrl.hash = '#projects';
    return c.redirect(targetUrl.toString());
  } catch (err: any) {
    console.error('OAuth callback error:', err);
    return c.json({ error: 'OAuth authentication failed', details: err.message }, 500);
  }
});

// 3. Dev login for test suites and local development ONLY (never enabled in production)
authRouter.post('/dev-login', async (c) => {
  // Only allow when NODE_ENV is explicitly 'development' or 'test'
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    return c.json({ error: 'Not found' }, 404);
  }

  // Enforce that request strictly comes from localhost
  const host = (c.req.header('host') || '').split(':')[0].toLowerCase();
  const forwarded = c.req.header('x-forwarded-for');
  const clientIp = (forwarded ? forwarded.split(',')[0].trim() : '').toLowerCase();

  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isLocalIp = !clientIp || clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost';

  if (!isLocalHost || !isLocalIp) {
    return c.json({ error: 'Not found' }, 404);
  }

  const { email, name, orgName } = await c.req.json();
  if (!email) {
    return c.json({ error: 'Email required' }, 400);
  }

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        email,
        emailVerified: true,
        name: name || email.split('@')[0],
      })
      .returning();

    const slug = `${(orgName || user.name || 'org').toLowerCase().replace(/[^a-z0-9]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const [org] = await db
      .insert(orgs)
      .values({
        name: orgName || `${user.name}'s Org`,
        slug,
      })
      .returning();

    await db.insert(orgMembers).values({
      orgId: org.id,
      userId: user.id,
      role: 'owner',
    });
  }

  const { sessionId, expiresAt } = await createSession(user.id);

  setCookie(c, 'dwarflens_session', sessionId, {
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });

  return c.json({
    user,
    sessionId,
  });
});

// 4. Get current user and organizations
authRouter.get('/me', requireUser, async (c) => {
  const user = c.get('user')!;

  const memberships = await db
    .select({
      role: orgMembers.role,
      orgId: orgs.id,
      orgName: orgs.name,
      orgSlug: orgs.slug,
    })
    .from(orgMembers)
    .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
    .where(eq(orgMembers.userId, user.id));

  return c.json({
    user,
    orgs: memberships,
  });
});

// 5. Logout
authRouter.post('/logout', async (c) => {
  const sessionId = c.req.header('cookie')?.match(/dwarflens_session=([^;]+)/)?.[1];
  if (sessionId) {
    await deleteSession(sessionId);
  }

  deleteCookie(c, 'dwarflens_session', { path: '/' });
  return c.json({ status: 'logged_out' });
});

// 6. Delete Account (Permanently erase user and personal organizations)
authRouter.delete('/me', requireUser, async (c) => {
  const user = c.get('user')!;

  // Find organizations where this user is an owner
  const ownerMemberships = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, user.id), eq(orgMembers.role, 'owner')));

  for (const m of ownerMemberships) {
    // If no other owners exist in this org, delete the entire org (cascading all projects & analyses)
    const otherOwners = await db
      .select({ id: orgMembers.id })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, m.orgId), eq(orgMembers.role, 'owner')));

    if (otherOwners.length <= 1) {
      await db.delete(orgs).where(eq(orgs.id, m.orgId));
    }
  }

  // Delete user record (cascades sessions and remaining memberships)
  await db.delete(users).where(eq(users.id, user.id));

  // Clear session cookie
  deleteCookie(c, 'dwarflens_session', { path: '/' });

  return c.json({ status: 'deleted', id: user.id });
});

