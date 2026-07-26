/**
 * episodes.ts — Drizzle schema for the `episodes` table
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: drizzle-orm/pg-core, ./users (foreign key)
 *
 * HUMAN REVIEW NOTES:
 * `fsm_version` is the optimistic-lock counter. Every FSM transition atomically
 * increments it. Any writer holding a stale version gets a typed conflict error —
 * no partial writes, no lost updates.
 *
 * `state` uses a pgEnum — invalid states are rejected at the DB level.
 * The state vocabulary is intentionally minimal in Phase 1A; additive extension
 * is straightforward (add enum value, add transition in FSM).
 *
 * The `owner_id` FK references users(id) — episodes are always owned.
 * No shared/unowned episodes in Phase 1A.
 */

import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// ─── Enums ───────────────────────────────────────────────────────────────────

/**
 * episodeStateEnum — Valid states in the Episode FSM.
 *
 * Transition map (enforced in /server/fsm/):
 *   draft → processing → ready → published
 *   Any state → archived (terminal; no exits)
 *   draft → archived (direct archive before processing)
 *
 * "ready" = all assets generated and awaiting owner review.
 * "published" = assets approved and distributed.
 * "archived" = soft-deleted; excluded from normal queries.
 *
 * Phase 1B+ may add: "failed" (processing error), "paused" (owner hold).
 */
export const episodeStateEnum = pgEnum("episode_state", [
  "draft",       // Initial state: metadata entered, no processing started
  "processing",  // Background jobs running (transcription, clip generation, etc.)
  "ready",       // All assets generated; awaiting owner review
  "published",   // Owner approved; assets distributed to all channels
  "archived",    // Soft-deleted; excluded from active queries
]);

// ─── Table ───────────────────────────────────────────────────────────────────

/**
 * episodes — Podcast episode records, the central domain entity.
 *
 * Each episode tracks one recording through the full production pipeline.
 * The FSM controls which state transitions are valid; direct SQL updates
 * to `state` or `fsm_version` outside the FSM are prohibited.
 */
export const episodes = pgTable("episodes", {
  /** Surrogate primary key. */
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * Foreign key to the owning user.
   * Phase 1A: always Russell's user row.
   * Phase 1B+: multi-user support would relax this to a team/workspace concept.
   */
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  /** Human-readable episode title. Required; validated in the Service layer. */
  title: text("title").notNull(),

  /**
   * Current FSM state.
   * ONLY updated by the FSM transition function — never raw SQL.
   */
  state: episodeStateEnum("state").notNull().default("draft"),

  /**
   * Optimistic-lock version counter.
   * Incremented atomically with every FSM transition.
   * Writers must supply the current version; mismatch → OptimisticLockError.
   * Starts at 1 (not 0) so that any zeroed/missing version fails immediately.
   */
  fsmVersion: integer("fsm_version").notNull().default(1),

  /** Row creation timestamp. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /**
   * GCS object key for the uploaded raw audio file.
   * Set after the owner uploads audio; null until then.
   * Example: "audio/{episodeId}/original.mp3"
   */
  audioStorageKey: text("audio_storage_key"),

  /** Last FSM transition timestamp. Updated on every state change. */
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /**
   * GCS object key for the enhanced audio file.
   * Set by the processing pipeline after audio enhancement.
   * Null until enhancement completes (or if no provider ran).
   * Example: "audio/{episodeId}/cleaned.wav"
   */
  cleanedAudioStorageKey: text("cleaned_audio_storage_key"),

  /**
   * Random UUID token for the public shareable episode page (/share/[token]).
   * Generated on demand via POST /api/episodes/[id]/share-token.
   * Null until the owner explicitly enables sharing.
   */
  shareToken: uuid("share_token").unique(),

  /**
   * Current pipeline stage while state = "processing" (telemetry, NOT part of
   * the FSM): "downloading" | "enhancing" | "transcribing" | "generating" |
   * "packaging". Null when idle/complete. Drives the assembly-line stepper.
   */
  processingStage: text("processing_stage"),

  /**
   * Human-readable message from the most recent processing failure.
   * Cleared when processing (re)starts. Shown on the episode page so
   * failures are never a mystery spinner.
   */
  processingError: text("processing_error"),
});

// ─── TypeScript types ─────────────────────────────────────────────────────────

/** Episode — a fully-hydrated episode row. */
export type Episode = typeof episodes.$inferSelect;

/** NewEpisode — shape required to insert a new episode row. */
export type NewEpisode = typeof episodes.$inferInsert;

/**
 * EpisodeState — valid state string values, derived from the pgEnum.
 * Use this type everywhere state strings appear — no raw string comparisons.
 */
export type EpisodeState = (typeof episodeStateEnum.enumValues)[number];
