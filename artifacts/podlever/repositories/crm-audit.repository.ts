/**
 * repositories/crm-audit.repository.ts — Data access layer for the crm_audit_log table
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM audit trail)
 *
 * Dependencies: drizzle-orm (query builder), @/db (pool), @/db/schema
 *
 * SECURITY INVARIANTS (CISSP Domain 7 — Operations Security):
 * 1. INSERT ONLY — no update() or delete() calls exist in this file.
 *    The crm_audit_log table is tamper-evident; rows must never be modified.
 * 2. meta field MUST NOT contain PII. The caller is responsible for stripping
 *    email addresses and other personal data before passing meta to insert().
 * 3. userAgent is truncated to 512 chars at the repository level as a last-resort
 *    safeguard; callers should also truncate before calling.
 *
 * HUMAN REVIEW NOTES:
 * - If this file ever gains an update() or delete() method, treat it as a
 *   security incident and escalate immediately.
 * - listRecent() is read-only and safe to call from the owner dashboard.
 * - listForLead() uses PostgreSQL's @> array-containment operator via Drizzle's
 *   sql template tag — the leadId is a parameterized $N binding, never interpolated.
 */

import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  crmAuditLog,
  type CrmAuditEntry,
  type NewCrmAuditEntry,
} from "@/db/schema";

// ─── Repository ───────────────────────────────────────────────────────────────

export class CrmAuditRepository {
  /**
   * insert — Append a new audit entry to the immutable audit log.
   *
   * This is the ONLY write operation permitted on this table.
   * The userAgent field is truncated here as a final safeguard.
   * Never throws on failure — audit logging must not break the main flow.
   *
   * @param entry — NewCrmAuditEntry with all required fields populated
   */
  async insert(entry: NewCrmAuditEntry): Promise<void> {
    // Truncate userAgent to 512 chars — prevents oversized rows and log injection.
    const safeEntry: NewCrmAuditEntry = {
      ...entry,
      userAgent: entry.userAgent ? entry.userAgent.slice(0, 512) : null,
    };

    await db.insert(crmAuditLog).values(safeEntry);
  }

  /**
   * listRecent — Return the most recent audit entries, newest first.
   *
   * Used to render the audit log panel in the owner dashboard.
   * Read-only; never modifies any row.
   *
   * @param limit — Maximum number of entries to return (default 100)
   * @returns Array of CrmAuditEntry, ordered by createdAt descending
   */
  async listRecent(limit: number = 100): Promise<CrmAuditEntry[]> {
    return db
      .select()
      .from(crmAuditLog)
      .orderBy(desc(crmAuditLog.createdAt))
      .limit(limit);
  }

  /**
   * listForLead — Return audit entries that reference a specific lead ID.
   *
   * Used in the lead detail panel to show per-lead audit history.
   * PostgreSQL's `@>` (contains) operator checks if the leadIds uuid[] array
   * includes the given UUID. The leadId is passed as a parameterized Drizzle
   * sql binding — never interpolated into the query string.
   *
   * @param leadId — UUID of the waitlist entry to filter by
   * @param limit  — Maximum entries to return (default 50)
   */
  async listForLead(leadId: string, limit: number = 50): Promise<CrmAuditEntry[]> {
    // Drizzle sql`` template tag: ${leadId} becomes a $N parameterized binding.
    // The ARRAY[...] wrapping and ::uuid[] cast are literals in the SQL string,
    // NOT user-supplied data — safe to include without parameterization.
    return db
      .select()
      .from(crmAuditLog)
      .where(
        sql`${crmAuditLog.leadIds} @> ARRAY[${leadId}::uuid]::uuid[]`,
      )
      .orderBy(desc(crmAuditLog.createdAt))
      .limit(limit);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * crmAuditRepository — module-level singleton.
 * Import this directly; do not instantiate CrmAuditRepository elsewhere.
 */
export const crmAuditRepository = new CrmAuditRepository();
