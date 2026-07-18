/**
 * server/fsm/states.ts — Episode FSM state definitions and transition validation
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: @/types/episode (VALID_TRANSITIONS, EpisodeState)
 *
 * HUMAN REVIEW NOTES:
 * This module owns the runtime transition guard (assertValidTransition) and the
 * typed domain error for illegal moves. It is `server-only` because it imports
 * from server-only modules and is never needed by client components.
 *
 * VALID_TRANSITIONS lives in /types/episode.ts (shared, not server-only) so that
 * UI components can import the state vocabulary without pulling in server code.
 * This module re-exports it for convenience so callers import from one place.
 */

// Note: server-only guard enforced at service layer.

import { VALID_TRANSITIONS } from "@/types/episode";
import type { EpisodeState } from "@/types/episode";

export { VALID_TRANSITIONS };

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * InvalidTransitionError — thrown when a caller requests an illegal FSM move.
 *
 * This is a domain error, not a DB error. It means the requested
 * fromState → toState path is not in VALID_TRANSITIONS.
 *
 * The error carries the offending states so callers can surface a precise message.
 */
export class InvalidTransitionError extends Error {
  readonly kind = "InvalidTransitionError" as const;
  readonly fromState: EpisodeState;
  readonly toState: EpisodeState;

  constructor(fromState: EpisodeState, toState: EpisodeState) {
    const allowed = VALID_TRANSITIONS[fromState];
    const allowedStr =
      allowed.length > 0
        ? allowed.join(", ")
        : "(none — terminal state)";

    super(
      `Invalid FSM transition: "${fromState}" → "${toState}". ` +
        `Allowed exits from "${fromState}": ${allowedStr}`,
    );
    this.fromState = fromState;
    this.toState = toState;
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * assertValidTransition — validate a proposed transition; throw if invalid.
 *
 * @param fromState - Current episode state
 * @param toState   - Requested target state
 * @throws InvalidTransitionError if the move is not in VALID_TRANSITIONS
 *
 * Business context: Called by the FSM executor before any DB write.
 * Fast rejection path — no DB round-trip, cheap.
 */
export function assertValidTransition(
  fromState: EpisodeState,
  toState: EpisodeState,
): void {
  const allowed: readonly EpisodeState[] = VALID_TRANSITIONS[fromState] ?? [];
  if (!allowed.includes(toState)) {
    throw new InvalidTransitionError(fromState, toState);
  }
}

/**
 * isValidTransition — non-throwing check, useful for UI guards.
 *
 * @param fromState - Current episode state
 * @param toState   - Requested target state
 * @returns true if the transition is in VALID_TRANSITIONS
 */
export function isValidTransition(
  fromState: EpisodeState,
  toState: EpisodeState,
): boolean {
  const allowed: readonly EpisodeState[] = VALID_TRANSITIONS[fromState] ?? [];
  return allowed.includes(toState);
}
