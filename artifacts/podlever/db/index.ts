/**
 * db/index.ts — Drizzle ORM client instance for PodLever
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: drizzle-orm/node-postgres (query builder), pg (connection pool),
 *               @/config (typed env — DATABASE_URL read here only)
 *
 * HUMAN REVIEW NOTES:
 * This file is the ONLY place that creates the pg Pool and Drizzle instance.
 * All database access goes through the `db` export below.
 *
 * Connection pool sizing: pg defaults to 10 max connections. On Replit Autoscale,
 * each instance gets its own pool. With multiple instances, use PgBouncer or
 * Neon's connection pooling to avoid exhausting PostgreSQL connection limits.
 * Review this before enabling autoscaling beyond 1 instance.
 *
 * The `config` import ensures DATABASE_URL is validated at startup — if the
 * variable is missing, the process throws before any DB operation is attempted.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "@/config";
import * as schema from "./schema";

// ─── Connection pool ──────────────────────────────────────────────────────────

/**
 * pool — PostgreSQL connection pool.
 *
 * Reads DATABASE_URL from the validated config (never process.env directly).
 * Replit auto-provisions a PostgreSQL instance and injects DATABASE_URL.
 *
 * Performance note: pool is created once at module load and reused across
 * requests. Do not create per-request pools.
 */
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  // Max connections per pool instance. Keep low on Replit's shared PostgreSQL.
  // Raise in Phase 1B once connection pooling middleware is in place.
  max: 5,
});

// ─── Startup-migration fallback ───────────────────────────────────────────────
// instrumentation.ts register() is the primary trigger for runtime migrations,
// but during the 2026-07-26 incident deployment logs showed register() never
// ran (platform-dependent). This module loads before the FIRST query in every
// runtime path, so kicking migrations here guarantees the schema is checked
// exactly once per process no matter what. runStartupMigrations() is
// advisory-locked, idempotent, and never throws.
const globalMigrations = globalThis as unknown as {
  __podleverMigrationsKicked?: boolean;
};
// NOTE: literal NEXT_RUNTIME === "nodejs" check — webpack inlines the value
// per-bundle and dead-code-eliminates this import from any Edge bundle
// (startup-migrations uses node:fs/pg, which cannot compile for Edge).
if (process.env.NEXT_RUNTIME === "nodejs" && !globalMigrations.__podleverMigrationsKicked) {
  globalMigrations.__podleverMigrationsKicked = true;
  import("../lib/startup-migrations")
    .then(({ runStartupMigrations }) => runStartupMigrations())
    .catch((err) => console.error("[startup-migrations] fallback kick failed:", err));
}

// ─── Drizzle instance ─────────────────────────────────────────────────────────

/**
 * db — The Drizzle ORM query builder, bound to the connection pool and schema.
 *
 * Usage in repositories:
 *   import { db } from "@/db";
 *   const rows = await db.select().from(schema.episodes).where(...);
 *
 * Transaction usage (pass tx as optional parameter to repository methods):
 *   await db.transaction(async (tx) => {
 *     await episodeRepo.transitionState(episodeId, payload, tx);
 *     // tx is the same shape as db — methods are identical
 *   });
 */
export const db = drizzle(pool, { schema });

// ─── Type helpers ─────────────────────────────────────────────────────────────

/**
 * DbTx — The type of a Drizzle transaction object.
 *
 * Repository methods that participate in transactions accept an optional `tx`
 * parameter of this type. When provided, they use the transaction; when absent,
 * they use the module-level `db` directly.
 *
 * Pattern:
 *   async createEpisode(input: NewEpisode, tx?: DbTx): Promise<Episode> {
 *     const client = tx ?? db;
 *     return client.insert(episodes).values(input).returning()[0];
 *   }
 */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
