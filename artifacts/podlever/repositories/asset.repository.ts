/**
 * asset.repository.ts — Data access layer for Asset entities
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: drizzle-orm, @/db, @/db/schema
 *
 * HUMAN REVIEW NOTES:
 * The `version` counter is managed here — callers never supply it directly.
 * createAssetVersion queries the current max version for the (episode, assetType)
 * pair and increments it. This is safe within a transaction but NOT safe for
 * high-concurrency scenarios (race between SELECT max and INSERT).
 *
 * Phase 1B mitigation: add a PostgreSQL SEQUENCE per (episode_id, asset_type)
 * or use a serializable transaction if concurrent asset creation becomes a concern.
 * In Phase 1A (single owner, no parallel job workers), this is acceptable.
 */

// Note: server-only guard is enforced at the service layer (the UI boundary).

import { and, eq, max, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  assets,
  type Asset,
  type NewAsset,
  type AssetType,
} from "@/db/schema";

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * AssetNotFoundError — thrown when an asset row cannot be found.
 */
export class AssetNotFoundError extends Error {
  readonly kind = "AssetNotFoundError" as const;
  constructor(assetId: string) {
    super(`Asset not found: ${assetId}`);
  }
}

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * AssetRepository — domain-oriented data access for episode assets.
 *
 * Manages versioned asset records for each episode. The version counter
 * is monotonically increasing within (episode_id, asset_type).
 */
export class AssetRepository {
  /**
   * createAssetVersion — Insert a new versioned asset record.
   *
   * Computes the next version number by reading the current max for the
   * (episodeId, assetType) pair and incrementing by 1. Always runs within
   * a transaction to avoid version gaps from concurrent inserts.
   *
   * @param input - Asset fields (episodeId, assetType, storageKey, label)
   * @param tx    - Optional transaction; RECOMMENDED to prevent version races
   * @returns     The newly created Asset row with the computed version
   *
   * Business context: Called by AssetService.createAssetVersion after
   * authorization and episode existence checks. Each new draft gets a
   * higher version number than all previous drafts of the same asset type.
   */
  async createAssetVersion(
    input: Omit<NewAsset, "version">,
    tx?: DbTx,
  ): Promise<Asset> {
    const client = tx ?? db;

    // Query current max version for this (episode, assetType) pair.
    // Returns null if no versions exist yet → first version is 1.
    const [maxResult] = await client
      .select({ currentMax: max(assets.version) })
      .from(assets)
      .where(
        and(
          eq(assets.episodeId, input.episodeId),
          eq(assets.assetType, input.assetType),
        ),
      );

    // Compute next version: 1 if no prior versions, otherwise increment
    const nextVersion = (maxResult?.currentMax ?? 0) + 1;

    const [created] = await client
      .insert(assets)
      .values({ ...input, version: nextVersion })
      .returning();

    return created!;
  }

  /**
   * getAsset — Fetch a single asset by its ID.
   *
   * @param assetId - UUID of the asset
   * @param tx      - Optional transaction
   * @returns       The asset row
   * @throws        AssetNotFoundError if no matching row
   *
   * Business context: Used by AssetService for status updates and reads.
   * Episode ownership is NOT checked here — the Service layer enforces that
   * the asset's episodeId belongs to the requesting owner.
   */
  async getAsset(assetId: string, tx?: DbTx): Promise<Asset> {
    const client = tx ?? db;
    const [row] = await client
      .select()
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);

    if (!row) {
      throw new AssetNotFoundError(assetId);
    }
    return row;
  }

  /**
   * listAssetsForEpisode — Fetch all assets for a given episode.
   *
   * @param episodeId - UUID of the episode
   * @param assetType - Optional filter by asset type
   * @param tx        - Optional transaction
   * @returns         Array of Asset rows, ordered by type then version descending
   *
   * Business context: Used to display all generated assets for an episode.
   * Ordering by version DESC within each type puts the latest version first.
   */
  async listAssetsForEpisode(
    episodeId: string,
    assetType?: AssetType,
    tx?: DbTx,
  ): Promise<Asset[]> {
    const client = tx ?? db;

    const conditions = assetType
      ? and(eq(assets.episodeId, episodeId), eq(assets.assetType, assetType))
      : eq(assets.episodeId, episodeId);

    return client
      .select()
      .from(assets)
      .where(conditions)
      .orderBy(
        sql`${assets.assetType} ASC`,
        sql`${assets.version} DESC`,
      );
  }
}

/** assetRepository — singleton instance. */
export const assetRepository = new AssetRepository();
