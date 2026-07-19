# /db — Database Schema and Drizzle ORM

## What lives here

- `schema/index.ts` — Barrel export for all Drizzle table definitions
- `schema/users.ts` — users table (id, external_identity_id, role, timestamps)
- `schema/episodes.ts` — episodes table (id, owner_id, title, state, fsm_version, timestamps)
- `schema/assets.ts` — assets table (id, episode_id, asset_type, version, status, timestamps)
- `schema/pipeline-events.ts` — pipeline_events table (append-only; unique constraint)
- `schema/waitlist.ts` — waitlist_leads table (email, source, status, timestamps)
- `schema/crm-audit-log.ts` — crm_audit_log table (actor, action, meta; append-only)
- `schema/rate-limit-hits.ts` — rate_limit_hits table (key, hit_timestamps JSONB, updated_at)
- `index.ts` — Drizzle client instance (reads DATABASE_URL via /config)
- `migrate.ts` — Migration runner (called manually; never auto-run in production)

## Key schema constraints

- `episodes.fsm_version` — INTEGER NOT NULL DEFAULT 1 — used for optimistic locking
- `pipeline_events` UNIQUE on `(episode_id, to_state, idempotency_key)` — idempotency source of truth
- `assets.version` + `assets.status` — shaped for future "published immutable" invariant

## Rules

- All `pipeline_events` paths are INSERT-only. No UPDATE or DELETE on this table, ever.
- `DATABASE_URL` must be read via `/config`, never via `process.env.DATABASE_URL` directly.
- `drizzle-kit` migration files live in `db/migrations/` — never hand-edit the DB.

---

## rate_limit_hits — Retention and Cleanup

### How rows accumulate

`rate_limit_hits` stores one row per unique rate-limit key (namespaced IP or userId).
The `hit_timestamps` JSONB array is pruned of stale timestamps on every read+write, so
the array itself stays compact. However, the **row itself** is never deleted after the
sliding window expires — idle rows from past requests persist indefinitely.

### Automated cleanup (recommended)

A POST endpoint at `/rpc/cron/prune-rate-limits` deletes rows where
`updated_at < NOW() - INTERVAL '2 hours'` (2× the longest configured window, currently
the 60-minute export window). Secure it with the `CRON_SECRET` environment variable.

**Setup:**

1. Generate a strong secret:
   ```
   openssl rand -hex 32
   ```
2. Save it as a Replit Secret named `CRON_SECRET`.
3. Configure your cron scheduler to call this endpoint **once per hour**:
   ```
   POST https://<your-domain>/rpc/cron/prune-rate-limits
   Authorization: Bearer <CRON_SECRET value>
   ```
   Suitable schedulers: Replit Scheduled Deployments, GitHub Actions `schedule`,
   cron-job.org (free tier), EasyCron, or any HTTP cron service.

**Response:**
- `200 { "deleted": N }` — N rows removed
- `401` — missing or incorrect Bearer token
- `503` — `CRON_SECRET` not configured in environment

### Performance index

Migration `0002_rate_limit_updated_at_idx` adds a BRIN index on `updated_at`. This
keeps the hourly `DELETE WHERE updated_at < cutoff` fast even as the table grows.
BRIN indexes are tiny and add negligible write overhead.

### Manual prune (emergency / one-off)

To prune stale rows manually, connect to the database and run:

```sql
-- Delete rows not updated in the last 2 hours (2× the 60-minute export window).
-- Adjust the interval if a longer-window limiter is added in future.
DELETE FROM rate_limit_hits
WHERE updated_at < NOW() - INTERVAL '2 hours';

-- Confirm how many rows remain:
SELECT COUNT(*) FROM rate_limit_hits;
```

### Updating the threshold

The `STALE_THRESHOLD_MS` constant in
`app/rpc/cron/prune-rate-limits/route.ts` and the SQL interval above must both
be updated if a rate limiter with a window longer than 60 minutes is added.
The threshold should always be ≥ 2× the longest configured window to avoid
evicting rows that are still within an active window.
