/**
 * episode.repository.ts — Data access layer for Episode and PipelineEvent entities
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: drizzle-orm (query builder), @/db (pool + DbTx type), @/db/schema
 *
 * HUMAN REVIEW NOTES:
 * Repositories expose DOMAIN-ORIENTED methods, not generic CRUD.
 * Every method that writes to the DB accepts an optional `tx` (DbTx) parameter
 * so that callers (services, FSM) can compose operations into a single transaction.
 *
 * This repository is the ONLY code that:
 *   - Imports drizzle-orm operators (eq, and, sql, etc.)
 *   - Writes to the `episodes` or `pipeline_events` tables
 *
 * The FSM transition (transitionEpisodeState) is the most critical method here.
 * It does TWO things in ONE transaction:
 *   1. UPDATE episodes SET state = toState, fsm_version = currentVersion + 1
 *      WHERE id = episodeId AND fsm_version = currentVersion
 *      (if 0 rows updated → OptimisticLockError)
 *   2. INSERT INTO pipeline_events (idempotency_key, ...)
 *      ON CONFLICT DO NOTHING
 *      (if conflict → idempotent replay, return success without new event)
 *
 * The caller (EpisodeService / FSM) always wraps these two in a transaction.
 */

// Note: server-only guard is enforced at the service layer (the UI boundary).
// Repositories are internal — protected transitively by the service guard.

import { and, eq, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  episodes,
  pipelineEvents,
  type Episode,
  type NewEpisode,
  type EpisodeState,
  type PipelineEvent,
  type NewPipelineEvent,
} from "@/db/schema";

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * EpisodeNotFoundError — thrown when an episode row cannot be found.
 * Typed so callers can distinguish "not found" from generic DB errors.
 */
export class EpisodeNotFoundError extends Error {
  readonly kind = "EpisodeNotFoundError" as const;
  constructor(episodeId: string) {
    super(`Episode not found: ${episodeId}`);
  }
}

/**
 * OptimisticLockError — thrown when a state transition is rejected because the
 * caller's fsm_version does not match the current DB value.
 *
 * This means another writer modified the episode between when the caller
 * read it and when it attempted the transition. The caller should re-fetch
 * and retry (with a new idempotency key if needed).
 */
export class OptimisticLockError extends Error {
  readonly kind = "OptimisticLockError" as const;
  constructor(episodeId: string, expectedVersion: number) {
    super(
      `Optimistic lock conflict on episode ${episodeId}: expected fsm_version=${expectedVersion} but row was modified concurrently.`,
    );
  }
}

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * EpisodeRepository — domain-oriented data access for episodes and pipeline events.
 *
 * Instantiated once and injected into EpisodeService.
 * All methods are async and return strongly-typed domain objects.
 */
export class EpisodeRepository {
  /**
   * createEpisode — Insert a new episode row and return the created record.
   *
   * @param input - Episode fields to insert (title, ownerId, etc.)
   * @param tx    - Optional transaction; if provided, insert runs within it
   * @returns     The fully-hydrated newly created Episode row
   *
   * Business context: Called by EpisodeService.createEpisode after authorization check.
   * fsmVersion defaults to 1 (set in schema); state defaults to "draft".
   */
  async createEpisode(input: NewEpisode, tx?: DbTx): Promise<Episode> {
    const client = tx ?? db;
    const [created] = await client
      .insert(episodes)
      .values(input)
      .returning();

    // Returning clause always yields one row on successful insert
    return created!;
  }

  /**
   * getEpisodeForOwner — Fetch a single episode, scoped to a specific owner.
   *
   * @param episodeId - UUID of the episode to fetch
   * @param ownerId   - UUID of the requesting user (owner-scoping for security)
   * @param tx        - Optional transaction
   * @returns         The episode row if found and owned by ownerId
   * @throws          EpisodeNotFoundError if no matching row exists
   *
   * Business context: All episode reads in Phase 1A are owner-scoped.
   * This prevents one user from reading another's episodes even if they
   * somehow have a valid UUID (defense-in-depth below the service auth check).
   */
  async getEpisodeForOwner(
    episodeId: string,
    ownerId: string,
    tx?: DbTx,
  ): Promise<Episode> {
    const client = tx ?? db;
    const [row] = await client
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, episodeId),
          eq(episodes.ownerId, ownerId), // owner-scoped — never removed
        ),
      )
      .limit(1);

    if (!row) {
      throw new EpisodeNotFoundError(episodeId);
    }
    return row;
  }

  /**
   * listEpisodesForOwner — Fetch all non-archived episodes for an owner.
   *
   * @param ownerId - UUID of the requesting user
   * @param tx      - Optional transaction
   * @returns       Array of Episode rows, ordered by creation date (newest first)
   *
   * Business context: Used by the owner dashboard to display active episodes.
   * Archived episodes are excluded; use a separate query for the archive view.
   */
  async listEpisodesForOwner(ownerId: string, tx?: DbTx): Promise<Episode[]> {
    const client = tx ?? db;
    return client
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.ownerId, ownerId),
          // Exclude archived — archived episodes are soft-deleted from normal views
          // Using sql template to compare enum column without importing the enum value
          sql`${episodes.state} != 'archived'`,
        ),
      )
      .orderBy(sql`${episodes.createdAt} DESC`);
  }

  /**
   * transitionEpisodeState — Atomically update episode state with optimistic locking.
   *
   * This is the FSM write primitive. It MUST be called within a transaction that
   * also calls appendPipelineEvent — the two operations are always atomic.
   *
   * @param episodeId      - UUID of the episode to transition
   * @param currentVersion - Expected current fsm_version (optimistic lock value)
   * @param toState        - The target state to transition to
   * @param tx             - REQUIRED transaction (caller must provide one)
   * @returns              The updated Episode row
   * @throws               OptimisticLockError if fsm_version mismatch (concurrent write)
   * @throws               EpisodeNotFoundError if no row updated (episode deleted or wrong owner)
   *
   * Business context: The WHERE clause includes fsm_version = currentVersion.
   * If another process already transitioned this episode, the UPDATE matches 0 rows,
   * and we throw OptimisticLockError. Caller retries with fresh data and a new key.
   *
   * Side effects: increments fsm_version, updates state and updatedAt in one SQL statement.
   */
  async transitionEpisodeState(
    episodeId: string,
    currentVersion: number,
    toState: EpisodeState,
    tx: DbTx, // transaction is mandatory for this method — never optional
  ): Promise<Episode> {
    const [updated] = await tx
      .update(episodes)
      .set({
        state: toState,
        // Atomically increment the version — prevents concurrent transitions
        fsmVersion: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(episodes.id, episodeId),
          // Optimistic lock: reject if another writer already changed the version
          eq(episodes.fsmVersion, currentVersion),
        ),
      )
      .returning();

    if (!updated) {
      // 0 rows updated: either the episode doesn't exist or the version was stale
      // Distinguish between the two by attempting a plain fetch
      const [exists] = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .limit(1);

      if (!exists) {
        throw new EpisodeNotFoundError(episodeId);
      }
      // Row exists but version didn't match → concurrent write detected
      throw new OptimisticLockError(episodeId, currentVersion);
    }

    return updated;
  }

  /**
   * appendPipelineEvent — Insert an immutable pipeline event record.
   *
   * On a duplicate idempotency key (same episode_id + to_state + idempotency_key),
   * the INSERT silently does nothing and returns null — idempotent replay.
   * The caller treats null as "already done, success".
   *
   * @param event - Pipeline event fields to insert
   * @param tx    - Optional transaction (SHOULD be provided alongside transitionEpisodeState)
   * @returns     The newly inserted PipelineEvent, or null if idempotent replay
   *
   * Business context: Always called in the same transaction as transitionEpisodeState.
   * If the transaction rolls back (e.g., OptimisticLockError from the UPDATE), this
   * INSERT also rolls back — no orphan events are ever created.
   *
   * IMPORTANT: This table is APPEND-ONLY. Never add UPDATE or DELETE calls here.
   */
  async appendPipelineEvent(
    event: NewPipelineEvent,
    tx?: DbTx,
  ): Promise<PipelineEvent | null> {
    const client = tx ?? db;

    // ON CONFLICT DO NOTHING: the DB unique constraint handles idempotency.
    // If a row with the same (episode_id, to_state, idempotency_key) already exists,
    // the INSERT is silently skipped and `returning()` yields an empty array.
    const [inserted] = await client
      .insert(pipelineEvents)
      .values(event)
      .onConflictDoNothing()
      .returning();

    // null → idempotent replay (event already exists); not an error
    return inserted ?? null;
  }

  /**
   * listPipelineEventsForEpisode — Fetch the full FSM event history for an episode.
   *
   * @param episodeId - UUID of the episode
   * @param tx        - Optional transaction
   * @returns         Array of PipelineEvent rows, chronological order (oldest first)
   *
   * Business context: Used for audit display and debugging FSM state.
   * In Phase 1B+, this feeds webhook replay and analytics.
   */
  async listPipelineEventsForEpisode(
    episodeId: string,
    tx?: DbTx,
  ): Promise<PipelineEvent[]> {
    const client = tx ?? db;
    return client
      .select()
      .from(pipelineEvents)
      .where(eq(pipelineEvents.episodeId, episodeId))
      .orderBy(sql`${pipelineEvents.createdAt} ASC`);
  }
}

/** episodeRepository — singleton instance for use throughout the application. */
export const episodeRepository = new EpisodeRepository();
