# /repositories — Repository Layer (T8)

**Status: Placeholder — implemented in T8**

Repositories expose domain-oriented data access methods. They are the only layer
that imports Drizzle and pg.

## What goes here (T8)

- `episode.repository.ts` — EpisodeRepository: createEpisode, getEpisodeForOwner,
  transitionEpisodeState, appendPipelineEvent
- `asset.repository.ts` — AssetRepository: createAssetVersion, getAsset, listByEpisode

## Rules

- Every repository method accepts an optional `tx` (Drizzle transaction) parameter.
  Signature pattern: `method(args, tx?: DbTx): Promise<Result>`
- Repositories contain NO business logic and NO authorization checks.
- Repositories expose domain-oriented methods — NOT generic CRUD.
  Bad: `findMany({ where: { episodeId } })`
  Good: `getEpisodeForOwner(episodeId, ownerId, tx?)`
- User persistence is NOT in a repository in Phase 1A (single call site; see ADR 0002).
