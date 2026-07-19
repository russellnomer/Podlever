/**
 * db/schema/episode-cogs.ts — Per-call AI cost tracking (COGS)
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Week-1 cost audit)
 *
 * One row per AI API call during episode processing.
 * Provides exact token counts and estimated USD cost per step per episode.
 *
 * HUMAN REVIEW NOTES:
 * - cost_usd is an estimate based on published pricing at write time.
 *   Actual billing comes from the AI Integrations proxy / Replit credits.
 * - audio_seconds is populated for Whisper calls (cost is duration-based).
 * - tokens_in / tokens_out are null for Whisper; populated for chat completions.
 * - This table is append-only — no deletes. CASCADE on episode delete for GDPR.
 */

import { integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users }    from "./users";
import { episodes } from "./episodes";

// ─── Step constants ───────────────────────────────────────────────────────────

export const COGS_STEPS = [
  "transcription",
  "show_notes",
  "blog_post",
  "social_post",
  "guest_media_pack",
  "audio_cleanup",
  "pdf_generation",
  "asset_regeneration",
] as const;

export type CogsStep = (typeof COGS_STEPS)[number];

// ─── Table ────────────────────────────────────────────────────────────────────

export const episodeCogs = pgTable("episode_cogs", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Parent episode. CASCADE delete keeps GDPR clean. */
  episodeId: uuid("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),

  /** User who owns this episode (denormalized for efficient admin queries). */
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  /**
   * Pipeline step that triggered this API call.
   * One of COGS_STEPS — stored as text (no migration needed for new steps).
   */
  step: text("step").notNull(),

  /** Model name, e.g. "gpt-4o-mini-transcribe" or "gpt-5.6-luna". */
  model: text("model").notNull(),

  /** Input tokens (null for Whisper, which is priced by audio duration). */
  tokensIn: integer("tokens_in"),

  /** Output tokens (null for Whisper). */
  tokensOut: integer("tokens_out"),

  /** Audio duration in seconds (populated for Whisper transcription calls). */
  audioSeconds: integer("audio_seconds"),

  /**
   * Estimated USD cost for this call.
   * Precision: 10 digits total, 6 decimal places (sub-cent accuracy).
   * Example: 0.003000 = $0.003 for a 30-second Whisper call.
   */
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EpisodeCogs    = typeof episodeCogs.$inferSelect;
export type NewEpisodeCogs = typeof episodeCogs.$inferInsert;
