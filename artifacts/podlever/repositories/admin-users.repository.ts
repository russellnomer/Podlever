/**
 * repositories/admin-users.repository.ts — Owner-facing user administration queries
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (admin demo-user console — /admin/users)
 *
 * Read model for the /admin/users page and write helpers for the owner's
 * access-control actions (suspend, reinstate, cap override, access expiry).
 *
 * HUMAN REVIEW NOTES:
 * - listUserOverview() merges four small queries in JS instead of one giant
 *   SQL join. User count is tiny in beta (tens, not thousands); clarity wins.
 * - Suspension bumps session_version so any cached owner-guard checks and
 *   future per-request version checks invalidate stolen/live cookies.
 * - All writes are called ONLY from owner-guarded server actions
 *   (app/actions/admin-users.actions.ts). No route exposes these directly.
 */

import { and, count, eq, gte, max, sql, sum } from "drizzle-orm";
import { db }           from "@/db";
import { users }        from "@/db/schema/users";
import { usageEvents }  from "@/db/schema/usage-events";
import { episodeCogs }  from "@/db/schema/episode-cogs";
import { waitlist }     from "@/db/schema/waitlist";
import { getTier }      from "@/lib/tiers";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** AdminUserOverview — one row per non-owner user for the /admin/users table. */
export interface AdminUserOverview {
  userId:             string;
  displayName:        string | null;
  plan:               string;
  tierLabel:          string;
  /** Episodes processed in the current UTC calendar month. */
  usedThisMonth:      number;
  /** Effective monthly cap (override if set, else tier default). */
  effectiveLimit:     number;
  /** Episodes processed across the account lifetime. */
  lifetimeEpisodes:   number;
  /** Total pipeline cost incurred by this user, USD (sum of episode_cogs). */
  totalCostUsd:       number;
  /** Most recent usage event, or null if the user has never processed. */
  lastActivityAt:     Date | null;
  /** Admin-set per-user cap override (null = tier default). */
  episodeCapOverride: number | null;
  /** Admin-set access expiry (null = no expiry). */
  accessExpiresAt:    Date | null;
  suspendedAt:        Date | null;
  suspendedReason:    string | null;
  /** True when accessExpiresAt is set and in the past. */
  accessExpired:      boolean;
  /** Replit user ID — shown so the owner can add accounts to OWNER_REPLIT_USER_ID. */
  externalIdentityId: string;
  /** Deal registration info from the linked waitlist entry (matched by Replit user ID). */
  email:              string | null;
  dealNotes:          string | null;
  waitlistId:         string | null;
  createdAt:          Date;
}

// ─── Repository ───────────────────────────────────────────────────────────────

class AdminUsersRepository {

  /**
   * listUserOverview — Full per-user overview for the /admin/users console.
   *
   * Returns all non-owner users with usage, cost, deal, and access-control
   * state, sorted by total cost descending (most expensive users first —
   * they are the ones worth watching).
   */
  async listUserOverview(): Promise<AdminUserOverview[]> {
    const now         = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // Query 1: all non-owner users with their access-control columns.
    const userRows = await db
      .select({
        userId:             users.id,
        externalIdentityId: users.externalIdentityId,
        displayName:        users.displayName,
        plan:               users.plan,
        episodeCapOverride: users.episodeCapOverride,
        accessExpiresAt:    users.accessExpiresAt,
        suspendedAt:        users.suspendedAt,
        suspendedReason:    users.suspendedReason,
        createdAt:          users.createdAt,
      })
      .from(users)
      .where(sql`${users.role} = 'user'`);

    if (userRows.length === 0) return [];

    // Query 2: usage aggregates (this month + lifetime + last activity) per user.
    const usageRows = await db
      .select({
        userId:   usageEvents.userId,
        lifetime: count(usageEvents.id),
        thisMonth: sql<number>`
          COUNT(*) FILTER (
            WHERE ${usageEvents.createdAt} >= ${periodStart}
          )::int`,
        lastAt:   max(usageEvents.createdAt),
      })
      .from(usageEvents)
      .where(eq(usageEvents.eventType, "episode_processed"))
      .groupBy(usageEvents.userId);
    const usageByUser = new Map(usageRows.map((r) => [r.userId, r]));

    // Query 3: total pipeline cost per user.
    const cogsRows = await db
      .select({
        userId: episodeCogs.userId,
        total:  sum(episodeCogs.costUsd),
      })
      .from(episodeCogs)
      .groupBy(episodeCogs.userId);
    const cogsByUser = new Map(cogsRows.map((r) => [r.userId, r.total]));

    // Query 4: waitlist entries (deal registration) keyed by Replit user ID.
    const waitlistRows = await db
      .select({
        id:           waitlist.id,
        email:        waitlist.email,
        notes:        waitlist.notes,
        replitUserId: waitlist.replitUserId,
      })
      .from(waitlist);
    const waitlistByReplitId = new Map(
      waitlistRows
        .filter((w) => w.replitUserId != null)
        .map((w) => [w.replitUserId as string, w]),
    );

    // Merge.
    const overview: AdminUserOverview[] = userRows.map((u) => {
      const tier    = getTier(u.plan);
      const usage   = usageByUser.get(u.userId);
      const cost    = cogsByUser.get(u.userId);
      const wl      = waitlistByReplitId.get(u.externalIdentityId);
      const expired = u.accessExpiresAt != null && u.accessExpiresAt < now;

      return {
        userId:             u.userId,
        displayName:        u.displayName,
        plan:               u.plan,
        tierLabel:          tier.label,
        usedThisMonth:      usage?.thisMonth ?? 0,
        effectiveLimit:     u.episodeCapOverride ?? tier.episodesPerMonth,
        lifetimeEpisodes:   usage?.lifetime ?? 0,
        totalCostUsd:       cost != null ? parseFloat(String(cost)) : 0,
        lastActivityAt:     usage?.lastAt ?? null,
        episodeCapOverride: u.episodeCapOverride,
        accessExpiresAt:    u.accessExpiresAt,
        suspendedAt:        u.suspendedAt,
        suspendedReason:    u.suspendedReason,
        accessExpired:      expired,
        externalIdentityId: u.externalIdentityId,
        email:              wl?.email ?? null,
        dealNotes:          wl?.notes ?? null,
        waitlistId:         wl?.id ?? null,
        createdAt:          u.createdAt,
      };
    });

    return overview.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  }

  /**
   * getOwnerOverview — Usage + cost stats for the owner account(s).
   *
   * The founder asked to see his own activity alongside beta users
   * ("I want to hold myself accountable too"). Returned separately from
   * listUserOverview so the UI can render it without suspend/cap controls.
   */
  async getOwnerOverview(): Promise<
    { displayName: string | null; usedThisMonth: number; lifetimeEpisodes: number; totalCostUsd: number; lastActivityAt: Date | null }[]
  > {
    const now         = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const owners = await db
      .select({ userId: users.id, displayName: users.displayName })
      .from(users)
      .where(sql`${users.role} = 'owner'`);
    if (owners.length === 0) return [];

    const results = [];
    for (const o of owners) {
      const [usage] = await db
        .select({
          lifetime:  count(usageEvents.id),
          thisMonth: sql<number>`
            COUNT(*) FILTER (
              WHERE ${usageEvents.createdAt} >= ${periodStart}
            )::int`,
          lastAt:    max(usageEvents.createdAt),
        })
        .from(usageEvents)
        .where(and(eq(usageEvents.eventType, "episode_processed"), eq(usageEvents.userId, o.userId)));

      const [cost] = await db
        .select({ total: sum(episodeCogs.costUsd) })
        .from(episodeCogs)
        .where(eq(episodeCogs.userId, o.userId));

      results.push({
        displayName:      o.displayName,
        usedThisMonth:    usage?.thisMonth ?? 0,
        lifetimeEpisodes: usage?.lifetime != null ? Number(usage.lifetime) : 0,
        totalCostUsd:     cost?.total != null ? parseFloat(String(cost.total)) : 0,
        lastActivityAt:   usage?.lastAt ?? null,
      });
    }
    return results;
  }

  /**
   * suspendUser — Revoke a user's access immediately.
   *
   * Sets suspended_at + reason, and bumps session_version so any existing
   * cookies are invalidated wherever version checks apply.
   * Idempotent: re-suspending updates the reason and timestamp.
   */
  async suspendUser(userId: string, reason: string): Promise<void> {
    await db
      .update(users)
      .set({
        suspendedAt:     new Date(),
        suspendedReason: reason,
        sessionVersion:  sql`${users.sessionVersion} + 1`,
        updatedAt:       new Date(),
      })
      .where(and(eq(users.id, userId), sql`${users.role} = 'user'`));
  }

  /**
   * reinstateUser — Clear a suspension. The user's plan/caps are untouched,
   * so they return to exactly the access they had before suspension.
   */
  async reinstateUser(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        suspendedAt:     null,
        suspendedReason: null,
        updatedAt:       new Date(),
      })
      .where(and(eq(users.id, userId), sql`${users.role} = 'user'`));
  }

  /**
   * setEpisodeCapOverride — Set or clear (null) a per-user monthly cap.
   * Deal registration: authorize a specific allowance in advance.
   */
  async setEpisodeCapOverride(userId: string, cap: number | null): Promise<void> {
    await db
      .update(users)
      .set({ episodeCapOverride: cap, updatedAt: new Date() })
      .where(and(eq(users.id, userId), sql`${users.role} = 'user'`));
  }

  /**
   * setAccessExpiry — Set or clear (null) the user's access expiry date.
   * Time-boxed demo access: after this date the upload gate closes.
   */
  async setAccessExpiry(userId: string, expiresAt: Date | null): Promise<void> {
    await db
      .update(users)
      .set({ accessExpiresAt: expiresAt, updatedAt: new Date() })
      .where(and(eq(users.id, userId), sql`${users.role} = 'user'`));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** adminUsersRepository — module-level singleton. */
export const adminUsersRepository = new AdminUsersRepository();
