/**
 * pipeline-events.ts — Drizzle schema for the `pipeline_events` table
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: drizzle-orm/pg-core, ./episodes (foreign key)
 *
 * HUMAN REVIEW NOTES:
 * This table is APPEND-ONLY. There are zero UPDATE or DELETE code paths
 * anywhere in PodLever for this table. This is enforced by convention (no
 * update/delete methods on PipelineEventRepository) and should be enforced
 * by a PostgreSQL row-level security policy in Phase 1B+.
 *
 * The unique constraint on (episode_id, to_state, idempotency_key) is the
 * source of truth for idempotency — NOT application-level pre-checks.
 * When a duplicate INSERT is attempted, PostgreSQL returns a unique violation
 * (error code 23505), which the FSM transition function treats as a no-op
 * success (idempotent replay). See /server/fsm/ for implementation.
 *
 * Why no `from_state` in the unique constraint?
 * An idempotency_key represents a specific caller intent ("transition THIS
 * episode to THIS state"). The from_state is implicit context, not part of
 * the identity of the intent. Including it would allow the same key to
 * produce two events if the same transition were attempted from different
 * starting states (a logic error, not an idempotent replay).
 */

import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { episodes } from "./episodes";
import { type EpisodeState } from "./episodes";

// ─── Table ───────────────────────────────────────────────────────────────────

/**
 * pipelineEvents — Immutable audit log of all Episode FSM transitions.
 *
 * One row is inserted per successful state transition. This log is the
 * authoritative history of what happened to each episode and when.
 * It is used for:
 *   - Audit trail (who did what, when)
 *   - Idempotency enforcement (duplicate transition detection)
 *   - Future analytics (pipeline throughput, bottleneck detection)
 *   - Webhook replays (replay last N events to recover from outage)
 *
 * NEVER update or delete rows in this table.
 */
export const pipelineEvents = pgTable(
  "pipeline_events",
  {
    /** Surrogate primary key. */
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * The episode this event belongs to.
     * Cascade-deletes events if an episode is hard-deleted (rare edge case).
     */
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),

    /**
     * The state the episode was in BEFORE this transition.
     * Stored as text (not enum FK) to remain readable even if the enum evolves.
     */
    fromState: text("from_state").notNull().$type<EpisodeState>(),

    /**
     * The state the episode moved TO in this transition.
     * Part of the unique constraint — an idempotency_key may only move
     * an episode to a given to_state once.
     */
    toState: text("to_state").notNull().$type<EpisodeState>(),

    /**
     * Caller-supplied idempotency key.
     *
     * Rules for callers:
     *   - Must be unique per intended transition attempt (e.g., UUID v4 generated once)
     *   - Must be stable across retries of the same operation
     *   - Never reuse a key for a different transition intent
     *
     * The FSM treats a duplicate (episode_id, to_state, idempotency_key) as
     * an idempotent replay → no-op success, no new event, no version bump.
     *
     * Phase 1B: job handlers will generate keys from job_id + step_name
     * to ensure retried jobs don't double-emit events.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    /**
     * Optional metadata about what triggered this transition.
     * Free-form JSON string for extensibility (job ID, user action label, etc.).
     * Nullable — not all transitions have additional context in Phase 1A.
     */
    metadata: text("metadata"),

    /**
     * Transition timestamp. Indexed implicitly via the primary key.
     * Append-only: this value never changes after INSERT.
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // ─── Constraints ─────────────────────────────────────────────────────────────
  (table) => [
    /**
     * Idempotency unique constraint — the database-level guard.
     *
     * Prevents duplicate events for the same (episode, target state, caller key).
     * This is the authoritative idempotency mechanism — not application checks.
     * See HUMAN REVIEW NOTES above for design rationale.
     */
    unique("pipeline_events_idempotency_key")
      .on(table.episodeId, table.toState, table.idempotencyKey),
  ],
);

// ─── TypeScript types ─────────────────────────────────────────────────────────

/** PipelineEvent — a fully-hydrated pipeline event row. */
export type PipelineEvent = typeof pipelineEvents.$inferSelect;

/** NewPipelineEvent — shape required to insert a new pipeline event row. */
export type NewPipelineEvent = typeof pipelineEvents.$inferInsert;
