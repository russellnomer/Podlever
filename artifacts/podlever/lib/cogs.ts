/**
 * lib/cogs.ts — AI Cost of Goods Sold (COGS) tracking
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Week-1 cost audit)
 *
 * Pricing constants and helper to record AI API costs per episode step.
 * All prices are estimates based on published rates as of July 2026.
 * Actual costs flow through Replit AI Integrations credits.
 *
 * HUMAN REVIEW NOTES:
 * - Update PRICING_USD when model rates change (check Replit AI credits console).
 * - recordCogs is fire-and-forget (called with .catch) — a logging failure must
 *   never abort the processing pipeline.
 * - gpt-5.6-luna pricing is estimated from GPT-4o family rates; update once
 *   Replit publishes exact rates for this model.
 */

import "server-only";
import { db }          from "@/db";
import { episodeCogs } from "@/db/schema/episode-cogs";
import type { CogsStep } from "@/db/schema/episode-cogs";

// ─── Pricing constants (USD per unit) ─────────────────────────────────────────

/**
 * PRICING_USD — estimated cost per unit for each model.
 * Whisper: per audio minute.
 * Chat completions: per 1,000 tokens (input / output separate).
 */
export const PRICING_USD = {
  /** gpt-4o-mini-transcribe: $0.003 per audio minute */
  "gpt-4o-mini-transcribe": {
    type:              "audio" as const,
    perMinute:         0.003,
  },
  /** gpt-5.6-luna: estimated GPT-4o class pricing */
  "gpt-5.6-luna": {
    type:              "tokens" as const,
    per1kTokensInput:  0.0025,   // $2.50 / 1M = $0.0025 / 1K
    per1kTokensOutput: 0.010,    // $10.00 / 1M = $0.010 / 1K
  },
  /** Adobe Podcast Enhance: free during beta */
  "adobe": {
    type:              "audio" as const,
    perMinute:         0,
  },
  /** FFmpeg: local processing, no API cost */
  "ffmpeg": {
    type:              "audio" as const,
    perMinute:         0,
  },
} as const;

export type PricedModel = keyof typeof PRICING_USD;

// ─── Cost calculators ─────────────────────────────────────────────────────────

/**
 * estimateAudioCost — compute USD cost for an audio processing call.
 * @param model         Model key from PRICING_USD
 * @param audioSeconds  Duration of audio processed
 */
export function estimateAudioCost(model: PricedModel, audioSeconds: number): number {
  const config = PRICING_USD[model];
  if (config.type !== "audio") return 0;
  return (audioSeconds / 60) * config.perMinute;
}

/**
 * estimateTokenCost — compute USD cost for a chat completion call.
 * @param model     Model key from PRICING_USD
 * @param tokensIn  Prompt tokens consumed
 * @param tokensOut Completion tokens generated
 */
export function estimateTokenCost(
  model:     PricedModel,
  tokensIn:  number,
  tokensOut: number,
): number {
  const config = PRICING_USD[model];
  if (config.type !== "tokens") return 0;
  return (tokensIn / 1000) * config.per1kTokensInput
       + (tokensOut / 1000) * config.per1kTokensOutput;
}

// ─── DB recorder ──────────────────────────────────────────────────────────────

interface CogsRecord {
  episodeId:    string;
  userId:       string;
  step:         CogsStep;
  model:        string;
  costUsd:      number;
  tokensIn?:    number;
  tokensOut?:   number;
  audioSeconds?: number;
}

/**
 * recordCogs — Append a cost event to episode_cogs.
 *
 * Always call with .catch() so a DB failure never aborts the pipeline.
 * Example:
 *   recordCogs({ episodeId, userId, step: "transcription", ... }).catch(...)
 */
export async function recordCogs(record: CogsRecord): Promise<void> {
  await db.insert(episodeCogs).values({
    episodeId:    record.episodeId,
    userId:       record.userId,
    step:         record.step,
    model:        record.model,
    costUsd:      record.costUsd.toFixed(6),
    tokensIn:     record.tokensIn    ?? null,
    tokensOut:    record.tokensOut   ?? null,
    audioSeconds: record.audioSeconds ?? null,
  });
}

// ─── Episode summary helper ────────────────────────────────────────────────────

import { eq, sum } from "drizzle-orm";

export interface EpisodeCogsSummary {
  episodeId:  string;
  totalUsd:   number;
  byStep:     Array<{ step: string; model: string; costUsd: number; tokensIn: number | null; tokensOut: number | null; audioSeconds: number | null }>;
}

/**
 * getEpisodeCogs — Aggregate COGS for a single episode.
 * Used by the /admin/cogs dashboard and episode detail page.
 */
export async function getEpisodeCogs(episodeId: string): Promise<EpisodeCogsSummary> {
  const rows = await db
    .select()
    .from(episodeCogs)
    .where(eq(episodeCogs.episodeId, episodeId))
    .orderBy(episodeCogs.createdAt);

  const totalUsd = rows.reduce((acc, r) => acc + parseFloat(String(r.costUsd)), 0);

  return {
    episodeId,
    totalUsd,
    byStep: rows.map((r) => ({
      step:         r.step,
      model:        r.model,
      costUsd:      parseFloat(String(r.costUsd)),
      tokensIn:     r.tokensIn,
      tokensOut:    r.tokensOut,
      audioSeconds: r.audioSeconds,
    })),
  };
}
