/**
 * app/actions/regenerate.actions.ts — Regenerate a single AI-generated asset
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — revision button)
 *
 * Server Action called by RegenerateButton.tsx.
 * Re-runs the GPT generation step for one asset type and stores a new version.
 *
 * Plan limits (enforced server-side — never trust the client):
 *   free    — 0 regenerations (button hidden + rejected here)
 *   pro     — 3 per episode (across all asset types combined)
 *   agency  — unlimited
 *
 * Rate tracking: usage_events with event_type = 'asset_regenerated'.
 * Counting is per-episode, not per-asset-type, to keep it simple.
 *
 * SECURITY: server-only. Ownership verified via requireOwner().
 *           PII-free logs.
 */

"use server";

import { requireOwner }            from "@/providers/owner-guard";
import { episodeRepository, assetRepository, usageRepository } from "@/repositories";
import { openai, MODELS }          from "@/lib/openai";
import { recordCogs, estimateTokenCost } from "@/lib/cogs";
import { db }                      from "@/db";
import { usageEvents }             from "@/db/schema";
import { and, eq, count }          from "drizzle-orm";
import type { AssetType }          from "@/db/schema";

// ─── Plan limits ──────────────────────────────────────────────────────────────

const REGEN_LIMITS: Record<string, number> = {
  free:   0,
  pro:    3,
  agency: Infinity,
};

// ─── System prompts (duplicated from process route for now) ───────────────────

const SYSTEM_PROMPTS: Record<string, string> = {
  show_notes: `You are a podcast producer writing structured show notes.
Given a podcast transcript, produce clean, reader-friendly show notes in markdown:
- An engaging 2-3 sentence episode summary
- Key takeaways (3-5 bullet points)
- Topics covered (brief section list)
- Notable quotes (1-2 direct quotes with attribution)
Return only the markdown — no preamble, no meta-commentary.`,

  blog_post: `You are a content strategist converting a podcast episode into a long-form blog post.
Given a transcript, write a compelling 600-900 word blog post:
- An SEO-friendly headline (H1)
- An engaging introduction that hooks the reader
- 3-4 well-developed sections (H2 subheadings)
- A strong closing paragraph with a call to action
Write in a professional but conversational tone. Return only the blog post markdown.`,

  social_post: `You are a social media manager writing promotional copy for a podcast episode.
Given a transcript, produce THREE social media posts in this exact format:

**LinkedIn (professional, 150-200 words):**
[post]

**Twitter/X (punchy, under 280 chars):**
[post]

**Instagram caption (engaging, 100-150 words + 5 relevant hashtags):**
[post]

Return only the three posts in that format — no other text.`,

  guest_media_pack: `You are a podcast producer creating a guest media pack.
Given a transcript, produce a structured guest media pack in markdown:
- **Guest name and title** (infer from transcript)
- **Bio blurb** (2-3 sentences suitable for show notes)
- **Key topics discussed** (5-7 bullet points)
- **Suggested social announcement** (short caption the guest can post)
- **Suggested follow-up questions** (3 questions for future conversations)
- **Notable quotes** (2-3 direct quotes with attribution)
Return only the markdown — no preamble.`,
};

// ─── Regeneratable asset types ─────────────────────────────────────────────────

const REGENERATABLE: ReadonlySet<AssetType> = new Set([
  "show_notes", "blog_post", "social_post", "guest_media_pack",
]);

// ─── Action result ─────────────────────────────────────────────────────────────

export type RegenerateResult =
  | { success: true;  content: string; version: number }
  | { success: false; error: string };

// ─── Server Action ─────────────────────────────────────────────────────────────

/**
 * regenerateAsset — Re-generate one AI asset for an episode.
 *
 * @param episodeId  Target episode (must be owned by caller)
 * @param assetType  Which asset to regenerate (must be in REGENERATABLE)
 * @param styleHint  Optional guidance appended to the system prompt (e.g. "more informal tone")
 */
export async function regenerateAsset(
  episodeId: string,
  assetType:  AssetType,
  styleHint?: string,
): Promise<RegenerateResult> {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const { userId, plan } = await requireOwner();

  // ── Plan gate ──────────────────────────────────────────────────────────────
  const limit = REGEN_LIMITS[plan ?? "free"] ?? 0;
  if (limit === 0) {
    return { success: false, error: "Upgrade to Pro to regenerate assets." };
  }

  // ── Ownership check ────────────────────────────────────────────────────────
  let episode;
  try {
    episode = await episodeRepository.getEpisodeForOwner(episodeId, userId);
  } catch {
    return { success: false, error: "Episode not found." };
  }

  if (episode.state !== "ready" && episode.state !== "published") {
    return { success: false, error: "Episode is not ready yet." };
  }

  // ── Asset type guard ───────────────────────────────────────────────────────
  if (!REGENERATABLE.has(assetType)) {
    return { success: false, error: `Cannot regenerate asset type: ${assetType}` };
  }

  // ── Count usage for this episode ───────────────────────────────────────────
  if (isFinite(limit)) {
    const [row] = await db
      .select({ cnt: count() })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, userId),
          eq(usageEvents.episodeId, episodeId),
          eq(usageEvents.eventType, "asset_regenerated"),
        ),
      );

    const used = Number(row?.cnt ?? 0);
    if (used >= limit) {
      return {
        success: false,
        error:   `You've used ${used}/${limit} regenerations for this episode. Upgrade to Agency for unlimited.`,
      };
    }
  }

  // ── Fetch transcript ───────────────────────────────────────────────────────
  const allAssets   = await assetRepository.listAssetsForEpisode(episodeId);
  const transcript  = allAssets.find((a) => a.assetType === "transcript")?.content;

  if (!transcript) {
    return { success: false, error: "Transcript not found — cannot regenerate." };
  }

  // ── Re-generate ────────────────────────────────────────────────────────────
  const systemPrompt = SYSTEM_PROMPTS[assetType]!;
  const userContent  = styleHint
    ? `Style guidance: ${styleHint}\n\nTranscript:\n${transcript}`
    : `Here is the podcast transcript:\n\n${transcript}`;

  try {
    const response = await openai.chat.completions.create({
      model:    MODELS.generation,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userContent },
      ],
      max_completion_tokens: 2048,
      user: "none",
    });

    const content   = response.choices[0]?.message?.content ?? "";
    const tokensIn  = response.usage?.prompt_tokens    ?? 0;
    const tokensOut = response.usage?.completion_tokens ?? 0;
    const cost      = estimateTokenCost("gpt-5.6-luna", tokensIn, tokensOut);

    if (!content) {
      return { success: false, error: "Model returned an empty response — try again." };
    }

    // ── Store new asset version ────────────────────────────────────────────
    const newAsset = await assetRepository.createAssetVersion({
      episodeId,
      assetType,
      label:      `Regenerated ${assetType.replace(/_/g, " ")} (v2+)`,
      content,
      storageKey: null,
    });

    // ── Log usage + COGS ──────────────────────────────────────────────────
    await usageRepository.recordUsageEvent(userId, episodeId, "asset_regenerated");
    recordCogs({
      episodeId,
      userId,
      step:      "asset_regeneration",
      model:     MODELS.generation,
      tokensIn,
      tokensOut,
      costUsd:   cost,
    }).catch(() => {});

    console.log(JSON.stringify({
      event:     "asset.regenerated",
      episodeId,
      assetType,
      version:   newAsset.version,
    }));

    return { success: true, content, version: newAsset.version };

  } catch (err) {
    console.error(JSON.stringify({
      event:     "asset.regenerate.failed",
      episodeId,
      assetType,
      error:     String(err),
    }));
    return { success: false, error: "Generation failed — please try again." };
  }
}
