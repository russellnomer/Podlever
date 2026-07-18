/**
 * verify-fsm.ts — Phase 1A FSM verification script
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (added Test 5: service-boundary replay)
 *
 * Run: pnpm --filter @workspace/podlever run verify-fsm
 *  Or: tsx scripts/verify-fsm.ts  (from artifacts/podlever/)
 *
 * Verifies all five required FSM behaviors against the real database:
 *   1. Valid transition: state updates, fsm_version increments, one event inserted
 *   2. Invalid transition: InvalidTransitionError thrown, no DB writes
 *   3. Stale version (OCC): OptimisticLockError thrown, no partial writes
 *   4. Idempotent replay: same key → no new event, no version bump, no error
 *      (executor-layer test: caller passes original fromState)
 *   5. Service-boundary retry replay: simulates what EpisodeService.transitionEpisode
 *      does on retry — fetches current DB state as fromState, calls executeTransition
 *      with SAME key and SAME toState but UPDATED fromState. Verifies replay fires
 *      before assertValidTransition (the case broken by the old INSERT-first design).
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — one or more assertions failed (details printed to stderr)
 *
 * The process explicitly closes the DB connection at the end so it exits cleanly.
 *
 * HUMAN REVIEW NOTES:
 * This script creates real rows in the database and cleans up after itself.
 * It should NOT be run against a production database. Use a dev DATABASE_URL.
 * All test rows are inserted with a unique prefix and cleaned up at the end.
 *
 * Note: EpisodeService has a `server-only` guard that prevents importing it in tsx.
 * Test 5 therefore simulates the service boundary by replicating its exact behavior:
 * read episode state from DB → pass as fromState to executeTransition (with the
 * caller's original toState and idempotencyKey). This exercises the identical code
 * path and verifies the critical SELECT-first idempotency fix.
 */

// DATABASE_URL and other env vars are already present in the Replit environment.
// For local development outside Replit, set DATABASE_URL in your shell or .env.local.

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, episodes, pipelineEvents } from "../db/schema/index.js";
import { executeTransition } from "../server/fsm/executor.js";
import { InvalidTransitionError } from "../server/fsm/states.js";
import {
  EpisodeNotFoundError,
  OptimisticLockError,
} from "../repositories/episode.repository.js";
import { Pool } from "pg";

// ─── Assertion helpers ────────────────────────────────────────────────────────

let _passed = 0;
let _failed = 0;

/**
 * assert — Lightweight assertion with descriptive output.
 * Does NOT throw — collects failures and reports at end so all tests run.
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
 * assertThrows — Assert that an async function throws an instance of ErrorClass.
 */
async function assertThrows<E extends Error>(
  fn: () => Promise<unknown>,
  ErrorClass: new (...args: never[]) => E,
  message: string,
): Promise<E | null> {
  try {
    await fn();
    console.error(`  ❌ FAIL (no throw): ${message}`);
    _failed++;
    return null;
  } catch (err) {
    if (err instanceof ErrorClass) {
      console.log(`  ✅ PASS: ${message}`);
      _passed++;
      return err;
    }
    console.error(
      `  ❌ FAIL (wrong error type — got ${(err as Error).constructor.name}): ${message}`,
    );
    _failed++;
    return null;
  }
}

// ─── Setup / teardown helpers ─────────────────────────────────────────────────

/** RUN_ID — unique prefix for all rows created in this test run (for safe cleanup). */
const RUN_ID = `verify-fsm-${Date.now()}`;

/**
 * setupTestFixtures — Create a test User and Episode in the database.
 * Returns their IDs for use in assertions.
 */
async function setupTestFixtures(): Promise<{ userId: string; episodeId: string }> {
  // Insert a test user (external identity mimics Phase 1A stub owner)
  const [user] = await db
    .insert(users)
    .values({
      externalIdentityId:       `${RUN_ID}-user`,
      externalIdentityProvider: "stub",
      displayName:              "Verify FSM Test User",
      role:                     "owner",
    })
    .returning();

  // Insert a test episode in "draft" state (the initial FSM state)
  const [episode] = await db
    .insert(episodes)
    .values({
      ownerId: user!.id,
      title:   `${RUN_ID} — FSM Test Episode`,
      state:   "draft",
      fsmVersion: 1,
    })
    .returning();

  return { userId: user!.id, episodeId: episode!.id };
}

/**
 * cleanupTestFixtures — Remove all rows created by this test run.
 * Cascade deletes handle child rows (episodes, pipeline_events via FK).
 */
async function cleanupTestFixtures(userId: string): Promise<void> {
  // Delete the test user — cascades to episodes and pipeline_events
  await db.delete(users).where(eq(users.id, userId));
}

// ─── Test cases ───────────────────────────────────────────────────────────────

/**
 * test1_validTransition — Verifies a valid draft → processing transition.
 *
 * Expected outcomes:
 *   - Episode state updated to "processing"
 *   - fsm_version incremented from 1 → 2
 *   - Exactly one pipeline_events row inserted
 *   - idempotentReplay: false
 */
async function test1_validTransition(episodeId: string): Promise<number> {
  console.log("\n📋 Test 1: Valid transition (draft → processing)");

  const idempotencyKey = `${RUN_ID}-t1-key`;

  const result = await executeTransition({
    episodeId,
    fromState:         "draft",
    currentFsmVersion: 1,
    toState:           "processing",
    idempotencyKey,
    metadata:          "Test 1: valid transition",
  });

  assert(result.episode.state === "processing",    "episode.state === 'processing'");
  assert(result.episode.fsmVersion === 2,          "episode.fsmVersion === 2 (incremented)");
  assert(result.idempotentReplay === false,         "idempotentReplay === false");

  // Verify exactly one pipeline_events row was inserted with correct fields
  const events = await db
    .select()
    .from(pipelineEvents)
    .where(
      and(
        eq(pipelineEvents.episodeId, episodeId),
        eq(pipelineEvents.idempotencyKey, idempotencyKey),
      ),
    );

  assert(events.length === 1,                          "exactly 1 pipeline_events row inserted");
  assert(events[0]?.fromState === "draft",             "event.fromState === 'draft'");
  assert(events[0]?.toState === "processing",          "event.toState === 'processing'");
  assert(events[0]?.idempotencyKey === idempotencyKey, "event.idempotencyKey matches");

  // Return new fsm_version for use in subsequent tests
  return result.episode.fsmVersion;
}

/**
 * test2_invalidTransition — Verifies that an illegal transition is rejected.
 *
 * Attempts "processing" → "draft" (not in VALID_TRANSITIONS).
 * Expected outcomes:
 *   - InvalidTransitionError thrown
 *   - No DB writes (episode unchanged, no new event)
 */
async function test2_invalidTransition(
  episodeId: string,
  currentFsmVersion: number,
): Promise<void> {
  console.log("\n📋 Test 2: Invalid transition (processing → draft — illegal)");

  const eventsBefore = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.episodeId, episodeId));

  const eventCountBefore = eventsBefore.length;

  const err = await assertThrows(
    () =>
      executeTransition({
        episodeId,
        fromState:         "processing",
        currentFsmVersion,
        toState:           "draft", // ILLEGAL: processing cannot go back to draft
        idempotencyKey:    `${RUN_ID}-t2-key`,
        metadata:          "Test 2: invalid transition attempt",
      }),
    InvalidTransitionError,
    "InvalidTransitionError thrown for illegal transition",
  );

  if (err) {
    assert(
      err.fromState === "processing" && err.toState === "draft",
      `error carries fromState="processing", toState="draft"`,
    );
  }

  // Verify no new pipeline_events were inserted
  const eventsAfter = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.episodeId, episodeId));

  assert(
    eventsAfter.length === eventCountBefore,
    "no new pipeline_events rows after rejected transition",
  );

  // Verify episode state and version are unchanged
  const [episode] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);

  assert(episode!.state === "processing",                "episode.state still 'processing'");
  assert(episode!.fsmVersion === currentFsmVersion,      "episode.fsmVersion unchanged");
}

/**
 * test3_staleVersionConflict — Verifies optimistic lock rejection.
 *
 * Simulates a concurrent write by passing a stale fsm_version.
 * Expected outcomes:
 *   - OptimisticLockError thrown
 *   - No DB writes (episode unchanged, no new event)
 *   - The idempotency key from this call is NOT consumed (rollback)
 */
async function test3_staleVersionConflict(
  episodeId: string,
  currentFsmVersion: number,
): Promise<void> {
  console.log("\n📋 Test 3: Stale fsm_version conflict (optimistic lock)");

  const staleVersion = currentFsmVersion - 1; // intentionally stale

  const eventsBefore = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.episodeId, episodeId));

  const eventCountBefore = eventsBefore.length;
  const idempotencyKey = `${RUN_ID}-t3-stale-key`;

  await assertThrows(
    () =>
      executeTransition({
        episodeId,
        fromState:         "processing",
        currentFsmVersion: staleVersion, // STALE — triggers optimistic lock rejection
        toState:           "ready",
        idempotencyKey,
        metadata:          "Test 3: stale version attempt",
      }),
    OptimisticLockError,
    `OptimisticLockError thrown for stale version=${staleVersion}`,
  );

  // Verify no partial writes occurred (transaction rolled back)
  const eventsAfter = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.episodeId, episodeId));

  assert(
    eventsAfter.length === eventCountBefore,
    "no new pipeline_events rows after OCC rejection (transaction rolled back)",
  );

  // The idempotency key was rolled back — verify by checking it's not in DB
  const [keyRow] = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.idempotencyKey, idempotencyKey))
    .limit(1);

  assert(keyRow === undefined, "idempotency key NOT consumed by rejected transaction");

  // Episode state and version unchanged
  const [episode] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);

  assert(episode!.fsmVersion === currentFsmVersion, "episode.fsmVersion unchanged after OCC rejection");
}

/**
 * test4_idempotentReplay — Verifies that replaying the same key is a no-op.
 *
 * Steps:
 *   1. Successfully transition processing → ready (fresh key)
 *   2. Replay the SAME transition with the SAME key
 * Expected outcomes (replay):
 *   - No error thrown
 *   - idempotentReplay: true
 *   - No new pipeline_events row
 *   - fsm_version NOT incremented on replay
 */
async function test4_idempotentReplay(
  episodeId: string,
  currentFsmVersion: number,
): Promise<void> {
  console.log("\n📋 Test 4: Idempotent replay (same key → no new event, no version bump)");

  const idempotencyKey = `${RUN_ID}-t4-replay-key`;

  // First application — fresh transition
  const first = await executeTransition({
    episodeId,
    fromState:         "processing",
    currentFsmVersion,
    toState:           "ready",
    idempotencyKey,
    metadata:          "Test 4: first application",
  });

  assert(first.idempotentReplay === false,             "first call: idempotentReplay=false");
  assert(first.episode.state === "ready",               "first call: state='ready'");
  assert(first.episode.fsmVersion === currentFsmVersion + 1, "first call: fsmVersion incremented");

  const versionAfterFirst = first.episode.fsmVersion;

  // Count events before replay
  const eventsBefore = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.episodeId, episodeId));

  const eventCountBefore = eventsBefore.length;

  // Second application — replay with the ORIGINAL intent (same fromState, toState, key).
  // We pass fromState="processing" and toState="ready" — the exact same intent as the
  // first call. assertValidTransition("processing","ready") passes. The INSERT then hits
  // the DB unique constraint → replay path executes → current episode returned, NO
  // version bump, idempotentReplay=true.
  const replay = await executeTransition({
    episodeId,
    fromState:         "processing",      // ORIGINAL fromState (same as first call intent)
    currentFsmVersion: versionAfterFirst, // current version (not used in replay path, but supplied)
    toState:           "ready",            // ORIGINAL toState — same key was used for this move
    idempotencyKey,                        // SAME key → triggers unique constraint → replay
    metadata:          "Test 4: replay attempt",
  });

  assert(replay.idempotentReplay === true,             "replay: idempotentReplay=true");
  assert(replay.episode.fsmVersion === versionAfterFirst, "replay: fsmVersion NOT bumped on replay");

  // Verify no new pipeline_events row was inserted
  const eventsAfter = await db
    .select()
    .from(pipelineEvents)
    .where(eq(pipelineEvents.episodeId, episodeId));

  assert(
    eventsAfter.length === eventCountBefore,
    "replay: no new pipeline_events row inserted",
  );
}

/**
 * test5_serviceBoundaryReplay — Verifies that a service-layer retry is handled as a replay.
 *
 * This is the exact scenario that was broken by the old INSERT-first design:
 *
 *   OLD (broken): assertValidTransition(currentFromState, originalToState) ran first.
 *   After a successful transition, currentFromState === originalToState (self-loop).
 *   Most self-loops are invalid → InvalidTransitionError thrown before replay check.
 *
 *   NEW (correct): SELECT-first replay check happens before assertValidTransition.
 *   Key found → return current episode, idempotentReplay=true. No error.
 *
 * Simulation of EpisodeService.transitionEpisode on retry:
 *   1. [Initial call, succeeds] episode draft → processing (key=K)
 *   2. [Retry] service fetches episode → currentState="processing"
 *   3. [Retry] service calls executeTransition(fromState=currentState, toState="processing", key=K)
 *   4. [Expected] SELECT finds key K → replay → no error, idempotentReplay=true
 *
 * Note: EpisodeService has `server-only` which prevents tsx import.
 * Steps 2–3 replicate its exact code path manually.
 */
async function test5_serviceBoundaryReplay(userId: string): Promise<void> {
  console.log("\n📋 Test 5: Service-boundary retry replay (SELECT-first key check)");

  // Create a fresh episode for this test
  const [testEpisode] = await db
    .insert(episodes)
    .values({
      ownerId:    userId,
      title:      `${RUN_ID} — T5 Service Replay`,
      state:      "draft",
      fsmVersion: 1,
    })
    .returning();

  const episodeId    = testEpisode!.id;
  const idempotencyKey = `${RUN_ID}-t5-service-retry-key`;
  const originalToState = "processing" as const;

  // ── Step A: Initial successful transition (draft → processing) ───────────────
  const first = await executeTransition({
    episodeId,
    fromState:         "draft",
    currentFsmVersion: 1,
    toState:           originalToState,
    idempotencyKey,
    metadata:          "Test 5: initial call",
  });

  assert(first.idempotentReplay === false,                    "T5 initial: idempotentReplay=false");
  assert(first.episode.state === "processing",                 "T5 initial: state='processing'");
  assert(first.episode.fsmVersion === 2,                      "T5 initial: fsmVersion=2");

  // ── Step B: Simulate service-layer retry ─────────────────────────────────────
  // EpisodeService.transitionEpisode does: episode = await repo.getEpisodeForOwner(id, ownerId)
  // Then calls: executeTransition({ fromState: episode.state, toState: input.toState, ... })
  // On retry, episode.state is NOW "processing" — same as the originalToState.
  const [currentEpisode] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))
    .limit(1);

  // This is exactly what the service passes on a retry:
  //   fromState = currentEpisode.state     ("processing" — updated by the first call)
  //   toState   = originalToState          ("processing" — from the caller's original input)
  //   key       = same idempotencyKey
  // Under the old design: assertValidTransition("processing", "processing") → InvalidTransitionError
  // Under the new design: SELECT finds key first → replay → no error
  const retry = await executeTransition({
    episodeId,
    fromState:         currentEpisode!.state,   // "processing" (from DB — service's fetch)
    currentFsmVersion: currentEpisode!.fsmVersion, // 2 (current)
    toState:           originalToState,            // "processing" (caller's original intent)
    idempotencyKey,                                // SAME key
    metadata:          "Test 5: retry attempt",
  });

  assert(
    retry.idempotentReplay === true,
    "T5 retry: idempotentReplay=true (SELECT-first key check fired before assertValidTransition)",
  );
  assert(
    retry.episode.state === "processing",
    "T5 retry: returned state='processing' (current state, unchanged)",
  );
  assert(
    retry.episode.fsmVersion === 2,
    "T5 retry: fsmVersion NOT bumped on replay (still 2)",
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("PodLever — FSM Verification Script (Phase 1A)");
  console.log("=".repeat(60));

  let userId: string | null = null;

  try {
    // Setup: create test user and episode
    console.log("\n🔧 Setting up test fixtures...");
    const fixtures = await setupTestFixtures();
    userId = fixtures.userId;
    const { episodeId } = fixtures;
    console.log(`   User ID:    ${userId}`);
    console.log(`   Episode ID: ${episodeId}`);

    // Test 1: valid transition
    const versionAfterT1 = await test1_validTransition(episodeId);

    // Test 2: invalid transition (no state change from test 1)
    await test2_invalidTransition(episodeId, versionAfterT1);

    // Test 3: stale version conflict (no state change from test 1)
    await test3_staleVersionConflict(episodeId, versionAfterT1);

    // Test 4: idempotent replay at executor level (advances from processing → ready)
    await test4_idempotentReplay(episodeId, versionAfterT1);

    // Test 5: service-boundary retry replay
    // Uses its own fresh episode; userId required for foreign key
    await test5_serviceBoundaryReplay(userId);

  } catch (err) {
    console.error("\n💥 Unexpected error in test harness:", err);
    _failed++;
  } finally {
    // Cleanup: remove all test fixtures
    if (userId) {
      console.log("\n🧹 Cleaning up test fixtures...");
      await cleanupTestFixtures(userId);
      console.log("   Cleanup complete.");
    }

    // Explicitly close the DB connection so the process exits cleanly (no hang)
    // We close the underlying pg pool from the drizzle instance
    const pool = (db as unknown as { $client: InstanceType<typeof Pool> }).$client;
    if (pool && typeof pool.end === "function") {
      await pool.end();
    }
  }

  // ── Final report ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${_passed} passed, ${_failed} failed`);
  console.log("=".repeat(60));

  if (_failed > 0) {
    console.error(`\n❌ ${_failed} assertion(s) failed — Phase 1A FSM verification INCOMPLETE`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${_passed} assertions passed — Phase 1A FSM verified`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
