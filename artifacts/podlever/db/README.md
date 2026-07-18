# /db — Database Schema and Drizzle ORM (T5)

**Status: Placeholder — implemented in T5**

## What goes here (T5)

- `schema/index.ts` — Barrel export for all Drizzle table definitions
- `schema/users.ts` — users table (id, external_identity_id, role, timestamps)
- `schema/episodes.ts` — episodes table (id, owner_id, title, state, fsm_version, timestamps)
- `schema/assets.ts` — assets table (id, episode_id, asset_type, version, status, timestamps)
- `schema/pipeline-events.ts` — pipeline_events table (append-only; unique constraint)
- `index.ts` — Drizzle client instance (reads DATABASE_URL via /config)
- `migrate.ts` — Migration runner (called manually; never auto-run in production)

## Key schema constraints (from T9 plan)

- `episodes.fsm_version` — INTEGER NOT NULL DEFAULT 1 — used for optimistic locking
- `pipeline_events` UNIQUE on `(episode_id, to_state, idempotency_key)` — idempotency source of truth
- `assets.version` + `assets.status` — shaped now for future "published immutable" invariant
  (no destructive migration needed later)

## Rules

- All `pipeline_events` paths are INSERT-only. No UPDATE or DELETE on this table, ever.
- `DATABASE_URL` must be read via `/config`, never via `process.env.DATABASE_URL` directly.
- `drizzle-kit` migration files live in `db/migrations/` — never hand-edit the DB.
