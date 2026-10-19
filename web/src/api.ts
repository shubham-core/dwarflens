// DwarfLens Dashboard API Client

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface OrgMembership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: 'owner' | 'member' | 'viewer';
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  repo: string;
  settings?: any;
  createdAt: string;
}

export interface AnalysisSummary {
  id: string;
  projectId: string;
  commitSha: string;
  branch: string;
  buildName: string;
  createdAt: string;
  totalSize: number;
  flashSize: number;
  ramSize: number;
  structCount: number;
  symbolCount: number;
  paddingBytes: number;
  cacheLineCrossings: number;
}

export interface DiffResult {
  base_commit: string;
  head_commit: string;
  base_file_size: number;
  head_file_size: number;
  file_size_delta: number;
  file_size_pct: number;
  flash_delta: number;
  ram_delta: number;
  has_padding_regression: boolean;
  section_deltas: Array<{
    name: string;
    category: string;
    base_size: number;
    head_size: number;
    delta: number;
    pct_change: number;
  }>;
  top_symbol_deltas: Array<{
    name: string;
    base_size: number;
    head_size: number;
    delta: number;
    status: 'added' | 'removed' | 'modified' | 'unchanged';
  }>;
  struct_regressions: Array<{
    name: string;
    base_padding: number;
    head_padding: number;
    padding_delta: number;
    base_cache_lines: number;
    head_cache_lines: number;
    cache_lines_delta: number;
    has_regression: boolean;
  }>;
}

const API_BASE = '/api/v1';

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  return res.json();
}

export const api = {
  async getMe(): Promise<{ user: User; orgs: OrgMembership[] }> {
    return req('/auth/me');
  },

  async devLogin(email: string, name?: string, orgName?: string): Promise<{ user: User; sessionId: string }> {
    return req('/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email, name, orgName }),
    });
  },

  async logout(): Promise<void> {
    await req('/auth/logout', { method: 'POST' });
  },

  async getProjects(orgId: string): Promise<Project[]> {
    const res = await req<{ projects: Project[] }>(`/orgs/${orgId}/projects`);
    return res.projects;
  },

  async createProject(orgId: string, data: { name: string; slug: string; repo: string }): Promise<Project> {
    const res = await req<{ project: Project }>(`/orgs/${orgId}/projects`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.project;
  },

  async createApiKey(orgId: string, data: { name: string; projectId?: string }): Promise<{ apiKey: any; rawKey: string }> {
    return req(`/orgs/${orgId}/keys`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getProject(projectId: string): Promise<Project> {
    const res = await req<{ project: Project }>(`/projects/${projectId}`);
    return res.project;
  },

  async getAnalyses(projectId: string, branch?: string): Promise<AnalysisSummary[]> {
    const query = branch && branch !== 'all' ? `?branch=${encodeURIComponent(branch)}` : '';
    const res = await req<{ analyses: AnalysisSummary[] }>(`/projects/${projectId}/analyses${query}`);
    return res.analyses;
  },

  async getAnalysis(analysisId: string): Promise<any> {
    const res = await req<{ analysis: any }>(`/analyses/${analysisId}`);
    return res.analysis;
  },

  async getDiff(projectId: string, base: string, head: string): Promise<DiffResult> {
    const res = await req<{ diff: DiffResult }>(`/projects/${projectId}/diff?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
    return res.diff;
  },

  async createShareLink(analysisId: string): Promise<{ token: string; url: string }> {
    return req(`/analyses/${analysisId}/share`, { method: 'POST' });
  },

  async getSharedAnalysis(token: string): Promise<any> {
    return req(`/shared/${token}`);
  },
};
