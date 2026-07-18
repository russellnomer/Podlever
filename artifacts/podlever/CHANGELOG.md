# PodLever Changelog

All notable changes to PodLever are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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

## [Unreleased]

_Phase 1A complete. Pending: Task #3 (remove diagnostic route), Task #4 (proxy routing), Phase 1B pipeline._
