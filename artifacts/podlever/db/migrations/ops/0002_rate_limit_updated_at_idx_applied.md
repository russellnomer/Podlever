# Ops Record: Migration 0002 Applied to Development Database

## Migration
`0002_rate_limit_updated_at_idx` — BRIN index on `rate_limit_hits.updated_at`

## Environment
- **Target**: Development (Replit managed PostgreSQL)
- **Applied by**: Agent (task #49)
- **Date**: 2026-07-19

## Method
`CREATE INDEX CONCURRENTLY IF NOT EXISTS` cannot execute inside a transaction block.
drizzle-kit wraps every migration in a transaction, so `pnpm run db:migrate` exits
with a false-positive success message while silently skipping this migration.

**Workaround applied:**
1. SQL executed directly outside any transaction via `executeSql` (dev environment):
   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS rate_limit_hits_updated_at_brin
     ON rate_limit_hits USING brin (updated_at);
   ```
2. Drizzle tracking row inserted manually so `db:migrate` treats the migration as applied:
   ```sql
   INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
   VALUES ('433c6e1fe8d5109b8c5417f2e991f4afb3089bc21edcd70584ea7251e03d9533', 1753142400000);
   ```

## Verification

Query run against development database post-application:
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'rate_limit_hits'
ORDER BY indexname;
```

Result:
```
indexname                         | indexdef
----------------------------------+-----------------------------------------------------------
rate_limit_hits_pkey              | CREATE UNIQUE INDEX rate_limit_hits_pkey ON public.rate_limit_hits USING btree (key)
rate_limit_hits_updated_at_brin   | CREATE INDEX rate_limit_hits_updated_at_brin ON public.rate_limit_hits USING brin (updated_at)
```

`rate_limit_hits_updated_at_brin` is **present** ✓

`drizzle.__drizzle_migrations` after insert:
```
id | hash                                                             | created_at
---+------------------------------------------------------------------+---------------
3  | 433c6e1fe8d5109b8c5417f2e991f4afb3089bc21edcd70584ea7251e03d9533 | 1753142400000
1  | a5cffff53c5a485d7713857acf76c67ae3c89cb3c97bed0df59db1ccb9db838d | 1784435720964
2  | 06a6d0461fde07cffa951876379bca923e35aca4a79c56fff9027c0aed824d5f | 1784469539550
```

## Production
Production schema changes are applied by Replit's Publish flow (schema diff on publish).
No manual action required; re-publishing will apply this index to production.

## Rollback
```sql
DROP INDEX CONCURRENTLY IF EXISTS rate_limit_hits_updated_at_brin;
DELETE FROM drizzle.__drizzle_migrations
  WHERE hash = '433c6e1fe8d5109b8c5417f2e991f4afb3089bc21edcd70584ea7251e03d9533';
```

## Related
- Migration SQL: `db/migrations/0002_rate_limit_updated_at_idx.sql`
- Known issue: `CONCURRENTLY` + drizzle-kit transaction incompatibility tracked in task #54
