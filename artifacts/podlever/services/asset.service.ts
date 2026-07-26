/**
 * services/asset.service.ts — Business logic orchestration for Assets
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent (T8 complete + T7 owner guard wired)
 *
 * Dependencies: @/repositories, @/types/asset
 *
 * HUMAN REVIEW NOTES:
 * Like EpisodeService, this service is context-agnostic:
 * it accepts ownerId from the caller (Server Action or job handler)
 * rather than reading from the request context.
 *
 * Phase 1A invariants NOT yet enforced (deferred to Phase 1B+):
 *   - "Published versions are immutable" (status === "published" → no update)
 *   - "One approved version per (episode_id, asset_type)"
 * The schema is shaped for these invariants; enforcement code is Phase 1B+.
 */

import "server-only";

import { episodeRepository, assetRepository } from "@/repositories";
import { CreateAssetVersionSchema, type CreateAssetVersionInput } from "@/types/asset";
import type { Asset } from "@/db/schema";

/**
 * AssetService — orchestrates versioned asset creation and retrieval.
 */
export class AssetService {
  /**
   * createAssetVersion — Create a new versioned asset for an episode.
   *
   * @param rawInput - Unvalidated create input (episodeId, assetType, etc.)
   * @param ownerId  - DB user ID of the owner (for episode ownership check)
   * @returns        The newly created Asset row with computed version number
   *
   * Business context: Called when a job completes and produces a new asset.
   * Version is auto-incremented by AssetRepository within the same write.
   * Ownership is verified before creating the asset.
   */
  async createAssetVersion(
    rawInput: unknown,
    ownerId: string,
  ): Promise<Asset> {
    const input: CreateAssetVersionInput = CreateAssetVersionSchema.parse(rawInput);

    // Verify the parent episode belongs to this owner before creating an asset.
    // Throws EpisodeNotFoundError if not found or wrong owner (defense-in-depth).
    await episodeRepository.getEpisodeForOwner(input.episodeId, ownerId);

    return assetRepository.createAssetVersion({
      episodeId:  input.episodeId,
      assetType:  input.assetType,
      label:      input.label ?? null,
      storageKey: input.storageKey ?? null,
      content:    input.content ?? null,
      // status defaults to "draft" (set in schema)
    });
  }

  /**
   * listAssetsForEpisode — List all assets for an episode the owner controls.
   *
   * @param episodeId - UUID of the episode
   * @param ownerId   - DB user ID of the requesting owner
   * @returns         Array of Asset rows ordered by type then version (newest first)
   */
  async listAssetsForEpisode(
    episodeId: string,
    ownerId: string,
  ): Promise<Asset[]> {
    // Ownership check: throws if episode not found or wrong owner
    await episodeRepository.getEpisodeForOwner(episodeId, ownerId);
    return assetRepository.listAssetsForEpisode(episodeId);
  }
}

/** assetService — singleton service instance. */
export const assetService = new AssetService();
