/**
 * server/fsm/executor.ts — Episode FSM transition executor
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (fixed idempotent replay at service boundary)
 *
 * HUMAN REVIEW NOTES:
 * Idempotency design — SELECT-first, key-gated:
 *
 * The idempotency check (SELECT pipeline_events WHERE episode_id + to_state + key)
 * happens BEFORE assertValidTransition. This is critical:
 *
 * Why key-first matters for real retries:
 *   1. Client calls transitionEpisode(draft→processing, key=K, version=1)
 *   2. Server transitions successfully. Episode is now in "processing" (version=2).
 *   3. Client times out (didn't receive the response). Retries with same input.
 *   4. Service fetches episode → fromState="processing" (current DB state).
 *   5. Service calls executeTransition(fromState="processing", toState="processing", key=K).
 *      [Note: toState is "processing" in the retry because that's what was in the original request]
 *
 * OLD (broken) design: assertValidTransition ran first → "processing→processing" is illegal
 * → InvalidTransitionError thrown before the idempotency check could fire.
 *
 * NEW (correct) design:
 *   1. SELECT pipeline_events WHERE (episode_id, to_state, key) — inside transaction
 *   2. If found → idempotent replay: fetch current episode, return it, NO writes
 *   3. If not found → assertValidTransition → INSERT event → UPDATE episode (OCC)
 *
 * Race condition safety:
 *   The SELECT-first check is inside a transaction. If two concurrent requests both
 *   pass the SELECT check (both see "not found"), the INSERT with ON CONFLICT DO NOTHING
 *   ensures only one succeeds. The losing INSERT returns no rows → treated as replay
 *   (rare concurrent-identical-request edge case; handled as a second-pass replay).
 *
 * Idempotency invariant: fsmVersion is NEVER incremented on a replay.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, pipelineEvents } from "@/db/schema";
import {
  EpisodeNotFoundError,
  OptimisticLockError,
} from "@/repositories";
import { assertValidTransition, InvalidTransitionError } from "./states";
import type { EpisodeState } from "@/types/episode";
import type { Episode } from "@/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecuteTransitionInput = {
  episodeId:         string;
  /**
   * Defense-in-depth: when provided, all episode SELECT and UPDATE queries include
   * an AND owner_id = ownerId predicate so a stale/leaked episodeId cannot be
   * transitioned by any entry point that bypasses the service-layer ownership check.
   *
   * Optional for backward compatibility with the verify-fsm script (which already
   * scopes to its own fixture user). Always provide from EpisodeService.
   */
  ownerId?:          string;
  fromState:         EpisodeState;  // current DB state (supplied by caller from their fetch)
  currentFsmVersion: number;         // OCC guard — must match DB for fresh transitions
  toState:           EpisodeState;  // requested target state
  idempotencyKey:    string;         // stable, unique-per-intent key; replay-safe across retries
  metadata?:         string | null;
};

export type TransitionResult = {
  episode:          Episode;
  idempotentReplay: boolean;
};

// ─── Executor ─────────────────────────────────────────────────────────────────

/**
 * executeTransition — Atomically execute an Episode FSM state transition.
 *
 * @throws InvalidTransitionError  — illegal state move (only for fresh requests; never on replay)
 * @throws EpisodeNotFoundError    — episode deleted between caller's fetch and this write
 * @throws OptimisticLockError     — concurrent write on fresh request; caller retries
 */
export async function executeTransition(
  input: ExecuteTransitionInput,
): Promise<TransitionResult> {
  const { episodeId, ownerId, fromState, currentFsmVersion, toState, idempotencyKey, metadata } = input;

  // Build owner-scoped episode condition (defense-in-depth when ownerId is provided)
  const episodeCondition = ownerId
    ? and(eq(episodes.id, episodeId), eq(episodes.ownerId, ownerId))
    : eq(episodes.id, episodeId);

  return db.transaction(async (tx) => {

    // ── Step 1: Key-first replay check (BEFORE transition validation) ───────────
    // Query the exact (episode_id, to_state, idempotency_key) triple.
    // If found, this request was already processed — return current state, no writes.
    //
    // Why before assertValidTransition:
    //   On a service-layer retry, the episode is already in toState.
    //   The service passes the current (updated) fromState, making fromState===toState.
    //   Most self-loops are invalid transitions — we'd throw before reaching idempotency.
    //   By checking the key first, replays always succeed regardless of current state.
    const [existingEvent] = await tx
      .select({ id: pipelineEvents.id })
      .from(pipelineEvents)
      .where(
        and(
          eq(pipelineEvents.episodeId, episodeId),
          eq(pipelineEvents.toState, toState),
          eq(pipelineEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (existingEvent) {
      // Idempotent replay path — the work was already done.
      // Fetch and return the current episode state (no version bump, no writes).
      // Use owner-scoped condition for defense-in-depth on the read.
      const [current] = await tx
        .select()
        .from(episodes)
        .where(episodeCondition)
        .limit(1);

      if (!current) throw new EpisodeNotFoundError(episodeId);
      return { episode: current, idempotentReplay: true };
    }

    // ── Step 2: Validate the transition (fresh requests only) ───────────────────
    // Only runs if the key is NOT already in the DB — i.e., this is genuinely new.
    // InvalidTransitionError thrown here means a caller bug, not a replay scenario.
    assertValidTransition(fromState, toState);

    // ── Step 3: INSERT pipeline event (idempotency gate for concurrent duplicates) ─
    // ON CONFLICT DO NOTHING handles the rare case where two concurrent fresh requests
    // both pass the Step 1 SELECT before either inserts.
    const [insertedEvent] = await tx
      .insert(pipelineEvents)
      .values({
        episodeId,
        fromState,
        toState,
        idempotencyKey,
        metadata: metadata ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!insertedEvent) {
      // Concurrent race: another request inserted between our SELECT and INSERT.
      // Treat as replay — fetch current state and return.
      const [current] = await tx
        .select()
        .from(episodes)
        .where(episodeCondition)
        .limit(1);

      if (!current) throw new EpisodeNotFoundError(episodeId);
      return { episode: current, idempotentReplay: true };
    }

    // ── Step 4: UPDATE episodes with OCC guard (fresh transition only) ──────────
    // WHERE id = episodeId [AND owner_id = ownerId] AND fsm_version = currentFsmVersion
    // ownerId predicate adds defense-in-depth: only the owning user's episodes can transition.
    // 0 rows updated → version mismatch OR wrong owner → OptimisticLockError
    // Transaction rolls back: the INSERT above is also rolled back; key not consumed.
    const [updatedEpisode] = await tx
      .update(episodes)
      .set({
        state:      toState,
        fsmVersion: currentFsmVersion + 1,
        updatedAt:  new Date(),
      })
      .where(
        and(
          episodeCondition,
          eq(episodes.fsmVersion, currentFsmVersion),
        ),
      )
      .returning();

    if (!updatedEpisode) {
      const [exists] = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .limit(1);

      if (!exists) throw new EpisodeNotFoundError(episodeId);
      throw new OptimisticLockError(episodeId, currentFsmVersion);
    }

    return { episode: updatedEpisode, idempotentReplay: false };
  });
}

export { InvalidTransitionError, EpisodeNotFoundError, OptimisticLockError };
