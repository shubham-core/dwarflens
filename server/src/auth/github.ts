import { env } from '../env.js';

export function getGitHubAuthUrl(state: string, redirectUri?: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri || `${env.API_URL}/api/v1/auth/github/callback`,
    scope: 'user:email read:user',
    state,
  });

  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubCode(code: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange GitHub code: ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
  if (data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Failed to obtain access token');
  }

  return data.access_token;
}

export async function getGitHubUserProfile(accessToken: string): Promise<{
  githubId: string;
  email: string;
  name: string;
  avatarUrl: string;
}> {
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'DwarfLens-SaaS',
    },
  });

  if (!userRes.ok) {
    throw new Error('Failed to fetch GitHub user profile');
  }

  const profile = (await userRes.json()) as {
    id: number;
    login: string;
    name?: string;
    email?: string;
    avatar_url?: string;
  };

  let email = profile.email;
  if (!email) {
    // Fetch user emails
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'DwarfLens-SaaS',
      },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified) || emails[0];
      if (primary) {
        email = primary.email;
      }
    }
  }

  return {
    githubId: String(profile.id),
    email: email || `${profile.login}@users.noreply.github.com`,
    name: profile.name || profile.login,
    avatarUrl: profile.avatar_url || '',
  };
}
