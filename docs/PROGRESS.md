# DwarfLens SaaS Transformation Progress

## Step 0: Orient First
- [x] Orient and create documentation baseline (AGENTS.md, PROGRESS.md, ARCHITECTURE.md, DECISIONS.md)

## TIER A: Foundation (hardest, do first)
- [x] A1. Analysis JSON contract
- [x] A2. Backend skeleton in server/
- [x] A3. Data model and migrations
- [x] A4. Authentication and tenant isolation
- [x] A5. Ingest and read API
- [x] A6. GitHub Action upgrade (action/)

## TIER B: Product (medium difficulty)
- [x] B1. Dashboard in web/
- [x] B2. Shareable report links
- [x] B3. Budgets
- [x] B4. Alerts
- [x] B5. Teams

## TIER C: Simple Tasks and Polish
- [x] C1. Landing page
- [x] C2. Docs
- [x] C3. Legal and data control
- [x] C4. Billing
- [x] C5. Deployment
- [x] C6. Repo polish

---

## Security & Bug Fix Pass

### P0 — Money and Takeover (do first)
- [x] 1. **CORS allowlist** — replace origin-reflection with an allowlist from APP_URL (+ localhost in dev); keep `credentials` only for allowlisted origins.
- [x] 2. **Billing webhook signature** — verify Stripe HMAC-SHA256 (`t.payload`, `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance, constant-time compare); reject unsigned requests; look up org via stored `stripe_customer_id`, never trust `org_id` from body.
- [x] 3. **Retention cron guard** — require `CRON_SECRET` header (constant-time), add a scheduled GitHub Actions workflow calling it daily.
- [x] 4. **Dev login hardening** — only enabled in `NODE_ENV==='development'`; fail startup in production if `SESSION_SECRET` or `DATABASE_URL` use defaults; hide Quick Dev Login form from production web build (show only when `import.meta.env.DEV`).
- [x] 5. **GitHub OAuth state cookie** — store `state` in a short-lived httpOnly cookie, verify in callback; link accounts ONLY by GitHub ID or VERIFIED primary email, never fall back to unverified emails.
- [x] 6. **DB pool hardening** — add `pool.on('error')` handler, enable TLS verification, run migrations at server startup.
- [x] 7. **XSS escaping** — add `escapeHtml` helper, apply to every API/user-controlled value interpolated into `innerHTML` in `dashboard.ts`; add a test with XSS payload and `std::vector<int>`.

### P1 — Finish Payments
- [x] 8. **Stripe Checkout** — add `line_items` with price IDs from env, create/store `stripe_customer_id` and subscription ID on orgs (new migration), put `org_id` in `subscription_data[metadata]`, handle `customer.subscription.updated/deleted` and `invoice.payment_failed`, make portal use stored customer, make `getSubscription` read real state; validate success/cancel/return URLs against `APP_URL`.
- [x] 9. **Frontend billing UI** — Upgrade buttons on pricing section, Billing page in dashboard (current plan, usage, Upgrade, Manage subscription).
- [x] 10. **Enforce plan limits server-side** — alerts only on paid plans, private repos on paid plans, history retention per plan; return `null` limits as the string `"unlimited"` instead of `Infinity`.
- [x] 11. **Payment abstraction** — abstract billing behind existing interface; implement Razorpay or Lemon Squeezy if Stripe unavailable (user choice).

### P2 — Permissions and Abuse
- [x] 12. **API key scopes** — add `ingest:write` scope by default; CI keys must NOT manage members/keys/billing/delete projects/change budgets; enforce project-scoped keys on every route.
- [x] 13. **Alert hardening** — allow `slack_webhook_url` only for `https://hooks.slack.com/services/*`; only send alert emails to verified org members; hide webhook URLs from viewers (return `has_slack_webhook` boolean).
- [x] 14. **Pending invitations** — create invitation with token, email it, add user only after they accept while logged in with a verified email.
- [x] 15. **Input validation** — validate all route params as UUIDs (400 on bad input), wrap `c.req.json()` in safe parsing, add `app.onError` returning generic 500 JSON, enforce 5 MB body limit via middleware.
- [x] 16. **Rate limiting** — use platform trusted client IP (not raw `X-Forwarded-For`), apply to login/OAuth/share/ingest routes, document multi-instance shared store requirement.
- [x] 17. **Session hardening** — hash session IDs in DB, delete expired sessions periodically, require typed confirmation for destructive actions, don't delete orgs that still have other members.
- [x] 18. **Dependency audit** — upgrade drizzle-orm to patched version, run `npm audit` for server and web.

### P3 — Login on Other Domains
- [x] 19. **Cross-origin login** — put app and API on same site or implement one-time-code handoff (OAuth callback redirects to `APP_URL#code=...`, frontend exchanges via POST for session token in `sessionStorage`).

### P4 — GitHub Action
- [x] 20. **Action injection safety** — never interpolate `${{ }}` in `run:` scripts; pass all inputs and GitHub context through `env:` and reference `"$VAR"` in bash.
- [x] 21. **Binary download** — download pinned release binary with SHA256 check or build from `${{ github.action_path }}/..`; honor `dwarflens-version`.
- [x] 22. **Job failure handling** — use `if: always()` / `continue-on-error` so upload and PR comment run even when thresholds fail; fail job at end; make PR comment non-fatal for fork PRs; document `permissions: pull-requests: write`. *(Commit: `a959fb4`)*
- [ ] 23. **Fix macos runner and tag v0.1.0** — fix or replace macos-13 runner in `release.yml`, create first tag `v0.1.0`.

### P5 — Hygiene
- [ ] 24. **Cleanup** — remove `web/dist` from git, fix double-slash in `#shared/`, normalize `APP_URL`, set `NODE_ENV=production` explicitly in Render config, add GitHub branch rule requiring CI before merge.
- [ ] 25. **Regression tests and security docs** — add regression tests for all items above, and `docs/SECURITY.md`.

---
## Task Log

### Step 0: Orient First
- **Completed:** Baseline architecture audit, created AGENTS.md, docs/PROGRESS.md, docs/ARCHITECTURE.md, and docs/DECISIONS.md.
- **Verification:** Verified C++ clean build, 5/5 ctest suites passed, web build cleanly succeeded.

### A1: Analysis JSON Contract
- **Completed:** Added `"schema_version": 1` and optional metadata (`repo`, `commit_sha`, `branch`, `build_name`, `timestamp`, `tool_version`, `compiler`, `flags`) to `BinaryAnalysis` and CLI flags. Authored standard JSON Schema at `schema/analysis.v1.schema.json`. Added automated Python-based schema validation test in `tests/test_analysis_schema.py` integrated into CTest.
- **Verification:** Ran `ctest --test-dir build --output-on-failure` (6/6 passed including `AnalysisSchemaValidation`), verified backward compatibility without flags, and confirmed web build passed cleanly.

### A2: Backend Skeleton in server/
- **Completed:** Created TypeScript backend skeleton with Hono, Drizzle ORM, Zod env validation, Vitest, and Postgres client. Added `docker-compose.yml` for local Postgres, `server/.env.example`, `GET /health` endpoint, and scripts for dev/build/test/migrate.
- **Verification:** Ran `npm test` in `server/` (health test passed), `npm run build` (clean tsc output), verified C++ ctest (6/6 passed), and verified web build.

### A3: Data Model and Migrations
- **Completed:** Implemented multi-tenant Drizzle schema for `users`, `sessions`, `orgs`, `org_members`, `projects`, `api_keys`, `analyses`, and `share_links` with compound indexes on `(project_id, created_at)` and `(project_id, branch)`. Generated migration `0000_living_exodus.sql` and documented schema in `docs/DATA_MODEL.md`.
- **Verification:** Generated SQL migrations with `npm run db:generate`, confirmed TypeScript typecheck and Vitest tests pass in `server/`, ran CTest (6/6 green), and verified web build.

### A4: Authentication and Tenant Isolation
- **Completed:** Built GitHub OAuth flow, secure httpOnly session cookies, SHA-256 hashed API keys with visible prefixes, and tenant resolution middleware enforcing role hierarchy (owner/member/viewer). Implemented test suite proving cross-tenant read/write isolation.
- **Verification:** Ran `npm test` in `server/` (12/12 tests passed including all 11 isolation scenarios), TypeScript build clean, CTest (6/6 passed), and web build cleanly succeeded.

### A5: Ingest and Read API
- **Completed:** Implemented `POST /api/v1/analyses` (Ajv schema validation against schema v1, 5 MB payload limit, sliding window rate limiting, idempotency on project+commit+build_name), `GET /api/v1/projects/:id/analyses` with summary columns, `GET /api/v1/analyses/:id`, and `GET /api/v1/projects/:id/diff?base=&head=` with section, symbol, and struct padding delta calculations.
- **Verification:** Ran `npm test` in `server/` (21/21 tests passed across all 3 test files), clean TypeScript build, verified CTest (6/6 passed), and confirmed web build succeeded.

### A6: GitHub Action Upgrade (action/)
- **Completed:** Added optional `api-url`, `api-key`, and `build-name` inputs to `action/action.yml` for automated analysis JSON upload via curl. Upgraded single PR comment tracking via marker detection and GitHub CLI (`gh api`). Added complete copy-paste workflow documentation in `action/README.md`.
- **Verification:** Ran full suite (`npm test --prefix server`, `ctest`, `npm run build --prefix web`) all green.

### B1: Dashboard in web/
- **Completed:** Added client-side SPA routing (`#try`, `#login`, `#projects`, `#projects/:id`, `#analyses/:id`, `#compare`). Preserved 100% client-side Wasm analyzer as "Try it" page. Added login page, projects list, create project modal (reveals generated API key once with copy action), project detail page with branch filter, SVG size history line chart, analyses history table with dual-selection comparison launcher, analysis detail page reusing full visualizers, and compare-two-analyses diff view.
- **Verification:** Built cleanly (`npm run build --prefix web`), all server vitest suites passed (21/21), ctest passed (6/6).

### B2: Shareable Report Links
- **Completed:** Added `POST /api/v1/analyses/:id/share` (owner-restricted creation of random 16-byte token), `DELETE /api/v1/analyses/:id/share` (revocation), and public unauthenticated `GET /api/v1/shared/:token`. Added `#shared/:token` route to web dashboard allowing public read-only viewing without login.
- **Verification:** Added `server/tests/share.test.ts` (4/4 tests passed), all server tests passed (25/25), CTest passed (6/6), and web build cleanly succeeded.

### B3: Budgets
- **Completed:** Implemented project budget settings (`max_total_size`, `max_growth_bytes`, `fail_on_padding_regression`) and `PUT /api/v1/projects/:id/budgets`. Integrated automated budget evaluation into `POST /api/v1/analyses` against base analyses. Updated GitHub Action (`action/action.yml`) to parse `budget_status`, write failures to PR comments / step summary, and fail CI with exit code 1 on violations.
- **Verification:** Added `server/tests/budgets.test.ts` (6/6 tests passed covering size, growth, and padding regression failures and passes), all server vitest suites passed (31/31), CTest passed (6/6), and web build succeeded.

### B4: Alerts
- **Completed:** Added budget alert notification system supporting optional Slack incoming-webhook URLs and Resend email alerts. Implemented `PUT /api/v1/projects/:id/alerts` to configure project-level alerts. Ingest triggers alert dispatching on `main`/`master` branch budget failures, falling back to org owner email when custom project recipient is omitted.
- **Verification:** Added `server/tests/alerts.test.ts` (5/5 tests passed covering Slack webhooks, Resend emails, branch filtering, and org owner fallback), all server vitest suites passed (36/36), CTest passed (6/6), and web build succeeded.

### B5: Teams
- **Completed:** Implemented organization member management API (`GET /orgs/:orgId/members`, `POST /orgs/:orgId/members`, `PATCH /orgs/:orgId/members/:memberId`, `DELETE /orgs/:orgId/members/:memberId`). Enforced strict role permissions (`owner`, `member`, `viewer`) across all routes: viewers have read-only access (blocked from creating projects, keys, share links, updating budgets/alerts, or ingesting analyses); members can manage projects and ingest analyses; owners have full administrative control. Added safeguards preventing removal or demotion of the final organization owner.
- **Verification:** Added `server/tests/teams.test.ts` (12/12 tests passed covering member invitations, role promotions/demotions, member removals, last-owner safeguards, and role permission enforcement across every endpoint), all server vitest suites passed (48/48), CTest passed (6/6), and web build succeeded.

### C1: Landing Page
- **Completed:** Designed and implemented responsive SaaS landing page in `web/src/landing.ts` featuring: Hero section with an interactive embedded live demo (supporting ELF, WebAssembly, and PE samples with real-time section bars and struct padding previews), 3 comprehensive feature breakdown cards (CI size tracking, DWARF padding/cache splits, automated budgets/alerts), dedicated "Your Binaries Never Leave Your Machine" zero-knowledge privacy assurance section, transparent 3-tier pricing table (Free / Pro / Team placeholders), and collapsible FAQ section. Updated client-side router and header navigation to support seamless `#landing`, `#pricing`, and `#faq` smooth scrolling.
- **Verification:** Clean TypeScript compile and Vite build (`npm run build --prefix web`), all server vitest suites passed (48/48), and CTest passed (6/6).

### C2: Docs
- **Completed:** Authored comprehensive developer documentation: `docs/QUICKSTART.md` (5-minute step-by-step setup guide covering local CLI installation, project/key creation, and copy-paste GitHub Action workflow), `docs/API_REFERENCE.md` (complete REST API specification for analyses ingest, diffs, projects, budgets, alerts, share links, and team member management), `docs/SCHEMA_REFERENCE.md` (detailed reference for `analysis.v1.schema.json` contract covering metadata, sections, symbols, and struct padding holes), and `docs/FAQ.md` (architectural knowledge base answering privacy, formats, cache-line splits, and offline execution).
- **Verification:** Verified all links and schemas conform to implementation; all server vitest suites passed (48/48), CTest passed (6/6), and web build cleanly succeeded.

### C3: Legal and Data Control
- **Completed:** Added privacy policy and terms of service templates (`docs/PRIVACY.md`, `docs/TERMS.md`) and rendered client-side views `#privacy` and `#terms` with footer navigation links. Implemented `DELETE /api/v1/projects/:id` (owner-restricted project deletion with database cascade to analyses, keys, and share links) and `DELETE /api/v1/auth/me` (self-service account deletion permanently destroying user records, personal organizations, and active sessions). Added Danger Zone UI for project and account deletion in the web dashboard.
- **Verification:** Added `server/tests/data_control.test.ts` (4/4 tests passed verifying owner permissions, cross-tenant isolation, cascade cleanups, and session cookie invalidation), all server vitest suites passed (52/52), CTest passed (6/6), and web build cleanly succeeded.

### C4: Billing and Plan Limits
- **Completed:** Added `plan` column to organizations (`free` default, `pro`, `team`) with migration `0001_military_azazel.sql`. Defined `BillingProvider` interface and implemented `StripeBillingProvider` supporting checkout sessions, customer portal redirects, and webhook lifecycle handling (`checkout.session.completed`, `customer.subscription.deleted`). Enforced plan limits server-side on project creation and ingest auto-creation (Free: 1 project limit, public repositories only; Pro/Team: unlimited projects and private repos). Built data retention cleanup job (`runRetentionCleanup`) and endpoint (`POST /api/v1/billing/retention`) to prune analyses exceeding 30 days on Free and 365 days on Pro tiers.
- **Verification:** Authored `server/tests/billing.test.ts` (6 tests verifying 1-project Free limit 403, private repo block 403, billing overview, checkout/portal sessions, Stripe webhook plan upgrade/downgrade, and 30-day retention pruning). Ran all tests: Vitest (9 test files, 58/58 passed), CTest (6/6 passed), and clean web build.

### C5: Deployment
- **Completed:** Authored production multi-stage Alpine Dockerfile for the backend server (`server/Dockerfile` and `server/.dockerignore`) with unprivileged `node` user runtime and dynamic schema/migrations mounting. Created comprehensive production deployment guide in `docs/DEPLOYMENT.md` detailing API deployment on Fly.io and Railway, frontend SPA hosting on Vercel and Cloudflare Pages, managed serverless PostgreSQL setup on Neon/Supabase, and full environment variables reference. Configured automated GitHub Actions workflow (`.github/workflows/server.yml`) running server migrations, Vitest test suites against a transient PostgreSQL service container, TypeScript compilation, and Docker smoke build on every PR/push.
- **Verification:** Verified Docker build locally (`docker build -t dwarflens-server:test server`), smoke tested container startup and health checks (`GET /health` returning 200 OK), verified CTest (6/6 passed), all Vitest server tests passed (58/58), and web build cleanly succeeded.

### C6: Repo Polish and Repository Documentation
- **Completed:** Authored `CONTRIBUTING.md` outlining architectural non-negotiables (zero-knowledge privacy, zero-dependency C++23, no HTTP in core, tenant isolation), complete directory map, build/test workflows for all subsystems, and commit conventions. Added SaaS Cloud platform section and quickstart to root `README.md`. Documented suggested GitHub About metadata and topic tags in `docs/REPO_POLISH.md`. Audited and verified `.github/workflows/release.yml` for multi-platform binary compilation, sha256 checksum generation, and automated GitHub Releases packaging.
- **Verification:** Ran all test suites across the repository: CTest (6/6 passed), Server Vitest (9 test files, 58/58 passed), clean web build, and verified release workflow configuration.

### P2-14: Pending Invitations Lifecycle
- **Completed:** Built pending invitations system with SHA-256 hashed token storage (`POST /api/v1/orgs/:orgId/invites`), 7-day expiration, single-use acceptance (`POST /api/v1/invitations/accept`), verified email matching enforcement, role escalation prevention, and disabled the legacy direct member addition endpoint (`POST /api/v1/orgs/:orgId/members` returning 403). Commit: `6f3056a`.
- **Verification:** Authored `server/tests/security_invitations.test.ts` (11 tests covering token hashing, expiry, unverified email rejection, wrong email rejection, role escalation prevention, and single use). All 30 server vitest test files (152 tests) passed, TypeScript typecheck clean, web build clean.

### P2-15: Input Validation and Error Handling
- **Completed:** Added comprehensive UUID validation middleware (`server/src/middleware/validateUuid.ts`) rejecting non-UUID route parameters and query params with 400 Bad Request; enforced global 5 MB body limit middleware via `hono/body-limit` (returning 413); added safe JSON body error handling returning 400 on malformed payloads; added generic `app.onError` returning generic 500 JSON without stack trace leaks. Commit: `4a769c6`.
- **Verification:** Authored `server/tests/security_input_validation.test.ts` (9 tests covering invalid UUID params across routes, malformed JSON bodies, payload size limits exceeding 5 MB, and generic 500 error sanitization). All 31 server vitest test files (161 tests) passed, TypeScript typecheck clean, web build clean.

### P2-16: Platform Trusted IP & Comprehensive Rate Limiting
- **Completed:** Hardened rate limiting middleware to resolve trusted client IPs from platform headers (`CF-Connecting-IP`, `True-Client-IP`, or the rightmost IP in `X-Forwarded-For`), neutralizing client-injected IP headers; mounted rate limiters with route-specific buckets on OAuth routes (`GET /github`, `GET /github/callback`), login (`POST /dev-login`), public share report reading (`GET /shared/:token`), and share generation (`POST /analyses/:id/share`); added `Retry-After` headers; documented multi-instance shared store requirements in `docs/DEPLOYMENT.md` and `docs/ARCHITECTURE.md`. Commit: `05b77b2`.
- **Verification:** Authored `server/tests/security_rate_limiting.test.ts` (3 tests verifying trusted CF IP enforcement despite spoofed XFF, dev-login rate limit enforcement, and public share rate limit enforcement). All 32 server vitest test files (164 tests) passed, TypeScript typecheck clean, web build clean.

### P2-17: Session Token Hashing & Safe Destructive Deletions
- **Completed:** Hardened session management to store only SHA-256 hashes of session tokens in the database, preventing token compromise upon DB leaks; added `cleanupExpiredSessions()` with periodic background execution and retention hook; enforced typed confirmation (`confirmName`) for destructive project deletion (`DELETE /api/v1/projects/:id`) and account deletion (`DELETE /api/v1/auth/me`), rejecting missing/mismatched requests with 400; preserved multi-member organizations when an owner deletes their account, transferring ownership rather than deleting the org. Commit: `834b2db`.
- **Verification:** Authored `server/tests/security_session_hardening.test.ts` (5 tests verifying SHA-256 session hash storage, expired session cleanup, typed project confirmation rejection/success, typed account confirmation rejection/success, and multi-member org preservation). All 33 server vitest test files (169 tests) passed, TypeScript typecheck clean, web build clean.

### P2-18: Dependency Vulnerability Audit & Upgrades
- **Completed:** Upgraded `drizzle-orm` to `^0.45.4` and `drizzle-kit` to `^0.31.11` to resolve SQL identifier injection (GHSA-gpj5-g38j-94v9); upgraded `vitest` to `^5.0.5` in `server/` to patch tinypool prototype pollution / RCE vulnerabilities; upgraded `vite` to `^6.4.5` in `web/` to resolve esbuild dev server vulnerabilities, achieving 0 npm audit vulnerabilities in `web/`. Commit: `0e4beb1`.
- **Verification:** Ran `npm audit` on both `server/` and `web/`; verified TypeScript compilation and all 33 Vitest server test suites (169/169 passed); verified clean frontend Vite build.

### P3-19: Cross-Origin Login & One-Time-Code Handoff
- **Completed:** Implemented ephemeral one-time-code handoff (`/auth/handoff.ts` and `POST /api/v1/auth/exchange-code`) allowing OAuth callbacks to transfer authentication to cross-site web frontends via URL hash without relying on third-party cookies (bypassing Safari ITP and Brave Shields); updated web SPA client to store tokens in `sessionStorage` and authenticate via `Authorization: Bearer <sessionId>`; documented apex same-site domain configuration and CNAME setup in `docs/DEPLOYMENT.md`. Commit: `4bbc1f4`.
- **Verification:** Authored `server/tests/security_cross_origin_login.test.ts` (3 tests verifying single-use code exchange, rejection of expired/replayed codes, and cookie-free Bearer authentication). All 34 server vitest test files (172 tests) passed, TypeScript typecheck clean, web build clean.

### P4-20: GitHub Action Script Injection Hardening
- **Completed:** Audited and refactored `action/action.yml` to eliminate direct `${{ }}` template expression interpolations inside all bash `run:` scripts, passing all workflow inputs and GitHub event context properties exclusively through step-scoped `env:` variables and referencing them as quoted `"$VAR"` variables in bash. Commit: `64e290f`.
- **Verification:** Authored `server/tests/security_action_injection.test.ts` static analysis test asserting zero `${{` expressions in any `run:` block across `action/action.yml`. All 35 server vitest test files (173 tests) passed, TypeScript typecheck clean, web build clean.

### P4-21: Action Release Binary Download & SHA-256 Checksum Verification
- **Completed:** Added pinned release binary download support in `action/action.yml` respecting `dwarflens-version` input (defaulting to `v0.1.0`), downloading platform-specific release tarballs and verifying SHA-256 checksums before execution; implemented source build fallback pointing to `${ACTION_PATH}/..` so external repositories consuming the action build cleanly. Commit: `efa2f29`.
- **Verification:** Authored `server/tests/security_action_binary_download.test.ts` (4 tests verifying `ACTION_PATH` and `VERSION` env passing, SHA-256 checksum verification, `ACTION_PATH/..` fallback path, and `dwarflens-version` default). All 36 server vitest test files (177 tests) passed, TypeScript typecheck clean, web build clean.









