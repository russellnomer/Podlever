/**
 * types/asset.ts — Zod schemas and inferred TypeScript types for Asset domain
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: zod
 *
 * HUMAN REVIEW NOTES:
 * Asset type and status enums mirror the pgEnum values in /db/schema/assets.ts.
 * Re-exported from here so callers import from @/types, not @/db.
 */

import { z } from "zod";
import type { AssetType, AssetStatus } from "@/db/schema/assets";

// ─── Re-export DB-derived types ────────────────────────────────────────────────
export type { AssetType, AssetStatus };

// ─── Enum schemas ─────────────────────────────────────────────────────────────

/** AssetTypeSchema — runtime validation for asset type strings. */
export const AssetTypeSchema = z.enum([
  "cleaned_audio",
  "transcript",
  "youtube_cut",
  "vertical_clip",
  "show_notes",
  "blog_post",
  "social_post",
  "guest_media_pack",
]);

/** AssetStatusSchema — runtime validation for asset status strings. */
export const AssetStatusSchema = z.enum([
  "draft",
  "approved",
  "published",
  "rejected",
]);

// ─── Input schemas ────────────────────────────────────────────────────────────

/**
 * CreateAssetVersionSchema — validates input for creating a new asset version.
 * The `version` number is computed by the Repository, not supplied by the caller.
 */
export const CreateAssetVersionSchema = z.object({
  episodeId:   z.string().uuid("episodeId must be a valid UUID"),
  assetType:   AssetTypeSchema,
  label:       z.string().trim().max(255).optional(),
  storageKey:  z.string().max(1024).optional(),
  /** Full text content for text-based assets (transcript, show_notes, etc.) */
  content:     z.string().optional(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

/** CreateAssetVersionInput — validated create input type. */
export type CreateAssetVersionInput = z.infer<typeof CreateAssetVersionSchema>;
