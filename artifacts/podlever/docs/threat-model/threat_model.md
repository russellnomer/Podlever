# Threat Model

## Project Overview

**PodLever** is a single-owner internal podcast content automation tool built for Russell Nomer Consulting. A recording goes in; a complete asset suite (transcript, show notes, social clips, etc.) comes out. Phase 1A establishes the foundation: OIDC authentication, episode FSM, owner-guarded Server Actions, and a PostgreSQL-backed repository layer. No AI pipeline or file storage runs yet.

**Tech stack:** Next.js 15 App Router · TypeScript strict · Tailwind v4 · Drizzle ORM · Replit PostgreSQL · Replit Auth (OIDC/PKCE) · iron-session (AES-256-GCM encrypted cookies)

**Users:** One authorized owner (Russell). All other authenticated Replit users receive role="user" and are blocked by the owner guard. Unauthenticated visitors see only a sign-in prompt.

**Deployment surface:** Replit dev workspace (port 3000, proxied by Replit mTLS iframe). Future: Replit Autoscale deployment.

---

## Assets

| Asset | Why it matters |
|-------|---------------|
| **Session cookie** | AES-256-GCM encrypted with SESSION_SECRET. Compromise grants impersonation of the owner. |
| **SESSION_SECRET** | 32+ char key used by iron-session. Stored in Replit Secrets. Leaking it breaks all session confidentiality. |
| **OIDC tokens** | Short-lived access/ID tokens issued by Replit. Validated by openid-client before any claims are trusted. |
| **Episode data** | Podcast episode metadata and FSM state stored in PostgreSQL. Unauthorized mutation could destroy content. |
| **Pipeline events** | Append-only FSM audit log. Integrity is a correctness invariant (idempotency depends on it). |
| **OWNER_REPLIT_USER_ID** | Determines who gets role="owner". If misconfigured (empty string), anyone could become owner. |
| **DATABASE_URL** | PostgreSQL connection string. Stored in Replit Secrets. Leaking it grants full DB read/write. |

---

## Trust Boundaries

| Boundary | What it separates |
|----------|------------------|
| **Browser → Next.js server** | All browser requests cross this. The server must treat every request as untrusted. iron-session cookie is the only trust token. |
| **Next.js → PostgreSQL** | Drizzle ORM generates parameterized queries; no raw SQL concatenation. DATABASE_URL is the credential. |
| **Next.js → Replit OIDC** | Server-to-server OIDC code exchange. Only HTTPS; openid-client validates JWT signature, issuer, audience, nonce, expiry. |
| **Unauthenticated → Authenticated** | `/auth/login` → OIDC flow → iron-session cookie. No protected data is accessible before auth. |
| **Authenticated (role=user) → Owner** | `requireOwner()` guard at every Server Action. role is embedded in the encrypted session; role changes require re-login. |
| **Dev workspace → Production** | `NODE_ENV` gates cookie `secure` flag. OIDC callback URL resolves differently per environment. |

---

## Scan Anchors

**Production entry points:**
- `artifacts/podlever/app/auth/` — OIDC login/callback/logout Route Handlers (highest risk)
- `artifacts/podlever/app/actions/episode.actions.ts` — all Server Action mutations
- `artifacts/podlever/app/page.tsx` — root Server Component (auth gate)

**Highest-risk code:**
- `artifacts/podlever/app/auth/callback/route.ts` — token exchange, user upsert, session write
- `artifacts/podlever/providers/owner-guard.ts` — authorization boundary
- `artifacts/podlever/server/fsm/executor.ts` — atomic FSM transition (OCC + idempotency)

**Public surface:** `/auth/login` (unauthenticated); `/auth/callback` (unauthenticated, PKCE-protected)

**Owner-only surface:** all Server Actions, all episode reads/writes

**Dev-only / ignore in prod scans:** `artifacts/podlever/scripts/verify-fsm.ts`

---

## Threat Categories

### Spoofing

**What:** An attacker impersonates the owner to access or mutate episode data.

**Why it matters:** The entire authorization model rests on the OIDC identity chain: Replit → openid-client validates the ID token → role is assigned at callback → role is session-cached.

**Guarantees required:**
- The OIDC code exchange MUST use openid-client's `authorizationCodeGrant()`, which validates JWT signature, issuer (`https://replit.com/oidc`), audience (`REPL_ID`), nonce, state, and expiration before trusting any claims.
- PKCE S256 MUST be enforced on every login initiation; no plain authorization code flow.
- The `state` and `nonce` parameters MUST be generated with a CSPRNG, stored in an encrypted cookie, and validated at callback.
- Session cookies MUST be httpOnly (no client-side JS access) and SameSite=Lax (CSRF mitigation).
- `requireOwner()` MUST be the first call in every Server Action and Route Handler that accesses owner data.

**Current status:** ✅ Implemented. openid-client v6 handles all token validation. PKCE S256 with iron-session PKCE state cookie. requireOwner() at all Server Action entry points.

---

### Tampering

**What:** An attacker modifies episode state or pipeline events without authorization.

**Why it matters:** FSM state changes are irreversible in the current model (e.g., once archived). Pipeline events are the idempotency source-of-truth; corruption breaks replay guarantees.

**Guarantees required:**
- Episode state MUST only change through `executeTransition()`, which validates the FSM graph, enforces OCC via `fsm_version`, and atomically writes the state change + pipeline event in one transaction.
- The `pipeline_events` table MUST be append-only. No UPDATE or DELETE is permitted.
- All episode mutation SQL MUST include `AND owner_id = ?` (defense-in-depth below the service-layer auth check).
- All Server Action inputs MUST pass Zod schema validation before reaching the service layer.

**Current status:** ✅ Implemented. executeTransition uses SELECT-first idempotency + INSERT + UPDATE in one DB transaction. ownerId is passed from EpisodeService to the executor WHERE clause. Zod validates createEpisode and transitionEpisode inputs. getEpisodeAction validates UUID format before DB access.

---

### Repudiation

**What:** The owner or a hypothetical attacker performs a sensitive action and later denies it, with no way to prove otherwise.

**Why it matters:** As a single-owner tool, the risk is lower than multi-user systems. But auth events and FSM transitions must be auditable for incident response.

**Guarantees required:**
- Login and logout events MUST emit structured JSON log entries with `{ event, replitUserId, dbUserId, role, timestamp }` (no PII).
- FSM transitions MUST be recorded in `pipeline_events` (append-only, with `idempotency_key` and timestamps).
- Log entries MUST NOT contain PII (display name, email). Only DB user IDs and Replit user IDs.

**Current status:** ✅ Implemented. `auth.login` and `auth.logout` events logged at callback/logout routes. All FSM transitions recorded in `pipeline_events`.

---

### Information Disclosure

**What:** An attacker reads episode data, session content, or infrastructure internals they shouldn't see.

**Why it matters:** Episode data (recording titles, pipeline state) is business-sensitive. Session cookie content grants owner access if decrypted. DB errors could reveal schema details.

**Guarantees required:**
- Session cookies MUST be encrypted with AES-256-GCM (iron-session). The cookie payload MUST NOT be readable without SESSION_SECRET.
- DB error messages MUST NOT be surfaced to the UI. Server Components and Server Actions MUST log errors server-side and return generic client-safe messages.
- The `/auth/` routes MUST NOT expose token exchange details or internal errors to the browser (only redirect to `/auth/login`).
- No debug endpoints MUST be reachable in production. The dev diagnostic route (`/api/discovery/headers`) was removed in Task #3.
- All episode reads MUST be owner-scoped (`WHERE owner_id = ?`) at the repository layer.

**Current status:** ✅ Implemented. DB errors in `app/page.tsx` are logged server-side; generic message returned to UI. Auth callback redirects to `/auth/login` on all error paths. Diagnostic route removed. Repository queries are owner-scoped.

---

### Denial of Service

**What:** An attacker floods the app or exhausts resources to deny the owner access.

**Why it matters:** PodLever is a single-owner internal tool. The primary DoS risk is auth-flooding (`/auth/login`) that abuses the Replit OIDC provider or generates noisy session churn.

**Guarantees required:**
- **Phase 1B (pending):** `/auth/login` MUST implement rate limiting (IP or session-based sliding window). Without it, anyone can repeatedly trigger OIDC redirects and generate PKCE cookies. Acceptable in Phase 1A (single-owner, not public-facing); not acceptable before any broader exposure.
- Database connections MUST be pooled with a bounded max (currently `max: 5` in `db/index.ts`).
- No unbounded query results — all list queries MUST have implicit owner-scoping that limits result set to one owner's episodes.

**Current status:** ✅ Implemented. DB pool bounded (max 5). `/auth/login` rate limiting implemented: per-IP sliding-window (10 req/60 s) in `lib/rate-limiter.ts` (`SlidingWindowRateLimiter`); requests over the limit receive 429 with `Retry-After` header and are NOT forwarded to the OIDC provider. In-memory store (single-instance; state clears on restart — acceptable for Phase 1B single-instance deployment).

---

### Elevation of Privilege

**What:** An authenticated user with role="user" gains owner-level access, or an unauthenticated visitor accesses protected data.

**Why it matters:** This is the most direct attack path in a role-gated single-owner system.

**Guarantees required:**
- `requireOwner()` MUST be called at the entry point of every Server Action and Route Handler that reads or writes owner data. It MUST check both (a) session exists and (b) `session.role === "owner"`.
- Role MUST be assigned server-side at the OIDC callback, not client-supplied.
- The repository layer MUST provide a second defense via owner-scoped queries (`WHERE owner_id = ?`), so that even if the entry-point guard is bypassed, the DB query returns no data.
- `ForbiddenError` (role="user") and `UnauthorizedError` (no session) MUST be typed, thrown, and handled without leaking internal state.
- The FSM executor MUST include `AND owner_id = ownerId` in episode UPDATE queries when `ownerId` is supplied by the service layer.

**Current status:** ✅ Implemented. requireOwner() at all Server Actions. Role assigned at callback via getOwnerReplitUserId(). Repository queries are owner-scoped. FSM executor accepts and enforces optional ownerId predicate (always provided by EpisodeService).

---

## Known Accepted Risks (Phase 1A)

| Risk | Severity | Rationale | Phase 1B Action |
|------|----------|-----------|-----------------|
| ~~No rate limiting on `/auth/login`~~ | ~~High~~ | **Closed — Task #7.** Per-IP sliding-window rate limit (10 req/60 s) implemented in `lib/rate-limiter.ts`. 429 returned before OIDC redirect. | ✅ Done |
| GET-based logout (no CSRF token) | Medium | Single-owner; logout CSRF not meaningful when only one user can log in. | Convert to POST + Server Action with CSRF token if multi-user is ever added. |
| Role cached in session (no per-request DB check) | Low | Role changes require re-login. Acceptable for single owner. | Add session invalidation mechanism if team roles are introduced in Phase 1B+. |
| OIDC end-session not implemented | Low | Replit account stays logged in; only PodLever session is cleared. Acceptable for Phase 1A. | Implement OIDC RP-initiated logout if session revocation is needed. |
