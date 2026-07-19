-- Migration: 0002_rate_limit_updated_at_idx
-- Purpose:   Add a BRIN index on rate_limit_hits.updated_at to keep periodic
--            DELETE … WHERE updated_at < NOW() - INTERVAL '2 hours' fast even
--            as the table grows under sustained traffic.
--
-- Index type: BRIN (Block Range INdex) — ideal for naturally-ordered timestamp
--   columns in append/update-heavy tables. It is tiny (one block range per
--   physical block), so it adds almost zero write overhead and fits entirely in
--   shared_buffers. For DELETE WHERE updated_at < cutoff the planner will use
--   the BRIN to skip blocks that are guaranteed newer than the cutoff.
--
-- Applied by: pnpm --filter @workspace/podlever run db:migrate
-- Rolled back by: DROP INDEX CONCURRENTLY IF EXISTS rate_limit_hits_updated_at_brin;

CREATE INDEX CONCURRENTLY IF NOT EXISTS rate_limit_hits_updated_at_brin
  ON rate_limit_hits USING brin (updated_at);
