# /docs/adr — Architectural Decision Records (T12)

**Status: Placeholder — ADRs written in T12 (final task)**

Three ADRs will be written here after all other tasks complete (T1–T11).
They capture what was actually built, not what was planned.

## Planned ADRs

### ADR-0001: Architecture
- Overall stack (Next.js 15, TypeScript strict, Tailwind v4, Zod, Drizzle, PostgreSQL)
- Layering model (Action/Handler/Job → Service → Repository → Drizzle)
- Folder structure rationale
- Platform findings from T2 (Replit identity mechanism, port/proxy behavior, DATABASE_URL)
- Hosting/scaffolding decision: custom Next.js workflow on Replit (not managed scaffold)

### ADR-0002: Repository and Transaction Pattern
- Domain-oriented repositories vs generic CRUD
- Why User repository is deferred (single call site rule)
- TransactionManager rejection + revisit trigger (Phase 1B outbox/job patterns)
- Optional transaction object convention: `method(args, tx?: DbTx)`

### ADR-0003: Finite State Machine
- State/transition typing approach (compile-time where possible, runtime always)
- Optimistic locking via `fsm_version` (UPDATE guard + conflict error type)
- Idempotency via DB unique constraint on `(episode_id, to_state, idempotency_key)`
- Append-only PipelineEvent log rationale

## ADR Format

Each ADR uses the standard format:
- **Status**: Accepted | Superseded | Deprecated
- **Context**: Why this decision was needed
- **Decision**: What was decided
- **Alternatives considered**: What was rejected and why
- **Consequences**: What this enables and what it constrains
