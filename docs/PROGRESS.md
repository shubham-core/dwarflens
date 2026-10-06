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
- [ ] C6. Repo polish

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








