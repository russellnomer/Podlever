# ADR-0004: Authentication Mechanism
**Status:** Accepted  
**Date:** 2026-07-18  
**Decision made by:** Russell Nomer (T3 Human Checkpoint)  
**Authors:** Phase 1A build agent

---

## Context

Phase 1A required a human checkpoint (T3) before implementing any authentication code.
T2 environment discovery found:
- No Replit identity headers injected in the dev environment
- No Clerk environment variables present
- `SESSION_SECRET` available via Replit Secrets
- Three candidate mechanisms evaluated: Replit Auth OIDC, Managed Clerk, Session-based custom JWT

---

## Decisions (Russell's T3 Answers)

### Decision A — Auth Mechanism: Replit Auth (OIDC/PKCE)

**Choice:** Replit Auth (OIDC/PKCE) via the `replit-auth` skill.

**Rationale:**
- First-class Replit platform support; no external API keys needed
- Works with the workspace's existing SESSION_SECRET
- Appropriate for a single-owner internal tool (PodLever is Russell's internal product)
- The `replit-auth` skill provides a tested implementation path for Express + React/Vite apps
  and the pattern applies to Next.js Server Actions

**Implementation notes:**
- Auth is implemented as an AuthProvider at `/providers/auth.ts`
- The provider reads the Replit OIDC session and returns a typed `Identity` object
- The owner guard in services checks `identity.role === "owner"` against the DB
- In Next.js App Router: Replit Auth is integrated via cookie-based sessions using SESSION_SECRET
- The T2 discovery route (`/api/discovery/headers`) is removed before Phase 1B

### Decision B — API Routing: Server Actions Only in Phase 1A

**Choice:** No Route Handlers in Phase 1A. All mutations use Next.js Server Actions.

**Rationale:**
- The shared proxy routes `/api/*` to the `api-server` artifact — PodLever's Route Handlers would be unreachable through the proxy
- Server Actions are more appropriate for a single-owner internal tool (no public API consumers)
- Reduces surface area; cleaner for Phase 1A scope
- Phase 1B task #4 will resolve the routing conflict before Route Handlers are added

**Implementation constraint:**
- All PodLever mutations in Phase 1A go through Server Actions only
- Route Handlers are explicitly deferred to Phase 1B (after Task #4 resolves the routing)

### Decision C — Stub Acceptable for Phase 1A Verification

**Choice:** Yes — the `__STUB_OWNER_ID__` guard in `EpisodeService` is acceptable for Phase 1A exit criteria.

**Rationale:** Phase 1A is not deployed to production. The stub is clearly documented with `⚠️ T3 PENDING` comments. The real owner guard (T7) is implemented in the same Phase 1A task after T3 clears.

**Constraint:** The stub MUST be replaced by the real guard (T7) before Phase 1A is marked complete.

---

## Consequences

- **Enables:** T6 AuthProvider implementation using Replit Auth OIDC
- **Enables:** T7 owner guard wired into EpisodeService and AssetService
- **Enables:** T10 Minimal Verification UI (owner-gated)
- **Constrains:** Phase 1A uses Server Actions only for mutations; no Route Handlers
- **Constrains:** Replit Auth session cookie requires `SESSION_SECRET` (already provisioned)
- **Deferred:** Route Handler namespace (Task #4) resolved before Phase 1B

---

## Implementation References

- `providers/auth.ts` — AuthProvider (T6)
- `services/episode.service.ts` — owner guard (T7) — replaces `__STUB_OWNER_ID__` stub
- `services/asset.service.ts` — owner guard (T7)
- `app/actions/` — Server Actions (Phase 1A mutation entry points)
- `SESSION_SECRET` — Replit Secret (already provisioned)
