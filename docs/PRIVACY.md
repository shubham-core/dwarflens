# DwarfLens Privacy Policy

*Plain template marked: **Review before launch***  
*Last updated: October 19, 2026*

---

## 1. Core Principle: Zero Binaries Uploaded

At DwarfLens, we operate under a strict, non-negotiable privacy principle:  
**Your compiled binaries and proprietary machine code are NEVER uploaded to our servers.**

All parsing of ELF, WebAssembly, Mach-O, and PE files occurs **100% locally** on your developer machine or within your private CI runner (e.g., GitHub Actions, GitLab CI). The DwarfLens C++ engine has zero networking capabilities.

---

## 2. Information We Collect

When you choose to synchronize metrics with DwarfLens Cloud, we collect only the resulting layout metadata:

1. **Analysis Metadata:** Section names and byte sizes (e.g. `.text`, `.rodata`), symbol names and sizes, struct names, member alignment offsets, padding hole byte counts, and 64-byte cache-line split counts.
2. **Repository & CI Context:** Git commit SHA, branch name, build name (e.g. `release`), and repository slug (e.g. `org/repo`).
3. **Account Information:** When signing in via GitHub OAuth, we receive your public GitHub username, email address, and avatar URL.
4. **Usage Data:** Standard API access logs (IP address, user-agent, timestamp) for security and sliding-window rate limiting.

---

## 3. How We Use Information

- To generate size progression and regression graphs over time per branch.
- To compute delta diffs between base and pull-request builds.
- To evaluate project-defined budgets and trigger alerts (via Slack or email).
- To isolate multi-tenant data strictly to authorized organization members.

---

## 4. Multi-Tenant Data Isolation

- Every database query is strictly filtered by organization UUID (`org_id`).
- API keys are hashed using SHA-256 before storage; the raw key is displayed once upon creation and cannot be retrieved by DwarfLens personnel.
- Public shareable reports are read-only and explicitly generated and revocable by project owners.

---

## 5. Data Control & Deletion Rights

You have complete control over your data:
- **Project Deletion:** Organization owners can permanently delete any project at any time via `DELETE /api/v1/projects/:id` or through the dashboard UI. This permanently erases all associated analyses, historical metrics, and project API keys.
- **Account Deletion:** You may permanently delete your account at any time via `DELETE /api/v1/auth/me`. All user data, active sessions, and personal organizations are immediately destroyed.

---

## 6. Contact Us

For privacy inquiries or data requests, contact: `privacy@dwarflens.dev`
