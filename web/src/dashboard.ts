import { api, API_BASE, User, OrgMembership, Project, AnalysisSummary, DiffResult } from './api.js';
import { renderSizeHistoryChart } from './chart.js';
import { renderStoredAnalysis, resetResultsToTryView } from './main.js';
import { renderLandingPage } from './landing.js';
import { escapeHtml } from './escape.js';

export function renderProjectCardHtml(p: { id: string; name: string; repo: string; createdAt: string | Date }): string {
  return `
    <a href="#projects/${escapeHtml(p.id)}" style="text-decoration: none; color: inherit;">
      <div style="padding: 1.25rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; transition: border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border-color)'">
        <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.25rem;">${escapeHtml(p.name)}</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); font-family: var(--font-mono); margin-bottom: 0.75rem;">${escapeHtml(p.repo)}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-secondary);">
          <span>Created ${new Date(p.createdAt).toLocaleDateString()}</span>
          <span style="color: var(--accent);">View details &rarr;</span>
        </div>
      </div>
    </a>
  `;
}

export function renderTopSymbolDeltaHtml(sym: { name: string; status: string; base_size: number; head_size: number; delta: number }): string {
  return `
    <tr style="border-bottom: 1px solid var(--border-color);">
      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">${escapeHtml(sym.name)}</td>
      <td style="padding: 0.75rem 1rem;">
        <span class="badge" style="background: ${sym.status === 'added' ? 'var(--danger-bg)' : sym.status === 'removed' ? 'var(--success-bg)' : 'var(--bg-tertiary)'}; color: ${sym.status === 'added' ? 'var(--danger)' : sym.status === 'removed' ? 'var(--success)' : 'var(--text-secondary)'};">
          ${escapeHtml(sym.status)}
        </span>
      </td>
      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono);">${sym.base_size} B</td>
      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono);">${sym.head_size} B</td>
      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; color: ${sym.delta > 0 ? 'var(--danger)' : 'var(--success)'};">
        ${sym.delta >= 0 ? '+' : ''}${sym.delta} B
      </td>
    </tr>
  `;
}

export class DashboardApp {
  user: User | null = null;
  orgs: OrgMembership[] = [];
  currentOrg: OrgMembership | null = null;
  currentProject: Project | null = null;

  selectedForDiff: string[] = [];

  async init(): Promise<void> {
    this.setupHashRouter();
    await this.checkAuth();
    this.handleRoute();
  }

  setupHashRouter(): void {
    window.addEventListener('hashchange', () => {
      this.handleRoute();
    });
  }

  async checkAuth(): Promise<void> {
    try {
      const data = await api.getMe();
      this.user = data.user;
      this.orgs = data.orgs;
      this.currentOrg = data.orgs[0] || null;
    } catch {
      this.user = null;
      this.orgs = [];
      this.currentOrg = null;
    }
    this.updateNav();
  }

  updateNav(): void {
    const authContainer = document.getElementById('nav-auth-container');
    const dashboardLink = document.getElementById('nav-dashboard-link');
    if (!authContainer) return;

    if (this.user) {
      if (dashboardLink) dashboardLink.style.display = 'inline-flex';
      authContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <span style="font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(this.user.name || this.user.email)}</span>
          <a href="#billing" class="btn btn-secondary btn-sm" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; text-decoration: none;">Billing</a>
          <button id="btn-logout" class="btn btn-secondary btn-sm" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;">Logout</button>
          <button id="btn-delete-account" class="btn btn-sm" style="background: transparent; color: var(--danger); border: 1px solid rgba(248,81,73,0.3); padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: 4px; cursor: pointer;" title="Delete your DwarfLens account">Delete Account</button>
        </div>
      `;
      document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await api.logout();
        this.user = null;
        this.orgs = [];
        this.currentOrg = null;
        this.updateNav();
        window.location.hash = '#landing';
      });

      document.getElementById('btn-delete-account')?.addEventListener('click', async () => {
        const confirmed = window.confirm('Are you absolutely sure you want to permanently delete your account and personal organizations? This action cannot be undone.');
        if (!confirmed) return;
        try {
          await api.deleteAccount();
          alert('Account deleted successfully.');
          this.user = null;
          this.orgs = [];
          this.currentOrg = null;
          this.updateNav();
          window.location.hash = '#landing';
        } catch (err: any) {
          alert(`Failed to delete account: ${err.message}`);
        }
      });
    } else {
      if (dashboardLink) dashboardLink.style.display = 'none';
      authContainer.innerHTML = `
        <a href="#login" class="btn btn-primary btn-sm" style="padding: 0.35rem 0.75rem; font-size: 0.85rem;">Sign In</a>
      `;
    }
  }

  hideAllViews(): void {
    const viewIds = [
      'view-landing',
      'view-try',
      'view-login',
      'view-projects',
      'view-project-detail',
      'view-analysis-detail',
      'view-compare',
      'view-privacy',
      'view-terms',
      'view-billing',
    ];
    for (const id of viewIds) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }

    // Update active nav link classes
    const hash = window.location.hash || '#landing';
    const isLanding = hash === '' || hash === '#' || hash.startsWith('#landing');
    document.querySelectorAll('.main-nav-tab').forEach((tab) => {
      const tabTarget = tab.getAttribute('data-view');
      if (isLanding && tabTarget === 'landing') {
        tab.classList.add('active');
      } else if (hash.startsWith('#pricing') && tabTarget === 'pricing') {
        tab.classList.add('active');
      } else if (hash.startsWith('#faq') && tabTarget === 'faq') {
        tab.classList.add('active');
      } else if (hash.startsWith('#try') && tabTarget === 'try') {
        tab.classList.add('active');
      } else if (!isLanding && !hash.startsWith('#try') && !hash.startsWith('#login') && !hash.startsWith('#pricing') && !hash.startsWith('#faq') && !hash.startsWith('#privacy') && !hash.startsWith('#terms') && tabTarget === 'dashboard') {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }

  handleRoute(): void {
    const hash = window.location.hash || '#landing';
    this.hideAllViews();

    if (hash === '' || hash === '#' || hash === '#landing' || hash.startsWith('#pricing') || hash.startsWith('#faq')) {
      this.renderLandingView(hash);
    } else if (hash.startsWith('#privacy')) {
      this.renderPrivacyView();
    } else if (hash.startsWith('#terms')) {
      this.renderTermsView();
    } else if (hash === '#try') {
      resetResultsToTryView();
      const el = document.getElementById('view-try');
      if (el) el.style.display = 'block';
    } else if (hash === '#login') {
      this.renderLoginView();
    } else if (hash.startsWith('#billing')) {
      if (!this.user) {
        window.location.hash = '#login';
        return;
      }
      this.renderBillingView();
    } else if (hash === '#projects') {
      if (!this.user) {
        window.location.hash = '#login';
        return;
      }
      this.renderProjectsView();
    } else if (hash.startsWith('#projects/')) {
      if (!this.user) {
        window.location.hash = '#login';
        return;
      }
      const projectId = hash.replace('#projects/', '').split('?')[0];
      this.renderProjectDetailView(projectId);
    } else if (hash.startsWith('#analyses/')) {
      const analysisId = hash.replace('#analyses/', '').split('?')[0];
      this.renderAnalysisDetailView(analysisId);
    } else if (hash.startsWith('#shared/')) {
      const token = hash.replace('#shared/', '').split('?')[0];
      this.renderSharedReportView(token);
    } else if (hash.startsWith('#compare')) {
      this.renderCompareView();
    } else {
      this.renderLandingView(hash);
    }
  }

  renderLandingView(hash: string): void {
    const el = document.getElementById('view-landing');
    if (!el) return;
    el.style.display = 'block';
    renderLandingPage(el);

    if (hash.startsWith('#pricing')) {
      setTimeout(() => {
        document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } else if (hash.startsWith('#faq')) {
      setTimeout(() => {
        document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  renderPrivacyView(): void {
    const el = document.getElementById('view-privacy');
    if (!el) return;
    el.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    el.innerHTML = `
      <div style="max-width: 800px; margin: 3rem auto; padding: 2rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; line-height: 1.7;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem;">
          <h1 style="font-size: 1.75rem; font-weight: 700;">DwarfLens Privacy Policy</h1>
          <span style="font-size: 0.8rem; background: var(--bg-tertiary); padding: 0.2rem 0.6rem; border-radius: 4px; color: var(--text-secondary);">Template &bull; Review before launch</span>
        </div>
        <div style="color: var(--text-secondary); font-size: 0.95rem;">
          <h3 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">1. Non-Negotiable Privacy Rule: Zero Binaries Uploaded</h3>
          <p>DwarfLens never uploads compiled ELF, Wasm, Mach-O, or PE binary files to our servers. The native C++ engine parses your files locally on your computer or CI runner. Only lightweight layout summary JSON is transmitted.</p>

          <h3 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">2. Information We Store</h3>
          <p>We store only high-level layout metadata: section names/sizes, symbol names/sizes, struct member offsets, padding hole byte sizes, git commit SHAs, and branch names.</p>

          <h3 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">3. Tenant Isolation</h3>
          <p>All database queries are strictly scoped to your tenant. API keys are hashed with SHA-256 before storage.</p>

          <h3 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">4. Your Data Deletion Rights</h3>
          <p>Organization owners can permanently delete projects (via <code>DELETE /api/v1/projects/:id</code>) or their entire account (via <code>DELETE /api/v1/auth/me</code>) at any time with immediate effect.</p>
        </div>
      </div>
    `;
  }

  renderTermsView(): void {
    const el = document.getElementById('view-terms');
    if (!el) return;
    el.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    el.innerHTML = `
      <div style="max-width: 800px; margin: 3rem auto; padding: 2rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; line-height: 1.7;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem;">
          <h1 style="font-size: 1.75rem; font-weight: 700;">DwarfLens Terms of Service</h1>
          <span style="font-size: 0.8rem; background: var(--bg-tertiary); padding: 0.2rem 0.6rem; border-radius: 4px; color: var(--text-secondary);">Template &bull; Review before launch</span>
        </div>
        <div style="color: var(--text-secondary); font-size: 0.95rem;">
          <h3 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">1. Service Overview</h3>
          <p>DwarfLens provides developer tooling for binary size monitoring, struct memory layout visualization, and automated CI regression tracking.</p>

          <h3 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">2. Code Ownership</h3>
          <p>You retain 100% intellectual property ownership of your source code, compiled binaries, and analysis data. DwarfLens claims no rights over your code.</p>

          <h3 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">3. Fair Use & Rate Limiting</h3>
          <p>API requests are subject to rate limiting (100 req/min standard). Payloads exceeding 5 MB are rejected.</p>

          <h3 style="color: var(--text-primary); margin: 1.5rem 0 0.5rem;">4. Termination & Deletion</h3>
          <p>You may terminate your account and erase all associated projects at any time through self-service endpoints.</p>
        </div>
      </div>
    `;
  }


  renderLoginView(): void {
    const el = document.getElementById('view-login');
    if (!el) return;
    el.style.display = 'block';

    el.innerHTML = `
      <div style="max-width: 440px; margin: 4rem auto; padding: 2.5rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
        <h2 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; text-align: center;">Welcome to DwarfLens SaaS</h2>
        <p style="color: var(--text-secondary); font-size: 0.9rem; text-align: center; margin-bottom: 2rem;">
          Continuous binary size, struct padding, and cache layout regression tracking for CI.
        </p>

        <a href="${API_BASE}/auth/github" class="btn btn-primary" style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; padding: 0.75rem; font-weight: 600; text-decoration: none; margin-bottom: 1.5rem;">
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          Continue with GitHub
        </a>

        ${import.meta.env.DEV ? `
        <div style="display: flex; align-items: center; margin: 1.5rem 0; color: var(--text-muted); font-size: 0.8rem;">
          <div style="flex: 1; height: 1px; background: var(--border-color);"></div>
          <span style="padding: 0 0.75rem;">OR QUICK DEV LOGIN</span>
          <div style="flex: 1; height: 1px; background: var(--border-color);"></div>
        </div>

        <form id="dev-login-form" style="display: flex; flex-direction: column; gap: 0.75rem;">
          <div>
            <label style="display: block; font-size: 0.8rem; margin-bottom: 0.3rem; color: var(--text-secondary);">Developer Email</label>
            <input type="email" id="dev-email" value="developer@example.com" class="input" style="width: 100%; padding: 0.5rem; background: var(--code-bg); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px;" required />
          </div>
          <div>
            <label style="display: block; font-size: 0.8rem; margin-bottom: 0.3rem; color: var(--text-secondary);">Organization Name</label>
            <input type="text" id="dev-org" value="Engineering Team" class="input" style="width: 100%; padding: 0.5rem; background: var(--code-bg); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px;" required />
          </div>
          <button type="submit" class="btn btn-secondary" style="margin-top: 0.5rem; padding: 0.6rem;">Sign In (Local Dev)</button>
        </form>
        ` : ''}
      </div>
    `;

    if (import.meta.env.DEV) {
      document.getElementById('dev-login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (document.getElementById('dev-email') as HTMLInputElement).value;
        const orgName = (document.getElementById('dev-org') as HTMLInputElement).value;
        try {
          await api.devLogin(email, email.split('@')[0], orgName);
          await this.checkAuth();
          window.location.hash = '#projects';
        } catch (err: any) {
          alert('Login failed: ' + err.message);
        }
      });
    }
  }

  async renderProjectsView(): Promise<void> {
    const el = document.getElementById('view-projects');
    if (!el || !this.currentOrg) return;
    el.style.display = 'block';

    el.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">Loading projects...</div>';

    try {
      const projects = await api.getProjects(this.currentOrg.orgId);

      el.innerHTML = `
        <div style="max-width: 1000px; margin: 2rem auto; padding: 0 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <div>
              <h2 style="font-size: 1.5rem; font-weight: 700;">Projects</h2>
              <p style="color: var(--text-secondary); font-size: 0.85rem;">Organization: <strong>${escapeHtml(this.currentOrg.orgName)}</strong></p>
            </div>
            <button id="btn-create-project-modal" class="btn btn-primary" style="display: flex; align-items: center; gap: 0.4rem;">
              <span>+</span> New Project
            </button>
          </div>

          <div id="api-key-reveal-banner" style="display: none; margin-bottom: 1.5rem; padding: 1.25rem; background: var(--warning-bg); border: 1px solid var(--warning); border-radius: 8px;">
            <div style="font-weight: 700; color: #e3b341; margin-bottom: 0.3rem;">⚠️ Save your new Project API Key</div>
            <div style="font-size: 0.85rem; margin-bottom: 0.75rem; color: var(--text-primary);">
              This API key will only be shown <strong>once</strong>. Set this as <code>DWARFLENS_API_KEY</code> in your GitHub repository secrets.
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <input type="text" id="revealed-key-input" readonly style="flex: 1; padding: 0.5rem; font-family: var(--font-mono); font-size: 0.85rem; background: var(--code-bg); border: 1px solid var(--border-color); color: #7ee787; border-radius: 6px;" />
              <button id="btn-copy-revealed-key" class="btn btn-secondary btn-sm" style="white-space: nowrap;">Copy Key</button>
            </div>
          </div>

          ${projects.length === 0 ? `
            <div style="text-align: center; padding: 4rem 2rem; background: var(--bg-secondary); border: 1px dashed var(--border-color); border-radius: 12px;">
              <h3 style="font-size: 1.1rem; margin-bottom: 0.5rem;">No projects yet</h3>
              <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem;">
                Create a project to start tracking binary sizes and struct layout diffs in your GitHub CI pipeline.
              </p>
              <button id="btn-create-project-empty" class="btn btn-primary">+ Create First Project</button>
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem;">
              ${projects.map((p) => renderProjectCardHtml(p)).join('')}
            </div>
          `}
        </div>

        <!-- Create Project Modal -->
        <div id="modal-create-project" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; align-items: center; justify-content: center;">
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 2rem; width: 100%; max-width: 480px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem;">Create New Project</h3>
            <form id="form-create-project" style="display: flex; flex-direction: column; gap: 1rem;">
              <div>
                <label style="display: block; font-size: 0.8rem; margin-bottom: 0.3rem;">Project Name</label>
                <input type="text" id="new-proj-name" placeholder="e.g. Firmware Kernel" class="input" style="width: 100%; padding: 0.5rem; background: var(--code-bg); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px;" required />
              </div>
              <div>
                <label style="display: block; font-size: 0.8rem; margin-bottom: 0.3rem;">Project Slug</label>
                <input type="text" id="new-proj-slug" placeholder="e.g. firmware-kernel" class="input" style="width: 100%; padding: 0.5rem; background: var(--code-bg); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px;" required />
              </div>
              <div>
                <label style="display: block; font-size: 0.8rem; margin-bottom: 0.3rem;">GitHub Repository (owner/repo)</label>
                <input type="text" id="new-proj-repo" placeholder="e.g. my-org/firmware-kernel" class="input" style="width: 100%; padding: 0.5rem; background: var(--code-bg); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px;" required />
              </div>
              <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
                <button type="button" id="btn-cancel-create-project" class="btn btn-secondary">Cancel</button>
                <button type="submit" class="btn btn-primary">Create & Generate API Key</button>
              </div>
            </form>
          </div>
        </div>
      `;

      // Wire modal events
      const modal = document.getElementById('modal-create-project');
      const openModal = () => { if (modal) modal.style.display = 'flex'; };
      const closeModal = () => { if (modal) modal.style.display = 'none'; };

      document.getElementById('btn-create-project-modal')?.addEventListener('click', openModal);
      document.getElementById('btn-create-project-empty')?.addEventListener('click', openModal);
      document.getElementById('btn-cancel-create-project')?.addEventListener('click', closeModal);

      document.getElementById('form-create-project')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = (document.getElementById('new-proj-name') as HTMLInputElement).value;
        const slug = (document.getElementById('new-proj-slug') as HTMLInputElement).value;
        const repo = (document.getElementById('new-proj-repo') as HTMLInputElement).value;

        try {
          const project = await api.createProject(this.currentOrg!.orgId, { name, slug, repo });
          // Generate API Key automatically
          const keyRes = await api.createApiKey(this.currentOrg!.orgId, {
            name: `${name} CI Key`,
            projectId: project.id,
          });

          closeModal();
          await this.renderProjectsView();

          // Show key reveal banner
          const revealBanner = document.getElementById('api-key-reveal-banner');
          const keyInput = document.getElementById('revealed-key-input') as HTMLInputElement;
          if (revealBanner && keyInput) {
            keyInput.value = keyRes.rawKey;
            revealBanner.style.display = 'block';

            document.getElementById('btn-copy-revealed-key')?.addEventListener('click', () => {
              navigator.clipboard.writeText(keyRes.rawKey);
              alert('API key copied to clipboard!');
            });
          }
        } catch (err: any) {
          alert('Failed to create project: ' + err.message);
        }
      });
    } catch (err: any) {
      el.innerHTML = `<div class="alert alert-error">Failed to load projects: ${escapeHtml(err.message)}</div>`;
    }
  }

  async renderProjectDetailView(projectId: string): Promise<void> {
    const el = document.getElementById('view-project-detail');
    if (!el) return;
    el.style.display = 'block';

    el.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">Loading project details...</div>';

    try {
      const project = await api.getProject(projectId);
      this.currentProject = project;
      const analyses = await api.getAnalyses(projectId);

      // Extract unique branches
      const branches = Array.from(new Set(analyses.map((a) => a.branch)));
      if (!branches.includes('main') && branches.length > 0) branches.unshift('all');
      else branches.unshift('all');

      el.innerHTML = `
        <div style="max-width: 1100px; margin: 2rem auto; padding: 0 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem;">
                <a href="#projects" style="color: var(--accent); text-decoration: none;">&larr; Projects</a>
                <span>/</span>
                <span>${escapeHtml(project.repo)}</span>
              </div>
              <h2 style="font-size: 1.6rem; font-weight: 700;">${escapeHtml(project.name)}</h2>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: center;">
              <button id="btn-compare-selected" class="btn btn-primary btn-sm" disabled style="opacity: 0.6;">
                Compare Selected (0/2)
              </button>
            </div>
          </div>

          <!-- Branch Filter & History Chart Card -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.5rem; margin-bottom: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h3 style="font-size: 1.05rem; font-weight: 600;">Total Binary Size Over Time</h3>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <label style="font-size: 0.8rem; color: var(--text-secondary);">Branch:</label>
                <select id="branch-filter-select" style="padding: 0.35rem 0.6rem; background: var(--code-bg); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px; font-size: 0.85rem;">
                  ${branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div id="project-size-chart-container" style="min-height: 240px;"></div>
          </div>

          <!-- Analyses Table -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden;">
            <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-color); font-weight: 600; font-size: 1rem;">
              Analysis History (${analyses.length})
            </div>
            ${analyses.length === 0 ? `
              <div style="padding: 3rem; text-align: center; color: var(--text-muted);">
                No analyses ingested yet. Run the DwarfLens GitHub Action in CI to push your first build analysis!
              </div>
            ` : `
              <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                  <thead>
                    <tr style="border-bottom: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary);">
                      <th style="padding: 0.75rem 1rem; width: 40px;">Select</th>
                      <th style="padding: 0.75rem 1rem;">Commit / Branch</th>
                      <th style="padding: 0.75rem 1rem;">Build</th>
                      <th style="padding: 0.75rem 1rem;">Total Size</th>
                      <th style="padding: 0.75rem 1rem;">Flash / RAM</th>
                      <th style="padding: 0.75rem 1rem;">Structs / Padding</th>
                      <th style="padding: 0.75rem 1rem;">Ingested</th>
                      <th style="padding: 0.75rem 1rem; text-align: right;">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${analyses.map((a) => `
                      <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 0.75rem 1rem;">
                          <input type="checkbox" class="analysis-compare-cb" data-id="${escapeHtml(a.id)}" data-commit="${escapeHtml(a.commitSha)}" />
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <div style="font-family: var(--font-mono); font-weight: 600; color: var(--accent);">${escapeHtml(a.commitSha.substring(0, 7))}</div>
                          <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(a.branch)}</div>
                        </td>
                        <td style="padding: 0.75rem 1rem;"><span class="badge" style="background: var(--bg-tertiary);">${escapeHtml(a.buildName)}</span></td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">${(a.totalSize / 1024).toFixed(1)} KB</td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary);">
                          F: ${(a.flashSize / 1024).toFixed(1)} KB<br>R: ${(a.ramSize / 1024).toFixed(1)} KB
                        </td>
                        <td style="padding: 0.75rem 1rem; font-size: 0.8rem;">
                          ${a.structCount} structs<br><span style="color: ${a.paddingBytes > 0 ? 'var(--warning)' : 'var(--text-muted)'}">${a.paddingBytes} B wasted</span>
                        </td>
                        <td style="padding: 0.75rem 1rem; color: var(--text-secondary);">${new Date(a.createdAt).toLocaleString()}</td>
                        <td style="padding: 0.75rem 1rem; text-align: right;">
                          <a href="#analyses/${escapeHtml(a.id)}" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 0.25rem 0.5rem; text-decoration: none;">View Detail</a>
                        </td>
                      </tr>
                    `).join('')}
                </table>
              </div>
            `}
          </div>

          <!-- Danger Zone: Delete Project -->
          <div style="background: var(--bg-secondary); border: 1px solid rgba(248,81,73,0.4); border-radius: 10px; padding: 1.5rem; margin-top: 2rem;">
            <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--danger); margin-bottom: 0.5rem;">Danger Zone</h3>
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1rem;">
              Permanently delete this project and all associated analyses, historical metrics, and project API keys. This action cannot be undone.
            </p>
            <button id="btn-delete-project" class="btn btn-sm" style="background: var(--danger); color: #fff; border: none; font-weight: 600; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer;">
              🗑️ Delete Project
            </button>
          </div>
        </div>
      `;


      // Render chart
      const chartContainer = document.getElementById('project-size-chart-container');
      if (chartContainer) {
        renderSizeHistoryChart(chartContainer, analyses);
      }

      // Handle branch filter
      const branchSelect = document.getElementById('branch-filter-select') as HTMLSelectElement | null;
      branchSelect?.addEventListener('change', async () => {
        const branchVal = branchSelect.value;
        const filteredAnalyses = await api.getAnalyses(projectId, branchVal);
        if (chartContainer) {
          renderSizeHistoryChart(chartContainer, filteredAnalyses);
        }
      });

      // Handle Compare selection (max 2)
      this.selectedForDiff = [];
      const compareBtn = document.getElementById('btn-compare-selected') as HTMLButtonElement | null;
      const checkboxes = document.querySelectorAll('.analysis-compare-cb') as NodeListOf<HTMLInputElement>;

      checkboxes.forEach((cb) => {
        cb.addEventListener('change', () => {
          const id = cb.getAttribute('data-id')!;
          if (cb.checked) {
            if (this.selectedForDiff.length >= 2) {
              cb.checked = false;
              alert('You can only select two analyses to compare.');
              return;
            }
            this.selectedForDiff.push(id);
          } else {
            this.selectedForDiff = this.selectedForDiff.filter((item) => item !== id);
          }

          if (compareBtn) {
            compareBtn.textContent = `Compare Selected (${this.selectedForDiff.length}/2)`;
            if (this.selectedForDiff.length === 2) {
              compareBtn.disabled = false;
              compareBtn.style.opacity = '1';
            } else {
              compareBtn.disabled = true;
              compareBtn.style.opacity = '0.6';
            }
          }
        });
      });

      compareBtn?.addEventListener('click', () => {
        if (this.selectedForDiff.length === 2) {
          window.location.hash = `#compare?project=${projectId}&base=${this.selectedForDiff[1]}&head=${this.selectedForDiff[0]}`;
        }
      });

      // Handle Project Deletion (Danger Zone)
      document.getElementById('btn-delete-project')?.addEventListener('click', async () => {
        const confirmed = window.confirm(`Are you absolutely sure you want to permanently delete project "${project.name}" (${project.repo})? This will delete all associated analyses and cannot be undone.`);
        if (!confirmed) return;
        try {
          await api.deleteProject(projectId);
          alert('Project deleted successfully.');
          window.location.hash = '#projects';
        } catch (err: any) {
          alert(`Failed to delete project: ${err.message}`);
        }
      });
    } catch (err: any) {
      el.innerHTML = `<div class="alert alert-error">Failed to load project: ${escapeHtml(err.message)}</div>`;
    }
  }

  async renderAnalysisDetailView(analysisId: string): Promise<void> {
    const el = document.getElementById('view-analysis-detail');
    if (!el) return;
    el.style.display = 'block';

    el.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">Loading stored analysis...</div>';

    try {
      const stored = await api.getAnalysis(analysisId);
      const rawData = stored.rawData;

      el.innerHTML = `
        <div style="max-width: 1200px; margin: 1.5rem auto; padding: 0 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem;">
                <a href="#projects/${escapeHtml(stored.projectId)}" style="color: var(--accent); text-decoration: none;">&larr; Back to Project</a>
                <span>/</span>
                <span>Commit: <strong class="mono">${escapeHtml(stored.commitSha.substring(0, 7))}</strong></span>
                <span>(${escapeHtml(stored.branch)})</span>
              </div>
              <h2 style="font-size: 1.5rem; font-weight: 700;">Stored Analysis: ${escapeHtml(rawData.filename)}</h2>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <button id="btn-share-analysis" class="btn btn-secondary btn-sm" style="display: flex; align-items: center; gap: 0.3rem;">
                🔗 Share Report Link
              </button>
            </div>
          </div>

          <div id="share-link-banner" style="display: none; margin-bottom: 1.5rem; padding: 1rem; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px;">
            <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem;">Public Read-Only Share Link:</div>
            <div style="display: flex; gap: 0.5rem;">
              <input type="text" id="share-url-input" readonly style="flex: 1; padding: 0.4rem; background: var(--code-bg); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; font-family: var(--font-mono); font-size: 0.8rem;" />
              <button id="btn-copy-share-url" class="btn btn-primary btn-sm">Copy</button>
            </div>
          </div>

          <!-- Stored Visualizer Mount -->
          <div id="stored-analysis-mount"></div>
        </div>
      `;

      // Mount full visualizer from main.ts
      const mount = document.getElementById('stored-analysis-mount');
      if (mount) {
        renderStoredAnalysis(mount, rawData);
      }

      // Handle share button
      document.getElementById('btn-share-analysis')?.addEventListener('click', async () => {
        try {
          const res = await api.createShareLink(analysisId);
          const banner = document.getElementById('share-link-banner');
          const input = document.getElementById('share-url-input') as HTMLInputElement;
          if (banner && input) {
            input.value = `${window.location.origin}/#shared/${res.token}`;
            banner.style.display = 'block';

            document.getElementById('btn-copy-share-url')?.addEventListener('click', () => {
              navigator.clipboard.writeText(input.value);
              alert('Public report link copied to clipboard!');
            });
          }
        } catch (err: any) {
          alert('Failed to generate share link: ' + err.message);
        }
      });
    } catch (err: any) {
      el.innerHTML = `<div class="alert alert-error">Failed to load analysis: ${escapeHtml(err.message)}</div>`;
    }
  }

  async renderSharedReportView(token: string): Promise<void> {
    const el = document.getElementById('view-analysis-detail');
    if (!el) return;
    el.style.display = 'block';

    el.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">Loading public shared report...</div>';

    try {
      const res = await api.getSharedAnalysis(token);
      const rawData = res.analysis.rawData;

      el.innerHTML = `
        <div style="max-width: 1200px; margin: 1.5rem auto; padding: 0 1rem;">
          <div style="background: rgba(56, 139, 253, 0.1); border: 1px solid var(--accent); border-radius: 8px; padding: 0.75rem 1.25rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <span style="font-weight: 700; color: var(--accent);">🌐 Public Read-Only Report</span>
              <span style="color: var(--text-muted); font-size: 0.85rem; margin-left: 0.5rem;">Project: <strong>${escapeHtml(res.project.name)}</strong> (${escapeHtml(res.project.repo)})</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">
              Shared on ${new Date(res.shared_at).toLocaleDateString()}
            </div>
          </div>

          <div style="margin-bottom: 1.25rem;">
            <h2 style="font-size: 1.5rem; font-weight: 700;">${escapeHtml(rawData.filename)}</h2>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-family: var(--font-mono); margin-top: 0.25rem;">
              Commit: <strong>${escapeHtml(res.analysis.commitSha.substring(0, 7))}</strong> &bull; Branch: <strong>${escapeHtml(res.analysis.branch)}</strong>
            </div>
          </div>

          <!-- Stored Visualizer Mount -->
          <div id="stored-analysis-mount"></div>
        </div>
      `;

      const mount = document.getElementById('stored-analysis-mount');
      if (mount) {
        renderStoredAnalysis(mount, rawData);
      }
    } catch (err: any) {
      el.innerHTML = `<div class="alert alert-error">Shared report not found or has been revoked: ${escapeHtml(err.message)}</div>`;
    }
  }

  async renderCompareView(): Promise<void> {
    const el = document.getElementById('view-compare');
    if (!el) return;
    el.style.display = 'block';

    const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const projectId = params.get('project');
    const base = params.get('base');
    const head = params.get('head');

    if (!projectId || !base || !head) {
      el.innerHTML = `<div style="padding: 3rem; text-align: center; color: var(--text-muted);">Please select two analyses from a project to compare.</div>`;
      return;
    }

    el.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">Computing analysis diff...</div>';

    try {
      const diff: DiffResult = await api.getDiff(projectId, base, head);

      const sizeSign = diff.file_size_delta >= 0 ? '+' : '';
      const sizeColor = diff.file_size_delta > 0 ? 'var(--danger)' : diff.file_size_delta < 0 ? 'var(--success)' : 'var(--text-secondary)';

      el.innerHTML = `
        <div style="max-width: 1100px; margin: 2rem auto; padding: 0 1rem;">
          <div style="margin-bottom: 1.5rem;">
            <a href="#projects/${escapeHtml(projectId)}" style="color: var(--accent); text-decoration: none; font-size: 0.85rem;">&larr; Back to Project</a>
            <h2 style="font-size: 1.6rem; font-weight: 700; margin-top: 0.5rem;">Binary Size & Layout Comparison</h2>
            <div style="font-size: 0.85rem; color: var(--text-secondary); font-family: var(--font-mono); margin-top: 0.25rem;">
              Base: <strong>${escapeHtml(diff.base_commit.substring(0, 7))}</strong> &rarr; Head: <strong>${escapeHtml(diff.head_commit.substring(0, 7))}</strong>
            </div>
          </div>

          <!-- Top-level Delta Metric Cards -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.3rem;">TOTAL SIZE DELTA</div>
              <div style="font-size: 1.6rem; font-weight: 700; color: ${sizeColor};">
                ${sizeSign}${(diff.file_size_delta / 1024).toFixed(2)} KB
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">${diff.file_size_pct >= 0 ? '+' : ''}${diff.file_size_pct}% change</div>
            </div>

            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.3rem;">FLASH / ROM DELTA</div>
              <div style="font-size: 1.6rem; font-weight: 700; color: ${diff.flash_delta > 0 ? 'var(--danger)' : 'var(--text-primary)'};">
                ${diff.flash_delta >= 0 ? '+' : ''}${(diff.flash_delta / 1024).toFixed(2)} KB
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">.text + .rodata + .data</div>
            </div>

            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.3rem;">RAM DELTA</div>
              <div style="font-size: 1.6rem; font-weight: 700; color: ${diff.ram_delta > 0 ? 'var(--danger)' : 'var(--text-primary)'};">
                ${diff.ram_delta >= 0 ? '+' : ''}${(diff.ram_delta / 1024).toFixed(2)} KB
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">.data + .bss</div>
            </div>

            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.3rem;">STRUCT REGRESSION</div>
              <div style="font-size: 1.4rem; font-weight: 700; color: ${diff.has_padding_regression ? 'var(--danger)' : 'var(--success)'};">
                ${diff.has_padding_regression ? '⚠️ Regression Found' : '✅ No Regressions'}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Struct padding hole changes</div>
            </div>
          </div>

          <!-- Section Deltas Table -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 10px; margin-bottom: 2rem; overflow: hidden;">
            <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-color); font-weight: 600;">
              Section Size Deltas
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary);">
                  <th style="padding: 0.75rem 1rem;">Section</th>
                  <th style="padding: 0.75rem 1rem;">Category</th>
                  <th style="padding: 0.75rem 1rem;">Base Size</th>
                  <th style="padding: 0.75rem 1rem;">Head Size</th>
                  <th style="padding: 0.75rem 1rem;">Delta</th>
                  <th style="padding: 0.75rem 1rem;">Change</th>
                </tr>
              </thead>
              <tbody>
                ${diff.section_deltas.map((s) => `
                  <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">${escapeHtml(s.name)}</td>
                    <td style="padding: 0.75rem 1rem;"><span class="badge" style="background: var(--bg-tertiary);">${escapeHtml(s.category)}</span></td>
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-mono);">${(s.base_size / 1024).toFixed(1)} KB</td>
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-mono);">${(s.head_size / 1024).toFixed(1)} KB</td>
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; color: ${s.delta > 0 ? 'var(--danger)' : s.delta < 0 ? 'var(--success)' : 'var(--text-muted)'};">
                      ${s.delta >= 0 ? '+' : ''}${s.delta.toLocaleString()} B
                    </td>
                    <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); color: var(--text-muted);">${s.pct_change >= 0 ? '+' : ''}${s.pct_change}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Top Symbol Deltas Table -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 10px; margin-bottom: 2rem; overflow: hidden;">
            <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-color); font-weight: 600;">
              Top Symbol Deltas
            </div>
            ${diff.top_symbol_deltas.length === 0 ? `
              <div style="padding: 2rem; text-align: center; color: var(--text-muted);">No symbol changes detected.</div>
            ` : `
              <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                <thead>
                  <tr style="border-bottom: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary);">
                    <th style="padding: 0.75rem 1rem;">Symbol</th>
                    <th style="padding: 0.75rem 1rem;">Status</th>
                    <th style="padding: 0.75rem 1rem;">Base</th>
                    <th style="padding: 0.75rem 1rem;">Head</th>
                    <th style="padding: 0.75rem 1rem;">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  ${diff.top_symbol_deltas.map((sym) => renderTopSymbolDeltaHtml(sym)).join('')}
                </tbody>
              </table>
            `}
          </div>

          <!-- Struct Regressions Table -->
          <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden;">
            <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-color); font-weight: 600;">
              Struct Layout & Padding Changes
            </div>
            ${diff.struct_regressions.length === 0 ? `
              <div style="padding: 2rem; text-align: center; color: var(--text-muted);">No struct padding or layout regressions detected.</div>
            ` : `
              <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left;">
                <thead>
                  <tr style="border-bottom: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary);">
                    <th style="padding: 0.75rem 1rem;">Struct Name</th>
                    <th style="padding: 0.75rem 1rem;">Base Padding</th>
                    <th style="padding: 0.75rem 1rem;">Head Padding</th>
                    <th style="padding: 0.75rem 1rem;">Padding Delta</th>
                    <th style="padding: 0.75rem 1rem;">Cache Lines</th>
                    <th style="padding: 0.75rem 1rem;">Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  ${diff.struct_regressions.map((st) => `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">${escapeHtml(st.name)}</td>
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono);">${st.base_padding} B</td>
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono);">${st.head_padding} B</td>
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; color: ${st.padding_delta > 0 ? 'var(--danger)' : st.padding_delta < 0 ? 'var(--success)' : 'var(--text-muted)'};">
                        ${st.padding_delta >= 0 ? '+' : ''}${st.padding_delta} B
                      </td>
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono);">${st.base_cache_lines} &rarr; ${st.head_cache_lines}</td>
                      <td style="padding: 0.75rem 1rem;">
                        <span class="badge" style="background: ${st.has_regression ? 'var(--danger-bg)' : 'var(--success-bg)'}; color: ${st.has_regression ? 'var(--danger)' : 'var(--success)'};">
                          ${st.has_regression ? 'Regression' : 'Optimized'}
                        </span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>
      `;
    } catch (err: any) {
      el.innerHTML = `<div class="alert alert-error">Failed to compute comparison: ${escapeHtml(err.message)}</div>`;
    }
  }

  async renderBillingView(): Promise<void> {
    const el = document.getElementById('view-billing');
    if (!el || !this.currentOrg) return;
    el.style.display = 'block';

    const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const isSuccess = urlParams.get('billing') === 'success';
    const isCanceled = urlParams.get('billing') === 'canceled';

    el.innerHTML = `
      <div style="display: flex; justify-content: center; padding: 3rem 1rem;">
        <div style="color: var(--text-muted); font-size: 0.95rem;">Loading billing information...</div>
      </div>
    `;

    try {
      const billing = await api.getBilling(this.currentOrg.orgId);
      const isFree = billing.plan === 'free';
      const isPro = billing.plan === 'pro';
      const isTeam = billing.plan === 'team';

      const planName = escapeHtml(billing.plan.toUpperCase());
      const status = billing.subscription?.status || 'active';
      const periodEnd = billing.subscription?.currentPeriodEnd
        ? new Date(billing.subscription.currentPeriodEnd).toLocaleDateString()
        : null;

      el.innerHTML = `
        <div style="max-width: 900px; margin: 2rem auto; padding: 0 1rem;">
          ${
            isSuccess
              ? `<div style="background: var(--success-bg); color: var(--success); border: 1px solid rgba(63,185,80,0.3); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                  <span>✓ <strong>Subscription successfully updated!</strong> Your organization plan has been upgraded.</span>
                  <a href="#billing" class="btn btn-sm btn-secondary" style="font-size: 0.75rem;">Dismiss</a>
                 </div>`
              : ''
          }
          ${
            isCanceled
              ? `<div style="background: var(--warning-bg, rgba(210,153,34,0.15)); color: var(--warning, #d29922); border: 1px solid rgba(210,153,34,0.3); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                  <span>Checkout process was canceled. No charges were made.</span>
                  <a href="#billing" class="btn btn-sm btn-secondary" style="font-size: 0.75rem;">Dismiss</a>
                 </div>`
              : ''
          }

          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem;">Billing & Subscription</h1>
              <p style="color: var(--text-secondary); font-size: 0.9rem;">
                Organization: <strong>${escapeHtml(this.currentOrg.orgName)}</strong> (${escapeHtml(this.currentOrg.role)})
              </p>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items: center;">
              ${
                !isFree
                  ? `<button id="btn-manage-subscription" class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                      Manage Subscription
                     </button>`
                  : ''
              }
            </div>
          </div>

          <!-- Current Plan & Usage Summary -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2.5rem;">
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
              <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">Current Plan</div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-size: 1.5rem; font-weight: 800; color: var(--accent);">${planName}</span>
                <span style="font-size: 0.75rem; background: var(--bg-tertiary); padding: 0.15rem 0.5rem; border-radius: 4px; color: var(--text-primary); text-transform: uppercase;">${escapeHtml(status)}</span>
              </div>
              ${periodEnd ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">Renews on ${escapeHtml(periodEnd)}</div>` : ''}
            </div>

            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
              <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">Projects Monitored</div>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary);">
                ${billing.usage.projectCount} <span style="font-size: 0.9rem; font-weight: normal; color: var(--text-secondary);">/ ${escapeHtml(String(billing.limits.maxProjects))}</span>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">${billing.usage.analysisCount} total analyses indexed</div>
            </div>

            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
              <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">History Retention</div>
              <div style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary);">
                ${escapeHtml(String(billing.limits.retentionDays))} <span style="font-size: 0.9rem; font-weight: normal; color: var(--text-secondary);">${typeof billing.limits.retentionDays === 'number' ? 'Days' : ''}</span>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">Automated cron pruning</div>
            </div>

            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.25rem;">
              <div style="font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 0.5rem;">Alerts & Repos</div>
              <div style="font-size: 0.95rem; font-weight: 700; color: ${billing.limits.allowAlerts ? 'var(--success)' : 'var(--text-muted)'}; margin-top: 0.25rem;">
                Alerts: ${billing.limits.allowAlerts ? 'Enabled' : 'Disabled'}
              </div>
              <div style="font-size: 0.85rem; color: ${billing.limits.allowPrivateRepos ? 'var(--success)' : 'var(--text-muted)'}; margin-top: 0.25rem;">
                Private Repos: ${billing.limits.allowPrivateRepos ? 'Enabled' : 'Disabled'}
              </div>
            </div>
          </div>

          <!-- Upgrade Options -->
          <div style="margin-top: 2rem;">
            <h2 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem;">Available Plans</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.25rem;">
              
              <!-- Free Card -->
              <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.5rem; opacity: ${isFree ? '1' : '0.7'};">
                <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.25rem;">Free</div>
                <div style="font-size: 1.5rem; font-weight: 800; margin-bottom: 1rem;">$0 <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-secondary);">/mo</span></div>
                <ul style="list-style: none; padding: 0; margin-bottom: 1.5rem; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
                  <li>✓ 1 Project</li>
                  <li>✓ Public repositories only</li>
                  <li>✓ 30-day history</li>
                  <li>✗ No automated Slack alerts</li>
                </ul>
                ${
                  isFree
                    ? `<span style="display: block; text-align: center; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); padding: 0.5rem;">Current Plan</span>`
                    : ''
                }
              </div>

              <!-- Pro Card -->
              <div style="background: var(--bg-secondary); border: 2px solid ${isPro ? 'var(--accent)' : 'var(--border-color)'}; border-radius: 10px; padding: 1.5rem;">
                <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.25rem; color: var(--text-primary);">Pro</div>
                <div style="font-size: 1.5rem; font-weight: 800; margin-bottom: 1rem;">$19 <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-secondary);">/mo</span></div>
                <ul style="list-style: none; padding: 0; margin-bottom: 1.5rem; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
                  <li>✓ <strong>Unlimited Projects</strong></li>
                  <li>✓ Public & Private repositories</li>
                  <li>✓ 365-day history retention</li>
                  <li>✓ Slack & Email Budget Alerts</li>
                </ul>
                ${
                  isPro
                    ? `<span style="display: block; text-align: center; font-size: 0.85rem; font-weight: 600; color: var(--accent); padding: 0.5rem;">Current Plan</span>`
                    : `<button id="btn-upgrade-pro" class="btn btn-primary" style="width: 100%; padding: 0.6rem; font-weight: 600;">Upgrade to Pro</button>`
                }
              </div>

              <!-- Team Card -->
              <div style="background: var(--bg-secondary); border: 2px solid ${isTeam ? 'var(--accent)' : 'var(--border-color)'}; border-radius: 10px; padding: 1.5rem;">
                <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.25rem; color: var(--text-primary);">Team</div>
                <div style="font-size: 1.5rem; font-weight: 800; margin-bottom: 1rem;">$49 <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-secondary);">/mo</span></div>
                <ul style="list-style: none; padding: 0; margin-bottom: 1.5rem; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
                  <li>✓ <strong>Unlimited Projects & Members</strong></li>
                  <li>✓ Unlimited history retention</li>
                  <li>✓ Role enforcement & team isolation</li>
                  <li>✓ Priority incident support</li>
                </ul>
                ${
                  isTeam
                    ? `<span style="display: block; text-align: center; font-size: 0.85rem; font-weight: 600; color: var(--accent); padding: 0.5rem;">Current Plan</span>`
                    : `<button id="btn-upgrade-team" class="btn btn-secondary" style="width: 100%; padding: 0.6rem; font-weight: 600;">Upgrade to Team</button>`
                }
              </div>

            </div>
          </div>
        </div>
      `;

      // Event Listeners
      document.getElementById('btn-upgrade-pro')?.addEventListener('click', async () => {
        try {
          const res = await api.createCheckoutSession(this.currentOrg!.orgId, 'pro');
          window.location.href = res.checkoutUrl;
        } catch (err: any) {
          alert(`Checkout failed: ${err.message}`);
        }
      });

      document.getElementById('btn-upgrade-team')?.addEventListener('click', async () => {
        try {
          const res = await api.createCheckoutSession(this.currentOrg!.orgId, 'team');
          window.location.href = res.checkoutUrl;
        } catch (err: any) {
          alert(`Checkout failed: ${err.message}`);
        }
      });

      document.getElementById('btn-manage-subscription')?.addEventListener('click', async () => {
        try {
          const res = await api.createCustomerPortalSession(this.currentOrg!.orgId);
          window.location.href = res.portalUrl;
        } catch (err: any) {
          alert(`Customer portal failed: ${err.message}`);
        }
      });

    } catch (err: any) {
      el.innerHTML = `
        <div style="max-width: 600px; margin: 3rem auto; padding: 2rem; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; text-align: center;">
          <div style="color: var(--danger); font-weight: 600; margin-bottom: 0.5rem;">Failed to load billing information</div>
          <div style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1rem;">${escapeHtml(err.message)}</div>
          <a href="#projects" class="btn btn-secondary btn-sm">Return to Projects</a>
        </div>
      `;
    }
  }
}
