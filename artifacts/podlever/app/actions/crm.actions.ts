/**
 * app/actions/crm.actions.ts — CRM Server Actions for the owner dashboard
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM)
 *
 * All actions in this file:
 *   1. Call requireOwner() at entry — no exceptions
 *   2. Validate and sanitize all inputs server-side
 *   3. Log every operation to crm_audit_log (actor, IP, UA, action, meta)
 *   4. Never include PII (email addresses) in log output or audit meta
 *
 * CISSP compliance:
 *   - Domain 1 (Access Control): requireOwner() guard on every action
 *   - Domain 3 (Cryptography/Data in Transit): no data written to disk
 *   - Domain 7 (Operations Security): tamper-evident audit trail for every action
 *
 * OWASP:
 *   - All inputs validated with Zod before reaching the repository layer
 *   - Search terms stripped of characters outside email-safe set, max 320 chars
 *   - Status validated against the LEAD_STATUSES allowlist
 *   - Notes capped at 1000 chars
 */

"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireOwner } from "@/providers/owner-guard";
import { waitlistRepository, crmAuditRepository } from "@/repositories";
import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";
import { exportRateLimiter } from "@/lib/export-rate-limiter";
import { LEAD_STATUSES, type LeadStatus } from "@/db/schema";
import type { WaitlistEntry } from "@/db/schema";

// ─── Input validation schemas ──────────────────────────────────────────────────

/**
 * FilterSchema — shared validation for all list/export filter params.
 *
 * Sanitization rules:
 *   - search: strip non-email-safe characters, max 320 chars
 *     Allowed chars: alphanumeric, @, ., _, -, +
 *   - source: alphanumeric, underscores, hyphens, max 64 chars
 *   - status: must be in LEAD_STATUSES allowlist
 *   - dates: ISO date strings converted to Date objects
 */
// Zod requires a mutable tuple for z.enum(); cast the readonly const safely.
const LEAD_STATUSES_ENUM = [...LEAD_STATUSES] as [string, ...string[]];

const FilterSchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.union([
    z.literal(25),
    z.literal(50),
    z.literal(100),
  ]).default(25),
  search:   z
    .string()
    .max(320, "Search term too long")
    // Strip characters outside email-safe set — prevents wildcard injection
    // and ensures the ILIKE pattern is safely bounded.
    .transform((v) => v.replace(/[^a-zA-Z0-9@._\-+]/g, "").trim())
    .optional(),
  source:   z
    .string()
    .max(64)
    .regex(/^[a-zA-Z0-9_\-]+$/, "Invalid source")
    .optional(),
  status:   z
    .enum(LEAD_STATUSES_ENUM)
    .optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo:   z.coerce.date().optional(),
}).optional().default({});

/** Export-only filter (no pagination) */
const ExportFilterSchema = FilterSchema;

/** UpdateLead patch schema */
const UpdateLeadSchema = z.object({
  id:     z.string().uuid("Lead ID must be a valid UUID"),
  status: z.enum(LEAD_STATUSES_ENUM).optional(),
  notes:  z
    .string()
    .max(1000, "Notes cannot exceed 1000 characters")
    .nullable()
    .optional(),
});

/**
 * BulkUpdateLeadsSchema — validates the input for bulkUpdateLeads.
 *
 * Constraints:
 *   - ids: 1–500 UUIDs (upper bound prevents accidentally updating every lead)
 *   - status: required for bulk updates (notes cannot be bulk-edited)
 */
const BulkUpdateLeadsSchema = z.object({
  ids: z
    .array(z.string().uuid("Each lead ID must be a valid UUID"))
    .min(1, "Select at least one lead")
    .max(500, "Cannot bulk-update more than 500 leads at once"),
  status: z.enum(LEAD_STATUSES_ENUM, { required_error: "Status is required for bulk updates" }),
});

// ─── Action result types ───────────────────────────────────────────────────────

export type CrmActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface LeadListData {
  entries: WaitlistEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExportLimitData {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ─── Helper: extract request metadata (IP + UA) ───────────────────────────────

/**
 * getRequestMeta — extract IP and user agent from the current request headers.
 *
 * IP: first value from X-Forwarded-For (Replit proxy injects this).
 * User agent: raw value, truncated to 512 chars (repository truncates again as defense-in-depth).
 *
 * These values go into the audit log for forensic traceability.
 */
async function getRequestMeta(): Promise<{ ipAddress: string; userAgent: string | null }> {
  const h = await headers();
  return {
    ipAddress: SlidingWindowRateLimiter.extractIp(h),
    userAgent: (h.get("user-agent") ?? "").slice(0, 512) || null,
  };
}

// ─── Server Actions ────────────────────────────────────────────────────────────

/**
 * listLeads — Paginated, filtered lead list for the CRM table.
 *
 * Security:
 *   - requireOwner() first — throws UnauthorizedError / ForbiddenError if not owner
 *   - Inputs validated + sanitized via FilterSchema
 *   - Logs lead_viewed with filter params (no emails in meta)
 *
 * @param rawOpts — Unvalidated filter + pagination options from the client
 */
export async function listLeads(
  rawOpts: unknown,
): Promise<CrmActionResult<LeadListData>> {
  // Gate 1: authentication + authorization
  let owner;
  try {
    owner = await requireOwner();
  } catch {
    // Log auth denial and propagate to client
    const meta = await getRequestMeta();
    await crmAuditRepository.insert({
      actorId:   null,
      action:    "auth_denied",
      leadIds:   null,
      meta:      { reason: "guard_failed", context: "listLeads" },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }).catch(() => {}); // Audit failures must never crash the action
    return { success: false, error: "Unauthorized" };
  }

  // Gate 2: input validation
  const parsed = FilterSchema.safeParse(rawOpts);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid filter" };
  }

  const opts = parsed.data ?? {};
  const page     = opts.page     ?? 1;
  const pageSize = opts.pageSize ?? 25;

  try {
    const { entries, total } = await waitlistRepository.list({
      page,
      pageSize: pageSize as 25 | 50 | 100,
      search:   opts.search,
      source:   opts.source,
      status:   opts.status,
      dateFrom: opts.dateFrom,
      dateTo:   opts.dateTo,
    });

    // Audit log: lead_viewed — no emails in meta
    const meta = await getRequestMeta();
    await crmAuditRepository.insert({
      actorId:   owner.userId,
      action:    "lead_viewed",
      leadIds:   entries.map((e) => e.id),
      meta: {
        page,
        pageSize,
        // Redact the actual search term — only record whether search was active
        searchActive: !!opts.search,
        source:       opts.source ?? null,
        status:       opts.status ?? null,
        dateFrom:     opts.dateFrom?.toISOString() ?? null,
        dateTo:       opts.dateTo?.toISOString() ?? null,
        resultCount:  entries.length,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }).catch(() => {});

    return { success: true, data: { entries, total, page, pageSize } };
  } catch (err) {
    console.error("[crm.listLeads] error:", (err as Error).message);
    return { success: false, error: "Failed to load leads" };
  }
}

/**
 * updateLead — Update a lead's status and/or notes.
 *
 * Security:
 *   - requireOwner() first
 *   - Fetches the lead before updating to capture old values for audit log
 *   - Logs lead_updated with old + new values (no PII — status/notes only)
 *
 * @param rawPatch — { id: uuid, status?: string, notes?: string | null }
 */
export async function updateLead(
  rawPatch: unknown,
): Promise<CrmActionResult<WaitlistEntry>> {
  let owner;
  try {
    owner = await requireOwner();
  } catch {
    const meta = await getRequestMeta();
    await crmAuditRepository.insert({
      actorId:   null,
      action:    "auth_denied",
      leadIds:   null,
      meta:      { reason: "guard_failed", context: "updateLead" },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }).catch(() => {});
    return { success: false, error: "Unauthorized" };
  }

  const parsed = UpdateLeadSchema.safeParse(rawPatch);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { id, status, notes } = parsed.data;

  // At least one field must be present in the patch
  if (status === undefined && notes === undefined) {
    return { success: false, error: "Nothing to update — provide status or notes" };
  }

  try {
    // Fetch current state for audit delta (before the update)
    const before = await waitlistRepository.getById(id);
    if (!before) {
      return { success: false, error: "Lead not found" };
    }

    const updated = await waitlistRepository.updateLead(id, {
      status: status as LeadStatus | undefined,
      notes,
    });

    // Audit log: lead_updated — include field deltas, no email
    const meta = await getRequestMeta();
    await crmAuditRepository.insert({
      actorId:   owner.userId,
      action:    "lead_updated",
      leadIds:   [id],
      meta: {
        ...(status !== undefined && {
          statusBefore: before.status,
          statusAfter:  status,
        }),
        ...(notes !== undefined && {
          notesBefore: before.notes ? "[had notes]" : "[empty]",
          notesAfter:  notes ? "[has notes]" : "[cleared]",
        }),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }).catch(() => {});

    return { success: true, data: updated };
  } catch (err) {
    console.error("[crm.updateLead] error:", (err as Error).message);
    return { success: false, error: "Failed to update lead" };
  }
}

// ─── Result type for bulk update ──────────────────────────────────────────────

export interface BulkUpdateResult {
  /** Number of leads that were actually updated (may be < ids.length if some were deleted). */
  updatedCount: number;
}

/**
 * bulkUpdateLeads — Update the status of multiple leads in a single operation.
 *
 * Security:
 *   - requireOwner() first — no exceptions
 *   - Input validated via BulkUpdateLeadsSchema (1–500 UUIDs, valid status)
 *   - Captures the distinct set of "before" statuses for the audit log
 *   - Writes a single lead_updated audit entry covering all affected IDs;
 *     count is recorded in meta — no email addresses in the log
 *
 * Audit meta shape:
 *   { bulk: true, count: N, statusBefore: "mixed|<status>", statusAfter: "<status>" }
 *
 * @param rawInput — { ids: string[], status: string }
 */
export async function bulkUpdateLeads(
  rawInput: unknown,
): Promise<CrmActionResult<BulkUpdateResult>> {
  // ── Gate 1: authentication + authorization ──────────────────────────────────
  let owner;
  try {
    owner = await requireOwner();
  } catch {
    const meta = await getRequestMeta();
    await crmAuditRepository.insert({
      actorId:   null,
      action:    "auth_denied",
      leadIds:   null,
      meta:      { reason: "guard_failed", context: "bulkUpdateLeads" },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }).catch(() => {});
    return { success: false, error: "Unauthorized" };
  }

  // ── Gate 2: input validation ────────────────────────────────────────────────
  const parsed = BulkUpdateLeadsSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { ids, status } = parsed.data;

  try {
    // Fetch current statuses for audit delta (before the update).
    // We only need the status field; use getById equivalent via list.
    // Fetch all target rows to capture old statuses — no emails logged.
    const beforeRows = await Promise.all(
      // Fetch in a single query using the repository's list method would require
      // an inArray filter which isn't exposed there; use individual getById calls
      // batched in parallel. For up to 500 IDs this is acceptable (single tx not required).
      ids.map((id) => waitlistRepository.getById(id)),
    );

    // Determine the "before" status summary — avoid logging every individual status.
    const distinctBefore = [...new Set(
      beforeRows.flatMap((r) => (r ? [r.status] : [])),
    )];
    const statusBeforeSummary =
      distinctBefore.length === 0 ? "unknown" :
      distinctBefore.length === 1 ? distinctBefore[0] :
      "mixed";

    // Perform the bulk update — single UPDATE … WHERE id = ANY($1).
    const updated = await waitlistRepository.bulkUpdate(ids, { status: status as LeadStatus });

    // ── Audit log: single entry for the entire bulk operation ─────────────────
    // Records the count and status transition; no PII (no emails) in meta.
    const reqMeta = await getRequestMeta();
    await crmAuditRepository.insert({
      actorId:   owner.userId,
      action:    "lead_updated",
      leadIds:   ids,
      meta: {
        bulk:         true,
        count:        updated.length,
        statusBefore: statusBeforeSummary,
        statusAfter:  status,
      },
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    }).catch(() => {});

    return { success: true, data: { updatedCount: updated.length } };
  } catch (err) {
    console.error("[crm.bulkUpdateLeads] error:", (err as Error).message);
    return { success: false, error: "Failed to bulk-update leads" };
  }
}

/**
 * checkExportLimit — Peek at the export rate limit without consuming a slot.
 *
 * Used by the ExportButton to show "X of 3 exports remaining this hour"
 * without affecting the limit. Does NOT log an audit entry.
 *
 * @returns ExportLimitData with current remaining count and resetAt timestamp
 */
export async function checkExportLimit(): Promise<CrmActionResult<ExportLimitData>> {
  let owner;
  try {
    owner = await requireOwner();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  // Peek without consuming — returns current state without recording a hit
  const result = await exportRateLimiter.peek(owner.userId);

  return {
    success: true,
    data: {
      allowed:   result.allowed,
      remaining: result.remaining,
      resetAt:   result.resetAt,
    },
  };
}

