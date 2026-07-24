---
name: PodLever beta access guard
description: requireBetaAccess/requireBetaUser pattern for episode routes; AUTH_PATHS trailing-slash outage root cause; feedback table; OAuth 0.0.0.0 fix; production migration automation.
---

# PodLever Beta Access Guard

## The pattern

Two new functions in `providers/owner-guard.ts` (alongside `requireOwner` / `requireOwnerFromSession`):

- `requireBetaAccess(session)` — accepts owners OR `betaAccess === "active"` users. Same 3 gates (auth → role/betaAccess → session version DB check). Returns `UserIdentity` (extends `OwnerIdentity` with `isOwner: boolean`).
- `requireBetaUser()` — reads session from cookies then calls `requireBetaAccess`. Use in Server Actions / Route Handlers.

**Why:** Phase 1A was owner-only throughout. When beta testers were added (betaAccess field in session), all episode routes still blocked them. These guards are the correct replacement for episode operations; CRM/admin/export stays `requireOwner`.

**How to apply:** Use `requireBetaAccess`/`requireBetaUser` for any route that beta testers should reach (episodes, assets, downloads). Keep `requireOwner`/`requireOwnerFromSession` for CRM, admin, billing portal, CSV export.

## Routes affected (now open to active beta users)
- `/dashboard/episodes` — list
- `/dashboard/episodes/new` — upload
- `/dashboard/episodes/[id]` — detail + assets
- All `episode.actions.ts` actions (5 of them)
- `regenerate.actions.ts`
- `api/episodes/[id]/zip`, `share-token`, `guest-pack`

## Data scoping
All episode repository calls use `userId` as the scope key. `listEpisodesForOwner(userId)` and `getEpisodeForOwner(episodeId, userId)` work correctly for any user — the method names are misleading but the queries are userId-scoped, not role-scoped.

## Dashboard routing for non-owners
`/dashboard/page.tsx` checks `user.role !== "owner"` and redirects to `/dashboard/episodes` (previously redirected to `/`). Middleware already allows `betaAccess === "active"` users into `/dashboard/*`.

## AUTH_PATHS trailing-slash outage
**Root cause:** `AUTH_PATHS` had `"/auth/"` (trailing slash). `isAuthPath` appended another `"/"`, looking for `"/auth//"` — never matched. `/auth/login` was treated as a protected route → redirect loop → uptime monitor saw ERR_TOO_MANY_REDIRECTS.

**Fix:** Always use paths WITHOUT trailing slash in `AUTH_PATHS`: `["/auth", "/verify-access", "/waitlisted", "/onboarding"]`. The `isAuthPath` function adds `"/"` itself via `startsWith(p + "/")`.

**Why this matters:** Any future path added to `AUTH_PATHS` must not have a trailing slash.

## OAuth callback redirecting to 0.0.0.0:3000
**Root cause:** When Replit workspace preview iframe connects to the Next.js dev server, `x-forwarded-host` is set to `0.0.0.0:3000` (the internal binding address). `getCallbackUrl()` trusted it blindly, building `redirect_uri = http://0.0.0.0:3000/auth/callback`. After OAuth, Replit redirects the user's browser there — an unreachable address.

**Fix:** `getCallbackUrl()` now rejects `x-forwarded-host` values starting with `0.0.0.0`, `localhost`, `127.0.0.1`, or `::1` and falls through to `REPLIT_DEV_DOMAIN`. Also added `allowedDevOrigins: ["*.replit.dev", "*.repl.co"]` in `next.config.ts`.

**Why this matters:** Always validate proxy headers before using them to construct public-facing URLs.

## Feedback table
`db/schema/feedback.ts` — columns: id (uuid), user_id (text, not FK), display_name, page_url, message, created_at. Migration `0008_loose_sage.sql` applied. Server action: `app/actions/feedback.actions.ts`. Widget: `app/dashboard/components/FeedbackWidget.tsx`. Layout: `app/dashboard/layout.tsx`.

## Health check & middleware /api/ bypass

**Problem:** Next.js middleware `matcher` with `(?!api/)` negative lookahead does NOT reliably exclude `/api/` paths. With no session cookie (e.g. Cloud Run health probe), the middleware redirects API requests to `/auth/login` → 307.

**Fix (two parts):**
1. `app/api/healthz/route.ts` — dedicated health check route, returns `{"ok":true}` immediately, no auth/DB/session. `artifact.toml` health check path updated to `/api/healthz`.
2. `middleware.ts` `PUBLIC_PREFIXES` — added `/api/` so all API routes bypass the middleware auth redirect. API routes enforce their own auth via `requireOwner()`/`requireBetaUser()`.

**Why this matters:** The Jul 23 promote-step failure was partly caused by this redirect. Cloud Run health probe (no cookie) → middleware redirect → health check fails. Rule: never rely solely on the `matcher` config to exclude paths from middleware logic — also guard inside the middleware with `isPublicPath`.

**Jul 23 infrastructure note:** The promote step failure was also due to an intermittent Replit infra issue — the "Creating Autoscale service" step never ran after image push (failure within 3s, before any container start). Retry resolves this.

## Session cookie reliability in Next.js 15 App Router (CRITICAL)

**Root cause:** `/auth/callback` used `getIronSession(request, response, options)` to write the session cookie onto a `NextResponse.redirect()`. In Next.js 15 App Router Route Handlers, `Set-Cookie` headers on 3xx redirect responses can be stripped by Replit's Cloud Run reverse proxy before reaching the browser → session never stored → middleware finds empty session → redirects to `/auth/login` → loop.

**Fix:** Use `cookies()` from `next/headers` for ALL iron-session reads and writes in Route Handlers. `session.save()` then calls `cookieStore.set()` which Next.js injects at the framework level — guaranteed to survive any response type including redirects and proxy stripping.

**Why this matters:** `getSession()` (shared helper) already uses `cookies()` from `next/headers`. Any new route that reads or writes sessions MUST match this pattern. The `(request, response)` iron-session overload works for Pages Router but is unreliable for App Router redirects.

**How to apply:** In any App Router Route Handler: `const cookieStore = await cookies(); const session = await getIronSession<T>(cookieStore, options);`

## Production migration automation
**Problem:** Production DB was missing tables from migrations applied after initial setup. No migrations ran automatically on deploy.

**Fix:** `scripts/migrate-prod.mjs` — bootstrap script that:
1. Creates `drizzle.__drizzle_migrations` tracking table if missing
2. Pre-seeds hashes for migrations 0000–0007 (applied before tracking existed; hashes match dev tracking)
3. Runs `drizzle-kit migrate` to apply pending migrations

`package.json` `build:prod` = `node scripts/migrate-prod.mjs && next build`. `artifact.toml` production build uses `build:prod`.

**Why this matters:** Every future schema change (new migration) will be applied automatically on the next publish. No manual `db:migrate` needed after deploy.

**Migration tracking state:** Dev DB has 8 rows (id 1–8). Migration 0002 was applied via `db:push` and is NOT in the tracking table — this is intentional. Pre-seeded hashes cover 0000, 0001, 0003–0007. Future migrations will be tracked normally.
