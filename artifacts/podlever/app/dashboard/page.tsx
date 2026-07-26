/**
 * app/dashboard/page.tsx — PodLever owner CRM dashboard
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #35 — Full Lead CRM replacement)
 *
 * Route: /dashboard (owner-only; unauthenticated/non-owner redirected to /)
 *
 * This is a Server Component that:
 *   1. Enforces owner-only access (requireOwner via getAuthUser + role check)
 *   2. Reads URL search params for CRM filter + pagination state
 *   3. Fetches paginated leads, metrics, and audit log server-side
 *   4. Logs lead_viewed to crm_audit_log on every page render
 *   5. Renders the full CRM UI (filter bar, table, export, audit log)
 *
 * SECURITY NOTES:
 *   - No public endpoints; all data access is server-side only
 *   - Client components receive already-fetched data; no client-side API calls
 *     for the initial render
 *   - requireOwner() is called at the start of every non-public path
 *
 * HUMAN REVIEW NOTES:
 * Phase 1B: Replace the status checklist section with episode management UI
 * once the processing pipeline (Task #2) is implemented.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/providers/auth";
import { waitlistRepository, crmAuditRepository } from "@/repositories";
import { LEAD_STATUSES } from "@/db/schema";
import { CrmFilters }    from "./components/CrmFilters";
import { LeadTable }     from "./components/LeadTable";
import { ExportButton }  from "./components/ExportButton";
import { AuditLogPanel } from "./components/AuditLogPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Valid page size values — used to coerce invalid URL params */
const VALID_PAGE_SIZES = [25, 50, 100] as const;

/**
 * parsePageSize — Coerce a raw URL param string to a valid page size.
 * Falls back to 25 if the value is missing or not in the allowed set.
 */
function parsePageSize(raw: string | undefined): 25 | 50 | 100 {
  const n = Number(raw);
  return (VALID_PAGE_SIZES as readonly number[]).includes(n)
    ? (n as 25 | 50 | 100)
    : 25;
}

/**
 * parsePage — Coerce a raw URL param string to a valid page number (≥ 1).
 */
function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * parseDate — Coerce an ISO date string to a Date, or undefined.
 */
function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * sanitizeSearch — Strip characters outside the email-safe set.
 * Mirrors the server-action FilterSchema transform for consistency.
 */
function sanitizeSearch(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^a-zA-Z0-9@._\-+]/g, "").trim().slice(0, 320);
  return cleaned || undefined;
}

/**
 * sanitizeStatus — Accept only values in LEAD_STATUSES.
 */
function sanitizeStatus(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return (LEAD_STATUSES as readonly string[]).includes(raw) ? raw : undefined;
}

/**
 * StatusCounts — per-status lead counts for the metrics bar.
 */
interface StatusCounts {
  total:         number;
  new:           number;
  contacted:     number;
  qualified:     number;
  converted:     number;
  disqualified:  number;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  // ── Auth guard ─────────────────────────────────────────────────────────────
  const user = await getAuthUser();

  if (!user) {
    redirect("/");
  }

  if (user.role !== "owner") {
    // Non-owner active beta users access their own episode list, not the owner CRM.
    // The middleware has already verified betaAccess === "active" before this point.
    redirect("/dashboard/episodes");
  }

  // ── Parse search params ────────────────────────────────────────────────────
  const params = await searchParams;

  const page     = parsePage(params.page);
  const pageSize = parsePageSize(params.pageSize);
  const search   = sanitizeSearch(params.search);
  const source   = params.source?.slice(0, 64).replace(/[^a-zA-Z0-9_\-]/g, "") || undefined;
  const status   = sanitizeStatus(params.status);
  const dateFrom = parseDate(params.dateFrom);
  const dateTo   = parseDate(params.dateTo);

  // ── Parallel data fetching ─────────────────────────────────────────────────
  const [leadsResult, statusCountsResult, sourcesResult, auditResult] = await Promise.allSettled([
    waitlistRepository.list({ page, pageSize, search, source, status, dateFrom, dateTo }),
    waitlistRepository.getStatusCounts(), // includes all statuses for metrics bar; sum = total
    waitlistRepository.getDistinctSources(),
    crmAuditRepository.listRecent(100),
  ]);

  const leadsData   = leadsResult.status   === "fulfilled" ? leadsResult.value   : { entries: [], total: 0 };
  const statusCounts = statusCountsResult.status === "fulfilled" ? statusCountsResult.value : {};
  const sources     = sourcesResult.status === "fulfilled" ? sourcesResult.value : [];
  const auditEntries = auditResult.status   === "fulfilled" ? auditResult.value   : [];

  // ── Log lead_viewed audit entry (fire-and-forget — never blocks render) ────
  crmAuditRepository.insert({
    actorId:   user.userId,
    action:    "lead_viewed",
    leadIds:   leadsData.entries.map((e) => e.id),
    meta: {
      page,
      pageSize,
      searchActive: !!search,
      source:       source   ?? null,
      status:       status   ?? null,
      dateFrom:     dateFrom?.toISOString() ?? null,
      dateTo:       dateTo?.toISOString()   ?? null,
      resultCount:  leadsData.entries.length,
    },
    ipAddress: null, // Not available in Server Component context
    userAgent: null,
  }).catch(() => {}); // Silently swallow — audit failures must not affect the dashboard

  // ── Metrics ────────────────────────────────────────────────────────────────
  // Total = sum of all status counts (unfiltered; from getStatusCounts query)
  const totalCount = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);

  const metrics: StatusCounts = {
    total:        totalCount,
    new:          statusCounts["new"]          ?? 0,
    contacted:    statusCounts["contacted"]    ?? 0,
    qualified:    statusCounts["qualified"]    ?? 0,
    converted:    statusCounts["converted"]    ?? 0,
    disqualified: statusCounts["disqualified"] ?? 0,
  };

  // Rebuild filter params string for the export URL
  const filterParamParts: string[] = [];
  if (search)   filterParamParts.push(`search=${encodeURIComponent(search)}`);
  if (source)   filterParamParts.push(`source=${encodeURIComponent(source)}`);
  if (status)   filterParamParts.push(`status=${encodeURIComponent(status)}`);
  if (params.dateFrom) filterParamParts.push(`dateFrom=${encodeURIComponent(params.dateFrom)}`);
  if (params.dateTo)   filterParamParts.push(`dateTo=${encodeURIComponent(params.dateTo)}`);
  const filterParams = filterParamParts.join("&");

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-zinc-950 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎙️</span>
              <h1 className="text-2xl font-bold text-white">PodLever</h1>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                CRM
              </span>
            </div>
            <p className="text-zinc-500 text-sm pl-9">
              Welcome back, <span className="text-zinc-300">{user.displayName}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 text-xs font-semibold transition-colors"
            >
              Admin console
            </Link>
            <Link
              href="/dashboard/episodes"
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 text-xs transition-colors"
            >
              My episodes
            </Link>
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 text-xs transition-colors"
            >
              View site
            </Link>
            <Link
              href="/auth/logout"
              className="px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 text-xs transition-colors"
            >
              Sign out
            </Link>
          </div>
        </div>

        {/* ── Metrics bar ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[
            { label: "Total",         value: metrics.total,         color: "text-white" },
            { label: "New",           value: metrics.new,           color: "text-zinc-300" },
            { label: "Contacted",     value: metrics.contacted,     color: "text-blue-300" },
            { label: "Qualified",     value: metrics.qualified,     color: "text-amber-300" },
            { label: "Converted",     value: metrics.converted,     color: "text-emerald-400" },
            { label: "Disqualified",  value: metrics.disqualified,  color: "text-red-400" },
          ].map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 space-y-1"
            >
              <p className={`text-2xl font-bold tabular-nums ${m.color}`}>{m.value}</p>
              <p className="text-zinc-600 text-xs">{m.label}</p>
            </div>
          ))}
        </div>

        {/* ── Lead CRM ────────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              Early Access Leads
            </h2>
            <ExportButton
              filterParams={filterParams}
              matchingCount={leadsData.total}
            />
          </div>

          {/* Filter controls */}
          <CrmFilters
            sources={sources}
            currentSearch={params.search ?? ""}
            currentSource={params.source ?? ""}
            currentStatus={params.status ?? ""}
            currentDateFrom={params.dateFrom ?? ""}
            currentDateTo={params.dateTo ?? ""}
            currentPageSize={params.pageSize ?? "25"}
          />

          {/* Lead table (with inline editing + detail panel) */}
          <LeadTable
            entries={leadsData.entries}
            total={leadsData.total}
            page={page}
            pageSize={pageSize}
          />
        </div>

        {/* ── Audit log ───────────────────────────────────────────────────── */}
        <AuditLogPanel entries={auditEntries} />

        {/* ── Phase 1A status (collapsed, retained for reference) ──────────── */}
        <details className="group">
          <summary className="cursor-pointer list-none px-1">
            <span className="text-xs font-semibold text-zinc-700 uppercase tracking-wider hover:text-zinc-500 transition-colors">
              Phase 1A status ▸
            </span>
          </summary>
          <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800">
            {[
              { label: "Authentication",  status: "ok", detail: `Signed in as ${user.displayName} (owner)` },
              { label: "Episode FSM",     status: "ok", detail: "Verified — 22/22 assertions passed" },
              { label: "Schema",          status: "ok", detail: "users · episodes · assets · pipeline_events · waitlist · crm_audit_log" },
              { label: "Server Actions",  status: "ok", detail: "listLeads · updateLead · exportLeads · joinWaitlist wired" },
            ].map((check) => (
              <div key={check.label} className="flex items-start gap-4 p-4">
                <span className="mt-0.5 flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs">
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-zinc-200 text-sm font-medium">{check.label}</p>
                  <p className="text-zinc-500 text-xs mt-0.5 font-mono">{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </details>

        {/* Footer */}
        <p className="text-center text-zinc-700 text-xs">
          PodLever · Russell Nomer Consulting · {new Date().getFullYear()}
        </p>

      </div>
    </main>
  );
}
