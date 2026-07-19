/**
 * waitlist.repository.ts — Data access layer for the waitlist table
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #20 — owner waitlist dashboard)
 *
 * Dependencies: drizzle-orm (query builder), @/db (pool), @/db/schema
 *
 * HUMAN REVIEW NOTES:
 * This repository is the ONLY code that reads the `waitlist` table.
 * All methods are READ-ONLY — inserts happen in the joinWaitlist server action.
 * The data is only surfaced inside the owner dashboard (server component),
 * never through any public API endpoint.
 */

import { count, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { waitlist, type WaitlistEntry } from "@/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * SourceBreakdown — aggregate count per CTA source tag.
 * Used to show the owner which page/CTA drives the most interest.
 */
export interface SourceBreakdown {
  /** CTA source tag (e.g. "landing_hero", "landing_pricing"). */
  source: string;
  /** Number of unique email signups from this source. */
  signupCount: number;
}

/**
 * WaitlistSummary — all data needed to render the dashboard waitlist section.
 */
export interface WaitlistSummary {
  /** Total unique email signups across all sources. */
  totalCount: number;
  /** Per-source breakdown, sorted by signup count descending. */
  bySource: SourceBreakdown[];
  /** Most recent signups (up to 50), sorted newest first. */
  recent: WaitlistEntry[];
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class WaitlistRepository {
  /**
   * getSummary — fetch the full waitlist summary for the owner dashboard.
   *
   * Runs three lightweight queries:
   *   1. COUNT(*) for the total
   *   2. GROUP BY source for the breakdown
   *   3. ORDER BY created_at DESC LIMIT 50 for the recent list
   *
   * These are separate queries (not a single CTE) to keep the Drizzle
   * query builder straightforward. All three run on the same pool connection.
   */
  async getSummary(): Promise<WaitlistSummary> {
    // 1. Total count
    const [{ value: totalCount }] = await db
      .select({ value: count() })
      .from(waitlist);

    // 2. Per-source breakdown — sorted by count descending
    const sourceRows = await db
      .select({
        source: waitlist.source,
        signupCount: count(),
      })
      .from(waitlist)
      .groupBy(waitlist.source)
      .orderBy(desc(sql`count(*)`));

    // 3. Recent entries — newest first, capped at 50 to keep payload small
    const recent = await db
      .select()
      .from(waitlist)
      .orderBy(desc(waitlist.createdAt))
      .limit(50);

    return {
      totalCount: Number(totalCount),
      bySource: sourceRows.map((r) => ({
        source: r.source,
        signupCount: Number(r.signupCount),
      })),
      recent,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * waitlistRepository — module-level singleton.
 * Import this directly; do not instantiate WaitlistRepository elsewhere.
 */
export const waitlistRepository = new WaitlistRepository();
