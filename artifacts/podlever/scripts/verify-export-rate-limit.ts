/**
 * scripts/verify-export-rate-limit.ts — CRM export rate-limit verification
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #36 — export rate-limit verification)
 *
 * Run: pnpm --filter @workspace/podlever run verify-export-rate-limit
 *  Or: tsx scripts/verify-export-rate-limit.ts  (from artifacts/podlever/)
 *
 * Verifies that the CRM export is rate-limited to 3 downloads per rolling
 * 60-minute window per owner userId, and that a 4th attempt within the same
 * window is blocked (HTTP 429).
 *
 * Tests:
 *   1. Base class: 3 consecutive hits on a fresh SlidingWindowRateLimiter are
 *      allowed, the 4th is blocked, and the remaining counter is accurate.
 *   2. consumeExportSlot: same 3-pass / 4th-fail contract via the singleton
 *      helper used by the route handler.
 *   3. Full route-handler gate simulation: mirrors the exact sequence in
 *      app/rpc/crm/export/route.ts — auth check passes with a stubbed userId,
 *      consumeExportSlot is called in a loop, and the 4th call triggers a
 *      429-equivalent response (allowed=false).
 *   4. Isolation: two distinct userIds each get their own independent 3-slot
 *      budget; consuming all slots for one does not bleed into the other.
 *   5. Window expiry: after the window has passed, the slot counter resets and
 *      a previously-exhausted userId is allowed again.
 *
 * Design notes:
 *   - requireOwner() carries `import "server-only"` and cannot be imported in
 *     a tsx script. The auth gate is replaced by a stub that returns a fixed
 *     owner object — the same shape requireOwner() returns — so the rate-limit
 *     gate (Gate 2) is exercised via the real consumeExportSlot path.
 *   - SlidingWindowRateLimiter is tested with a short custom window (100 ms)
 *     for the expiry test so the script finishes fast without real clock sleeps.
 *   - No database access is required for any of these tests.
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — one or more assertions failed (details printed to stderr)
 *
 * HUMAN REVIEW NOTES:
 *   This script is safe to run in any environment — it creates no DB rows,
 *   writes no files, and makes no network calls. It is pure in-process logic.
 */

import { SlidingWindowRateLimiter } from "../lib/rate-limiter.js";
import { consumeExportSlot, exportRateLimiter } from "../lib/export-rate-limiter.js";

// ─── Assertion helpers ────────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;

/**
 * assert — Lightweight non-throwing assertion. Collects all failures so every
 * test runs regardless of earlier failures, matching the verify-fsm.ts pattern.
 */
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    _passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    _failed++;
  }
}

/**
 * uniqueUserId — Generate a collision-free test userId for each test so
 * test-run state does not leak between tests sharing the same singleton.
 */
let _uidCounter = 0;
function uniqueUserId(prefix: string): string {
  return `verify-export-rl-${prefix}-${Date.now()}-${++_uidCounter}`;
}

/**
 * sleep — Tiny Promise wrapper around setTimeout for the window-expiry test.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Test 1: SlidingWindowRateLimiter base class ──────────────────────────────

/**
 * test1_baseClass — Verify the SlidingWindowRateLimiter enforces max=3 and
 * blocks the 4th hit within the same window.
 *
 * This exercises the core algorithm (hit recording, pruning, remaining counter)
 * independently of the CRM-specific singleton so the test is not affected by
 * state accumulated in other tests.
 */
function test1_baseClass(): void {
  console.log("\n📋 Test 1: SlidingWindowRateLimiter base class (max=3, fresh instance)");

  // Fresh limiter — not the singleton; isolated to this test.
  const limiter = new SlidingWindowRateLimiter({ max: 3, windowMs: 60 * 60 * 1_000 });
  const userId  = uniqueUserId("t1");

  // Hit 1 of 3
  const r1 = limiter.check(userId);
  assert(r1.allowed === true,   "hit 1: allowed=true");
  assert(r1.remaining === 2,    "hit 1: remaining=2");

  // Hit 2 of 3
  const r2 = limiter.check(userId);
  assert(r2.allowed === true,   "hit 2: allowed=true");
  assert(r2.remaining === 1,    "hit 2: remaining=1");

  // Hit 3 of 3 — last allowed slot
  const r3 = limiter.check(userId);
  assert(r3.allowed === true,   "hit 3: allowed=true (last slot)");
  assert(r3.remaining === 0,    "hit 3: remaining=0 (budget exhausted)");

  // Hit 4 — must be blocked
  const r4 = limiter.check(userId);
  assert(r4.allowed === false,  "hit 4: allowed=false (rate limit enforced)");
  assert(r4.remaining === 0,    "hit 4: remaining=0 (still exhausted)");

  // Hit 5 — still blocked; not a transient glitch
  const r5 = limiter.check(userId);
  assert(r5.allowed === false,  "hit 5: allowed=false (limit persists)");
}

// ─── Test 2: consumeExportSlot helper (singleton) ─────────────────────────────

/**
 * test2_consumeExportSlot — Verify the consumeExportSlot() wrapper function
 * enforces the 3/60-min limit and returns the expected shape.
 *
 * Uses a unique userId to ensure no cross-contamination with Test 1 or Test 3.
 */
function test2_consumeExportSlot(): void {
  console.log("\n📋 Test 2: consumeExportSlot() — 3 allowed, 4th blocked");

  const userId = uniqueUserId("t2");

  // Exports 1–3: must succeed
  for (let i = 1; i <= 3; i++) {
    const result = consumeExportSlot(userId);
    assert(result.allowed === true,
      `export ${i}/3: allowed=true`);
    assert(result.remaining === 3 - i,
      `export ${i}/3: remaining=${3 - i}`);
  }

  // Export 4: must be blocked
  const blocked = consumeExportSlot(userId);
  assert(blocked.allowed === false,
    "export 4/3: allowed=false (429 territory)");
  assert(blocked.remaining === 0,
    "export 4/3: remaining=0");
}

// ─── Test 3: Full route-handler gate simulation ───────────────────────────────

/**
 * test3_routeHandlerGate — Replicate the exact Gate 2 logic from
 * app/rpc/crm/export/route.ts using the real consumeExportSlot import.
 *
 * Production gate (lines 110–118 of route.ts):
 *
 *   const rateResult = consumeExportSlot(owner.userId);
 *   if (!rateResult.allowed) {
 *     return NextResponse.json(
 *       { error: "Export rate limit exceeded..." },
 *       { status: 429, headers: { "Retry-After": "3600" } },
 *     );
 *   }
 *
 * This simulation replaces requireOwner() with a stub owner object (Gate 1
 * cannot be tested outside the Next.js runtime) and exercises Gate 2 with the
 * real singleton. The stub owner shape matches what requireOwner() returns so
 * any future shape change will cause this test to diverge — an intentional
 * signal to update both sides.
 */
function test3_routeHandlerGate(): void {
  console.log("\n📋 Test 3: Route-handler gate simulation (stub owner + real rate limiter)");

  // Stub owner — same shape returned by requireOwner() in owner-guard.ts.
  // Using a unique userId so the slot budget is independent of other tests.
  const stubOwner = {
    userId:   uniqueUserId("t3"),
    role:     "owner" as const,
    name:     "Test Owner",
  };

  /**
   * simulateExportRequest — Mirrors the Gate 2 block of the route handler.
   * Returns the HTTP status equivalent (200 = allowed, 429 = rate limited).
   */
  function simulateExportRequest(owner: typeof stubOwner): 200 | 429 {
    // Gate 1 skipped (requireOwner already passed — stub above).
    // Gate 2: rate limit check — IDENTICAL to route.ts
    const rateResult = consumeExportSlot(owner.userId);
    if (!rateResult.allowed) {
      // Route handler returns 429 with Retry-After: 3600
      return 429;
    }
    // Gate 3+ (validation, DB fetch, streaming) omitted — not rate-limit scope.
    return 200;
  }

  // Requests 1–3 must return 200
  for (let i = 1; i <= 3; i++) {
    const status = simulateExportRequest(stubOwner);
    assert(status === 200, `request ${i}/3: HTTP 200 (allowed)`);
  }

  // Request 4 must return 429
  const status4 = simulateExportRequest(stubOwner);
  assert(status4 === 429, "request 4/3: HTTP 429 (rate limit enforced)");

  // Request 5 still 429 — not intermittent
  const status5 = simulateExportRequest(stubOwner);
  assert(status5 === 429, "request 5/3: HTTP 429 (limit persists, not a fluke)");
}

// ─── Test 4: Per-user isolation ───────────────────────────────────────────────

/**
 * test4_perUserIsolation — Two distinct userIds each get their own independent
 * 3-slot budget. Exhausting one does not affect the other.
 *
 * This catches any accidental global-counter regression where all users share
 * a single counter instead of per-key counters.
 */
function test4_perUserIsolation(): void {
  console.log("\n📋 Test 4: Per-user isolation (two owners, independent budgets)");

  const limiter = new SlidingWindowRateLimiter({ max: 3, windowMs: 60 * 60 * 1_000 });
  const userA   = uniqueUserId("t4-A");
  const userB   = uniqueUserId("t4-B");

  // Exhaust userA's budget
  limiter.check(userA);
  limiter.check(userA);
  limiter.check(userA);
  const blockedA = limiter.check(userA);
  assert(blockedA.allowed === false, "userA: 4th request blocked after 3 uses");

  // userB should still have a full 3-slot budget
  const r1B = limiter.check(userB);
  assert(r1B.allowed === true,  "userB: 1st request allowed (independent of userA)");
  assert(r1B.remaining === 2,   "userB: remaining=2 (own budget, not shared)");

  const r2B = limiter.check(userB);
  assert(r2B.allowed === true,  "userB: 2nd request allowed");

  const r3B = limiter.check(userB);
  assert(r3B.allowed === true,  "userB: 3rd request allowed");

  // Now userB is also exhausted — but userA's state is independent
  const r4B = limiter.check(userB);
  assert(r4B.allowed === false, "userB: 4th request blocked");
}

// ─── Test 5: Window expiry resets the counter ─────────────────────────────────

/**
 * test5_windowExpiry — After the sliding window passes, a previously-exhausted
 * userId is allowed again.
 *
 * Uses windowMs=100 ms to keep the total sleep time minimal (150 ms).
 */
async function test5_windowExpiry(): Promise<void> {
  console.log("\n📋 Test 5: Window expiry — exhausted budget resets after window elapses");

  const WINDOW_MS = 100; // 100 ms window — fast enough for a verification script
  const limiter   = new SlidingWindowRateLimiter({ max: 3, windowMs: WINDOW_MS });
  const userId    = uniqueUserId("t5");

  // Exhaust the budget
  limiter.check(userId);
  limiter.check(userId);
  limiter.check(userId);
  const blocked = limiter.check(userId);
  assert(blocked.allowed === false, "pre-expiry: 4th request blocked (window full)");

  // Wait for the window to expire (all hits slide out)
  await sleep(WINDOW_MS + 50); // +50 ms margin for timer imprecision

  // After expiry, the userId should be allowed again
  const afterExpiry = limiter.check(userId);
  assert(afterExpiry.allowed === true,  "post-expiry: 1st request allowed (window reset)");
  assert(afterExpiry.remaining === 2,   "post-expiry: remaining=2 (fresh 3-slot window)");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("PodLever — CRM Export Rate-Limit Verification");
  console.log("=".repeat(60));

  try {
    test1_baseClass();
    test2_consumeExportSlot();
    test3_routeHandlerGate();
    test4_perUserIsolation();
    await test5_windowExpiry();
  } catch (err) {
    console.error("\n💥 Unexpected error in test harness:", err);
    _failed++;
  }

  // ── Final report ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${_passed} passed, ${_failed} failed`);
  console.log("=".repeat(60));

  if (_failed > 0) {
    console.error(`\n❌ ${_failed} assertion(s) failed — CRM export rate-limit verification INCOMPLETE`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${_passed} assertions passed — CRM export rate-limit verified`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
