# DwarfLens Engineering & Product Decisions

Record of architectural and product decisions made during DwarfLens SaaS development.

## Decision Log

### 2026-10-19: Step 0 - Project Architecture & Baseline
- **Context:** Transitioning DwarfLens into an open-core SaaS while maintaining the zero-dependency C++23 native core.
- **Decision:** Keep C++ core strictly focused on parsing and local diffing without any HTTP/network dependencies. The SaaS backend will be a single standalone Node.js service using Hono, Drizzle ORM, and PostgreSQL. CI ingestion will be handled via curl in the GitHub Action.
- **Rationale:** Meets all non-negotiable rules (privacy, zero network in C++, simple boring tech stack, low maintenance for solo developer).

### 2026-10-19: Task B4 - Budget Failure Alerts (Email & Slack)
- **Context:** Delivering CI budget failure notifications to project owners via email (Resend) on `main` and optional Slack incoming webhooks.
- **Decision:** Use native Node.js `fetch` against Resend's REST API and Slack webhooks to avoid heavyweight external SDK dependencies. Store alert settings (`slack_webhook_url`, `email`) in `projects.settings.alerts`. If no project override email is set, default recipient is the organization owner.
- **Rationale:** Zero extra dependencies, fully self-contained, predictable HTTP interaction easily mockable in test environments.

### 2026-10-20: Task C4 - Billing Provider & Plan Limits
- **Context:** Enforcing Free vs Pro vs Team tiers (Free: 1 project, public repos only, 30-day retention; Pro: unlimited projects, private repos, 365-day retention; Team: unlimited projects/retention).
- **Decision:** Implemented a thin `BillingProvider` interface with a concrete `StripeBillingProvider` handling checkout sessions, customer portal sessions, and subscription webhooks (`checkout.session.completed`, `customer.subscription.deleted`). Plan limits are enforced server-side upon project creation and CI auto-creation. Added a retention cleanup job (`runRetentionCleanup()`) and endpoint (`POST /api/v1/billing/retention`) to prune historical analyses exceeding plan limits.
- **Rationale:** Strict server-side enforcement prevents quota bypass, thin provider abstraction enables swapping payment processors if needed, and automated retention cleanup keeps database storage predictable and low-cost.


