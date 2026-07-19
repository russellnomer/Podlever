/**
 * db/schema/crm-audit-log.ts — Drizzle schema for the `crm_audit_log` table
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM audit trail)
 *
 * Tamper-evident append-only audit log for all CRM operations in the
 * owner dashboard. Satisfies CISSP Domain 7 (Operations Security) and
 * NIST CSF DE.AE-1 (audit trail for privileged data access).
 *
 * SECURITY INVARIANTS:
 * 1. NO UPDATE or DELETE operations — ever. The repository enforces this.
 *    Any code that attempts to update or delete from this table is a bug.
 * 2. `meta` must NEVER contain PII (no email addresses, no names).
 *    Only filter params, counts, and status values belong in meta.
 * 3. `ipAddress` is truncated to the first IP in X-Forwarded-For; no list stored.
 * 4. `userAgent` is truncated to 512 chars to prevent log-injection via UA.
 *
 * Actions logged:
 *   lead_viewed   — dashboard load / filter change (includes filter params)
 *   lead_updated  — status change or notes edit (old + new values, no email)
 *   lead_exported — CSV export (row count, filter params, format)
 *   auth_denied   — failed owner guard check (actor unknown, IP + UA logged)
 *
 * HUMAN REVIEW NOTES:
 * - This table has NO FK cascade deletes — rows are permanent.
 * - The actorId FK is nullable to handle auth_denied events where userId is unknown.
 * - leadIds is a uuid[] so a bulk export can reference all exported row IDs.
 *   For auth_denied events, leadIds is null (no specific lead was targeted).
 */

import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Table ───────────────────────────────────────────────────────────────────

/**
 * crmAuditLog — Immutable record of every CRM action taken by the owner.
 *
 * Insert-only. No UPDATE or DELETE is ever issued against this table.
 */
export const crmAuditLog = pgTable("crm_audit_log", {
  /** Surrogate primary key — random UUID avoids sequential guessing. */
  id: uuid("id").primaryKey().defaultRandom(),

  /**
   * actorId — DB UUID of the user who performed the action.
   *
   * Nullable because auth_denied events are logged before the identity
   * can be verified (the actor may not be a valid user at all).
   * FK to users.id is enforced in the migration but NOT declared here
   * with Drizzle `.references()` to avoid circular import issues
   * (users.ts ← crm-audit-log.ts would create a cycle through index.ts).
   * The FK is added in the migration SQL directly.
   */
  actorId: uuid("actor_id"),

  /**
   * action — The CRM operation that was performed.
   * One of: lead_viewed | lead_updated | lead_exported | auth_denied
   */
  action: text("action").notNull(),

  /**
   * leadIds — UUIDs of the waitlist rows affected by this action.
   *
   * For lead_viewed: array of the IDs in the returned page (may be large).
   * For lead_updated: single-element array with the updated lead's ID.
   * For lead_exported: array of all exported lead IDs.
   * For auth_denied: null (no lead was accessed).
   *
   * Stored as a native PostgreSQL uuid[] column.
   */
  leadIds: uuid("lead_ids").array(),

  /**
   * meta — Structured context for the action, stored as JSONB.
   *
   * MUST NOT contain PII (no email addresses, no names).
   * Example for lead_viewed:  { page: 1, pageSize: 25, search: "[redacted]", status: "new" }
   * Example for lead_updated: { field: "status", oldValue: "new", newValue: "contacted" }
   * Example for lead_exported: { rowCount: 47, format: "csv", filters: { status: "new" } }
   * Example for auth_denied:  { reason: "no_session" }
   */
  meta: jsonb("meta"),

  /**
   * ipAddress — Client IP, stripped to the first value from X-Forwarded-For.
   * Stored for forensic investigation; not used for rate limiting on this table.
   */
  ipAddress: text("ip_address"),

  /**
   * userAgent — Browser/client user agent string, truncated to 512 chars.
   * Truncated server-side before insert; prevents log injection via UA header.
   */
  userAgent: text("user_agent"),

  /**
   * createdAt — Immutable insertion timestamp.
   * Set by the DB default; never updated (the row is never updated at all).
   */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type CrmAuditEntry = typeof crmAuditLog.$inferSelect;
export type NewCrmAuditEntry = typeof crmAuditLog.$inferInsert;

/** Valid action types for the audit log — used at all call sites */
export type CrmAuditAction =
  | "lead_viewed"
  | "lead_updated"
  | "lead_exported"
  | "auth_denied";
