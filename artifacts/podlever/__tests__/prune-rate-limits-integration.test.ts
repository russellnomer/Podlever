/**
 * __tests__/prune-rate-limits-integration.test.ts
 * Integration tests for PostgresRateLimitStore.pruneStaleRows()
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #48 — verify pruneStaleRows deletes idle rows)
 *
 * HUMAN REVIEW NOTES:
 * This is a REAL DATABASE test — it writes to and reads from rate_limit_hits.
 * DATABASE_URL must be set and migrations must be applied before running.
 *
 * What this proves:
 *   - pruneStaleRows() removes rows whose updated_at is before the cutoff.
 *   - Fresh rows (updated_at within the window) are left untouched.
 *   - When no stale rows exist, the function returns 0 without error.
 *
 * Test isolation: every row key is prefixed with a unique timestamp so the
 * test is safe to run concurrently with other suites. Cleanup runs in afterAll.
 *
 * No module mocks in this file — vi.mock() hoisting in another file cannot
 * reach this module because each file runs in its own fork (pool: "forks").
 */

import { describe, it, expect, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitHits } from "@/db/schema";
import { PostgresRateLimitStore } from "@/lib/rate-limit-store";

// ─── Test-isolation keys ──────────────────────────────────────────────────────

/** Unique prefix per test run — prevents collisions in parallel CI. */
const RUN_ID = `test-prune-${Date.now()}`;

/** Keys that will be seeded as STALE (updated_at = 3 hours ago). */
const STALE_KEYS = [`${RUN_ID}:stale-1`, `${RUN_ID}:stale-2`];

/** Keys that will be seeded as FRESH (updated_at = now). */
const FRESH_KEYS = [`${RUN_ID}:fresh-1`, `${RUN_ID}:fresh-2`];

const ALL_KEYS = [...STALE_KEYS, ...FRESH_KEYS];

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  try {
    await db.delete(rateLimitHits).where(inArray(rateLimitHits.key, ALL_KEYS));
  } catch {
    // Non-fatal — rows auto-expire and never affect other tests.
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PostgresRateLimitStore.pruneStaleRows() — integration", () => {
  /**
   * Core assertion: stale rows are deleted, fresh rows survive.
   *
   * Setup:
   *   - 2 stale rows: updated_at = 3 hours ago (exceeds the 2-hour threshold).
   *   - 2 fresh rows: updated_at = now (inside the 2-hour window).
   *
   * Cutoff: 2 hours ago. pruneStaleRows() should remove only the stale rows.
   */
  it("deletes stale rows and leaves fresh rows untouched", async () => {
    const now = Date.now();
    // 3 hours ago — beyond the 2-hour threshold so these must be pruned.
    const staleDate = new Date(now - 3 * 60 * 60 * 1_000);
    // Right now — clearly inside the 2-hour window; must survive.
    const freshDate = new Date(now);

    // Seed stale rows with a backdated updated_at.
    await db.insert(rateLimitHits).values(
      STALE_KEYS.map((key) => ({
        key,
        hitTimestamps: [] as number[],
        updatedAt: staleDate,
      })),
    );

    // Seed fresh rows with the current timestamp.
    await db.insert(rateLimitHits).values(
      FRESH_KEYS.map((key) => ({
        key,
        hitTimestamps: [] as number[],
        updatedAt: freshDate,
      })),
    );

    // Cutoff = 2 hours ago.
    const cutoffMs = now - 2 * 60 * 60 * 1_000;
    const deleted = await PostgresRateLimitStore.pruneStaleRows(cutoffMs);

    // We inserted 2 stale rows; at least both must be reported deleted.
    // ">= 2" is resilient to other concurrent tests leaving additional stale rows.
    expect(deleted).toBeGreaterThanOrEqual(2);

    // Stale rows must be gone.
    const remainingStale = await db
      .select({ key: rateLimitHits.key })
      .from(rateLimitHits)
      .where(inArray(rateLimitHits.key, STALE_KEYS));
    expect(remainingStale).toHaveLength(0);

    // Fresh rows must still exist.
    const remainingFresh = await db
      .select({ key: rateLimitHits.key })
      .from(rateLimitHits)
      .where(inArray(rateLimitHits.key, FRESH_KEYS));
    expect(remainingFresh).toHaveLength(2);

    // Confirm the surviving keys are exactly the ones we inserted as fresh.
    const foundKeys = remainingFresh.map((r) => r.key).sort();
    expect(foundKeys).toEqual([...FRESH_KEYS].sort());
  });

  /**
   * Edge case: cutoff set far in the past — nothing in the table is that old.
   * pruneStaleRows() must return 0 and not throw.
   */
  it("returns 0 when no rows are older than the cutoff", async () => {
    // 10 years ago — nothing is that old.
    const ancientCutoff = Date.now() - 10 * 365 * 24 * 60 * 60 * 1_000;
    const deleted = await PostgresRateLimitStore.pruneStaleRows(ancientCutoff);
    expect(deleted).toBe(0);
  });
});
