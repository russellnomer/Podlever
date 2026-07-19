/**
 * __tests__/rate-limit-persistence.test.ts — Rate-limit persistence integration test
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #45 — confirm rate limits survive process restart)
 *
 * HUMAN REVIEW NOTES:
 * This is an INTEGRATION test — it writes to and reads from the real PostgreSQL
 * database (rate_limit_hits table). DATABASE_URL must be set in the environment.
 *
 * What this proves:
 *   Task #38 moved rate-limit state from in-process memory into PostgreSQL so
 *   that a server restart cannot reset the sliding window and allow an attacker
 *   to reset the 3/hr export cap by triggering a deploy.
 *
 *   This test simulates that exact scenario:
 *     1. Consume 2 of 3 export slots via consumeExportSlot().
 *     2. Verify the DB row holds exactly 2 timestamps.
 *     3. Create a brand-new SlidingWindowRateLimiter + PostgresRateLimitStore
 *        instance (simulating a fresh process after restart).
 *     4. Call check() on the new instance — confirms only 1 slot remains.
 *     5. Call check() again — confirms the request is blocked (allowed=false).
 *
 * Security relevance (OWASP A04 — Insecure Design):
 *   Without this guarantee an attacker could exhaust the 3 export-per-hour cap,
 *   trigger a redeploy, and immediately receive 3 fresh slots. Persistence via
 *   PostgreSQL closes that window.
 *
 * Test isolation:
 *   A unique userId (UUID-like prefix + timestamp) is used per test run so
 *   this test is safe to run concurrently with other tests or re-run without
 *   cleanup. The row accumulates at most 5 hit timestamps and is harmless.
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitHits } from "@/db/schema";
import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";
import { PostgresRateLimitStore } from "@/lib/rate-limit-store";
import { consumeExportSlot } from "@/lib/export-rate-limiter";

// ─── Test-isolation helpers ───────────────────────────────────────────────────

/**
 * A unique userId that is fresh for every test run.
 * Using a timestamp suffix prevents collisions between concurrent CI runs.
 * Pattern matches what the CRM export route passes to consumeExportSlot().
 */
const TEST_USER_ID = `test-persistence-user-${Date.now()}`;

/**
 * The namespace that PostgresRateLimitStore prefixes onto keys.
 * Must match the "export" namespace used in export-rate-limiter.ts.
 */
const EXPORT_NAMESPACE = "export";

/** The DB primary key this test's rows are stored under. */
const DB_KEY = `${EXPORT_NAMESPACE}:${TEST_USER_ID}`;

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  // Remove the test row so the DB stays tidy.
  // This is best-effort — a failure here does not fail the test suite.
  try {
    await db.delete(rateLimitHits).where(eq(rateLimitHits.key, DB_KEY));
  } catch {
    // Non-fatal: leftover row compacts itself on next check() and expires with
    // the window (1 hour). No manual intervention required.
  }
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("rate-limit state survives a process restart (PostgresRateLimitStore)", () => {
  /**
   * Step 1 + 2: Consume 2 slots; verify the DB row holds exactly 2 timestamps.
   *
   * Uses consumeExportSlot() — the same function the CRM export route calls —
   * so this path is identical to what production uses.
   */
  it("step 1 — consume 2 of 3 export slots; both are allowed", async () => {
    const slot1 = await consumeExportSlot(TEST_USER_ID);
    const slot2 = await consumeExportSlot(TEST_USER_ID);

    expect(slot1.allowed).toBe(true);
    expect(slot2.allowed).toBe(true);
  });

  it("step 2 — the DB row holds exactly 2 timestamps after 2 slots consumed", async () => {
    const rows = await db
      .select({ hitTimestamps: rateLimitHits.hitTimestamps })
      .from(rateLimitHits)
      .where(eq(rateLimitHits.key, DB_KEY))
      .limit(1);

    // The row must exist (was created by atomicCheckAndRecord's UPSERT).
    expect(rows).toHaveLength(1);

    // Exactly 2 timestamps — one per consumeExportSlot() call above.
    const timestamps = rows[0].hitTimestamps;
    expect(timestamps).toHaveLength(2);

    // Timestamps must be recent Unix-ms values (within the last 10 seconds).
    const now = Date.now();
    for (const ts of timestamps) {
      expect(ts).toBeGreaterThan(now - 10_000);
      expect(ts).toBeLessThanOrEqual(now);
    }
  });

  /**
   * Step 3: Simulate a process restart by instantiating a completely fresh
   * SlidingWindowRateLimiter backed by a new PostgresRateLimitStore.
   *
   * This is the critical assertion: the new instance knows nothing about the
   * previous 2 hits except what it reads from the database. If state were
   * held in memory, a fresh instance would report 3 slots remaining.
   */
  it("step 3+4 — fresh limiter instance (simulating restart) reports only 1 slot remaining", async () => {
    // Instantiate a fresh limiter — identical config to export-rate-limiter.ts
    // but a brand-new object with no in-memory state whatsoever.
    const freshStore   = new PostgresRateLimitStore(EXPORT_NAMESPACE);
    const freshLimiter = new SlidingWindowRateLimiter(
      { max: 3, windowMs: 60 * 60 * 1_000 }, // same as exportRateLimiter
      freshStore,
    );

    // peek() reads state without consuming a slot — confirms the restart-safe read path.
    const peeked = await freshLimiter.peek(TEST_USER_ID);
    expect(peeked.remaining).toBe(1);
    expect(peeked.allowed).toBe(true);

    // check() consumes the last slot — still allowed because remaining was 1.
    const slot3 = await freshLimiter.check(TEST_USER_ID);
    expect(slot3.allowed).toBe(true);
    expect(slot3.remaining).toBe(0);
  });

  /**
   * Step 5: Confirm the window is now full (3/3 consumed) and the 4th request
   * is blocked — even though it comes from yet another fresh limiter instance.
   */
  it("step 5 — another fresh instance confirms the 4th request is blocked (429)", async () => {
    // One more "restart" — a completely new limiter, no in-memory state.
    const freshStore2   = new PostgresRateLimitStore(EXPORT_NAMESPACE);
    const freshLimiter2 = new SlidingWindowRateLimiter(
      { max: 3, windowMs: 60 * 60 * 1_000 },
      freshStore2,
    );

    // The window has 3 hits; this 4th attempt must be blocked.
    const blocked = await freshLimiter2.check(TEST_USER_ID);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);

    // resetAt must be a future timestamp (not yet expired).
    expect(blocked.resetAt).toBeGreaterThan(Date.now());
  });
});
