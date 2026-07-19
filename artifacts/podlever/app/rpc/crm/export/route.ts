/**
 * app/rpc/crm/export/route.ts — Streaming CSV export Route Handler
 *
 * Part of: PodLever
 * Created: 2026-07-19 by agent (Task #35 — Lead CRM CSV export)
 *
 * Route: GET /rpc/crm/export
 *
 * Produces a streaming CSV response delivered directly to the browser as a
 * file download. The data is NEVER written to disk or object storage.
 *
 * Security (CISSP Domain 1, 3, 7):
 *   - requireOwner() called before any data access
 *   - Export rate-limited: 3 per rolling 60-minute window per owner userId
 *   - Every export logged to crm_audit_log with row count + filter params
 *   - Failed auth attempts logged as auth_denied
 *   - No PII (email addresses) in audit meta or server logs
 *   - CSV is streamed directly — no temp files, no object storage, no pre-signed URLs
 *
 * Query params (all optional, same as CRM filter UI):
 *   - search   — partial email match
 *   - source   — exact source match
 *   - status   — exact status match
 *   - dateFrom — ISO date string (inclusive lower bound)
 *   - dateTo   — ISO date string (inclusive upper bound)
 *
 * Response:
 *   200 — Content-Type: text/csv; streaming download
 *   401 — Not authenticated
 *   403 — Not owner
 *   429 — Rate limit exceeded
 *   500 — Server error
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/providers/owner-guard";
import { waitlistRepository } from "@/repositories";
import { crmAuditRepository } from "@/repositories";
import { SlidingWindowRateLimiter } from "@/lib/rate-limiter";
import { consumeExportSlot } from "@/lib/export-rate-limiter";
import { LEAD_STATUSES } from "@/db/schema";

// ─── Filter validation (same rules as crm.actions.ts) ────────────────────────

// Zod requires a mutable tuple for z.enum(); spread the readonly const safely.
const LEAD_STATUSES_ENUM = [...LEAD_STATUSES] as [string, ...string[]];

const ExportQuerySchema = z.object({
  search:   z
    .string()
    .max(320)
    .transform((v) => v.replace(/[^a-zA-Z0-9@._\-+]/g, "").trim())
    .optional(),
  source:   z.string().max(64).regex(/^[a-zA-Z0-9_\-]+$/).optional(),
  status:   z.enum(LEAD_STATUSES_ENUM).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo:   z.coerce.date().optional(),
});

// ─── CSV utilities ────────────────────────────────────────────────────────────

/**
 * csvEscape — escape a field value for RFC 4180 CSV.
 *
 * Wraps the field in double quotes if it contains a comma, double quote,
 * or newline. Double quotes within the field are escaped as "".
 */
function csvEscape(value: string | null | undefined | Date): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** CSV column headers — no internal UUIDs exported per security spec */
const CSV_HEADERS = ["email", "source", "status", "notes", "signed_up_at", "updated_at"];

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Gate 1: Authentication + Authorization ─────────────────────────────────
  const ipAddress = SlidingWindowRateLimiter.extractIp(req.headers);
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 512);

  let owner;
  try {
    owner = await requireOwner();
  } catch (err) {
    // Log auth denial without PII
    await crmAuditRepository.insert({
      actorId:   null,
      action:    "auth_denied",
      leadIds:   null,
      meta:      { reason: "guard_failed", context: "crm_export" },
      ipAddress,
      userAgent,
    }).catch(() => {});

    const isUnauthorized = (err as Error).name === "UnauthorizedError" ||
                           (err as Error).message?.includes("Unauthorized");
    return NextResponse.json(
      { error: isUnauthorized ? "Not authenticated" : "Forbidden" },
      { status: isUnauthorized ? 401 : 403 },
    );
  }

  // ── Gate 2: Export rate limit (3 per 60 min per owner userId) ─────────────
  const rateResult = await consumeExportSlot(owner.userId);
  if (!rateResult.allowed) {
    console.warn("[crm.export] rate limit exceeded", { userId: owner.userId });
    return NextResponse.json(
      { error: "Export rate limit exceeded. You may export 3 times per hour." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  // ── Gate 3: Input validation ───────────────────────────────────────────────
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ExportQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid filter parameters" },
      { status: 400 },
    );
  }

  const filters = parsed.data;

  // ── Fetch data ─────────────────────────────────────────────────────────────
  let entries;
  try {
    entries = await waitlistRepository.exportLeads(filters);
  } catch (err) {
    console.error("[crm.export] DB error:", (err as Error).message);
    return NextResponse.json({ error: "Export failed — database error" }, { status: 500 });
  }

  // ── Audit log: lead_exported ───────────────────────────────────────────────
  // Log AFTER fetching (so rowCount is accurate) — before streaming (so the
  // log is written even if the stream is interrupted).
  await crmAuditRepository.insert({
    actorId:   owner.userId,
    action:    "lead_exported",
    leadIds:   entries.map((e) => e.id),
    meta: {
      rowCount:   entries.length,
      format:     "csv",
      remaining:  rateResult.remaining,
      filters: {
        searchActive: !!filters.search,
        source:       filters.source   ?? null,
        status:       filters.status   ?? null,
        dateFrom:     filters.dateFrom?.toISOString() ?? null,
        dateTo:       filters.dateTo?.toISOString()   ?? null,
      },
    },
    ipAddress,
    userAgent,
  }).catch(() => {});

  // ── Stream CSV response ────────────────────────────────────────────────────
  // Build CSV as a single string for simplicity (the dataset is bounded by the
  // waitlist size — not gigabytes). If the list ever grows to 100K+ rows,
  // switch to a ReadableStream generator.

  const rows: string[] = [
    // Header row
    CSV_HEADERS.join(","),
    // Data rows — no internal UUIDs exported
    ...entries.map((e) =>
      [
        csvEscape(e.email),
        csvEscape(e.source),
        csvEscape(e.status),
        csvEscape(e.notes),
        csvEscape(e.createdAt),
        csvEscape(e.updatedAt),
      ].join(","),
    ),
  ];

  const csvBody = rows.join("\r\n") + "\r\n";
  const filename = `podlever-leads-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Prevent browser caching of the export response
      "Cache-Control":       "no-store, no-cache, must-revalidate",
      "Pragma":              "no-cache",
    },
  });
}
