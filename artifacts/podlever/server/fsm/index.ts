/**
 * server/fsm/index.ts — Barrel export for the Episode FSM module
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Import pattern for callers (EpisodeService only):
 *   import { executeTransition, InvalidTransitionError } from "@/server/fsm";
 */

export { executeTransition } from "./executor";
export type { TransitionResult } from "./executor";
export { assertValidTransition, isValidTransition, InvalidTransitionError } from "./states";
