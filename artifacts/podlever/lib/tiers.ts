/**
 * lib/tiers.ts — PodLever plan tier definitions (single source of truth)
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-24 by agent (Task #70 — pricing update: Agency $149/$199, 50 ep/mo)
 *
 * This file is imported by:
 *   - UsageRepository  (to look up limits when computing usage summaries)
 *   - EpisodeUploadForm (to display the limit in the gate message)
 *   - Admin views (to show tier labels)
 *   - app/pricing/page.tsx (source of truth cross-check)
 *
 * Stripe (#14) will update users.plan on subscription events. Until then,
 * all beta users default to "beta" (pro-equivalent limits) and un-onboarded
 * users default to "free".
 *
 * HUMAN REVIEW NOTES:
 * - Keep this file in sync with app/pricing/page.tsx feature table.
 * - `isTrialOnly: true` means the user gets exactly one episode ever (not per month).
 *   UsageRepository checks lifetime count for these tiers rather than monthly count.
 * - Adding a tier here does NOT require a DB migration (text column).
 */

// ─── Tier definition ──────────────────────────────────────────────────────────

export interface TierDef {
  /** Human-readable plan label. */
  label: string;

  /**
   * Monthly episode processing limit (for recurring plans).
   * Ignored for `isTrialOnly` tiers — those use a lifetime cap of 1.
   */
  episodesPerMonth: number;

  /**
   * When true, the user's limit is 1 episode for their entire account lifetime,
   * not 1 per month. UsageRepository gates on lifetime count, not monthly count.
   */
  isTrialOnly: boolean;

  /** Max audio/video file duration in minutes. */
  maxAudioMinutes: number;

  /** Displayed price per month at annual billing rate (USD). 0 = free. */
  pricePerMonthAnnual: number;

  /** Displayed price per month at monthly billing rate (USD). 0 = free / not applicable. */
  pricePerMonthMonthly: number;

  /**
   * Cost charged per episode over the monthly allotment (USD).
   * 0 means overage is not offered for this tier.
   */
  extraEpisodePriceUsd: number;

  /** Stripe price ID for annual billing (populated by Task #14). */
  stripePriceIdAnnual?: string;

  /** Stripe price ID for monthly billing (populated by Task #14). */
  stripePriceIdMonthly?: string;
}

// ─── Tier registry ─────────────────────────────────────────────────────────────

/**
 * TIERS — all plan tiers keyed by plan slug.
 *
 * `free`   — One-time trial; 1 episode ever, no card required.
 * `beta`   — Manually invited beta testers; Pro-equivalent limits, $0.
 * `pro`    — Paid tier; 10 episodes/month, $29/mo annual ($41 monthly).
 * `agency` — Paid tier; 50 episodes/month, $149/mo annual ($199 monthly).
 *
 * Values here MUST match the feature table in app/pricing/page.tsx.
 */
export const TIERS: Record<string, TierDef> = {
  free: {
    label:                "Free trial",
    episodesPerMonth:     1,       // Semantically unused — gate uses lifetime count
    isTrialOnly:          true,    // One episode ever, not one per month
    maxAudioMinutes:      60,
    pricePerMonthAnnual:  0,
    pricePerMonthMonthly: 0,
    extraEpisodePriceUsd: 0,
  },
  beta: {
    label:                "Beta",
    episodesPerMonth:     10,      // Pro-equivalent for beta testers
    isTrialOnly:          false,
    maxAudioMinutes:      240,
    pricePerMonthAnnual:  0,
    pricePerMonthMonthly: 0,
    extraEpisodePriceUsd: 0,
  },
  pro: {
    label:                "Pro",
    episodesPerMonth:     10,
    isTrialOnly:          false,
    maxAudioMinutes:      240,     // 4 hours
    pricePerMonthAnnual:  29,
    pricePerMonthMonthly: 41,
    extraEpisodePriceUsd: 4,
  },
  agency: {
    label:                "Agency",
    episodesPerMonth:     50,
    isTrialOnly:          false,
    maxAudioMinutes:      240,     // 4 hours (same as Pro)
    pricePerMonthAnnual:  149,
    pricePerMonthMonthly: 199,
    extraEpisodePriceUsd: 3,
  },
} as const;

/** Default plan for users without an explicit plan assignment. */
export const DEFAULT_PLAN = "free" as const;

/**
 * getTier — look up a TierDef by plan slug with a safe fallback.
 *
 * Returns the "free" tier if the slug is unrecognised (e.g. stale cookie
 * referencing a deleted tier, or a null value from the DB).
 *
 * @param plan - Plan slug from users.plan (e.g. "free", "pro", "beta")
 */
export function getTier(plan: string | null | undefined): TierDef {
  return TIERS[plan ?? DEFAULT_PLAN] ?? TIERS[DEFAULT_PLAN]!;
}
