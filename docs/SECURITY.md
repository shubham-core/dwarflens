# DwarfLens Security Architecture & Policy

DwarfLens is committed to protecting binary analysis artifacts, customer source metadata, organizational telemetry, and developer credentials against unauthorized access, tampering, and denial of service.

This document describes DwarfLens's security model, reporting guidelines, supported versions, and defensive controls implemented across the SaaS platform and GitHub Action runner.

---

## 1. Supported Versions

Security updates and critical vulnerability patches are actively maintained for the following versions:

| Version | Supported | Status |
| :--- | :---: | :--- |
| `0.1.x` | ✅ Yes | Current active release branch (`main`, `v0.1.0`) |
| `< 0.1.0` | ❌ No | Pre-release dev builds |

---

## 2. Reporting a Vulnerability

We value the contributions of security researchers and engineers who discover vulnerabilities. If you believe you have discovered a vulnerability in DwarfLens, please disclose it responsibly.

### Security Contact
* **Email:** `security@dwarflens.dev` (or open a confidential security advisory on GitHub under **Security → Advisories → Report a vulnerability**).
* **Encryption:** For sensitive disclosures, request a PGP public key from the maintainers prior to transmitting credentials or proof-of-concept exploits.

### Response Timelines (SLA)
* **Initial Acknowledgement:** Within **24 hours**.
* **Triage & Reproducibility Assessment:** Within **48 hours**.
* **Remediation & Patch Deployment:** Critical vulnerabilities are prioritized for hotfix within **5 business days**.
* **Public Advisory:** Published after patches are deployed to production and distributed across release artifacts.

Please **do not** file public GitHub issues for security vulnerabilities.

---

## 3. Security Architecture & Threat Model

```
               [ Internet / CI Runners / Browsers ]
                                |
                   (HTTPS / TLS Termination)
                                |
                   [ Trusted Proxy / Reverse Proxy ]
               (cf-connecting-ip / true-client-ip)
                                |
                  +-------------+-------------+
                  |  DwarfLens Hono Gateway   |
                  +-------------+-------------+
                                |
         +----------------------+----------------------+
         |                      |                      |
[ Rate Limiter ]         [ CORS Allowlist ]     [ Body Size Limit (5MB) ]
         |                      |                      |
         +----------------------+----------------------+
                                |
      +-------------------------+-------------------------+
      |                         |                         |
[ Auth Middleware ]     [ API Key Scopes ]       [ Param Validator ]
- SHA-256 Hash          - ingest:write only       - UUID enforcement
- httpOnly Cookie       - Project-scoped          - Error sanitization
- Bearer fallback       - No admin access
      |                         |                         |
      +-------------------------+-------------------------+
                                |
                    [ Multi-Tenant Core (DB) ]
                    - Organization isolation
                    - Strict role hierarchy (owner/member/viewer)
                    - TLS verify-full connection pool
```

### Multi-Tenant Isolation
1. **Hierarchical Ownership:** All projects, binary analyses, budgets, and API keys are strictly partitioned under organizations (`org_id`).
2. **Role-Based Access Control (RBAC):**
   * `owner`: Full administrative privileges (manage billing, invite members, modify roles, create API keys, configure webhooks/alerts, delete projects).
   * `member`: Engineering privileges (create projects, upload analyses, configure budgets). Forbidden from managing org members, billing, or API keys.
   * `viewer`: Read-only reporting privileges. Cannot upload analyses, cannot view raw webhook URLs, and cannot alter budgets.
3. **Foreign Key Guarantees:** Multi-table joins assert organizational ownership. Cross-tenant access attempts return `404 Not Found` or `403 Forbidden`.

### Session Security & Token Hashing
1. **Hashed Session Tokens:** Session tokens are never stored as plaintext in the database. When a session is generated, a 64-character high-entropy token is issued to the client while the database stores its SHA-256 cryptographic digest (`hashSessionId`).
2. **Storage & Transmission:**
   * Same-domain deployments utilize `httpOnly`, `SameSite=Lax`, `Secure` cookies.
   * Cross-site deployments (e.g., GitHub Pages frontend with Render backend) utilize an automated one-time-code exchange (`APP_URL#code=...`), with session tokens kept in browser `sessionStorage` and passed via `Authorization: Bearer <sessionId>` headers.
3. **Session Expiry & Lifecycle:** Sessions expire after 30 days and are automatically purged from the database during scheduled retention runs.

### API Key Scoping & Least Privilege
1. **Restricted Default Scopes:** API keys default to `ingest:write`.
2. **CI Isolation:** CI keys can **only** submit analysis payloads for their designated project. A compromised CI key cannot invite members, modify roles, alter budgets, access billing, delete projects, or create share links.
3. **Key Hashing:** Raw API keys (`dl_live_...`) are shown once upon creation and stored in the database exclusively as SHA-256 digests.

### Webhook & Cron Cryptographic Verification
1. **Fail-Closed Verification:** Webhook and cron endpoints fail closed. If signing secrets (`STRIPE_WEBHOOK_SECRET`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CRON_SECRET`) are missing or empty in production, endpoints immediately reject with `HTTP 503` without processing unauthenticated requests.
2. **Constant-Time Comparison:** All HMAC signatures (Stripe `t=<time>,v1=<hmac>`, Lemon Squeezy `x-signature`, Razorpay `x-razorpay-signature`) and cron bearer tokens are compared using `crypto.timingSafeEqual` to eliminate timing attacks.
3. **Timestamp Tolerance:** Webhook signatures enforce a 5-minute (300-second) timestamp freshness window to eliminate replay attacks.
4. **Customer Lookup:** Webhooks look up target organizations using verified `stripe_customer_id` stored on the organization, rather than blindly trusting arbitrary body payloads.

### CORS & Network Boundary Policy
1. **Origin Allowlist:** Origin reflection is banned. CORS origins are strictly matched against `new URL(env.APP_URL).origin` (plus localhost in development/test mode).
2. **Credential Protection:** `Access-Control-Allow-Credentials: true` is set only for explicitly allowlisted origins.

### Rate Limiting & Abuse Prevention
1. **Client IP Identification:** Rate limiters extract trusted client IPs from platform headers (`cf-connecting-ip`, `true-client-ip`, or the rightmost IP in `x-forwarded-for`), preventing client-controlled spoofing.
2. **Endpoint Coverage:** Rate limiting is enforced across sensitive attack vectors including login (`/auth/dev-login`), OAuth initiates and callbacks (`/auth/github`, `/auth/github/callback`), public report reads (`/shared/:token`), and public report creations (`/analyses/:id/share`).
3. **Response Headers:** `Retry-After` headers inform well-behaved clients of cool-off intervals.

### Input Validation & XSS Sanitization
1. **Route Param UUID Validation:** All route parameters (`:id`, `:orgId`, `:projectId`) are validated using UUID v4 regex schemas. Malformed or non-UUID inputs return `400 Bad Request` rather than causing database query exceptions.
2. **Body Stream Limit:** Middleware enforces a strict 5 MB payload limit before buffering JSON bodies into memory.
3. **Global Error Sanitization:** `app.onError` catches unhandled exceptions and returns generic `500 Internal Server Error` responses, preventing internal stack traces or database schema disclosures.
4. **Frontend Output Escaping:** Every dynamic string interpolated into the DOM (names, commit hashes, branches, struct names, C++ template symbols like `std::vector<int>`, error messages) passes through `escapeHtml()` in `web/src/escape.ts`.

### GitHub Action CI Hardening
1. **Script Injection Defense:** Composite action steps never interpolate `${{ ... }}` expressions directly into `run:` shell blocks. All inputs and contexts are passed via `env:` environment variables and referenced as `"$VAR"` in bash.
2. **Pinned Binary Verification:** The action downloads pinned release binaries from GitHub releases and validates their SHA-256 checksums before execution.
3. **Resilient Failure Handling:** Analysis upload and PR commenting steps execute under `if: always()` to capture failure telemetry even when size budgets fail, while non-zero exit codes are enforced at the final step. PR comments gracefully downgrade to warnings on fork pull requests lacking write permissions.

---

## 4. Security Controls Checklist

| ID | Control Description | Status | Verification Suite |
| :--- | :--- | :---: | :--- |
| **P0-1** | CORS allowlist matching canonical `APP_URL.origin` with credentials | ✅ Pass | `security_cors.test.ts` |
| **P0-2** | Webhook HMAC-SHA256 signature verification & customer lookup | ✅ Pass | `security_webhook.test.ts` |
| **P0-3** | Retention cron endpoint guard (`CRON_SECRET` constant-time compare) | ✅ Pass | `security_retention.test.ts` |
| **P0-4** | Dev-login restricted to localhost dev/test; production startup validation | ✅ Pass | `security_devlogin.test.ts`, `security_startup_validation.test.ts` |
| **P0-5** | GitHub OAuth CSRF state cookie & verified primary email linking | ✅ Pass | `security_oauth.test.ts`, `security_oauth_reverify.test.ts` |
| **P0-6** | PostgreSQL connection pool error handler & TLS verification | ✅ Pass | `security_db.test.ts` |
| **P0-7** | DOM XSS sanitization helper (`escapeHtml`) for user and binary values | ✅ Pass | `security_xss.test.ts`, `web/src/escape.test.ts` |
| **P1-8** | Stripe Checkout line items, customer storage & return URL origin checks | ✅ Pass | `security_stripe_checkout.test.ts`, `security_stripe_checkout_reverify.test.ts` |
| **P1-9** | Frontend billing UI (plan badge, upgrade modal, usage counters) | ✅ Pass | `security_billing_ui.test.ts` |
| **P1-10** | Plan limit enforcement & JSON `'unlimited'` limit serialization | ✅ Pass | `security_plan_limits.test.ts` |
| **P1-11** | Provider-agnostic billing abstraction (Stripe, Lemon Squeezy, Razorpay) | ✅ Pass | `security_billing_abstraction.test.ts` |
| **P2-12** | API key scoping (`ingest:write`) and project-level isolation | ✅ Pass | `security_api_key_scopes.test.ts` |
| **P2-13** | Slack webhook domain regex enforcement & viewer URL redaction | ✅ Pass | `security_alert_hardening.test.ts` |
| **P2-14** | Pending invitations with hashed tokens, expiry, and email verification | ✅ Pass | `security_invitations.test.ts` |
| **P2-15** | Route param UUID validation, 5MB body limit & generic 500 JSON handler | ✅ Pass | `security_input_validation.test.ts` |
| **P2-16** | Trusted client IP extraction & rate limiting on auth, shares, and ingests | ✅ Pass | `security_rate_limiting.test.ts` |
| **P2-17** | SHA-256 session token hashing, typed confirmation for destructive actions | ✅ Pass | `security_session_hardening.test.ts` |
| **P2-18** | Upgraded dependencies (`drizzle-orm`, `vitest`, `vite`) with clean audit | ✅ Pass | `package.json`, `package-lock.json` |
| **P3-19** | One-time-code OAuth handoff (`APP_URL#code=...`) for cross-site auth | ✅ Pass | `security_cross_origin_login.test.ts` |
| **P4-20** | Action script injection safety via `env:` environment bindings | ✅ Pass | `security_action_injection.test.ts` |
| **P4-21** | Pinned release binary download with SHA-256 checksum validation | ✅ Pass | `security_action_binary_download.test.ts` |
| **P4-22** | Action `if: always()` step resilience & fork PR comment degradation | ✅ Pass | `security_action_failure_handling.test.ts` |
| **P4-23** | Modern runner matrix (`macos-14`, `ubuntu-latest`, `windows-latest`) | ✅ Pass | `security_release_workflow.test.ts` |
| **P5-24** | Production hygiene (`web/dist` untracked, `APP_URL` normalized, `render.yaml`) | ✅ Pass | `security_cleanup_hygiene.test.ts` |
| **P5-25** | Comprehensive regression test suite and security documentation | ✅ Pass | `security_docs_and_regression.test.ts` |

---

## 5. Known Limitations & Mitigations

1. **Single-Node In-Memory Rate Limiting:**
   * *Limitation:* The default rate limiter uses an in-memory sliding window, which tracks counters per instance.
   * *Mitigation:* Documented in `docs/DEPLOYMENT.md`. For multi-instance horizontal scaling, deploy Redis or DragonFly using a shared store adapter.
2. **Third-Party Email Delivery:**
   * *Limitation:* Invitation emails and budget alerts depend on a configured Resend API key (`RESEND_API_KEY`).
   * *Mitigation:* When no email service is configured, invitations remain accessible to organization owners via direct invite tokens in the dashboard UI.
