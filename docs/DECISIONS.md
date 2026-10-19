# DwarfLens Engineering & Product Decisions

Record of architectural and product decisions made during DwarfLens SaaS development.

## Decision Log

### 2026-10-19: Step 0 - Project Architecture & Baseline
- **Context:** Transitioning DwarfLens into an open-core SaaS while maintaining the zero-dependency C++23 native core.
- **Decision:** Keep C++ core strictly focused on parsing and local diffing without any HTTP/network dependencies. The SaaS backend will be a single standalone Node.js service using Hono, Drizzle ORM, and PostgreSQL. CI ingestion will be handled via curl in the GitHub Action.
- **Rationale:** Meets all non-negotiable rules (privacy, zero network in C++, simple boring tech stack, low maintenance for solo developer).
