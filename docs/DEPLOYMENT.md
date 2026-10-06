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

| Variable Name | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection URI (`postgres://user:pass@host:5432/db?sslmode=require`). |
| `SESSION_SECRET` | **Yes** | — | 32+ character cryptographic secret for signing HTTP session cookies. |
| `PORT` | No | `3000` | Port on which the API server listens. |
| `NODE_ENV` | No | `development` | Set to `production` in staging/production deployments. |
| `GITHUB_CLIENT_ID` | **Yes** | — | GitHub OAuth application client ID for web dashboard login. |
| `GITHUB_CLIENT_SECRET` | **Yes** | — | GitHub OAuth application client secret. |
| `APP_URL` | No | `http://localhost:5173` | Public URL of the web dashboard (used for OAuth redirects and CORS). |
| `DEV_LOGIN_ENABLED` | No | `false` | Enables `/api/v1/auth/dev-login` for local development. **Must be false in production**. |
| `STRIPE_SECRET_KEY` | Optional | — | Stripe API secret key (`sk_live_...`) to activate real billing checkouts. |
| `STRIPE_WEBHOOK_SECRET` | Optional | — | Stripe webhook signing secret (`whsec_...`) for subscription events. |
| `RESEND_API_KEY` | Optional | — | Resend API key (`re_...`) for dispatching CI budget alert emails. |

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
