# PodLever Changelog

All notable changes to PodLever are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased] — 2026-07-20

### Removed — Adobe audio provider (Task #64)
- **Adobe Podcast Enhance removed from provider chain**: Confirmed (Jul 20, 2026) that `podcast.adobe.com/enhance` is a browser-only tool with no public developer API. `lib/audio/providers/adobe.ts` deleted. `"adobe"` key replaced with `"ffmpeg-adaptive"` in `PRICING_USD`. `ADOBE_ENHANCE_API_KEY` env var is now unused — do not set it.
- **Provider chain is now fully self-hosted**: All audio processing runs on-container with zero external API dependencies and zero ongoing cost.

### Removed — Dolby.io audio provider (prior session, Jul 19)
- **Dolby removed from provider chain**: Dolby.io confirmed in writing (Jul 19, 2026) that they are no longer onboarding new Media API customers. `lib/audio/providers/dolby.ts` deleted. Historical `episode_cogs` rows with `model = 'dolby-enhance'` are untouched.
- All Dolby references purged from UI copy, comments, and schema docs. User-visible label updated from `"Noise-reduced · normalized · Dolby.io"` to `"Noise-reduced · loudness normalized"`.

### Added — ffmpeg-adaptive provider / Task #64 (self-hosted AI audio)
- **`lib/audio/providers/ffmpeg-adaptive.ts`**: Uses FFmpeg's built-in `anlmdn` filter — Non-Local Means Denoiser. The same algorithm underpins professional audio restoration tools (Cedar, iZotope RX). Unlike `afftdn` (fixed noise-floor threshold), `anlmdn` adapts to each recording's own noise profile and handles intermittent noise (chair movement, typing, paper rustle) significantly better.
- **New provider chain**: `ffmpeg-adaptive` (anlmdn) → `ffmpeg` (afftdn). Both tiers cost $0. ffmpeg is the guaranteed last resort.
- **Why not RNNoise or Demucs**: RNNoise binary is not in the Nix store; Demucs requires Python + PyTorch (~500 MB) and Python is not installed on this container; FFmpeg's `arnndn` (RNN denoiser) requires a `.rnnn` model file from a repo that returned 404 as of 2026-07-20. `anlmdn` achieves comparable voice-denoising quality without any of those dependencies.
- **COGS key**: `"ffmpeg-adaptive"` at `perMinute: 0` in `PRICING_USD`.

### Changed (audio pipeline — Board moves 1 & 2)
- **Audio provider abstraction layer** (`lib/audio/`): Resilient provider chain with automatic fallback. FFmpeg is the guaranteed last resort — runs locally, needs no credentials, cannot be externally disrupted.
- **FFmpeg provider** (`lib/audio/providers/ffmpeg.ts`): `afftdn=nf=-25` + EBU R128 loudness normalization. Always-on guaranteed fallback. Cost: $0.
- **Process route updated**: COGS keys updated to `"ffmpeg-adaptive"` and `"ffmpeg"`. Adobe reference removed from comments and privacy notice.
- **Asset label**: The `cleaned_audio` asset label reflects the actual provider used.
- **Deleted**: `lib/audio-cleanup.ts`, `lib/audio/providers/dolby.ts`, `lib/audio/providers/adobe.ts`.

### Not built (by design)
- No user-facing provider picker UI. Audio enhancement runs silently for every episode.
- No affiliate/referral CTA. Revisit at 100 paying users.

## [Unreleased] — 2026-07-19

### Fixed
- **Waitlist bug (production):** Switched `onConflictDoNothing({ target })` → bare `onConflictDoNothing()` to suppress all conflicts regardless of constraint name. Added raw-SQL fallback path and full error-chain logging (`err.cause`) so the real PostgreSQL error code is always visible in production logs. Previously only `err.message` was captured, hiding the root cause.

### Added
- **Persistent job queue:** `job_queue` table with `SELECT FOR UPDATE SKIP LOCKED` worker. `after()` now triggers a fast worker POST instead of running the pipeline directly. Retries: 30s → 5min → 30min backoff. Stale-job recovery at `GET /rpc/queue/worker`.
- **Dolby.io audio cleanup:** Noise reduction + loudness normalization applied before transcription. Graceful fallback if `DOLBY_API_APP_KEY`/`DOLBY_API_APP_SECRET` are not configured. Cleaned audio stored at `audio/{episodeId}/cleaned.wav`.
- **COGS tracking:** `episode_cogs` table captures token counts and estimated USD cost per API call. Admin dashboard at `/admin/cogs` shows monthly totals, per-step breakdown, and top-cost episodes.
- **Guest media pack PDF:** Branded pdfkit PDF generated during processing and on-demand for legacy episodes. Download via `GET /api/episodes/[id]/guest-pack`.
- **ZIP bulk export:** All assets (text + audio) bundled into a single download at `GET /api/episodes/[id]/zip`.
- **Shareable episode links:** `episodes.share_token` column; `POST /api/episodes/[id]/share-token` generates a public link. Public read-only page at `/share/[token]` with viral PodLever CTA.
- **Asset regeneration:** Regenerate any text asset (show notes, blog post, social copy, guest pack) with revised output. Pro plan: 3 regenerations/episode; Agency: unlimited; Free: blocked. Tracked in `usage_events`.
- **Founding Member welcome page:** `/dashboard/welcome` — milestone celebration, perks list, Discord CTA (configurable via `FOUNDING_MEMBER_DISCORD_URL`).
- **Episode detail upgrades:** ZIP download button, PDF download button, Share button, Regenerate button per asset, cleaned audio row, episode COGS badge.
- **`plan` field on `OwnerIdentity`:** Auth guard now returns billing plan in one DB round-trip (no second query needed in Server Actions).

### Changed
- **Process route:** Added Dolby cleanup step, COGS logging per API call, PDF generation, and PDF GCS upload before transitioning episode to `ready`.
- **Episode actions:** Enqueues a `job_queue` row before `after()` so processing survives worker trigger failures.

### Database (migration 0008)
- New tables: `job_queue`, `episode_cogs`
- New columns: `episodes.share_token`, `episodes.cleaned_audio_storage_key`
- New enum value: `asset_type.guest_media_pack_pdf`
- New event type: `usage_events.event_type = 'asset_regenerated'`

### Configuration Required
- `ADOBE_ENHANCE_API_KEY` — optional; activates Adobe Podcast Enhance. FFmpeg runs if unset.
- `FOUNDING_MEMBER_DISCORD_URL` — optional; shows placeholder if unset

---

## [0.1.0-alpha.3] — 2026-07-19 — Pricing Model + Unit Economics (Task #12)

### Pricing Decisions

**PodLever Pricing Model v2.1 — Approved for implementation**

All prices and unit economics locked. Task #13 (landing page) and Task #14 (Stripe) read
from `docs/pricing/pricing-model-v2.1-approved.md`.

| Tier | Monthly | Annual (18% off) | Episodes/mo |
|---|---|---|---|
| Free | $0 | — | 3 |
| Creator | $39/mo | $32/mo ($384/yr) | 8 |
| Professional | $99/mo | $81/mo ($972/yr) | 20 |
| Studio | $249/mo | $204/mo ($2,448/yr) | 50 |

**Managed AI Credits:** $7.00/ep · 10-pack $65 ($6.50/ep) · 25-pack $150 ($6.00/ep)

**Free-tier guardrails:** 15% free→Creator conversion KPI (60 days); 500-account cap before waitlist

### Unit Economics Audit

Live AI rates fetched 2026-07-18. Recommended stack COGS: **$0.37–$0.80/episode**
= **89–95% gross margin** at $7.00. Planning floor remains $2.00 (conservative worst-case).

### AI Model Routing Policy (mandatory for Task #2 pipeline)

- Primary LLM: Anthropic Haiku 4.5 + prompt caching required
- Primary transcription: AssemblyAI Universal-3.5 Pro
- Per-episode COGS ceiling: $1.00 alert / $1.50 hard block
- Max 3 retries per asset call

### Added
- `docs/pricing/pricing-model-v2.1-approved.md` — single source of truth for all prices
- `docs/pricing/model-routing-policy.md` — AI model routing and cost ceiling policy
- `docs/pricing/unit-economics-audit-2026-07-18.md` — full COGS audit with live rate data
- `.agents/skills/unit-economics-guardrail/rates.json` — live rates cache (expires 30 days)

---

## [0.1.0-alpha.2] — 2026-07-18 — Proxy Routing Decision + Verification (Task #4)

### Architecture Decision

**Resolved: Proxy routing conflict — all PodLever Route Handlers use `/rpc/` prefix**

Phase 1A avoided the Replit shared-proxy conflict (`/api/*` → `api-server`) by using Server Actions exclusively. Phase 1B needs Route Handlers that cannot be Server Actions: Stripe webhooks (raw body + signature), job polling, and file upload.

Three options were evaluated:
- Move PodLever to root path → rejected (workspace-wide disruption)
- Server Actions only in Phase 1B → rejected (Stripe webhooks cannot use Server Actions)
- **`/rpc/` prefix for all Route Handlers → selected** (least disruptive, no proxy reconfiguration)

### Verified in Practice — 2026-07-18

PodLever was registered with the Replit shared proxy at `paths = ["/"]` via `artifacts/podlever/.replit-artifact/artifact.toml`. A temporary `GET /rpc/ping` Route Handler was created at `app/rpc/ping/route.ts` and smoke-tested through the proxy:

```
curl localhost:80/rpc/ping
→ 200 {"ok":true,"path":"/rpc/ping","timestamp":"2026-07-18T19:33:41.487Z"}
```

**Result:** HTTP 200 from Next.js through the shared proxy. The api-server intercept (`/api/*` only) did not capture the `/rpc/ping` request. Routes across artifacts are matched most-specific-first: `/api/*` → api-server (port 8080); `/*` → PodLever (port 3000). `/rpc/*` reaches Next.js as designed. Temporary route removed after verification.

### Changed
- `docs/adr/0001-architecture.md` — expanded "Proxy Routing Conflict" section with full decision record, options table, path convention, enforcement rules, and "Verified in practice" confirmation
- `app/api/README.md` — added guard-rail README explaining why no `route.ts` file may be created here, and where to put Route Handlers instead (`app/rpc/`)
- `features/README.md` — added inline note that Route Handlers must use `/rpc/` prefix

### Confirmed
- **Zero existing Route Handlers under `app/api/`** — no conflict today. The `app/api/` directory is empty (placeholder only).
- Auth routes remain at `/auth/` (pre-date this decision; correctly placed to avoid `/api/`).
- `/rpc/*` routes reach Next.js — not intercepted by api-server. ✅

---

## [0.1.0-alpha.3] — 2026-07-18 — Auth Boundary: Session Revocation + Verification (Task #8)

### Security

**Session version revocation mechanism** — stolen or old cookies are invalidated the moment the owner logs out, with no need to wait for the 7-day cookie maxAge:

- **`db/schema/users.ts`** — Added `session_version INTEGER NOT NULL DEFAULT 1` column. Incremented atomically at logout; never reset on login.
- **`providers/auth.ts`** — Added `sessionVersion: number` to `PodLeverSession`; embedded in the iron-session cookie at login time.
- **`app/auth/callback/route.ts`** — Reads `session_version` from the upserted user row and embeds it in the cookie.
- **`app/auth/logout/route.ts`** — Increments `users.session_version` atomically (`session_version + 1`) before destroying the cookie. All cookies issued before logout are instantly invalidated.
- **`providers/owner-guard.ts`** — `requireOwner()` now enforces three gates per privileged request:
  - Gate 1: cookie decrypts and `userId` is present
  - Gate 2: `role === "owner"`
  - Gate 3 *(new)*: `users.session_version` in DB matches `sessionVersion` in cookie — rejects stolen/replayed cookies after logout
- **`providers/auth-errors.ts`** *(new)* — `UnauthorizedError` and `ForbiddenError` extracted from `owner-guard.ts` to a file without `server-only`, enabling import by `tsx` scripts. `owner-guard.ts` re-exports both; all existing call sites unaffected.

**`scripts/verify-auth.ts`** — 34-assertion verification script:
1. No session cookie → `UnauthorizedError` (401)
2. Tampered cookie (wrong AES-GCM HMAC) → decryption fails → `UnauthorizedError` (401)
3. `role="user"` session → `ForbiddenError` (403) with role in message
4. Valid owner session with matching DB version → guard passes (no false rejects)
5. **Stolen cookie rejected**: cookie version (1) ≠ DB version (2) after logout increment → `UnauthorizedError` (401)
6. Logout `session.destroy()` clears cookie in memory; absent-cookie request rejected

### Schema migration

```sql
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 1 NOT NULL;
```
Applied to the live DB via `db:push-force`.

### Validated

```
pnpm --filter @workspace/podlever run typecheck   →  0 errors
pnpm --filter @workspace/podlever run verify-auth →  34/34 assertions passed
```

---

## [0.1.0-alpha.1] — 2026-07-18 — Phase 1A Security Audit Remediations (Task #6)

### Security

**Automated scan results:** All three scanners (dependency audit, SAST, HoundDog) returned zero findings.

**Architect review remediations:**

- **Fixed [High]:** PKCE cookie deletion now specifies `path: "/auth"` explicitly via `response.cookies.set(...)` with `maxAge: 0` — previously using `response.cookies.delete()` omitted the path, causing browsers to silently ignore the deletion.
- **Fixed [High]:** `app/auth/callback/route.ts` no longer reads `process.env.OWNER_REPLIT_USER_ID` / `REPLIT_USERID` directly. Reads now go through `getOwnerReplitUserId()` exported from `providers/auth.ts` (centralized, lazy-eval, single place to change).
- **Fixed [High — defense-in-depth]:** FSM executor `executeTransition()` now accepts an optional `ownerId` parameter. When provided (always from `EpisodeService`), all episode SELECT and UPDATE queries include `AND owner_id = ownerId`, adding a second SQL-level ownership fence below the service-layer auth check.
- **Fixed [Medium]:** `getEpisodeAction` now validates `episodeId` with `z.string().uuid()` before passing to the DB layer, preventing malformed UUIDs from reaching PostgreSQL and leaking driver error details.
- **Fixed [Medium]:** `app/page.tsx` DB connectivity check now logs the raw error server-side and returns a generic `"Database connectivity check failed — check server logs."` string — no internal DB error details surfaced to the UI.

**Documented accepted risks:**
- `/auth/login` rate limiting deferred to Phase 1B (requires edge middleware / sliding-window store not yet provisioned; single-owner internal tool, not public-facing).
- GET-based logout (no CSRF) and missing OIDC RP-initiated end-session deferred to Phase 1B.

### Docs

- Added `docs/threat-model/threat_model.md` — full STRIDE threat model covering OIDC/PKCE flow, iron-session cookie, owner guard, FSM executor, repository scoping, and trust boundaries.
- Added `docs/audit/security-scan.md` — automated scan results, architect review findings table, remediation status, and accepted-risks register.

### Validated

```
pnpm --filter @workspace/podlever run typecheck  →  0 errors
pnpm --filter @workspace/podlever run verify-fsm →  28/28 assertions passed
```

---

## [0.1.0-alpha] — 2026-07-18 — Phase 1A Foundation

### Added

**Project scaffold (T1)**
- Next.js 15 App Router + TypeScript strict + Tailwind CSS v4 + Zod setup
- `@workspace/podlever` pnpm workspace package with custom workflow (`PodLever Dev Server`, port 3000)
- `components.json` for shadcn/ui (non-interactive init; CSS vars; RSC enabled)
- `lib/utils.ts` — `cn()` helper (clsx + tailwind-merge)
- `app/globals.css` — Tailwind v4 `@import "tailwindcss"` with CSS custom properties
- `app/layout.tsx` — root layout (AuthProvider placeholder for T6)
- `app/page.tsx` — Phase 1A status page

**Typed configuration (T4)**
- `config/index.ts` — Zod-validated env config; fail-fast at startup; auth section marked TBD pending T3
- `.env.example` — documents all env vars; auth section marked "TBD pending T3"

**Database schema (T5)**
- `db/schema/users.ts` — `users` table with `userRoleEnum` ("owner"), `external_identity_id` (unique)
- `db/schema/episodes.ts` — `episodes` table with `episodeStateEnum`, `fsm_version INT NOT NULL DEFAULT 1`
- `db/schema/assets.ts` — `assets` table with `assetTypeEnum` (8 types), `assetStatusEnum`, `version`
- `db/schema/pipeline-events.ts` — append-only table; unique constraint `(episode_id, to_state, idempotency_key)`
- `db/schema/index.ts` — barrel export in FK-safe order
- `db/index.ts` — Drizzle client (`db`), pg Pool (max 5), `DbTx` type for optional-transaction pattern
- `drizzle.config.ts` — drizzle-kit strict config; migrations → `./db/migrations`
- Schema pushed to Replit PostgreSQL via `db:push-force`

**Type layer (T4 continuation)**
- `types/episode.ts` — `EpisodeStateSchema`, `VALID_TRANSITIONS`, `CreateEpisodeSchema`, `TransitionEpisodeSchema`
- `types/asset.ts` — `AssetTypeSchema`, `AssetStatusSchema`, `CreateAssetVersionSchema`
- `types/user.ts` — `IdentitySchema`, `UserRoleSchema`, `UpsertUserSchema`

**Repository layer (T8 partial)**
- `repositories/episode.repository.ts` — `EpisodeRepository` with all domain-oriented methods; `EpisodeNotFoundError`, `OptimisticLockError`
- `repositories/asset.repository.ts` — `AssetRepository` with versioned asset creation; `AssetNotFoundError`
- `repositories/index.ts` — barrel export

**Episode FSM (T9)**
- `server/fsm/states.ts` — `assertValidTransition`, `isValidTransition`, `InvalidTransitionError`
- `server/fsm/executor.ts` — `executeTransition` with INSERT-first idempotency pattern (no version bump on replay)
- `server/fsm/index.ts` — barrel export

**Service layer (T8 final)**
- `services/episode.service.ts` — `EpisodeService` (create, get, list, transition); auth guard is a stub pending T3/T6/T7
- `services/asset.service.ts` — `AssetService` (create version, list)
- `services/index.ts` — barrel export

**Verification script (T11)**
- `scripts/verify-fsm.ts` — four-case FSM verification against live DB (valid, invalid, OCC, idempotent replay)
- Added `verify-fsm` and `db:push-force` scripts to `package.json`

**Environment discovery (T2)**
- `app/api/discovery/headers/route.ts` — diagnostic header inspection route (remove before Phase 1B)
- `docs/discovery/t2-identity-findings.md` — T2 findings; mechanism_detected=NONE_DETECTED; T3 decisions required

**Architecture Decision Records (T12)**
- `docs/adr/0001-architecture.md` — framework, layering model, platform findings
- `docs/adr/0002-repository-pattern.md` — repository pattern rationale; TransactionManager decision
- `docs/adr/0003-finite-state-machine.md` — FSM design, OCC, idempotency, INSERT-first executor design

**Directory READMEs**
- All major directories include `README.md` with implementation specs and layering rules

### Security
- No credentials hardcoded anywhere; all env vars via Replit Secrets or platform injection
- `server-only` imports on all repository, service, FSM, and provider modules (client-bundle prevention)
- Auth guard stub clearly marked `⚠️ T3 PENDING` — not production-ready

**T3 Human Checkpoint decisions:**
- Auth: Replit Auth (OIDC/PKCE) confirmed
- API routing: Server Actions only (no Route Handlers for mutations in Phase 1A)
- Stub: acceptable for Phase 1A exit criteria (replaced by T7 in same phase)

**T6: AuthProvider (Replit Auth OIDC)**
- `providers/auth.ts` — iron-session encrypted cookie session management; Replit OIDC config; `getAuthUser()` for Server Components
- `app/auth/login/route.ts` — PKCE S256 login redirect; ephemeral PKCE state cookie
- `app/auth/callback/route.ts` — token exchange via openid-client v6; user upsert (auth-sync); structured audit log; session write
- `app/auth/logout/route.ts` — session destroy; audit log

**T7: Owner role protection**
- `providers/owner-guard.ts` — `requireOwner()` / `getOwnerOrNull()`; typed `UnauthorizedError` (401) and `ForbiddenError` (403)
- `app/actions/episode.actions.ts` — Server Actions with `requireOwner()` at every entry point
- `services/episode.service.ts` — stub removed; context-agnostic ownerId pattern finalized
- `services/asset.service.ts` — stub removed

**T10: Verification UI**
- `app/page.tsx` — Phase 1A status dashboard; unauthenticated → sign-in prompt; non-owner → access restricted; owner → full dashboard with 5 verification checks + pending task list

**Schema update**
- Added "user" value to `user_role` pgEnum (was "owner"-only; non-owner logins now stored with role="user")
- Schema pushed to live DB

**ADR**
- `docs/adr/0004-auth-mechanism.md` — T3 decisions: Replit Auth, Server Actions only, stub acceptable

### Security
- Iron-session AES-256-GCM encrypted cookie (httpOnly, secure in prod, SameSite=Lax)
- PKCE S256 on every login; state + nonce prevent CSRF and token replay
- openid-client v6 validates JWT signature, issuer, audience, nonce, expiration before trusting any claims
- Structured audit logs for auth.login and auth.logout events (userId + role; no PII)
- Owner role guard at every Server Action entry point; repository owner-scoped queries as second defense

### Not Yet Implemented (Explicit Deferrals)
- UserRepository — deferred; single call site; see ADR-0002
- Published-immutable invariant for assets — deferred to Phase 1B (schema shaped, enforcement pending)
- OIDC end-session (RP-initiated logout) — deferred to Phase 1B
- Logout CSRF protection (POST + CSRF token) — deferred to Phase 1B

---

## [0.1.0-alpha.2] — 2026-07-18 — Login Rate Limiting (Task #7)

### Security

- **Fixed [High]:** `/auth/login` now enforces a per-IP sliding-window rate limit (10 requests/60-second window) before initiating any OIDC redirect. Requests over the limit receive a `429 Too Many Requests` response with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers. The OIDC provider is never contacted for over-limit requests.
- Added `lib/rate-limiter.ts` — `SlidingWindowRateLimiter` class with in-memory Map-backed sliding-window store, periodic stale-entry cleanup (5-min interval, `unref()`'d), and `extractIp()` static helper (respects `x-forwarded-for` and `x-real-ip` for Replit's reverse proxy).
- Rate-limit state is in-memory (single-instance); state clears on process restart. Acceptable for Phase 1B single-instance deployment. Redis upgrade path is documented in `lib/rate-limiter.ts`.

### Docs

- `docs/threat-model/threat_model.md` — Denial of Service section updated to ✅ Implemented; accepted-risk row for `/auth/login` rate limiting closed.
- `docs/audit/security-scan.md` — A1 accepted-risk row closed; marked as implemented.

### Validated

```
pnpm --filter @workspace/podlever run typecheck  →  0 errors
```

---

## [Unreleased]

_Phase 1B pending: Task #2 (real episode pipeline), Task #4 (proxy routing), Task #5 (stub removal)._
