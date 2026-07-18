/**
 * services/episode.service.ts — Business logic orchestration for Episodes
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T8 complete + T7 owner guard wired)
 *
 * Dependencies:
 *   @/repositories — EpisodeRepository + error types
 *   @/server/fsm — executeTransition
 *   @/types/episode — schemas and input types
 *
 * HUMAN REVIEW NOTES:
 * The service layer is context-agnostic: it trusts the `ownerId` provided by
 * the caller rather than reading from the HTTP request context.
 *
 * This design allows:
 *   - Server Actions: call requireOwner() → pass userId to service
 *   - Background jobs (Phase 1B): use a known owner ID from job metadata
 *   - Scripts (verify-fsm.ts): pass a test fixture user ID
 *
 * Authorization is enforced at the entry point (Server Action) via requireOwner().
 * The repository layer provides a second defense via owner-scoped queries.
 *
 * Services do NOT:
 *   - Import Drizzle tables or operators directly
 *   - Read process.env (use @/config via repositories/db)
 *   - Render UI or return HTTP responses
 *   - Call cookies() or read the request context
 */

import "server-only";

import { episodeRepository } from "@/repositories";
import { executeTransition } from "@/server/fsm";
import {
  CreateEpisodeSchema,
  TransitionEpisodeSchema,
  type CreateEpisodeInput,
  type TransitionEpisodeInput,
} from "@/types/episode";
import type { Episode } from "@/db/schema";
import type { TransitionResult } from "@/server/fsm";

/**
 * EpisodeService — orchestrates episode lifecycle operations.
 *
 * All methods accept `ownerId: string` (the DB UUID of the authenticated owner)
 * supplied by the entry point (Server Action or job handler) after auth verification.
 */
export class EpisodeService {
  /**
   * createEpisode — Create a new episode in draft state.
   *
   * @param rawInput - Unvalidated episode data (title, etc.)
   * @param ownerId  - DB user ID of the authenticated owner
   * @returns The newly created Episode row
   *
   * Business context: Entry point for the podcast production pipeline.
   * Every episode starts in "draft" state with fsm_version=1.
   * The caller (Server Action) has already verified ownership via requireOwner().
   */
  async createEpisode(
    rawInput: unknown,
    ownerId: string,
  ): Promise<Episode> {
    // Validate input — schema is the single source of truth for allowed fields
    const input: CreateEpisodeInput = CreateEpisodeSchema.parse(rawInput);

    return episodeRepository.createEpisode({
      title:   input.title,
      ownerId,
      // state defaults to "draft", fsmVersion defaults to 1 (set in schema)
    });
  }

  /**
   * getEpisode — Fetch a single episode, scoped to the requesting owner.
   *
   * @param episodeId - UUID of the episode to fetch
   * @param ownerId   - DB user ID of the requesting owner
   * @returns         The episode row
   * @throws          EpisodeNotFoundError if not found or wrong owner
   */
  async getEpisode(episodeId: string, ownerId: string): Promise<Episode> {
    return episodeRepository.getEpisodeForOwner(episodeId, ownerId);
  }

  /**
   * listEpisodes — List all active episodes for the requesting owner.
   *
   * @param ownerId - DB user ID of the requesting owner
   * @returns       Array of episodes (draft, processing, ready, published — not archived)
   */
  async listEpisodes(ownerId: string): Promise<Episode[]> {
    return episodeRepository.listEpisodesForOwner(ownerId);
  }

  /**
   * transitionEpisode — Execute a validated, authorized FSM state transition.
   *
   * @param rawInput - Unvalidated transition request (episodeId, toState, etc.)
   * @param ownerId  - DB user ID of the requesting owner
   * @returns        TransitionResult with updated episode and idempotentReplay flag
   *
   * @throws InvalidTransitionError — illegal state move
   * @throws EpisodeNotFoundError   — episode not found or wrong owner
   * @throws OptimisticLockError    — concurrent write; caller should retry
   *
   * Business context: This is the only legitimate entry point for episode state changes.
   * The FSM executor handles the atomic DB write (UPDATE + INSERT in one transaction).
   */
  async transitionEpisode(
    rawInput: unknown,
    ownerId: string,
  ): Promise<TransitionResult> {
    // Validate input schema
    const input: TransitionEpisodeInput = TransitionEpisodeSchema.parse(rawInput);

    // Fetch episode to verify ownership AND get the current fromState.
    // The getEpisodeForOwner call throws EpisodeNotFoundError if the episode
    // doesn't exist or doesn't belong to this owner.
    const episode = await episodeRepository.getEpisodeForOwner(
      input.episodeId,
      ownerId,
    );

    // Delegate the atomic write to the FSM executor.
    // fromState is authoritative from the DB fetch above.
    return executeTransition({
      episodeId:         input.episodeId,
      fromState:         episode.state,
      currentFsmVersion: input.currentFsmVersion,
      toState:           input.toState,
      idempotencyKey:    input.idempotencyKey,
      metadata:          input.metadata ?? null,
    });
  }
}

/** episodeService — singleton service instance. */
export const episodeService = new EpisodeService();
