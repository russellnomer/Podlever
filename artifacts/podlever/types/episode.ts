/**
 * types/episode.ts — Zod schemas and inferred TypeScript types for Episode domain
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: zod, ./common (shared validators)
 *
 * HUMAN REVIEW NOTES:
 * This is the single source of truth for Episode validation schemas.
 * Server Actions, Route Handlers, and Jobs all import from here — no
 * per-entry-point schema duplication.
 *
 * The EpisodeState type is re-exported from the DB schema enum to keep
 * the DB definition as the canonical source. Types here depend on DB schema
 * enums but never import Drizzle tables (schema ↔ db mapping stays in /db).
 */

import { z } from "zod";
import type { EpisodeState } from "@/db/schema/episodes";

// ─── Re-export DB-derived types ────────────────────────────────────────────────
// Re-export so callers import from @/types, not directly from @/db
export type { EpisodeState };

// ─── State enum for runtime validation ────────────────────────────────────────

/**
 * EpisodeStateSchema — Runtime Zod validation for episode state strings.
 * Matches the pgEnum values in /db/schema/episodes.ts.
 */
export const EpisodeStateSchema = z.enum([
  "draft",
  "processing",
  "ready",
  "published",
  "archived",
]);

// ─── Transition schemas ───────────────────────────────────────────────────────

/**
 * Valid FSM transitions. Defined as a type-safe map; the FSM runtime
 * in /server/fsm/ enforces these at the application layer.
 *
 * The DB unique constraint on pipeline_events is the second layer of defense.
 */
export const VALID_TRANSITIONS: Readonly<Record<EpisodeState, EpisodeState[]>> = {
  draft:      ["processing", "archived"],
  processing: ["ready", "archived"],
  ready:      ["published", "archived", "processing"], // allow re-process from ready
  published:  ["archived"],
  archived:   [], // terminal — no exits
} as const;

// ─── Input schemas ────────────────────────────────────────────────────────────

/**
 * CreateEpisodeSchema — Validates input for creating a new Episode.
 * Used by EpisodeService.createEpisode and the Server Action / Route Handler.
 */
export const CreateEpisodeSchema = z.object({
  /** Episode title. Required; stripped of leading/trailing whitespace. */
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(255, "Title must be 255 characters or fewer"),
});

/**
 * TransitionEpisodeSchema — Validates input for an FSM state transition request.
 * The caller must supply: episode ID, current fsm_version (for OCC), target state,
 * and a stable idempotency key.
 */
export const TransitionEpisodeSchema = z.object({
  /** UUID of the episode to transition. */
  episodeId: z.string().uuid("episodeId must be a valid UUID"),

  /**
   * Current fsm_version as known by the caller.
   * Must match the DB value — mismatch triggers OptimisticLockError.
   */
  currentFsmVersion: z.number().int().positive(),

  /** Target state for the transition. Validated against VALID_TRANSITIONS at runtime. */
  toState: EpisodeStateSchema,

  /**
   * Caller-supplied idempotency key.
   * Must be unique per transition intent; stable across retries.
   * Recommended format: crypto.randomUUID() generated once and persisted by the caller.
   */
  idempotencyKey: z.string().min(1).max(255),

  /** Optional metadata about what triggered this transition (job ID, user action, etc.). */
  metadata: z.string().optional(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

/** CreateEpisodeInput — validated create input type. */
export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;

/** TransitionEpisodeInput — validated transition input type. */
export type TransitionEpisodeInput = z.infer<typeof TransitionEpisodeSchema>;
