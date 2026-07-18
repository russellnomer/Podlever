---
name: PodLever Phase 1A decisions
description: Key architectural decisions, quirks, and constraints for the PodLever Next.js 15 app in the pnpm monorepo. Read before any PodLever work.
---

# PodLever Phase 1A — Durable Decisions

## Stack
- Next.js 15 App Router + TypeScript strict + Tailwind v4 + Zod + Drizzle ORM
- Located at `artifacts/podlever/` — NOT a registered artifact in artifact.toml; custom workflow "PodLever Dev Server" at port 3000
- Package: `@workspace/podlever`; path alias `@/*` maps to `artifacts/podlever/`

## Auth (T3 Decision — Replit Auth OIDC/PKCE)
- iron-session for encrypted cookie sessions (AES-256-GCM using SESSION_SECRET)
- Auth routes at `/auth/login`, `/auth/callback`, `/auth/logout` (NOT `/api/` — proxy conflict)
- Owner identity: Replit user whose sub == OWNER_REPLIT_USER_ID (fallback: REPLIT_USERID env var, auto-injected by Replit in dev workspace)
- `requireOwner()` in `providers/owner-guard.ts` — call from Server Actions; never from services
- Services are context-agnostic: accept `ownerId: string` from caller, NOT from cookies
- `getAuthUser()` in `providers/auth.ts` — use in Server Components for non-throwing auth check

## Proxy Routing Conflict — RESOLVED + VERIFIED
- Workspace proxy routes `/api/*` to `api-server` artifact — PodLever's `/api/` routes unreachable via proxy
- **Decision (confirmed by Russell):** All PodLever Route Handlers use `/rpc/` prefix. Never `/api/`.
- Auth routes remain at `/auth/` (pre-date decision; placed there to avoid conflict)
- Phase 1B path map: `/rpc/billing/*` (Stripe), `/rpc/upload/*` (file upload), `/rpc/jobs/*` (polling/SSE)
- `app/api/` directory intentionally empty; README.md inside it guards against accidental route creation
- Full decision record in `docs/adr/0001-architecture.md` § "Proxy Routing Conflict"
- **Proxy registration:** `artifacts/podlever/.replit-artifact/artifact.toml` created; PodLever registered at `paths=["/"]`, `localPort=3000`. Proxy routes most-specific-first: `/api/*`→api-server, `/*`→PodLever.
- **Verified:** `curl localhost:80/rpc/ping → 200 {"ok":true}` through proxy — api-server did NOT intercept `/rpc/` routes.
- **Proxy curl rule:** Always use `localhost:80/<path>` for proxy-level testing, never `localhost:3000` (bypasses proxy). External dev domain also works but requires the artifact.toml to be registered.
- OIDC discovery, `REPL_ID`, `REPLIT_DEV_DOMAIN` auto-injected by Replit in dev workspace

## FSM Design
- SELECT-FIRST idempotency (check for existing key BEFORE assertValidTransition) — critical for service-layer retries where fromState has already updated
- If key found → replay: return current episode, no writes, no version bump
- If key not found → assertValidTransition → INSERT event (ON CONFLICT DO NOTHING) → UPDATE episodes OCC
- OCC: WHERE fsm_version = currentFsmVersion; 0 rows → OptimisticLockError; transaction rolls back (key not consumed)
- Services pass current episode.state as fromState; on retry, fromState may equal toState — replay gate must fire first or InvalidTransitionError throws incorrectly
- Only EpisodeService.transitionEpisode → executeTransition — no direct FSM calls from entry points

## Packages — Non-Obvious
- `server-only` must be listed as an explicit dependency (not just a Next.js built-in) — tsx CLI can't resolve it as a built-in
- Remove `import "server-only"` from repository and FSM modules that verify-fsm.ts imports directly; keep it in services
- `iron-session` SessionOptions password must be a string (not a function); call getSessionSecret() at options creation time
- `openid-client` v6 authorizationCodeGrant() second arg is `URL | Request`, not `string` — pass `request` (NextRequest), not `request.url`

## Schema
- `user_role` pgEnum has ["owner", "user"] — "user" was added in Phase 1A after T6 auth implementation
- `fsm_version` starts at 1 (not 0); zeroed version always fails OCC check

**Why:** These decisions were made across multiple sessions; recording prevents re-learning them.
