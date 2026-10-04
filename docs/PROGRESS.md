# DwarfLens SaaS Transformation Progress

## Step 0: Orient First
- [x] Orient and create documentation baseline (AGENTS.md, PROGRESS.md, ARCHITECTURE.md, DECISIONS.md)

## TIER A: Foundation (hardest, do first)
- [x] A1. Analysis JSON contract
- [x] A2. Backend skeleton in server/
- [x] A3. Data model and migrations
- [x] A4. Authentication and tenant isolation
- [x] A5. Ingest and read API
- [ ] A6. GitHub Action upgrade (action/)

## TIER B: Product (medium difficulty)
- [ ] B1. Dashboard in web/
- [ ] B2. Shareable report links
- [ ] B3. Budgets
- [ ] B4. Alerts
- [ ] B5. Teams

## TIER C: Simple Tasks and Polish
- [ ] C1. Landing page
- [ ] C2. Docs
- [ ] C3. Legal and data control
- [ ] C4. Billing
- [ ] C5. Deployment
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
