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
The workspace's shared path-based proxy routes `/api/*` to the `api-server` artifact (port 8080). PodLever's own Route Handlers must NOT use `/api/` as a path prefix in Phase 1A to avoid routing conflicts. **Decision: PodLever uses Next.js Server Actions exclusively for mutations in Phase 1A; Route Handlers use `/rpc/` prefix if needed.**

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
