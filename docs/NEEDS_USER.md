# Actions Needed from User / Maintainer

This file documents manual actions, environment variables to configure in production, external provider setups, and database verification items that cannot or should not be automated by CI/CD.

---

## 1. Database Verification (Migration 0006)

* **Context:** Migration `0006_brainy_retro_girl.sql` (creating the `invitations` table) was applied to the Neon PostgreSQL instance.
* **Action Required:**
  1. Open your Neon PostgreSQL console / SQL editor.
  2. Run:
     ```sql
     SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;
     ```
  3. Verify that `0006_brainy_retro_girl` is present and matches `server/drizzle/0006_brainy_retro_girl.sql` in the repository.
  4. Ensure no further manual migrations are run outside of the automated server startup migration bootstrap (`migrate()` in `server/src/index.ts`).

---

## 2. Production Environment Variables (Render Dashboard)

Configure the following environment variables on the Render web service dashboard under **Settings → Environment**:

### Critical Security Keys
* `NODE_ENV`: Set explicitly to `production`.
* `APP_URL`: Set to the canonical frontend origin (e.g., `https://shubham-core.github.io/dwarflens` or your custom domain `https://app.dwarflens.dev`).
* `API_URL`: Set to the canonical backend API URL (e.g., `https://dwarflens.onrender.com` or `https://api.dwarflens.dev`).
* `SESSION_SECRET`: Generate a high-entropy 64-character secret (`openssl rand -hex 32`). Refuses to start if left default or under 32 characters.
* `CRON_SECRET`: Generate a high-entropy 64-character secret (`openssl rand -hex 32`). Must be at least 32 characters.

### GitHub OAuth App
* `GITHUB_CLIENT_ID`: OAuth App Client ID created in GitHub Developer Settings.
* `GITHUB_CLIENT_SECRET`: OAuth App Client Secret.
* **Authorization Callback URL in GitHub Developer Settings:** Must match `${API_URL}/api/v1/auth/github/callback`.

### GitHub Actions Secrets (Repository Settings → Secrets & Variables → Actions)
* `CRON_SECRET`: Must match the `CRON_SECRET` set on Render so `.github/workflows/retention-cron.yml` can authenticate.
* `DWARFLENS_API_URL`: Must match your Render API URL (e.g., `https://dwarflens.onrender.com`).

### Billing & Payments (When Enabling Paid Plans)
* `BILLING_PROVIDER`: Set to `stripe` (default), `lemonsqueezy`, or `razorpay`.
* If using Stripe:
  * `STRIPE_SECRET_KEY`: `sk_live_...`
  * `STRIPE_WEBHOOK_SECRET`: `whsec_...` (Obtain from Stripe Dashboard → Webhooks pointing to `${API_URL}/api/v1/billing/webhook`).
  * `STRIPE_PRICE_PRO`: Price ID for Pro plan (e.g., `price_...`).
  * `STRIPE_PRICE_TEAM`: Price ID for Team plan (e.g., `price_...`).
* If using Lemon Squeezy (Merchant of Record):
  * `BILLING_PROVIDER`: Set to `lemonsqueezy`.
  * `LEMONSQUEEZY_API_KEY`: API key (Lemon Squeezy Dashboard → Settings → API Keys).
  * `LEMONSQUEEZY_STORE_ID`: Store ID (Lemon Squeezy Dashboard → Settings → Stores).
  * `LEMONSQUEEZY_VARIANT_PRO`: Variant ID for the Pro plan ($19/mo).
  * `LEMONSQUEEZY_VARIANT_TEAM`: Variant ID for the Team plan ($49/mo).
  * `LEMONSQUEEZY_WEBHOOK_SECRET`: Signing secret configured for webhook.
  * *(Optional)* `LEMONSQUEEZY_STORE_SLUG`: Your Lemon Squeezy subdomain slug (e.g. `dwarflens`).
  * **Webhook URL to enter in Lemon Squeezy:** `https://dwarflens.onrender.com/api/v1/billing/webhook`
  * **Webhook Events to enable:**
    * `order_created`
    * `subscription_created`
    * `subscription_updated`
    * `subscription_cancelled`
    * `subscription_resumed`
    * `subscription_expired`
* If using Razorpay:
  * `BILLING_PROVIDER`: Set to `razorpay`.
  * `RAZORPAY_KEY_ID`: Razorpay Key ID (`rzp_live_...` or `rzp_test_...` from Razorpay Dashboard → Settings → API Keys).
  * `RAZORPAY_KEY_SECRET`: Razorpay Key Secret.
  * `RAZORPAY_WEBHOOK_SECRET`: Webhook signing secret (configured in Razorpay Dashboard → Settings → Webhooks).
  * `RAZORPAY_CURRENCY`: `USD` or `INR` (default: `USD`).
  * **Webhook URL to enter in Razorpay:** `https://dwarflens.onrender.com/api/v1/billing/webhook`
  * **Webhook Active Events to check in Razorpay:**
    * `payment_link.paid`
    * `payment.captured`
    * `subscription.activated`
    * `subscription.charged`
    * `subscription.cancelled`
    * `subscription.halted`

### Email Alerts (Optional)
* `RESEND_API_KEY`: API key from [Resend](https://resend.com) (`re_...`) for budget violation alerts and invitation emails.

---

## 3. GitHub Branch Protection Rules

To prevent accidental breaks or unauthorized pushes to the production codebase:

1. In the GitHub repository, navigate to **Settings → Branches**.
2. Click **Add branch ruleset** or **Add branch protection rule**.
3. Set **Branch name pattern** to `main`.
4. Enable the following protections:
   * **Require a pull request before merging**:
     * Check *Require approvals* (minimum 1 approval recommended).
     * Check *Dismiss stale pull request approvals when new commits are pushed*.
   * **Require status checks to pass before merging**:
     * Check *Require branches to be up to date before merging*.
     * Search and select the required status checks:
       * `Native CLI & Tests / build-and-test` (`ci.yml`)
       * `WASM Build / wasm-build` (`ci.yml`)
       * `Server CI / test-and-typecheck` (`server.yml`)
   * **Do not allow bypassing the above settings**: Enforce rules for administrators as well.
5. Save changes.
