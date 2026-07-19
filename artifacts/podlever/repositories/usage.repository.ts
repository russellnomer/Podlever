/**
 * repositories/usage.repository.ts — Data access layer for usage metering
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #57 — Usage metering per user)
 *
 * Reads and writes the usage_events table.
 * Also queries the users table to resolve each user's current plan.
 *
 * HUMAN REVIEW NOTES:
 * - getUsageSummary computes the period window from UTC midnight on the 1st of
 *   the current month — intentionally simple for Phase 1B.
 *   Stripe webhooks (#14) will override this with the actual billing period.
 * - recordUsageEvent is idempotent by design: calling it twice with the same
 *   episodeId + eventType produces two rows. The caller (process route) must
 *   guard against duplicate calls using FSM state checks.
 * - listPerUserSummary is an aggregated query — O(1) DB round-trips regardless
 *   of user count; safe for the admin dashboard.
 */

import { and, count, gte, eq, desc, sql } from "drizzle-orm";
import { db }             from "@/db";
import { usageEvents }    from "@/db/schema/usage-events";
import { users }          from "@/db/schema/users";
import { getTier }        from "@/lib/tiers";
import type { UsageEventType } from "@/db/schema/usage-events";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * UsageSummary — returned by getUsageSummary for a single user.
 * Includes their current plan limits for display in the upload gate.
 */
export interface UsageSummary {
  /** Number of episodes processed this billing period. */
  used: number;
  /** Max episodes allowed this period (Infinity = unlimited). */
  limit: number;
  /** UTC start of the current billing period (first of the month). */
  periodStart: Date;
  /** User's current plan slug (e.g. "free", "pro"). */
  plan: string;
  /** Human-readable tier label. */
  tierLabel: string;
  /** True when the user is at or above their limit. */
  atLimit: boolean;
}

/**
 * UserUsageSummary — per-user summary for the admin dashboard.
 */
export interface UserUsageSummary {
  userId:      string;
  displayName: string | null;
  plan:        string;
  tierLabel:   string;
  used:        number;
  limit:       number;
  periodStart: Date;
}

// ─── Repository ───────────────────────────────────────────────────────────────

class UsageRepository {

  /**
   * recordUsageEvent — Append a billable event to the usage log.
   *
   * Called by the processing pipeline on successful episode completion.
   * The caller is responsible for ensuring this is only called once per episode
   * (the FSM transition to "ready" is the right trigger point).
   *
   * @param userId    - DB UUID of the episode owner
   * @param episodeId - DB UUID of the completed episode
   * @param eventType - Billable event type (default: "episode_processed")
   */
  async recordUsageEvent(
    userId:    string,
    episodeId: string,
    eventType: UsageEventType = "episode_processed",
  ): Promise<void> {
    await db.insert(usageEvents).values({ userId, episodeId, eventType });
  }

  /**
   * getUsageSummary — Compute a user's current-period usage vs their plan limit.
   *
   * The period window is the current UTC calendar month (1st to now).
   * Stripe webhooks (#14) will refine this to the exact billing period.
   *
   * @param userId - DB UUID of the user to check
   * @returns UsageSummary with used count, tier limit, and atLimit flag
   */
  async getUsageSummary(userId: string): Promise<UsageSummary> {
    // ── Resolve the user's plan ─────────────────────────────────────────────
    const [userRow] = await db
      .select({ plan: users.plan })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const plan = userRow?.plan ?? "free";
    const tier = getTier(plan);

    // ── Compute period start (UTC midnight on the 1st of this month) ────────
    const now         = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // ── Count events in current period ──────────────────────────────────────
    const [row] = await db
      .select({ total: count() })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.userId, userId),
          eq(usageEvents.eventType, "episode_processed"),
          gte(usageEvents.createdAt, periodStart),
        ),
      );

    const used  = row?.total ?? 0;
    const limit = tier.episodesPerMonth;

    return {
      used,
      limit,
      periodStart,
      plan,
      tierLabel: tier.label,
      atLimit:   used >= limit,
    };
  }

  /**
   * listPerUserSummary — Aggregated usage summary for all users this period.
   *
   * ADMIN USE ONLY — called by the admin episodes dashboard.
   * Single DB query via GROUP BY; efficient regardless of user/event count.
   *
   * @returns Array of UserUsageSummary sorted by usage descending
   */
  async listPerUserSummary(): Promise<UserUsageSummary[]> {
    const now         = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // Join users with their event counts for the current period
    const rows = await db
      .select({
        userId:      users.id,
        displayName: users.displayName,
        plan:        users.plan,
        used:        sql<number>`COUNT(${usageEvents.id})::int`,
      })
      .from(users)
      .leftJoin(
        usageEvents,
        and(
          eq(usageEvents.userId, users.id),
          eq(usageEvents.eventType, "episode_processed"),
          gte(usageEvents.createdAt, periodStart),
        ),
      )
      .where(sql`${users.role} = 'user'`)
      .groupBy(users.id)
      .orderBy(desc(sql`COUNT(${usageEvents.id})`));

    return rows.map((r) => {
      const tier = getTier(r.plan);
      return {
        userId:      r.userId,
        displayName: r.displayName,
        plan:        r.plan ?? "free",
        tierLabel:   tier.label,
        used:        r.used ?? 0,
        limit:       tier.episodesPerMonth,
        periodStart,
      };
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** usageRepository — module-level singleton. */
export const usageRepository = new UsageRepository();
