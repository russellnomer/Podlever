# ADR-0003: Episode Finite State Machine
**Status:** Accepted  
**Date:** 2026-07-18  
**Authors:** Phase 1A build agent

---

## Context

PodLever's core business process is moving a podcast episode through a production pipeline (upload → transcribe → generate clips → review → publish). This pipeline must be:

- **Auditable:** every state change is logged immutably
- **Safe under concurrent writes:** two jobs should not both advance the same episode
- **Idempotent:** retried job operations should not create duplicate state changes
- **Extensible:** new states (e.g., "failed", "paused") should be addable without redesign

---

## Decision

### State Vocabulary (Phase 1A)

```
draft → processing → ready → published
  ↓         ↓          ↓         ↓
archived  archived   archived  archived
                    ↓
               processing  (re-process from ready)
```

States as a pgEnum (`episode_state`): `draft`, `processing`, `ready`, `published`, `archived`.

`archived` is terminal — no exits. All other states can transition to `archived` (soft delete).

### Optimistic Concurrency Control via `fsm_version`

Every episode row has an `fsm_version INTEGER NOT NULL DEFAULT 1` column. Every FSM transition atomically increments it. The transition UPDATE includes a WHERE clause guarding on the caller's expected version:

```sql
UPDATE episodes
SET state = $toState, fsm_version = $currentVersion + 1, updated_at = NOW()
WHERE id = $episodeId AND fsm_version = $currentVersion
```

If 0 rows are updated, the caller's version is stale (concurrent write detected) → `OptimisticLockError` thrown, transaction rolled back, no partial writes. The caller re-fetches the episode and retries with a new idempotency key.

`fsm_version` starts at 1 (not 0) so that a zeroed or missing version always fails immediately.

### Append-Only PipelineEvent Log

Every successful state transition inserts one row into `pipeline_events`. This table is:
- **Append-only:** no UPDATE or DELETE code paths exist anywhere in PodLever
- **The idempotency source of truth:** unique constraint on `(episode_id, to_state, idempotency_key)`

### Idempotency via Database Unique Constraint

The `pipeline_events` table has:
```sql
CONSTRAINT "pipeline_events_idempotency_key"
  UNIQUE ("episode_id", "to_state", "idempotency_key")
```

When a transition executor attempts to INSERT a pipeline event and the key is already present, the DB returns a unique violation. The application treats this as **idempotent replay: no-op success, no version bump, no error**.

Why `(episode_id, to_state, idempotency_key)` and not `(episode_id, idempotency_key)` alone?

Including `to_state` prevents an edge case: if a caller reuses a key for a different target state (a caller bug), the constraint does NOT silently absorb it — it would insert a new event with the same key but a different `to_state`. This is a stricter guard: one key = one intended (episode, target) pair.

**Why DB constraint, not application pre-check?**

Application-level checks (`SELECT ... WHERE idempotency_key = ?` before INSERT) have a race window. If two calls run simultaneously with the same key, both may pass the pre-check and both may INSERT, creating duplicates. The DB unique constraint is atomic — only one INSERT can win; the other gets the violation. This is race-proof.

### Executor Design

The FSM executor (`/server/fsm/executor.ts`) runs inside a single DB transaction:

1. **INSERT** `pipeline_events` with `ON CONFLICT DO NOTHING` (idempotency gate)
   - If 0 rows inserted (duplicate key): **idempotent replay path** — fetch current episode, return it, no UPDATE, no version bump
   - If 1 row inserted: proceed to step 2
2. **UPDATE** `episodes` WHERE `id = ? AND fsm_version = ?` (optimistic lock)
   - If 0 rows updated: `OptimisticLockError` — transaction rolled back (INSERT above also rolled back; key not consumed)
   - If 1 row updated: return updated episode

This INSERT-first order is deliberate: if the UPDATE fails (OCC), the INSERT is rolled back and the key is not consumed. The caller can safely retry with the same key.

### Type Safety

States are encoded as a `pgEnum` at the DB level and as a Zod enum in `/types/episode.ts`. The `VALID_TRANSITIONS` map in `/types/episode.ts` is typed as `Record<EpisodeState, EpisodeState[]>` so TypeScript ensures all states have an entry.

At runtime, `assertValidTransition(fromState, toState)` throws `InvalidTransitionError` before any DB operation if the move is illegal. This gives callers a typed error they can catch and surface to the UI.

---

## Alternatives Considered

| Alternative | Reason Rejected |
|---|---|
| Class-based state machine (XState) | Library overhead; plain objects + functions suffice for Phase 1A state count |
| Application-level idempotency pre-check | Race condition; DB constraint is atomic |
| Separate `fsm_events` table without unique constraint | Can't prevent duplicates; harder to query "was this key used?" |
| Pessimistic locking (SELECT FOR UPDATE) | Holds locks across job processing; poor for async pipelines |
| `from_state` in unique constraint | Allows same key for same episode if fromState differs — a caller bug, not a replay |
| Version bump on idempotent replay | Wastes version numbers; misleads audit trail (implies something happened when it didn't) |

---

## Consequences

- **Enables:** Safe retries in Phase 1B background jobs (pass job_id+step as idempotency_key)
- **Enables:** Full audit trail via append-only pipeline_events
- **Enables:** Analytics on pipeline throughput in Phase 1B+ (time between events)
- **Constrains:** Callers must supply a stable idempotency key — not generated inside the executor
- **Constrains:** All episode state changes go through `executeTransition` — no direct SQL updates
- **Requires:** Re-fetch + new idempotency key on `OptimisticLockError` retry (documented for callers)
