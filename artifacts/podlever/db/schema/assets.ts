/**
 * assets.ts — Drizzle schema for the `assets` table
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: drizzle-orm/pg-core, ./episodes (foreign key)
 *
 * HUMAN REVIEW NOTES:
 * The schema is shaped now for future invariants that will be enforced
 * in Phase 1B+ WITHOUT requiring a destructive migration:
 *
 *   1. "Published versions are immutable" — enforced by Service layer in Phase 1B+.
 *      The `status` column ("draft" | "approved" | "published") already carries
 *      the state needed to enforce this rule.
 *
 *   2. "One approved version per asset_type per episode" — enforced by a
 *      partial unique index in Phase 1B+ (WHERE status = 'approved').
 *      The columns needed for this index exist now.
 *
 * `version` is a monotonically increasing integer per (episode_id, asset_type).
 * Managed by the Repository layer — never set by callers directly.
 *
 * `storage_key` is nullable in Phase 1A (no object storage yet) but present
 * so Phase 1B can add it without a destructive migration.
 */

import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { episodes } from "./episodes";

// ─── Enums ───────────────────────────────────────────────────────────────────

/**
 * assetTypeEnum — The kinds of output assets PodLever produces per episode.
 *
 * Phase 1A: schema only — no generation logic yet.
 * Phase 1B+: each type maps to a job handler in /jobs/handlers/.
 */
export const assetTypeEnum = pgEnum("asset_type", [
  "cleaned_audio",      // Noise-reduced, normalized audio file
  "transcript",         // Full verbatim transcript (JSON + plain text)
  "youtube_cut",        // Full-length video cut for YouTube
  "vertical_clip",      // Short vertical clip for TikTok/Reels/Shorts
  "show_notes",         // Structured show notes (markdown)
  "blog_post",          // Long-form blog post derived from transcript
  "social_post",        // Platform-specific social media copy
  "guest_media_pack",   // Asset bundle for the podcast guest
]);

/**
 * assetStatusEnum — Lifecycle status of an asset version.
 *
 * Transitions: draft → approved → published
 * Invariants (enforced in Phase 1B+ Service layer):
 *   - "published" assets are immutable (no update/delete)
 *   - Only one "approved" version per (episode_id, asset_type)
 */
export const assetStatusEnum = pgEnum("asset_status", [
  "draft",      // Generated but not yet reviewed by owner
  "approved",   // Owner approved; ready for publishing
  "published",  // Distributed to channels; immutable
  "rejected",   // Owner rejected; superseded by a new draft
]);

// ─── Table ───────────────────────────────────────────────────────────────────

/**
 * assets — Versioned output assets generated per episode.
 *
 * Multiple versions of the same asset_type can exist per episode
 * (e.g., two drafts of show_notes, one approved). The version counter
 * is monotonically increasing within (episode_id, asset_type).
 */
export const assets = pgTable("assets", {
  /** Surrogate primary key. */
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * The episode this asset belongs to.
   * Cascade-deletes assets when an episode is hard-deleted (rare; soft-delete preferred).
   */
  episodeId: uuid("episode_id")
    .notNull()
    .references(() => episodes.id, { onDelete: "cascade" }),

  /**
   * Type of asset. One of the production pipeline output types.
   * Combined with episode_id to identify the asset category.
   */
  assetType: assetTypeEnum("asset_type").notNull(),

  /**
   * Monotonically increasing version number within (episode_id, asset_type).
   * Managed by AssetRepository.createAssetVersion — callers never set this.
   * Used by Service invariant: "no update to a published version".
   */
  version: integer("version").notNull().default(1),

  /**
   * Lifecycle status. Enforced by AssetService in Phase 1B+.
   * Phase 1A: column exists; invariant enforcement deferred.
   */
  status: assetStatusEnum("asset_status").notNull().default("draft"),

  /**
   * Object storage key (e.g., S3 or Cloudflare R2 path).
   * Nullable in Phase 1A — no storage integration yet.
   * Phase 1B: made non-null once upload infrastructure is wired.
   */
  storageKey: text("storage_key"),

  /**
   * Human-readable label or description of this asset version.
   * Optional. Used to distinguish draft revisions ("v2 with intro trimmed").
   */
  label: text("label"),

  /** Row creation timestamp. */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  /** Last status-change timestamp. */
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── TypeScript types ─────────────────────────────────────────────────────────

/** Asset — a fully-hydrated asset row. */
export type Asset = typeof assets.$inferSelect;

/** NewAsset — shape required to insert a new asset row. */
export type NewAsset = typeof assets.$inferInsert;

/** AssetType — valid asset type strings. */
export type AssetType = (typeof assetTypeEnum.enumValues)[number];

/** AssetStatus — valid asset status strings. */
export type AssetStatus = (typeof assetStatusEnum.enumValues)[number];
