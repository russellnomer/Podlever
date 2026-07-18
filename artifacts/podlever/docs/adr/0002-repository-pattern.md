# ADR-0002: Repository and Transaction Pattern
**Status:** Accepted  
**Date:** 2026-07-18  
**Authors:** Phase 1A build agent

---

## Context

PodLever needs a data access strategy that:
- Keeps business logic (services) decoupled from query implementation (repositories)
- Supports atomic multi-step operations (FSM transition = UPDATE + INSERT)
- Scales cleanly into Phase 1B (background jobs, transactional outbox patterns)
- Remains simple enough that a future coding agent can understand and extend it

---

## Decision

### Domain-Oriented Repositories (not Generic CRUD)

Repositories expose methods named after domain operations, not database operations.

**Good:** `getEpisodeForOwner(episodeId, ownerId)` — communicates ownership-scoped access  
**Bad:** `findMany({ where: { id: episodeId, ownerId } })` — leaks query structure into callers

This forces repository methods to encode invariants (e.g., owner-scoping) rather than leaving them to callers.

### Optional Transaction Parameter

Every repository method that writes to the database accepts an optional `tx?: DbTx` parameter:

```typescript
async createEpisode(input: NewEpisode, tx?: DbTx): Promise<Episode> {
  const client = tx ?? db;
  return client.insert(episodes).values(input).returning();
}
```

When `tx` is provided (by the FSM executor or a service coordinating multiple writes), the operation runs within the caller's transaction. When absent, it runs against the module-level `db` pool directly.

This pattern avoids a TransactionManager wrapper while enabling full transaction composition.

### No TransactionManager Wrapper

A thin TransactionManager interface was considered and rejected for Phase 1A.

**Why rejected:**
- Drizzle's `db.transaction(async (tx) => { ... })` is already fully typed and expressive
- Phase 1A has no cross-service transactions (Episode + Asset services are independent)
- No transactional outbox pattern needed until background jobs (Phase 1B)
- A wrapper adds an abstraction layer without solving a real Phase 1A problem

**Revisit trigger:** A TransactionManager becomes justified when:
- A service method needs to write to two different domain entity types atomically
- A transactional outbox is needed for reliable job dispatch (Phase 1B background jobs)
- Cross-repository rollback semantics become complex to express without it

This trigger and the rationale above should be reviewed at Phase 1B planning.

### Phase 1A Repositories

**EpisodeRepository** (implemented):
- `createEpisode(input, tx?)` — INSERT into episodes
- `getEpisodeForOwner(episodeId, ownerId, tx?)` — owner-scoped SELECT
- `listEpisodesForOwner(ownerId, tx?)` — owner-scoped list (excludes archived)
- `transitionEpisodeState(episodeId, version, toState, tx)` — OCC UPDATE (tx required)
- `appendPipelineEvent(event, tx?)` — idempotent INSERT (ON CONFLICT DO NOTHING)
- `listPipelineEventsForEpisode(episodeId, tx?)` — audit log SELECT

**AssetRepository** (implemented):
- `createAssetVersion(input, tx?)` — auto-versioned INSERT
- `getAsset(assetId, tx?)` — SELECT by ID
- `listAssetsForEpisode(episodeId, assetType?, tx?)` — filtered list

### Deferred Repositories

**UserRepository: deferred.** Reason: user persistence in Phase 1A has exactly one call site — the auth-sync path (Route Handler callback or Server Action). A repository adds an abstraction layer over a single operation with no domain invariants beyond "upsert on external ID". 

**Trigger for introduction:** Add a UserRepository when ≥2 distinct call sites exist OR when domain invariants beyond simple upsert are needed (e.g., role promotion requires reading the current role first).

---

## Alternatives Considered

| Alternative | Reason Rejected |
|---|---|
| TransactionManager wrapper | No Phase 1A cross-service transactions; adds indirection without benefit |
| Generic CRUD repository base class | Hides domain semantics; makes call sites harder to read |
| Direct Drizzle in services | Couples services to query structure; hard to test or swap persistence |
| UserRepository in Phase 1A | Single call site; over-engineering for one upsert |

---

## Consequences

- **Enables:** Clean service-layer composition without coupling to Drizzle operators
- **Enables:** Phase 1B job handlers can participate in existing transactions via the tx handle
- **Constrains:** Services must call repositories; entry points (Actions/Handlers/Jobs) never import repositories directly
- **Review at Phase 1B:** Evaluate TransactionManager when cross-service atomicity is needed
