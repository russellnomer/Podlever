# PodLever Changelog

## 2026-07-19 — Task #14: Stripe Subscriptions

### Added
- **Stripe schema bootstrap** — custom `runStripeDbMigrations()` in API server resolves stripe-replit-sync migration files from the installed package path (bypasses esbuild `__dirname` rewrite). All 52 migrations applied on first boot; idempotent thereafter.
- **`stripe.*` schema** — 52 tables synced including accounts, customers, subscriptions, products, prices, invoices, checkout_sessions, etc.
- **`public.users` Stripe columns** — `stripe_customer_id`, `stripe_subscription_id`, `plan_period_end`, `payment_grace_until` (migration 0007 applied).
- **API server: `stripeClient.ts`** — credential resolution: `STRIPE_SECRET_KEY` env → `Stripe_secret_key_dev` secret → Replit connector proxy. `getUncachableStripeClient()` + `getStripeSync()` factories.
- **API server: `webhookHandlers.ts`** — validates + delegates to stripe-replit-sync, then applies custom `users.plan` updates for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` (7-day grace period).
- **API server: `routes/billing.ts`** — `GET /api/billing/plans`, `POST /api/billing/checkout`, `POST /api/billing/portal`, `GET /api/billing/subscription/:userId`. Protected by `X-Podlever-Internal` header (reuses `CRON_SECRET`).
- **API server: `POST /api/stripe/webhook`** — registered before `express.json()` using `express.raw()` (required for Stripe signature verification).
- **Next.js: `lib/stripe.ts`** — `getStripeClient()` with same credential resolution order. Server-side only.
- **Next.js: `/api/billing/checkout`** — POST; iron-session auth; get/create Stripe customer; create Checkout Session.
- **Next.js: `/api/billing/portal`** — POST; iron-session auth; create Customer Portal session.
- **Next.js: `/api/billing/portal-redirect`** — GET; browser-friendly redirect to Stripe portal (no JS required).
- **Next.js: `/dashboard/billing`** — shows current plan, renewal date, payment grace warning, upgrade cards (Pro + Agency), "Manage subscription" link for paid users.
- **`scripts/src/seed-products.ts`** — idempotent script; created Pro ($29/mo annual, $41/mo monthly) and Agency ($97/mo annual, $136/mo monthly) products in Stripe test mode with `plan_slug` metadata.
- **`lib/db/src/schema/users.ts`** — API server's Drizzle projection of public.users (Stripe columns only).

### Changed
- `artifacts/api-server/src/index.ts` — startup now runs `runStripeDbMigrations()` → `findOrCreateManagedWebhook()` → `syncBackfill()` (non-blocking).
- `artifacts/api-server/src/app.ts` — Stripe webhook raw-body route registered before all middleware.
- `artifacts/api-server/src/routes/index.ts` — mounts billing router.
- `lib/db/src/schema/index.ts` — exports users table for API server.

### Security
- Stripe secret key never stored in env vars or code — fetched from Replit Secrets (`Stripe_secret_key_dev`) or connector proxy.
- Webhook signature verified by stripe-replit-sync before any business logic runs.
- Billing routes require internal shared secret; not exposed publicly.

### Stripe products seeded
- `prod_Uuq08QowliB7dT` — PodLever Pro (plan_slug: pro)
- `prod_Uuq0bf8BmGqQMW` — PodLever Agency (plan_slug: agency)
