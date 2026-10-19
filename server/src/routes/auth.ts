import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
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
  // In a full production app state can be stored in cookie with short TTL
  return c.redirect(getGitHubAuthUrl(state));
});

// 2. GitHub OAuth Callback
authRouter.get('/github/callback', async (c) => {
  const code = c.req.query('code');
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
      // Find by email or insert
      const [existingEmail] = await db
        .select()
        .from(users)
        .where(eq(users.email, profile.email))
        .limit(1);

      if (existingEmail) {
        user = (
          await db
            .update(users)
            .set({
              githubId: profile.githubId,
              avatarUrl: profile.avatarUrl,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existingEmail.id))
            .returning()
        )[0];
      } else {
        user = (
          await db
            .insert(users)
            .values({
              githubId: profile.githubId,
              email: profile.email,
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
      sameSite: 'Lax',
      path: '/',
      expires: expiresAt,
    });

    return c.redirect(env.APP_URL);
  } catch (err: any) {
    console.error('OAuth callback error:', err);
    return c.json({ error: 'OAuth authentication failed', details: err.message }, 500);
  }
});

// 3. Dev login for test suites and local development
if (env.NODE_ENV !== 'production') {
  authRouter.post('/dev-login', async (c) => {
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
}

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
