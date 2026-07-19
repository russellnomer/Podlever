/**
 * lib/rate-limit-store.ts — Pluggable store backends for SlidingWindowRateLimiter
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #38 — durable rate-limit state)
 * Last modified: 2026-07-19 by agent (Task #38 — atomic check-and-record via pg row lock)
 *
 * HUMAN REVIEW NOTES:
 * This module defines the RateLimitStore interface and two concrete implementations:
 *
 *   InMemoryRateLimitStore — Map-backed store (unit tests, local dev).
 *     atomicCheckAndRecord performs read-prune-append without any await points, so
 *     Node.js's single-threaded event loop guarantees true atomicity at no extra cost.
 *
 *   PostgresRateLimitStore — Drizzle-backed persistent store.
 *     atomicCheckAndRecord runs inside a database transaction with SELECT … FOR UPDATE
 *     so concurrent async requests for the same key serialize at the DB row lock.
 *     This eliminates the TOCTOU race that a naive getHits/setHits pair introduces.
 *
 * Key namespacing:
 *   Keys are prefixed "<namespace>:<raw-key>" so different limiters (login, waitlist,
 *   export) never collide in the shared rate_limit_hits table.
 *
 * Security (OWASP A04 — Insecure Design):
 *   - The atomic check-and-record ensures the max-requests constraint is enforced even
 *     under concurrent parallel HTTP requests to the same endpoint.
 *   - peek() is read-only and therefore race-free; it does not need locking.
 */

import { eq, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitHits } from "@/db/schema";

// ─── Store interface ──────────────────────────────────────────────────────────

/**
 * RateLimitStore — contract for hit-timestamp storage backends.
 *
 * Two operations are required:
 *
 *   getHits        — Read-only; used by peek() to inspect state without a hit.
 *                    No locking needed because peek() never writes.
 *
 *   atomicCheckAndRecord — Read-prune-check-conditionally-append in one atomic
 *                    unit; used by check(). MUST be race-safe under concurrency.
 */
export interface RateLimitStore {
  /**
   * getHits — Return the stored hit timestamps for `key` (read-only, no lock).
   * Returns [] if no record exists yet.
   */
  getHits(key: string): Promise<number[]>;

  /**
   * atomicCheckAndRecord — Atomically prune stale hits, check the limit, and
   * append a new timestamp when a slot is available.
   *
   * @param key         Rate-limit key (IP or userId, already namespaced if needed).
   * @param windowStart Unix-ms cutoff — timestamps ≤ this are considered stale.
   * @param max         Maximum number of in-window hits allowed.
   * @param now         Current Unix-ms timestamp for the new hit (if allowed).
   * @returns           The post-operation hit array and whether the request was allowed.
   */
  atomicCheckAndRecord(
    key: string,
    windowStart: number,
    max: number,
    now: number,
  ): Promise<{ hits: number[]; allowed: boolean }>;
}

// ─── In-memory store (default — tests + local dev) ────────────────────────────

/**
 * InMemoryRateLimitStore — synchronous Map-backed store; zero I/O.
 *
 * atomicCheckAndRecord performs every step (read → prune → check → write)
 * synchronously inside a single microtask — no await points means Node.js's
 * event loop gives us true atomicity for free.
 *
 * State is lost on process restart (intentional for tests; replaced by
 * PostgresRateLimitStore in production).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly data = new Map<string, number[]>();

  /** Read stored timestamps; returns [] on miss. */
  async getHits(key: string): Promise<number[]> {
    return this.data.get(key) ?? [];
  }

  /**
   * atomicCheckAndRecord — fully synchronous under the hood.
   *
   * Because there are no await points between read and write, Node.js cannot
   * interleave another request handler in the middle of this operation.
   */
  async atomicCheckAndRecord(
    key: string,
    windowStart: number,
    max: number,
    now: number,
  ): Promise<{ hits: number[]; allowed: boolean }> {
    // Synchronous block — no await; event loop cannot interleave here.
    let hits = (this.data.get(key) ?? []).filter((ts) => ts > windowStart);
    const allowed = hits.length < max;
    if (allowed) {
      hits = [...hits, now];
      this.data.set(key, hits);
    }
    return { hits, allowed };
  }

  /** clear — Remove all entries. Exposed for test teardown only. */
  clear(): void {
    this.data.clear();
  }
}

// ─── PostgreSQL store (production) ────────────────────────────────────────────

/**
 * PostgresRateLimitStore — Drizzle/pg-backed store; state survives restarts.
 *
 * atomicCheckAndRecord runs inside a Drizzle transaction and locks the target row
 * with SELECT … FOR UPDATE before reading, so concurrent requests for the same
 * key queue at the database row lock and execute serially. This eliminates the
 * read-prune-check-write race that a non-transactional implementation would have.
 *
 * Transaction flow:
 *   1. UPSERT an empty row for this key (INSERT … ON CONFLICT DO NOTHING) so the
 *      row always exists before we try to lock it.
 *   2. SELECT … FOR UPDATE — acquires an exclusive row lock for the duration of
 *      the transaction; any concurrent transaction on the same key will block here.
 *   3. Prune stale timestamps in application code.
 *   4. If under the limit, append `now` to the array; otherwise do nothing.
 *   5. UPDATE the row with the new array and commit — lock is released.
 *
 * peek() (read-only) reads without a transaction or lock; a slightly stale read
 * is acceptable because peek() only drives UI display, not enforcement decisions.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  private readonly namespace: string;

  /**
   * @param namespace  Short identifier for this limiter, e.g. "login", "waitlist", "export".
   *   Prepended to every DB key as "<namespace>:<key>" to prevent cross-limiter collisions.
   */
  constructor(namespace: string) {
    this.namespace = namespace;
  }

  /** Build the full DB primary key: "<namespace>:<raw-key>" */
  private namespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /**
   * getHits — Read-only SELECT for peek(); no transaction or lock needed.
   * Returns [] on miss (first ever request from this key).
   */
  async getHits(key: string): Promise<number[]> {
    const dbKey = this.namespacedKey(key);
    const row = await db
      .select({ hitTimestamps: rateLimitHits.hitTimestamps })
      .from(rateLimitHits)
      .where(eq(rateLimitHits.key, dbKey))
      .limit(1);
    return row[0]?.hitTimestamps ?? [];
  }

  /**
   * atomicCheckAndRecord — Transaction + row lock; race-safe under concurrency.
   *
   * Uses raw SQL for the SELECT … FOR UPDATE clause because Drizzle's query
   * builder does not expose FOR UPDATE as a first-class method. The rest of the
   * transaction uses Drizzle query builders for type safety.
   */
  async atomicCheckAndRecord(
    key: string,
    windowStart: number,
    max: number,
    now: number,
  ): Promise<{ hits: number[]; allowed: boolean }> {
    const dbKey = this.namespacedKey(key);

    return db.transaction(async (tx) => {
      // Step 1: Ensure the row exists so we can lock it.
      // ON CONFLICT DO NOTHING is safe — if the row already exists we just skip.
      await tx
        .insert(rateLimitHits)
        .values({ key: dbKey, hitTimestamps: [], updatedAt: new Date(now) })
        .onConflictDoNothing();

      // Step 2: Lock the row for this transaction.
      // Any concurrent transaction targeting the same key will block here until
      // we commit, serializing all check() calls for this key.
      const locked = await tx.execute(
        drizzleSql`SELECT hit_timestamps FROM rate_limit_hits WHERE key = ${dbKey} FOR UPDATE`,
      );

      // Extract timestamps from the pg driver result (rows is a plain array).
      const rawHits = (locked.rows[0] as { hit_timestamps: number[] } | undefined)
        ?.hit_timestamps ?? [];

      // Step 3: Prune stale timestamps (outside the sliding window).
      let hits = rawHits.filter((ts) => ts > windowStart);

      // Step 4: Conditionally record this hit.
      const allowed = hits.length < max;
      if (allowed) {
        hits = [...hits, now];
      }

      // Step 5: Persist the updated (or unchanged) array and release the lock.
      await tx
        .update(rateLimitHits)
        .set({ hitTimestamps: hits, updatedAt: new Date(now) })
        .where(eq(rateLimitHits.key, dbKey));

      return { hits, allowed };
    });
  }
}
