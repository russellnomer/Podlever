/**
 * repositories/waitlist.repository.ts — Data access layer for the waitlist table
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #35 — Lead CRM: add list, updateLead, exportLeads)
 *
 * Dependencies: drizzle-orm (query builder), @/db (pool), @/db/schema
 *
 * HUMAN REVIEW NOTES:
 * This repository is the ONLY code that reads or writes the `waitlist` table
 * (except the initial joinWaitlist server action which does the insert).
 *
 * All parameterized queries use Drizzle ORM bindings — no raw string interpolation
 * of user input is ever performed. Search uses ILIKE with a parameterized pattern.
 *
 * OWASP: Input sanitization is the caller's responsibility (server actions + crm.actions.ts).
 * The repository layer is the second line of defense — it never eval() or interpolate
 * user-supplied strings into SQL fragments.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { waitlist, type WaitlistEntry, LEAD_STATUSES, type LeadStatus } from "@/db/schema";

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

/**
 * ListLeadsOpts — filter and pagination options for list().
 * All fields validated/sanitized by the caller (crm.actions.ts) before reaching here.
 */
export interface ListLeadsOpts {
  /** 1-based page number. */
  page: number;
  /** Rows per page — constrained to 25, 50, or 100 by the action layer. */
  pageSize: 25 | 50 | 100;
  /**
   * Partial email match — ILIKE pattern.
   * Caller must strip non-email-safe chars and max 320 chars.
   * Passed as a parameterized binding; never interpolated into SQL.
   */
  search?: string;
  /** Exact match on the `source` column. */
  source?: string;
  /**
   * Exact match on the `status` column.
   * Caller validates against LEAD_STATUSES before passing here.
   */
  status?: string;
  /** Inclusive lower bound on createdAt. */
  dateFrom?: Date;
  /** Inclusive upper bound on createdAt. */
  dateTo?: Date;
}

/**
 * ListLeadsResult — paginated result from list().
 */
export interface ListLeadsResult {
  /** Rows for the current page. */
  entries: WaitlistEntry[];
  /** Total rows matching the filter (not just this page). */
  total: number;
}

/**
 * LeadPatch — fields that can be updated on a waitlist entry by the owner.
 */
export interface LeadPatch {
  /** New lifecycle status — validated against LEAD_STATUSES before reaching repo. */
  status?: LeadStatus;
  /** Updated owner notes — max 1000 chars validated before reaching repo. */
  notes?: string | null;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class WaitlistRepository {
  /**
   * getSummary — fetch the full waitlist summary for the dashboard metrics bar.
   *
   * Runs three lightweight queries:
   *   1. COUNT(*) for the total
   *   2. GROUP BY source for the breakdown
   *   3. ORDER BY created_at DESC LIMIT 50 for the recent list
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

  /**
   * getStatusCounts — aggregate lead counts by status for the metrics bar.
   *
   * Returns a Record mapping each status to its count.
   * Statuses with zero leads are not returned; callers should default to 0.
   */
  async getStatusCounts(): Promise<Record<string, number>> {
    const rows = await db
      .select({
        status: waitlist.status,
        cnt: count(),
      })
      .from(waitlist)
      .groupBy(waitlist.status);

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = Number(row.cnt);
    }
    return result;
  }

  /**
   * list — Paginated, filterable lead list for the CRM table.
   *
   * Builds WHERE conditions from the opts object using Drizzle's query
   * builder — all user-supplied values are parameterized bindings.
   * ILIKE search is wrapped in `%` wildcards by this method (not the caller).
   *
   * @param opts — validated filter + pagination options
   * @returns paginated result with total count for pagination controls
   */
  async list(opts: ListLeadsOpts): Promise<ListLeadsResult> {
    const { page, pageSize, search, source, status, dateFrom, dateTo } = opts;
    const offset = (page - 1) * pageSize;

    // Build WHERE conditions — each condition is a Drizzle SQL fragment
    // with parameterized values; no string interpolation occurs here.
    const conditions = [];

    if (search) {
      // Wrap search term in % wildcards for partial ILIKE match.
      // The `search` value itself is a parameterized $N binding.
      conditions.push(ilike(waitlist.email, `%${search}%`));
    }

    if (source) {
      conditions.push(eq(waitlist.source, source));
    }

    if (status) {
      conditions.push(eq(waitlist.status, status));
    }

    if (dateFrom) {
      conditions.push(gte(waitlist.createdAt, dateFrom));
    }

    if (dateTo) {
      // Upper bound: include the entire dateTo day (add 1 day, use <)
      // Here we use lte for simplicity — callers pass end-of-day if needed.
      conditions.push(lte(waitlist.createdAt, dateTo));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Run data + count queries in parallel for efficiency.
    const [entries, [{ total }]] = await Promise.all([
      db
        .select()
        .from(waitlist)
        .where(where)
        .orderBy(desc(waitlist.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ total: count() })
        .from(waitlist)
        .where(where),
    ]);

    return { entries, total: Number(total) };
  }

  /**
   * updateLead — Update the status and/or notes on a waitlist entry.
   *
   * Sets `updatedAt` to the current timestamp on every call.
   * Returns the updated entry so the UI can reflect the change immediately.
   *
   * @param id    — UUID of the waitlist entry to update
   * @param patch — Validated patch (status and/or notes); at least one must be set
   * @returns The updated WaitlistEntry
   * @throws Error if the lead is not found (no matching row)
   */
  async updateLead(id: string, patch: LeadPatch): Promise<WaitlistEntry> {
    // Build the update payload — only include fields present in the patch.
    const updateValues: Partial<typeof waitlist.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (patch.status !== undefined) {
      // Validate status is in the allowed set (defense-in-depth; action layer validates too)
      if (!LEAD_STATUSES.includes(patch.status as LeadStatus)) {
        throw new Error(`Invalid lead status: ${patch.status}`);
      }
      updateValues.status = patch.status;
    }

    if (patch.notes !== undefined) {
      updateValues.notes = patch.notes;
    }

    const [updated] = await db
      .update(waitlist)
      .set(updateValues)
      .where(eq(waitlist.id, id))
      .returning();

    if (!updated) {
      throw new Error(`Lead not found: ${id}`);
    }

    return updated;
  }

  /**
   * getById — Fetch a single waitlist entry by UUID.
   *
   * Used by updateLead to capture the "before" state for audit logging.
   *
   * @param id — UUID of the waitlist entry
   * @returns WaitlistEntry or null if not found
   */
  async getById(id: string): Promise<WaitlistEntry | null> {
    const [entry] = await db
      .select()
      .from(waitlist)
      .where(eq(waitlist.id, id))
      .limit(1);
    return entry ?? null;
  }

  /**
   * exportLeads — Return all leads matching the given filters, without pagination.
   *
   * Used by the export route handler to stream a CSV response.
   * Applies the same filter logic as list() but returns all matching rows.
   *
   * NOTE: This method returns email addresses. The caller (Route Handler) must:
   * 1. Authenticate + authorize the request before calling this method.
   * 2. Never log the returned emails.
   * 3. Stream the response directly to the browser — never write to disk.
   *
   * @param opts — Same filters as list() but without page/pageSize
   */
  async exportLeads(
    opts: Omit<ListLeadsOpts, "page" | "pageSize">,
  ): Promise<WaitlistEntry[]> {
    const { search, source, status, dateFrom, dateTo } = opts;

    const conditions = [];

    if (search) {
      conditions.push(ilike(waitlist.email, `%${search}%`));
    }
    if (source) {
      conditions.push(eq(waitlist.source, source));
    }
    if (status) {
      conditions.push(eq(waitlist.status, status));
    }
    if (dateFrom) {
      conditions.push(gte(waitlist.createdAt, dateFrom));
    }
    if (dateTo) {
      conditions.push(lte(waitlist.createdAt, dateTo));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    return db
      .select()
      .from(waitlist)
      .where(where)
      .orderBy(asc(waitlist.createdAt));
  }

  /**
   * bulkUpdate — Update the status of multiple waitlist entries in one query.
   *
   * Uses a single UPDATE … WHERE id = ANY($1) statement via Drizzle's inArray
   * helper — no row-by-row round trips.
   *
   * Security / defence-in-depth:
   *   - Status validated against LEAD_STATUSES before reaching this method.
   *   - IDs passed as a parameterized binding; no string interpolation.
   *   - Returns only the rows that were actually updated so the caller can
   *     audit the exact set that changed (handles the case where some IDs
   *     no longer exist in the table).
   *
   * @param ids    — Non-empty array of UUID strings (validated by the action layer)
   * @param patch  — Currently only `status` is supported for bulk updates
   * @returns      The updated WaitlistEntry rows
   * @throws       Error if ids array is empty (guard in the action layer too)
   */
  async bulkUpdate(
    ids: string[],
    patch: Pick<LeadPatch, "status">,
  ): Promise<WaitlistEntry[]> {
    if (ids.length === 0) {
      throw new Error("bulkUpdate called with empty ids array");
    }

    if (patch.status === undefined) {
      throw new Error("bulkUpdate: patch must include at least one field (status)");
    }

    // Defence-in-depth: validate status is in the allowed set.
    // The action layer validates first; this is a second line of defence.
    if (!LEAD_STATUSES.includes(patch.status as LeadStatus)) {
      throw new Error(`Invalid lead status: ${patch.status}`);
    }

    const updated = await db
      .update(waitlist)
      .set({ status: patch.status, updatedAt: new Date() })
      .where(inArray(waitlist.id, ids))
      .returning();

    return updated;
  }

  /**
   * getDistinctSources — Return all distinct source values in the table.
   *
   * Used to populate the source filter dropdown with only the sources
   * that actually exist in the data.
   */
  async getDistinctSources(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ source: waitlist.source })
      .from(waitlist)
      .orderBy(asc(waitlist.source));
    return rows.map((r) => r.source);
  }

  // ─── Beta invite methods ────────────────────────────────────────────────────

  /**
   * findInvitedByEmail — Find a waitlist entry by email with status "invited".
   *
   * Used by claimBetaInviteAction to verify self-declared email against the list.
   * Returns null if no matching invited entry found.
   *
   * @param email - Lowercased, trimmed email to look up
   */
  async findInvitedByEmail(email: string): Promise<WaitlistEntry | null> {
    const [row] = await db
      .select()
      .from(waitlist)
      .where(and(eq(waitlist.email, email), eq(waitlist.status, "invited")))
      .limit(1);
    return row ?? null;
  }

  /**
   * linkReplitUserId — Associate a Replit user ID with a waitlist entry.
   *
   * Called when a user successfully claims their invite via /verify-access.
   * Idempotent if the entry already has the same replitUserId.
   *
   * @param id           - UUID of the waitlist entry
   * @param replitUserId - Replit OIDC sub claim
   */
  async linkReplitUserId(id: string, replitUserId: string): Promise<void> {
    await db
      .update(waitlist)
      .set({ replitUserId, updatedAt: new Date() })
      .where(eq(waitlist.id, id));
  }

  /**
   * activateBetaUser — Transition a user's waitlist entry from "invited" → "active".
   *
   * Called when the user completes onboarding. Idempotent — if status is already
   * "active" the update is a no-op.
   *
   * @param replitUserId - Replit OIDC sub claim
   */
  async activateBetaUser(replitUserId: string): Promise<void> {
    await db
      .update(waitlist)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(waitlist.replitUserId, replitUserId), eq(waitlist.status, "invited")));
  }

  /**
   * markLeadInvited — Set a waitlist entry's status to "invited".
   *
   * Called by the owner CRM invite action. Safe to call on any non-active status.
   *
   * @param id - UUID of the waitlist entry to invite
   * @returns  The updated entry
   */
  async markLeadInvited(id: string): Promise<WaitlistEntry> {
    const [updated] = await db
      .update(waitlist)
      .set({ status: "invited", updatedAt: new Date() })
      .where(eq(waitlist.id, id))
      .returning();
    if (!updated) throw new Error(`Waitlist entry ${id} not found`);
    return updated;
  }

  /**
   * deleteEntry — Permanently remove a waitlist entry (owner cleanup).
   *
   * Does NOT touch any users row: if the entry was already claimed by an
   * account, that account keeps whatever plan it has — manage it from
   * /admin/users instead. Deleting an *invited but unclaimed* entry
   * effectively revokes the invite (claim lookups match by email + status).
   *
   * @param id - UUID of the waitlist entry to delete
   */
  async deleteEntry(id: string): Promise<void> {
    await db.delete(waitlist).where(eq(waitlist.id, id));
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * waitlistRepository — module-level singleton.
 * Import this directly; do not instantiate WaitlistRepository elsewhere.
 */
export const waitlistRepository = new WaitlistRepository();
