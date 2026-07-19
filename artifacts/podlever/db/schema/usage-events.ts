/**
 * db/schema/usage-events.ts — Usage metering table
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #57 — Usage metering per user)
 *
 * Append-only log of billable events. One row per metered action.
 * The current period count is derived by querying `created_at >= periodStart`.
 *
 * Phase 1B scope: only `episode_processed` events.
 * Phase 2 (Stripe): period reset on billing webhook; per-asset-type metering.
 *
 * HUMAN REVIEW NOTES:
 * - No deletes — this is an immutable audit trail.
 * - The `episode_id` FK is nullable so non-episode events can be added later.
 * - Index on (user_id, created_at) for efficient period queries.
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users }    from "./users";
import { episodes } from "./episodes";

// ─── Event type constants ─────────────────────────────────────────────────────

/**
 * USAGE_EVENT_TYPES — valid event_type values for usage_events rows.
 * Extend this list (no migration needed — stored as text) as new billable
 * actions are added.
 */
export const USAGE_EVENT_TYPES = ["episode_processed", "asset_regenerated"] as const;
export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

// ─── Table ─────────────────────────────────────────────────────────────────

/**
 * usageEvents — immutable, append-only metering log.
 *
 * Written by the processing pipeline on successful episode completion.
 * Read by UsageRepository to compute period totals for upload gating.
 */
export const usageEvents = pgTable("usage_events", {
  /** Surrogate primary key. */
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * User who owns this consumption event.
   * References users.id — CASCADE on user delete (GDPR cleanup).
   */
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  /**
   * Episode that triggered this event. Nullable for future non-episode events.
   * References episodes.id — SET NULL if episode deleted.
   */
  episodeId: uuid("episode_id")
    .references(() => episodes.id, { onDelete: "set null" }),

  /**
   * Type of billable event. Stored as text (not pgEnum) so new types can be
   * added without a column-type migration.
   * Valid values: USAGE_EVENT_TYPES constant.
   */
  eventType: text("event_type").notNull().default("episode_processed"),

  /** ISO timestamp of when the event occurred. Index target for period queries. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UsageEvent    = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
