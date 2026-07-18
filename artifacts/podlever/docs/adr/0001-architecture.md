# ADR-0001: Architecture
**Status:** Accepted  
**Date:** 2026-07-18  
**Authors:** Phase 1A build agent

---

## Context

PodLever is an enterprise-grade podcast content automation engine built for Russell Nomer Consulting. The system must turn one recording into a complete set of distribution-ready assets. Phase 1A establishes the architectural skeleton only — no product features are implemented.

The workspace is a Replit pnpm monorepo optimized for React+Vite+Express artifacts. Next.js is not a managed artifact type in this workspace but is platform-supported for hosting and Autoscale deployment.

---

## Decision

### Framework
**Next.js 15 App Router + TypeScript strict + Tailwind CSS v4 + Zod**

Chosen per owner specification. Provides React Server Components, Server Actions, and Route Handlers in one framework — appropriate for an orchestration engine that needs both server-side rendering and server-side mutation paths.

### Layering Model (Mandatory)
```
Server Action / Route Handler / Job (entry points)
        ↓
    Service layer        (business logic, authorization, validation)
        ↓
  Repository layer       (domain-oriented data access)
        ↓
    Drizzle ORM          (query builder)
        ↓
  PostgreSQL (Replit)    (persistence)
```

Entry points (Server Actions, Route Handlers, Job handlers) never import repositories directly. This rule is enforced by code search in the exit criteria.

### Folder Structure
```
app/           Next.js App Router (pages, layouts, Route Handlers, Server Actions)
components/    Shared UI components (shadcn/ui + custom)
config/        Typed env validation (Zod) — single source of env access
db/            Drizzle schema, client instance, migrations
docs/          ADRs, discovery notes, architecture diagrams
features/      Domain-specific UI feature modules (Phase 1B+)
jobs/          Background job handlers (Phase 1B+ — placeholder in 1A)
lib/           Shared utilities (cn(), formatters, type guards)
providers/     AuthProvider interface + concrete implementations
repositories/  Data access layer (domain-oriented methods + optional tx handle)
scripts/       Verification and maintenance scripts
server/        Server-only domain logic (FSM)
services/      Business logic orchestration
types/         Zod schemas + inferred TypeScript types (single source of truth)
```

### Persistence
**Replit PostgreSQL + Drizzle ORM**

Replit auto-provisions PostgreSQL and injects `DATABASE_URL`. Drizzle provides type-safe queries without the overhead of a full ORM. Migration files are committed to version control; `drizzle-kit push --force` is used for Phase 1A dev only — `migrate` for all subsequent changes.

### Validation
**Zod schemas in `/types` are the single source of truth.** Server Actions, Route Handlers, and Jobs all import and parse with the same schemas — no per-entry-point duplication.

### shadcn/ui
Initialized non-interactively via `components.json` in Phase 1A. No components installed yet. The `cn()` utility in `lib/utils.ts` is available for component composition.

---

## Platform Findings (T2 Environment Discovery)

### PORT Binding
Next.js 15 reads `process.env.PORT` automatically. Dev script: `next dev -p ${PORT:-3000} -H 0.0.0.0`. The `-H 0.0.0.0` flag is required for the Replit proxied preview iframe to reach the server.

### Proxy Routing Conflict

**Status:** Decided — 2026-07-18

**Context:**
The workspace shared path-based proxy routes `/api/*` to the `api-server` artifact (Express, port 8080). Any Next.js Route Handler placed under `app/api/` would be silently swallowed by the proxy and never reach the PodLever server.

Phase 1A avoided the conflict entirely by using only Server Actions for mutations and placing the three auth routes under `/auth/`. Phase 1B requires Route Handlers that cannot be Server Actions: Stripe webhook receiver (must be a raw POST endpoint for signature verification), job status polling (SSE or long-poll), and file upload (multipart form, too large for a Server Action).

**Three options considered:**

| Option | Description | Verdict |
|--------|-------------|---------|
| **A. Move PodLever to root path** | Reconfigure the Replit proxy so PodLever owns `/` and `api-server` moves to `/api-server/`. Eliminates the conflict permanently. | Rejected — requires workspace-wide proxy reconfiguration that affects all other artifacts; high disruption, high risk of breaking existing integrations. |
| **B. Server Actions only (Phase 1B restriction)** | Prohibit all Route Handlers. Implement webhooks via Server Actions + Stripe CLI forwarding in dev; polling via React Server Component revalidation. | Rejected — Stripe webhooks cannot be received by Server Actions (no raw body access, wrong signature verification surface). Job polling via full-page revalidation is wasteful. The constraint would distort the architecture permanently. |
| **C. `/rpc/` prefix for all PodLever Route Handlers** | PodLever's Route Handlers live at `/rpc/*` instead of `/api/*`. The proxy only intercepts `/api/*`, so `/rpc/*` routes reach Next.js directly. Auth routes remain at `/auth/`. | **Selected.** Least disruptive, no workspace-wide changes, immediately unblocks Phase 1B. Semantically clear: `/rpc/` signals "PodLever internal endpoint" vs. the shared `/api/` layer. |

**Decision: All PodLever Route Handlers use the `/rpc/` path prefix.**

**Verified in practice — 2026-07-18:** A temporary `GET /rpc/ping` Route Handler was added and tested through the Replit shared proxy:

```
curl localhost:80/rpc/ping
→ 200 {"ok":true,"path":"/rpc/ping","timestamp":"2026-07-18T19:33:41.487Z"}
```

The api-server proxy intercept (configured for `/api/*` paths only) did not intercept the `/rpc/ping` request. PodLever was registered with the proxy at `paths = ["/"]` via `artifacts/podlever/.replit-artifact/artifact.toml` as part of this verification. `/rpc/*` routes reach Next.js as designed. Smoke-test route removed after verification.

```
/auth/login        ← OIDC initiation (existing, Phase 1A)
/auth/callback     ← OIDC token exchange (existing, Phase 1A)
/auth/logout       ← Session destroy (existing, Phase 1A)
/rpc/billing/*     ← Stripe webhooks + checkout (Phase 1B)
/rpc/upload/*      ← File upload endpoints (Phase 1B)
/rpc/jobs/*        ← Job status polling / SSE (Phase 1B)
```

**Enforcement:**
- `app/api/` directory is intentionally empty. A `README.md` inside it explains the constraint. No `route.ts` file may ever be created inside `app/api/`.
- All new Route Handler code reviews must confirm the path prefix is `/rpc/`, not `/api/`.
- Comments in `app/auth/login/route.ts`, `providers/auth.ts`, and `app/layout.tsx` already document this constraint inline.

### Identity Headers
No Replit identity headers (`X-Replit-User-Id`, `X-Replit-Identity`) are injected in the development environment. `REPLIT_USERID=19531679` and `REPLIT_USER=RussellNomer` are present as process-level environment variables but are NOT per-request — not usable as auth. **T3 checkpoint decision required for the auth mechanism (see ADR-0003 once T3 clears).**

### DATABASE_URL
Auto-provisioned: `postgresql://postgres:***@helium/heliumdb?sslmode=disable`. Available in both dev and (expected) deploy environments.

### `server-only` Package
Server-only modules (`import "server-only"`) are enforced in repositories, services, server/fsm, and providers to prevent accidental client-bundle inclusion. The `server-only` package must be listed as a dependency (not just a Next.js built-in) for CLI scripts (e.g., verify-fsm.ts) to run via tsx without resolution errors.

---

## Alternatives Considered

| Alternative | Reason Rejected |
|---|---|
| React+Vite+Express (workspace default) | Owner specified Next.js; App Router RSC model better suits orchestration UI |
| Prisma ORM | Drizzle is lighter, faster startup, Replit-native via existing workspace setup |
| tRPC for API layer | Adds complexity without benefit for single-owner Phase 1A; revisit if multi-user |
| Separate frontend + backend | One Next.js app reduces operational surface; appropriate for Phase 1A |

---

## Consequences

- **Enables:** Clean extension into Phase 1B (jobs, storage, AI) without architectural redesign
- **Constrains:** All env reads must go through `/config`; no direct `process.env` access elsewhere
- **Requires:** T3 Human Checkpoint before any auth code is written
- **Monitoring:** Phase 1A has no observability beyond console logs — add in Phase 1B
