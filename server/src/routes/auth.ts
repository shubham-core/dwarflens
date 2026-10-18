import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import crypto from 'crypto';
import { eq, and, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, orgs, orgMembers } from '../db/schema.js';
import { env } from '../env.js';
import {
  getGitHubAuthUrl,
  exchangeGitHubCode,
  getGitHubUserProfile,
} from '../auth/github.js';
import { createSession, deleteSession, validateSession } from '../auth/sessions.js';
import { createOneTimeCode, exchangeOneTimeCode } from '../auth/handoff.js';
import { AuthContextVariables, requireAuth, requireUser } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimit.js';

export const authRouter = new Hono<{ Variables: AuthContextVariables }>();

// 1. Initiate GitHub OAuth
authRouter.get(
  '/github',
  rateLimiter({ limit: 20, windowMs: 60 * 1000, keyPrefix: 'auth-oauth' }),
  (c) => {
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${env.API_URL.replace(/\/$/, '')}/api/v1/auth/github/callback`;

  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 600, // 10 minutes
  });

  return c.redirect(getGitHubAuthUrl(state, redirectUri));
});

// 2. GitHub OAuth Callback
authRouter.get(
  '/github/callback',
  rateLimiter({ limit: 20, windowMs: 60 * 1000, keyPrefix: 'auth-oauth' }),
  async (c) => {
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

    const handoffCode = createOneTimeCode(sessionId);
    const targetUrl = new URL(env.APP_URL);
    targetUrl.hash = `#code=${handoffCode}`;
    return c.redirect(targetUrl.toString());
  } catch (err: any) {
    console.error('OAuth callback error:', err);
    return c.json({ error: 'OAuth authentication failed', details: err.message }, 500);
  }
});

// 3. Dev login for test suites and local development ONLY (never enabled in production)
authRouter.post(
  '/dev-login',
  rateLimiter({ limit: 10, windowMs: 60 * 1000, keyPrefix: 'auth-login' }),
  async (c) => {
  // Only allow when NODE_ENV is explicitly 'development' or 'test'
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    return c.json({ error: 'Not found' }, 404);
  }

  // Enforce that request strictly comes from localhost
  const rawHost = c.req.header('host') || (c.req.url ? new URL(c.req.url).hostname : '');
  const host = rawHost.split(':')[0].toLowerCase();
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

// 3.1 Exchange One-Time Code for Session Token (Cross-Origin Handoff for Safari/Brave)
authRouter.post(
  '/exchange-code',
  rateLimiter({ limit: 30, windowMs: 60 * 1000, keyPrefix: 'auth-exchange' }),
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const code = body?.code;
    if (!code || typeof code !== 'string') {
      return c.json({ error: 'Missing or invalid authorization code' }, 400);
    }

    const sessionId = exchangeOneTimeCode(code);
    if (!sessionId) {
      return c.json({ error: 'Invalid or expired authorization code' }, 400);
    }

    const sessionData = await validateSession(sessionId);
    if (!sessionData) {
      return c.json({ error: 'Session expired or invalidated' }, 401);
    }

    setCookie(c, 'dwarflens_session', sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
      path: '/',
      expires: sessionData.session.expiresAt,
    });

    return c.json({
      sessionId,
      user: sessionData.user,
      expiresAt: sessionData.session.expiresAt,
    });
  }
);

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

  // Typed confirmation check: require user name or email confirmation for destructive action
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const confirmName = body.confirmName || body.name || c.req.query('confirmName');
  const isMatch = (user.name && confirmName === user.name) || confirmName === user.email;
  if (!confirmName || !isMatch) {
    return c.json(
      {
        error: `Confirmation required: please provide confirmName matching "${user.name || user.email}" to delete your account`,
      },
      400
    );
  }

  // Find organizations where this user is an owner
  const ownerMemberships = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, user.id), eq(orgMembers.role, 'owner')));

  for (const m of ownerMemberships) {
    // Check if there are other members (of ANY role) in this organization
    const otherMembers = await db
      .select({ id: orgMembers.id, role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, m.orgId), ne(orgMembers.userId, user.id)));

    if (otherMembers.length === 0) {
      // Safe to delete org: user was the sole member
      await db.delete(orgs).where(eq(orgs.id, m.orgId));
    } else {
      // Do NOT delete the org! Ensure at least one remaining member is an owner
      const hasOtherOwner = otherMembers.some((mem) => mem.role === 'owner');
      if (!hasOtherOwner) {
        await db
          .update(orgMembers)
          .set({ role: 'owner' })
          .where(eq(orgMembers.id, otherMembers[0].id));
      }
      // Remove current user from this org
      await db
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, m.orgId), eq(orgMembers.userId, user.id)));
    }
  }

  // Delete user record (cascades sessions and remaining memberships)
  await db.delete(users).where(eq(users.id, user.id));

  // Clear session cookie
  deleteCookie(c, 'dwarflens_session', { path: '/' });

  return c.json({ status: 'deleted', id: user.id });
});

