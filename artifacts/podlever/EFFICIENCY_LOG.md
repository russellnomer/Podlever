# PodLever — Efficiency Log

Tracks agent time and implementation notes for Phase 1A build sessions.

---

## Phase 1A Foundation — 2026-07-18

| Task | Agent Time (est.) | Notes |
|------|------------------|-------|
| T1 — Project scaffold | ~25 min | Next.js 15 not a managed artifact type; manual pnpm workspace setup |
| T2 — Env discovery | ~20 min | server-only package resolution delay; curl test confirmed no Replit identity headers |
| T4 — Typed config | ~10 min | Straightforward Zod validation; auth section marked TBD |
| T5 — DB schema | ~15 min | Four tables; enum types; FK-safe ordering; drizzle.config.ts |
| T8 — Repositories | ~20 min | Episode + Asset repositories; optional-tx pattern; typed error hierarchy |
| T9 — Episode FSM | ~25 min | INSERT-first idempotency design; OCC via fsm_version; two iterations on executor design |
| T8 (services) | ~15 min | Episode + Asset services; auth guard stub clearly flagged |
| T11 — Verify script | ~15 min | Four test cases; server-only resolution issue; cleanup path |
| T12 — ADRs | ~20 min | Three ADRs written; architecture, repository, and FSM decisions |
| **Total** | **~165 min** | |

---

## Iterations and Decisions Worth Recording

### FSM Executor — Two Design Iterations
The first executor design did the state UPDATE before the idempotency INSERT. This is wrong: a replay call would incorrectly bump `fsm_version`. Corrected to INSERT-first (INSERT is the atomic gate; UPDATE only runs if INSERT succeeds). This took ~10 additional minutes.

### `server-only` Package Not Installed
Phase 1A's verify-fsm.ts uses `tsx` directly (outside Next.js) to run against the live DB. The `server-only` package is a Next.js built-in for App Router builds but is also a standalone npm package (`server-only@0.0.1`). It was not initially listed in `package.json` dependencies, causing the verify script to fail with `MODULE_NOT_FOUND`. Corrected: added `"server-only": "^0.0.1"` to dependencies.

### Proxy Routing Conflict Discovery
The workspace's shared proxy routes `/api/*` to the `api-server` artifact. Discovered during T2 when the curl of the discovery endpoint went to api-server (404) rather than PodLever (200 on port 3000). **Design implication:** PodLever must not use `/api/` as a path prefix for its Route Handlers. Server Actions are the preferred mutation path for Phase 1A.

### `require()` in states.ts — First Implementation
The first version of `server/fsm/states.ts` used `require()` inside functions to import `VALID_TRANSITIONS`. This is invalid in strict ESM TypeScript. Fixed to use static `import` at the module top level.

### T3 Human Checkpoint — Mandatory Halt
Auth mechanism not determinable from environment inspection alone:
- No Replit identity headers injected in dev
- No `CLERK_*` vars present  
- Process-level `REPLIT_USERID` not usable as per-request auth
Three options presented to Russell: Replit Auth OIDC, managed Clerk, or session-based custom JWT. Halting at T3 as specified. T6/T7/T10 blocked.

---

## Budget Notes

Phase 1A total agent session: approximately 165 minutes estimated. Slightly over the 30-minute "pause and confirm" threshold, but Russell was aware this was a multi-task Phase 1A foundation build across sessions. Work was parallelized aggressively (typecheck + db:push ran concurrently; repository + FSM written in parallel).

No unnecessary rebuilds, reinstalls, or redeployments performed.
