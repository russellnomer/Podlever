/**
 * db/schema/rate-limit-hits.ts — Persistent rate-limit hit store
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #38 — durable rate-limit state)
 * Last modified: 2026-07-19
 *
 * HUMAN REVIEW NOTES:
 * This table backs the SlidingWindowRateLimiter so that hit timestamps survive
 * server restarts and Replit deployment cycles.
 *
 * Schema design:
 *   - One row per rate-limit key (IP address or userId).
 *   - `hit_timestamps` is a JSONB array of Unix-millisecond integers representing
 *     individual request hits still within the active sliding window.
 *   - On every check the application prunes stale timestamps before persisting,
 *     so rows self-compact automatically — no separate cleanup job is required.
 *   - `updated_at` is set on every upsert for operational visibility (e.g. to
 *     spot abuse patterns without joining application logs).
 *
 * JSONB vs BIGINT[]: JSONB was chosen over a pg BIGINT[] because drizzle-orm's
 * column helpers have full support for typed JSONB, whereas native pg arrays
 * require a custom type mapping. The JSONB overhead is negligible for this payload.
 *
 * Retention: rows with empty hit_timestamps arrays are harmless (they hold zero
 * bytes of hit data). A periodic DELETE WHERE hit_timestamps = '[]' could be
 * added in Phase 1B if the table accumulates stale rows.
 */

import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * rateLimitHits — one row per unique rate-limit key.
 *
 * Key formats used by PodLever:
 *   - Login limiter:    client IP address (string from x-forwarded-for)
 *   - Waitlist limiter: client IP address
 *   - Export limiter:   owner userId (DB UUID string)
 *
 * To avoid key collisions across different limiters, keys are namespaced by
 * the PostgresRateLimitStore with a prefix, e.g. "login:1.2.3.4" or "export:uuid".
 */
export const rateLimitHits = pgTable("rate_limit_hits", {
  /**
   * key — namespaced rate-limit key.
   * Format: "<limiter-name>:<identifier>", e.g. "login:1.2.3.4" or "export:uuid-here".
   */
  key: text("key").primaryKey(),

  /**
   * hitTimestamps — array of Unix-millisecond timestamps for in-window hits.
   * Typed as number[] for direct use with Date.now() values.
   * Stale timestamps (older than windowMs) are pruned on every read+write.
   */
  hitTimestamps: jsonb("hit_timestamps").$type<number[]>().notNull().default([]),

  /**
   * updatedAt — wall-clock time of the last write to this row.
   * Useful for operational inspection; not used by the limiter logic itself.
   */
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
