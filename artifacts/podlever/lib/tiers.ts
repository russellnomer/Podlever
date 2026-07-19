/**
 * lib/tiers.ts — PodLever plan tier definitions (single source of truth)
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #57 — Usage metering per user)
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
 * - `episodesPerMonth: Infinity` means unlimited (no gate shown).
 * - Adding a tier here does NOT require a DB migration (text column).
 */

// ─── Tier definition ──────────────────────────────────────────────────────────

export interface TierDef {
  /** Human-readable plan label. */
  label: string;
  /** Monthly episode processing limit. Infinity = unlimited. */
  episodesPerMonth: number;
  /** Displayed price per month (annual rate, USD). 0 = free. */
  pricePerMonthAnnual: number;
  /** Stripe price ID (populated when Stripe goes live in #14). */
  stripePriceIdAnnual?: string;
  stripePriceIdMonthly?: string;
}

// ─── Tier registry ─────────────────────────────────────────────────────────────

/**
 * TIERS — all plan tiers keyed by plan slug.
 *
 * `free`   — Default for new users; 1 episode/month.
 * `beta`   — Manually invited beta testers; Pro-equivalent limits, $0.
 * `pro`    — Paid tier; 10 episodes/month, $29/mo annual.
 * `agency` — Paid tier; unlimited episodes, $97/mo annual.
 *
 * Values here MUST match the feature table in app/pricing/page.tsx.
 */
export const TIERS: Record<string, TierDef> = {
  free: {
    label:               "Free",
    episodesPerMonth:    1,
    pricePerMonthAnnual: 0,
  },
  beta: {
    label:               "Beta",
    episodesPerMonth:    10,    // Pro-equivalent for beta testers
    pricePerMonthAnnual: 0,
  },
  pro: {
    label:               "Pro",
    episodesPerMonth:    10,
    pricePerMonthAnnual: 29,
  },
  agency: {
    label:               "Agency",
    episodesPerMonth:    Infinity,
    pricePerMonthAnnual: 97,
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
