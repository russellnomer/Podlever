/**
 * app/actions/episode.actions.ts — Server Actions for Episode operations
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T7 — Owner role protection)
 *
 * Dependencies: @/providers/owner-guard, @/services/episode.service
 *
 * HUMAN REVIEW NOTES:
 * Server Actions are the ONLY mutation entry point in Phase 1A (no Route Handlers).
 * This enforces the T3 Decision B: "Server Actions only — no Route Handlers in Phase 1A."
 *
 * Every action:
 *   1. Calls requireOwner() — throws UnauthorizedError or ForbiddenError if not owner
 *   2. Delegates to the service layer with the authenticated userId
 *   3. Returns the result or re-throws typed errors for the UI to handle
 *
 * Error handling contract for UI callers:
 *   - UnauthorizedError (401): redirect to /auth/login
 *   - ForbiddenError (403): show "access denied" message
 *   - EpisodeNotFoundError: show "not found" message
 *   - OptimisticLockError: prompt user to refresh and retry
 *   - InvalidTransitionError: show which transitions are valid
 *   - ZodError: form validation failed — show field errors
 *
 * "use server" directive marks these as Server Actions for Next.js.
 * They are serialized function references — never imported by client code directly.
 */

"use server";

import { z } from "zod";
import { requireOwner } from "@/providers/owner-guard";
import { episodeService } from "@/services";
import type { Episode } from "@/db/schema";
import type { TransitionResult } from "@/server/fsm";

/** Reusable UUID validator for episodeId parameters */
const EpisodeIdSchema = z.string().uuid("episodeId must be a valid UUID");

/**
 * createEpisodeAction — Create a new episode in draft state.
 *
 * @param input - Raw episode data (validated by EpisodeService via Zod)
 * @returns The newly created Episode row
 * @throws UnauthorizedError, ForbiddenError, ZodError
 */
export async function createEpisodeAction(
  input: unknown,
): Promise<Episode> {
  const { userId } = await requireOwner();
  return episodeService.createEpisode(input, userId);
}

/**
 * listEpisodesAction — List all active episodes for the authenticated owner.
 *
 * @returns Array of episodes (draft, processing, ready, published — not archived)
 * @throws UnauthorizedError, ForbiddenError
 */
export async function listEpisodesAction(): Promise<Episode[]> {
  const { userId } = await requireOwner();
  return episodeService.listEpisodes(userId);
}

/**
 * getEpisodeAction — Fetch a single episode by ID for the authenticated owner.
 *
 * @param episodeId - UUID of the episode
 * @returns The episode row
 * @throws UnauthorizedError, ForbiddenError, EpisodeNotFoundError
 */
export async function getEpisodeAction(episodeId: string): Promise<Episode> {
  const { userId } = await requireOwner();
  // Validate UUID format before passing to the DB layer — prevents malformed UUIDs
  // from reaching PostgreSQL and leaking DB error details to the caller.
  const validatedId = EpisodeIdSchema.parse(episodeId);
  return episodeService.getEpisode(validatedId, userId);
}

/**
 * transitionEpisodeAction — Execute a validated FSM state transition.
 *
 * @param input - Transition request (episodeId, toState, idempotencyKey, currentFsmVersion)
 * @returns TransitionResult with updated episode and idempotentReplay flag
 * @throws UnauthorizedError, ForbiddenError, InvalidTransitionError, OptimisticLockError
 */
export async function transitionEpisodeAction(
  input: unknown,
): Promise<TransitionResult> {
  const { userId } = await requireOwner();
  return episodeService.transitionEpisode(input, userId);
}
