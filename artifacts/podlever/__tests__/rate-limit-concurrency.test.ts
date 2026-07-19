/**
 * __tests__/rate-limit-concurrency.test.ts — Concurrent export slot race-condition test
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #47 — confirm two simultaneous requests can't
 *   both slip through the rate-limit cap when only one slot remains)
 *
 * HUMAN REVIEW NOTES:
 * This is an INTEGRATION test — it writes to and reads from the real PostgreSQL
 * database (rate_limit_hits table). DATABASE_URL must be set in the environment.
 *
 * What this proves:
 *   PostgresRateLimitStore.atomicCheckAndRecord uses SELECT … FOR UPDATE inside a
 *   DB transaction so that concurrent requests for the same key queue at the row
 *   lock and execute serially. Without this guarantee, two async requests that both
 *   read "1 slot remaining" before either commits could both succeed — effectively
 *   granting 4 of 3 allowed exports.
 *
 *   This test simulates that exact race:
 *     1. Pre-seed 2 hits so only 1 slot remains.
 *     2. Fire two concurrent consumeExportSlot() calls via Promise.all().
 *     3. Assert exactly one call returns allowed=true and the other allowed=false.
 *     4. Verify the DB row holds exactly 3 timestamps (not 4).
 *
 * Security relevance (OWASP A04 — Insecure Design):
 *   Without SELECT … FOR UPDATE a race allows an attacker to burst more exports
 *   than the 3/hr cap permits by firing parallel requests. This test locks in the
 *   correct serialized behavior so any future refactor that drops the row lock is
 *   caught immediately.
 *
 * Test isolation:
 *   A unique userId (UUID-like prefix + timestamp) is used per test run so
 *   this test is safe to run concurrently with other tests or re-run without
 *   cleanup. Rows accumulate at most 3 timestamps and are harmless.
 *
 * Change classification: Standard (test-only, no production code changes).
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitHits } from "@/db/schema";
import { PostgresRateLimitStore } from "@/lib/rate-limit-store";
import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";

// ─── Test-isolation helpers ───────────────────────────────────────────────────

/**
 * A unique userId that is fresh for every test run.
 * Using a timestamp suffix prevents collisions between concurrent CI runs
 * and with the persistence test (which uses a different prefix).
 */
const TEST_USER_ID = `test-concurrency-user-${Date.now()}`;

/**
 * The namespace that PostgresRateLimitStore prepends to keys.
 * Matches the "export" namespace used in export-rate-limiter.ts.
 */
const EXPORT_NAMESPACE = "export";

/** The DB primary key this test's rows are stored under. */
const DB_KEY = `${EXPORT_NAMESPACE}:${TEST_USER_ID}`;

/**
 * A fresh limiter and store for this test suite — identical configuration to
 * the production exportRateLimiter (3 exports per 60-minute rolling window).
 * We instantiate our own rather than calling consumeExportSlot() so we can
 * control the exact state before the concurrent race.
 */
const store = new PostgresRateLimitStore(EXPORT_NAMESPACE);
const limiter = new SlidingWindowRateLimiter(
  { max: 3, windowMs: 60 * 60 * 1_000 }, // 60-minute sliding window, max 3
  store,
);

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Best-effort cleanup — a failure here does not fail the suite.
  // The row compacts itself on the next check() call within the window anyway.
  try {
    await db.delete(rateLimitHits).where(eq(rateLimitHits.key, DB_KEY));
  } catch {
    // Non-fatal: the row expires with the 1-hour window.
  }
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("concurrent export slot requests — SELECT FOR UPDATE serialization (PostgresRateLimitStore)", () => {
  /**
   * Step 1: Consume 2 of 3 slots sequentially so only 1 slot remains.
   *
   * We do this sequentially (awaited one at a time) so the pre-seed state
   * is deterministic before we introduce concurrency in the next step.
   */
  it("step 1 — pre-seed: consume 2 of 3 slots sequentially (both allowed)", async () => {
    const slot1 = await limiter.check(TEST_USER_ID);
    const slot2 = await limiter.check(TEST_USER_ID);

    expect(slot1.allowed).toBe(true);
    expect(slot2.allowed).toBe(true);

    // Exactly 1 slot should remain after two sequential hits.
    const peeked = await limiter.peek(TEST_USER_ID);
    expect(peeked.remaining).toBe(1);
  });

  /**
   * Step 2 (core race test): Fire two concurrent check() calls via Promise.all.
   *
   * With SELECT … FOR UPDATE, the DB serializes both transactions — only the
   * first one to acquire the row lock will see "hits.length < max" as true.
   * The second transaction blocks, then reads the committed (full) array and
   * must return allowed=false.
   *
   * Without the row lock both transactions could read "2 hits" simultaneously,
   * both decide "2 < 3 → allowed", and both write 3 timestamps — the table
   * would end up with the winner's 3 and the loser's 3 merged to 4, meaning
   * 4 of 3 exports are granted.
   */
  it("step 2 — concurrent: exactly one of two simultaneous requests is allowed", async () => {
    // Fire both check() calls at the same time.
    // Promise.all starts both Promises before awaiting either, maximising the
    // chance that both DB transactions overlap in time.
    const [resultA, resultB] = await Promise.all([
      limiter.check(TEST_USER_ID),
      limiter.check(TEST_USER_ID),
    ]);

    // Exactly one must be allowed — not zero, not two.
    const allowedCount = [resultA.allowed, resultB.allowed].filter(Boolean).length;
    expect(allowedCount).toBe(1);

    // The blocked request must have remaining=0 and a future resetAt.
    const blocked = resultA.allowed ? resultB : resultA;
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt).toBeGreaterThan(Date.now());

    // The allowed request used the last slot — remaining drops to 0.
    const allowed = resultA.allowed ? resultA : resultB;
    expect(allowed.allowed).toBe(true);
    expect(allowed.remaining).toBe(0);
  });

  /**
   * Step 3: Confirm the DB row holds exactly 3 timestamps — not 4.
   *
   * If the row lock failed and both transactions committed a new timestamp,
   * the array would have 4 entries. Three entries prove serialization worked.
   */
  it("step 3 — DB row holds exactly 3 timestamps after the concurrent race", async () => {
    const rows = await db
      .select({ hitTimestamps: rateLimitHits.hitTimestamps })
      .from(rateLimitHits)
      .where(eq(rateLimitHits.key, DB_KEY))
      .limit(1);

    // Row must exist.
    expect(rows).toHaveLength(1);

    // Exactly 3 timestamps — the two pre-seeded hits plus exactly one from the race.
    const timestamps = rows[0].hitTimestamps;
    expect(timestamps).toHaveLength(3);

    // All timestamps must be recent Unix-ms values (within the last 30 seconds).
    const now = Date.now();
    for (const ts of timestamps) {
      expect(ts).toBeGreaterThan(now - 30_000);
      expect(ts).toBeLessThanOrEqual(now);
    }
  });

  /**
   * Step 4: Confirm the window is full — a subsequent request is also blocked.
   *
   * Belt-and-suspenders: even after the race, the limiter must continue to
   * enforce the cap correctly for future requests in the same window.
   */
  it("step 4 — subsequent request after the race is blocked (window full)", async () => {
    const extraRequest = await limiter.check(TEST_USER_ID);
    expect(extraRequest.allowed).toBe(false);
    expect(extraRequest.remaining).toBe(0);
    expect(extraRequest.resetAt).toBeGreaterThan(Date.now());
  });
});
