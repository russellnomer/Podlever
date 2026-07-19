---
name: PodLever Stripe integration
description: Architecture decisions, gotchas, and startup sequence for the Stripe billing integration.
---

# PodLever Stripe Integration

## Credential resolution order (both API server + Next.js)
1. `STRIPE_SECRET_KEY` env var (production)
2. `Stripe_secret_key_dev` Replit Secret (development)
3. Replit connector proxy (`X-Replit-Token` header with dash, NOT underscore)

**Why:** Replit connector proxy auth requires `X-Replit-Token` (HTTP dash convention). Token sourced from `replit identity create --audience <connectors-url>` first, then `REPL_IDENTITY` env, then `WEB_REPL_RENEWAL`.

## stripe-replit-sync migration gotcha (CRITICAL)
`runMigrations()` from stripe-replit-sync uses `path.resolve(__dirname, "./migrations")` internally. When esbuild bundles the API server, `__dirname` resolves to the API server's `dist/` dir, not the package dir. Migrations are never found and the stripe schema stays empty.

**Fix:** Use `createRequire(import.meta.url)` to resolve the package path, then read and run migration SQL files directly with a pg client. See `artifacts/api-server/src/index.ts → runStripeDbMigrations()`.

**How to apply:** Any time stripe-replit-sync is upgraded, check if new migration files appear in `node_modules/stripe-replit-sync/dist/migrations/`. They run automatically on next API server restart.

## stripe.accounts table
Created by migration `0046_sync_status_per_account.sql` (not by `runMigrations`). Has JSONB generated columns (`business_name`, `email`, `type`, etc.) and a `set_updated_at` trigger. Do NOT create it manually before migrations run — the generated columns will be missing and later index creation will fail.

## Startup sequence
1. `runStripeDbMigrations()` — pool.connect() client, CREATE SCHEMA, CREATE _migrations, run SQL files in order
2. `getStripeSync()` — fresh StripeSync instance with Stripe key from credentials
3. `findOrCreateManagedWebhook(url)` — registers webhook with Stripe; URL uses REPLIT_DOMAINS
4. `syncBackfill()` — fire-and-forget; logs complete/error

## Webhook processing
- Route: `POST /api/stripe/webhook` registered BEFORE `express.json()` using `express.raw({ type: "application/json" })`
- `WebhookHandlers.processWebhook(payload: Buffer, sig)` → stripe-replit-sync sync → custom users.plan update
- Events handled: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

## Plan → users.plan mapping
Stripe product `metadata.plan_slug` → `users.plan`. Seed script must set this metadata on products. Free users have no stripe_customer_id. Grace period = 7 days after invoice.payment_failed.

## Billing page flow
- `/dashboard/billing` — server component, reads users table directly (plan, planPeriodEnd, paymentGraceUntil)
- Upgrade CTAs link to `/pricing?upgrade=<slug>` (pricing page handles Checkout creation)
- `/api/billing/portal-redirect` — GET route; iron-session auth; calls Stripe portal API; browser redirect
- `/api/billing/checkout` — POST; iron-session auth; get/create customer; Checkout Session
