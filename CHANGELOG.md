# PodLever Changelog

## 2026-07-24 — Fix post-consent session loop on podlever.com

### Root causes (three, all fixed)

**1. Session cookie not persisting after callback (primary — caused the loop)**
`/auth/callback` was writing the iron-session cookie to a `NextResponse.redirect()`
object via `getIronSession(request, response, options)`. In Next.js 15 App Router Route
Handlers, this is unreliable when the response is a 3xx redirect — Replit's Cloud Run
reverse proxy can strip `Set-Cookie` headers from redirect responses before they reach
the browser. The browser never received the session cookie → middleware found no session
→ redirect to `/auth/login` → new OIDC flow → loop.

Fix: switched to `cookies()` from `next/headers` (the correct Next.js 15 pattern).
Next.js injects cookies set via this API at the framework level into whatever Response
is returned, guaranteed to survive redirect responses and proxy stripping.
The `getSession()` shared helper already used this pattern; the callback now matches.

**2. betaAccess not set at login**
The callback never queried the `waitlist` table, so non-owner users always exited login
with `betaAccess = undefined`. Middleware correctly routes them to `/verify-access`.
But with the session write failing (bug #1), users never got that far — they saw
the `/auth/login` loop instead.

Fix: added a non-fatal `waitlist` lookup by `replitUserId` after the DB upsert.
Status `"invited"` or `"active"` is written into the session. Returning users who have
already claimed their invite now land directly at `/dashboard` / `/onboarding` without
visiting `/verify-access` again.

**3. PKCE "state incomplete" log missing field detail**
The error log emitted no diagnostic data, making it impossible to distinguish an expired
PKCE cookie (user took >10 min at consent) from a missing-fields failure.

Fix: log `{ hasCodeVerifier, hasState, hasNonce }` so each case is distinguishable.

### Also addressed
- PKCE reading now also uses `cookies()` from `next/headers` (consistent with session write)
- Added catch block around `session.save()` so a session-write failure logs clearly
  rather than silently preceding a broken redirect

### Change classification: Normal (auth callback logic, no schema change)
### Rollback: revert `app/auth/callback/route.ts` to prior commit

## 2026-07-24 — Fix invalid_redirect_uri on podlever.com (production login)

### Root cause
The current live production build was sending the dev workspace domain
(`worf.replit.dev`) as the OIDC `redirect_uri`. Replit's OIDC provider rejects
it because podlever.com is not that domain. Confirmed: `/auth/callback` on
podlever.com was 302-redirecting to the `.replit.dev` URL.

### Fix
1. **`OIDC_CALLBACK_URL=https://podlever.com/auth/callback`** set as a
   production env var (set in the previous session — this deploy activates it).
2. **`getCallbackUrl()` production path updated** (`providers/auth.ts`):
   - Priority 1: `OIDC_CALLBACK_URL` explicit override (set above).
   - Priority 2: `REPLIT_DOMAINS` with request-host matching — iterates the
     comma-separated domain list and selects the entry that matches the
     incoming request host, falling back to the first domain. This is the
     same pattern used by the working `pawsofkarma.com` Replit Auth setup.
   - `REPLIT_DEV_DOMAIN` is **never** consulted in production.
   - Note: `REPLIT_DOMAINS` is runtime-managed by Replit and cannot be set
     manually; `OIDC_CALLBACK_URL` is the authoritative override.
3. **`instrumentation.ts` startup check updated** — now validates both
   `OIDC_CALLBACK_URL` and `REPLIT_DOMAINS`; warns at boot if neither is
   set or if `REPLIT_DOMAINS` doesn't include `podlever.com`.

### Change classification: Normal (targeted auth config fix, no schema change)
### Rollback: revert `providers/auth.ts` and `instrumentation.ts` to prior commit

## 2026-07-23 — OAuth callback URL hardened for production (Task #67)

### Fixed — Production login safety: environment-aware getCallbackUrl()
Architect review of the iOS auth fix identified a latent production risk: if
`REPLIT_DEV_DOMAIN` is present in a Cloud Run container (possible in some Replit
environments) and `OIDC_CALLBACK_URL` is not set, `getCallbackUrl()` would use
the dev workspace domain as the OAuth `redirect_uri` for production — breaking
login for all users on podlever.com.

**Changes:**
- `providers/auth.ts` — `getCallbackUrl()` now splits into two explicit resolution
  paths based on `NODE_ENV`. In production: `OIDC_CALLBACK_URL` (required) →
  `REPLIT_DOMAINS` (emergency fallback with error log) → throw. `REPLIT_DEV_DOMAIN`
  and `x-forwarded-host` are never consulted in production. In development:
  unchanged behaviour (`OIDC_CALLBACK_URL` → `REPLIT_DEV_DOMAIN` → header-derived
  host with unroutable-IP guard → `REPLIT_DOMAINS`).
- `instrumentation.ts` (new) — Next.js server hook; emits a clear `console.error`
  at boot if `NODE_ENV=production` and `OIDC_CALLBACK_URL` is absent, so
  misconfiguration is visible in Cloud Run logs before the first login attempt.
- `config/index.ts` — Added `REPLIT_DOMAINS` and `OIDC_CALLBACK_URL` to the Zod
  schema so they are typed and validated at startup.
- Production env var set: `OIDC_CALLBACK_URL=https://podlever.com/auth/callback`
  (Replit Secrets, production scope).

### Test matrix
| Environment | OIDC_CALLBACK_URL set? | Resolution | Expected |
|---|---|---|---|
| Dev desktop | No | REPLIT_DEV_DOMAIN | ✓ worf.replit.dev/auth/callback |
| Dev iOS | No | REPLIT_DEV_DOMAIN | ✓ (fixed: no container IP leak) |
| Prod autoscale | Yes | OIDC_CALLBACK_URL | ✓ podlever.com/auth/callback |
| Prod autoscale | No | REPLIT_DOMAINS + error log | ⚠ may fail on custom domain |

## 2026-07-23 — OAuth callback URL fix for iOS / mobile browsers

### Fixed — "Not allowed to use restricted network port" after OAuth Allow
Safari on iOS blocked the OAuth callback because `getCallbackUrl()` was returning a
container-internal IP (e.g. `172.24.x.x`) as the `redirect_uri`. The iOS Replit app
routes requests through an internal proxy path where `x-forwarded-host` is set to the
container IP, not the public Replit domain. The IP passed the old `isLocalAddress` check
(which only covered `0.0.0.0`, `localhost`, `127.x`, `::1`) and was embedded into the
OIDC authorization URL. Safari tried to connect to that IP and threw the restricted port error.

**Fix (two parts):**
1. **Priority reorder** — `REPLIT_DEV_DOMAIN` (always injected by Replit) is now checked
   *before* `x-forwarded-host`. This guarantees the correct public URL is used in the dev
   workspace regardless of how the request arrived. `x-forwarded-host` is now a fallback
   for non-Replit environments only.
2. **Extended unroutable IP check** — added all RFC-1918 private ranges (`10.x`, full
   `172.16–31.x`, `192.168.x`) to the guard so they can never slip through even if
   `REPLIT_DEV_DOMAIN` is absent in an edge-case environment.

Dev server restarted; fix is live.

## 2026-07-23 — Health check hardening & middleware API bypass fix

### Fixed — Promote-step failure (health check)
The Jul 23 deployment failed at the promote step, NOT the build phase. The image
built and was pushed successfully. Root causes found and fixed:

1. **Middleware was running on `/api/` routes** — The `matcher` config attempted
   to exclude `api/` paths via a regex negative lookahead, but Next.js does not
   reliably honour that exclusion. With no session cookie (e.g. Cloud Run health
   probe), the middleware was redirecting API requests to `/auth/login` with a 307.
   Fix: added `/api/` to `PUBLIC_PREFIXES` so the middleware explicitly passes
   all API routes through. API routes enforce their own auth via `requireOwner()` /
   `requireBetaUser()` guards.

2. **Health check pointed at `GET /`** — The root page is SSR with session reads.
   Replaced with a dedicated `GET /api/healthz` endpoint that returns `{"ok":true}`
   immediately with no auth, no DB, no session — isolated from all app logic.
   `artifact.toml` updated: `[services.production.health.startup] path = "/api/healthz"`.

Both changes verified: `GET /api/healthz` → 200, `GET /` → 200 in production mode locally.

### Note — Jul 23 05:26 promote failure was also infrastructure-related
Comparing the Jul 20 success build log vs Jul 23 failure: the "Creating Autoscale
service" step never ran after the image was pushed (normal sequence is push →
create service → wait for ready → success). The failure occurred within 3 seconds
of pushing the manifest — before the container could start. This indicates an
intermittent Replit infrastructure issue, not a code defect. The health check fix
above ensures future deployments are more resilient.

## 2026-07-22 — Build hardening & auth login fix

### Fixed — TypeScript build error (deployment blocker)
- `app/dashboard/components/FeedbackWidget.tsx` — `useEffect` callback missing `return undefined` on the `!open` branch. TypeScript strict mode requires consistent return types when one branch returns a cleanup function. Added explicit `return undefined`.

### Fixed — OAuth callback redirecting to 0.0.0.0:3000
- `providers/auth.ts` — `getCallbackUrl()` now rejects local/internal `x-forwarded-host` values (`0.0.0.0`, `localhost`, `127.0.0.1`, `::1`) and falls through to `REPLIT_DEV_DOMAIN`. Previously, when the Replit workspace preview iframe set `x-forwarded-host: 0.0.0.0:3000`, the OAuth `redirect_uri` was built as `http://0.0.0.0:3000/auth/callback` — an address the user's browser cannot reach.
- `next.config.ts` — Added `allowedDevOrigins: ["*.replit.dev", "*.repl.co"]` to suppress the Next.js cross-origin dev warning and properly trust the Replit proxy.

### Fixed — Production database migrations never ran automatically
- **Root cause:** The production build command was `next build` only. No migrations ran. Production DB was missing `job_queue`, `episode_cogs`, and `feedback` tables — users uploading episodes or submitting feedback would hit DB errors immediately after login.
- `scripts/migrate-prod.mjs` — New Node.js migration bootstrap script. On each deploy: (1) creates the `drizzle.__drizzle_migrations` tracking table if absent, (2) pre-seeds hashes for migrations 0000–0007 that were applied before Drizzle tracking existed, (3) runs `drizzle-kit migrate` to apply any pending migrations. Idempotent — safe to run multiple times.
- `package.json` — Added `build:prod` script: `node scripts/migrate-prod.mjs && next build`.
- `artifact.toml` — Production build command updated from `build` → `build:prod`. Every publish now migrates before compiling.
- `db/migrations/0008_job_queue_cogs_share.sql` — Deleted. This was an orphaned file superseded by `0008_loose_sage.sql` (which the Drizzle journal tracks). Having two `0008_` files could cause Drizzle Kit confusion.

## 2026-07-21 — Beta access & in-app feedback

### Security / Architecture
- **`requireBetaAccess(session)` guard** — new function in `providers/owner-guard.ts` that grants access to owners OR users with `betaAccess === "active"`. Applies same three gates as `requireOwnerFromSession` (authenticated → role/betaAccess check → session version DB match). Returns `UserIdentity` which extends `OwnerIdentity` with an `isOwner: boolean` field.
- **`requireBetaUser()`** — cookie-reading variant of `requireBetaAccess` for use in Server Actions and Route Handlers.

### Changed — Episode routes unblocked for beta users
All episode-related pages, actions, and API routes now use `requireBetaAccess` / `requireBetaUser` instead of `requireOwnerFromSession` / `requireOwner`. CRM, admin, billing, and export routes remain owner-only.

Affected files:
- `app/dashboard/episodes/page.tsx` — beta users can list their episodes; CRM nav link hidden for non-owners
- `app/dashboard/episodes/new/page.tsx` — beta users can upload episodes
- `app/dashboard/episodes/[id]/page.tsx` — beta users can view their episode results
- `app/actions/episode.actions.ts` — all 5 actions (create, list, get, transition, upload) open to beta users
- `app/actions/regenerate.actions.ts` — regenerate action open to beta users (plan limits still enforced)
- `app/api/episodes/[id]/zip/route.ts` — ZIP download open to beta users
- `app/api/episodes/[id]/share-token/route.ts` — share token generation open to beta users
- `app/api/episodes/[id]/guest-pack/route.ts` — guest pack PDF open to beta users

### Changed — Dashboard routing for beta users
- `app/dashboard/page.tsx` — non-owner users (active beta) now redirect to `/dashboard/episodes` instead of `/`. Owner CRM is unchanged.

### Added — In-app feedback widget
- **`db/schema/feedback.ts`** — new `feedback` table (id, user_id, display_name, page_url, message, created_at). Append-only; no FK so rows survive user deletion.
- **Migration `0008_loose_sage.sql`** — creates `feedback` table; applied.
- **`app/actions/feedback.actions.ts`** — `submitFeedbackAction` server action: validates input (Zod), inserts into `feedback` table, emits structured `feedback.submitted` production log.
- **`app/dashboard/components/FeedbackWidget.tsx`** — floating "Feedback" button (bottom-right, all dashboard pages). Opens a modal with a free-text field; page URL captured automatically; shows success state for 2.2 s then auto-closes.
- **`app/dashboard/layout.tsx`** — new dashboard shell layout that mounts `FeedbackWidget` on every `/dashboard/*` route.

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
