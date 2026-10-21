# DwarfLens Production Deployment Guide

This guide describes how to deploy the DwarfLens SaaS stack to production using simple, managed, low-maintenance infrastructure:
- **API Server:** Containerized Node.js service running on **Fly.io** or **Railway**.
- **Web Frontend:** Static SPA deployed on **Vercel** or **Cloudflare Pages**.
- **Database:** Serverless PostgreSQL hosted on **Neon** or **Supabase**.

---

## 1. Managed PostgreSQL Setup (Neon / Supabase)

DwarfLens requires a PostgreSQL database (version 14+) with standard SSL connections.

### Setup on Neon (Recommended)
1. Sign up at [neon.tech](https://neon.tech) and create a project named `dwarflens-db`.
2. In the Neon console, copy the **Connection string** (choose **Connection pooling** for serverless apps).
3. The connection string has the format:
   ```text
   postgres://[user]:[password]@[endpoint]-pooler.[region].neon.tech/neondb?sslmode=require
   ```
4. Run migrations from your terminal to initialize the database tables:
   ```bash
   DATABASE_URL="postgres://..." npm run db:migrate --prefix server
   ```

---

## 2. API Server Deployment

The backend server is packaged as a minimal, multi-stage Alpine Docker container (`server/Dockerfile`) exposing port `3000`.

### Option A: Fly.io (Recommended)

1. **Install Fly CLI**:
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth login
   ```

2. **Initialize Fly App**:
   From the repository root:
   ```bash
   fly launch --dockerfile server/Dockerfile --name dwarflens-api --no-deploy
   ```

3. **Configure `fly.toml`**:
   Ensure `fly.toml` includes health checks and port mappings:
   ```toml
   app = "dwarflens-api"
   primary_region = "iad"

   [build]
     dockerfile = "server/Dockerfile"

   [http_service]
     internal_port = 3000
     force_https = true
     auto_stop_machines = 'stop'
     auto_start_machines = true
     min_machines_running = 1

     [http_service.concurrency]
       type = "requests"
       hard_limit = 250
       soft_limit = 200

   [[http_service.checks]]
     interval = "30s"
     timeout = "5s"
     grace_period = "10s"
     method = "GET"
     path = "/health"
   ```

4. **Set Production Secrets**:
   ```bash
   fly secrets set \
     DATABASE_URL="postgres://..." \
     SESSION_SECRET="$(openssl rand -hex 32)" \
     GITHUB_CLIENT_ID="your_github_client_id" \
     GITHUB_CLIENT_SECRET="your_github_client_secret" \
     APP_URL="https://dwarflens.vercel.app" \
     DEV_LOGIN_ENABLED="false"
   ```

5. **Deploy**:
   ```bash
   fly deploy
   ```

---

### Option B: Railway

1. Sign in to [railway.app](https://railway.app) and create a **New Project** from your GitHub repository.
2. In the service settings:
   - **Root Directory**: `server`
   - **Build Command**: Uses `Dockerfile` automatically.
3. In **Variables**, add all required production variables listed in the table below.
4. Under **Settings > Networking**, generate a public Railway domain (e.g., `https://dwarflens-production.up.railway.app`).

---

## 3. Web Dashboard & Landing Deployment

The frontend (`web/`) is a client-side Single Page Application built with Vite and TypeScript. It includes the landing page, live interactive demo, web analyzer, and authenticated SaaS dashboard.

### Option A: Vercel

1. Import the `dwarflens` repository into [vercel.com](https://vercel.com).
2. Configure project settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Add a Single Page Application rewrite rule in `web/vercel.json` if using custom client routes:
   ```json
   {
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```
4. Deploy the project.

### Option B: Cloudflare Pages

1. Navigate to Cloudflare Dashboard > **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. Settings:
   - **Project Name**: `dwarflens`
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `web`
3. Click **Save and Deploy**.

---

## 4. Environment Variables Reference

In production (`NODE_ENV=production`), DwarfLens strictly enforces startup validation (`validateProductionEnv`). The server will refuse to start if any required environment variable is missing, using default values, or pointing to localhost.

| Variable Name | Required in Prod | Default / Example | Description |
| :--- | :---: | :---: | :--- |
| `NODE_ENV` | Yes | `production` | Deployment environment (`production`, `development`, `test`). Defaults to `production` when unset. |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection URI (`postgresql://user:pass@host:5432/db?sslmode=require`). Cannot be localhost in production. |
| `DATABASE_URL_UNPOOLED` | No | — | Optional unpooled connection string for direct migration scripts. |
| `SESSION_SECRET` | **Yes** | — | 32+ character cryptographic secret for signing HTTP session cookies. Cannot use dev default. |
| `PORT` | No | `3000` | Port on which the API server listens. |
| `GITHUB_CLIENT_ID` | **Yes** | — | GitHub OAuth application client ID for web dashboard login. |
| `GITHUB_CLIENT_SECRET` | **Yes** | — | GitHub OAuth application client secret. |
| `APP_URL` | **Yes** | `https://shubham-core.github.io/dwarflens/` | Public URL of the web dashboard (used for CORS allowlist and redirect validation). Cannot be localhost in production. |
| `API_URL` | **Yes** | `https://dwarflens.onrender.com` | Public base URL of the API server (used for OAuth callback redirection). Cannot be localhost in production. |
| `CRON_SECRET` | **Yes** | — | 32+ character secret for authenticating scheduled maintenance jobs (`POST /api/v1/billing/retention`). |
| `BILLING_PROVIDER` | No | `stripe` | Active billing provider: `stripe`, `lemonsqueezy`, or `razorpay`. |
| `STRIPE_SECRET_KEY` | Optional | `sk_live_...` | Stripe API secret key. Required for live Stripe checkout sessions. |
| `STRIPE_WEBHOOK_SECRET` | **Yes\*** | `whsec_...` | Stripe webhook HMAC signing secret. **Required if `BILLING_PROVIDER=stripe`**. |
| `STRIPE_PRICE_PRO` | Optional | `price_...` | Stripe Price ID for Pro plan checkout. |
| `STRIPE_PRICE_TEAM` | Optional | `price_...` | Stripe Price ID for Team plan checkout. |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | **Yes\*** | — | Webhook HMAC signing secret. **Required if `BILLING_PROVIDER=lemonsqueezy`**. |
| `RAZORPAY_WEBHOOK_SECRET` | **Yes\*** | — | Webhook HMAC signing secret. **Required if `BILLING_PROVIDER=razorpay`**. |
| `RESEND_API_KEY` | Optional | `re_...` | Resend API key for dispatching CI budget alert emails. |

---

## 5. Automated Server CI/CD

Continuous integration for the server runs on every pull request and push affecting backend code via `.github/workflows/server.yml`.

To run tests locally:
```bash
# Start local Postgres container
docker compose up -d

# Run migrations
npm run db:migrate --prefix server

# Run full Vitest test suite
npm test --prefix server
```

---

## 6. Rate Limiting and Multi-Instance Scaling

DwarfLens enforces sliding-window rate limiting across critical API endpoints to protect against brute-force attacks and abuse:
- **Authentication & OAuth:** `POST /api/v1/auth/dev-login` (10 requests/min), `GET /api/v1/auth/github` and `/callback` (20 requests/min)
- **Public Share Links:** `GET /api/v1/shared/:token` (60 requests/min), `POST /api/v1/analyses/:id/share` (30 requests/min)
- **CI Ingestion:** `POST /api/v1/analyses` (100 requests/min per API key/IP)

### Trusted Client IP Resolution
The API extracts the client's trusted IP using platform headers:
1. `cf-connecting-ip` (Cloudflare edge proxy)
2. `true-client-ip` (Akamai / Cloudflare Enterprise)
3. In multi-hop proxy chains (Render, AWS ALB), the rightmost IP in `X-Forwarded-For` appended by the nearest reverse proxy, preventing client-spoofed prefix IPs from bypassing rate limits.

### Multi-Instance Shared Store Notice
> [!NOTE]
> The default rate limiter uses an in-memory sliding window store suitable for single-instance deployments (standard on Render and Fly.io single-container setups).
> When horizontally scaling to multiple backend instances or serverless worker pools, a shared centralized store (such as Redis or Upstash) must be configured to coordinate request counters across instances.

---

## 7. Custom Domain and Cross-Origin Authentication (Safari & Brave Compatibility)

### A. Same-Site Apex Domain Setup (Recommended for Custom Domains)
To avoid third-party cookie restrictions entirely across modern browsers (such as Apple Safari Intelligent Tracking Prevention and Brave Shields), configure both the frontend SPA and the backend API on the same registrable apex domain:
- **Frontend SPA:** `https://app.yourdomain.com` (or `https://yourdomain.com`)
- **Backend API:** `https://api.yourdomain.com`

#### DNS Configuration
1. **Frontend (Vercel / Cloudflare Pages / GitHub Pages):**
   - Add CNAME record: `app.yourdomain.com` -> `cname.vercel-dns.com` (or Cloudflare Pages target).
2. **Backend (Render / Fly.io / Railway):**
   - Add CNAME record: `api.yourdomain.com` -> `dwarflens.onrender.com`.

#### Environment Configuration
Update environment variables on the backend server:
```bash
APP_URL="https://app.yourdomain.com"
API_URL="https://api.yourdomain.com"
```
When configured on subdomains of the same parent site, cookies can be shared with `SameSite=Lax; Secure; Domain=.yourdomain.com`, enabling seamless first-party credentials across both origins.

### B. One-Time Code Handoff (Cross-Site Deployments)
When deploying across distinct third-party domains (e.g., GitHub Pages at `https://shubham-core.github.io/dwarflens/` and Render at `https://dwarflens.onrender.com`), browsers block cross-site `SameSite=None; Secure` cookies.

DwarfLens transparently handles this with an automated one-time-code exchange:
1. Upon GitHub OAuth callback, the backend generates an ephemeral cryptographic code (60-second TTL) and redirects to: `https://shubham-core.github.io/dwarflens/#code=<ephemeralCode>`.
2. The frontend SPA immediately detects `#code=`, exchanges it via `POST /api/v1/auth/exchange-code`, and purges the code from the address bar.
3. The resulting session token is kept in `sessionStorage` and transmitted via `Authorization: Bearer <sessionId>` headers for all subsequent API calls, guaranteeing 100% login reliability in Safari, Brave, and Incognito browsing mode.

---

## Branch Protection & Release Gates

To ensure code safety before production deployment:

1. **GitHub Branch Protection Rules**:
   - Apply protection rule to `main`.
   - **Require a pull request before merging** with at least 1 approval.
   - **Require status checks to pass before merging**:
     - `Native CLI & Tests / build-and-test`
     - `WASM Build / wasm-build`
     - `Server CI / test-and-typecheck`
   - Enforce branch up-to-date checks.
2. **Infrastructure-as-Code Configuration**:
   - `render.yaml` declares explicit `NODE_ENV: production` for the web service.
   - Deployments automatically trigger startup migration bootstrap (`migrate()`).

